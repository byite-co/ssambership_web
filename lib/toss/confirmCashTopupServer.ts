import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { isAllowedChargePayKrw } from "@/lib/cash/chargePackages";
import { recordCashTopupFromTossOrder } from "@/lib/toss/cashTopupFromPayment";
import type { ConfirmCashTopupOutcome } from "@/lib/toss/tossTopupCore";
import { confirmCashTopupCore } from "@/lib/toss/tossTopupCore";

/**
 * 인증 사용자 기반 Toss 승인(confirm) 공용 서버 코어.
 *
 * success page(/wallet/charge/success)와 /api/toss/confirm 라우트가 **같은 함수**를
 * 직접 호출한다 — 서버 내부 self-fetch(NEXT_PUBLIC_SITE_URL·localhost 폴백·Cookie
 * 문자열 재전달) 경로는 제거됐다. webhook 은 이 코어를 쓰지 않는다(서명 기반
 * 별도 계약 — app/api/toss/webhook 참조).
 *
 * 검증 순서는 tossTopupCore.confirmCashTopupCore 계약을 따른다: 인증·소유권·
 * 패키지 allowlist 를 전부 통과한 뒤에만 Toss 외부 승인을 호출한다.
 */
/** Toss REST 기본 인증 헤더. 시크릿 키는 헤더 생성에만 쓰고 어디에도 로깅하지 않는다. */
function tossBasicAuthHeader(): string {
  const secret = process.env.TOSS_SECRET_KEY ?? "";
  return `Basic ${Buffer.from(`${secret}:`).toString("base64")}`;
}

export async function confirmCashTopupForCurrentUser(input: {
  paymentKey: unknown;
  orderId: unknown;
  amount: unknown;
}): Promise<ConfirmCashTopupOutcome> {
  return confirmCashTopupCore(input, {
    getAuthenticatedUserId: async () => {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      return data?.user?.id ?? null;
    },
    isAllowedPayKrw: isAllowedChargePayKrw,
    hasTossSecret: () => Boolean(process.env.TOSS_SECRET_KEY?.trim()),
    tossConfirm: async ({ paymentKey, orderId, amount }) => {
      const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
        method: "POST",
        headers: {
          Authorization: tossBasicAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paymentKey, orderId, amount }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as
        | { status?: unknown; orderId?: unknown; totalAmount?: unknown; method?: unknown; code?: unknown }
        | null;
      if (!res.ok) {
        const errorCode = typeof data?.code === "string" ? data.code : null;
        // 원문 응답은 서버 로그에만 남긴다(사용자 노출은 코어의 고정 문구가 담당).
        console.error("[toss/confirm] failed", { status: res.status, orderId, errorCode });
        return { ok: false, data: null, errorCode };
      }
      return { ok: true, data };
    },
    // 기승인(ALREADY_PROCESSED_PAYMENT) 대조 전용 — orderId 로 정본 주문을 조회한다.
    tossLookupOrder: async (orderId) => {
      const res = await fetch(
        `https://api.tosspayments.com/v1/payments/orders/${encodeURIComponent(orderId)}`,
        {
          method: "GET",
          headers: { Authorization: tossBasicAuthHeader() },
          cache: "no-store",
        },
      );
      const data = (await res.json().catch(() => null)) as
        | { status?: unknown; orderId?: unknown; totalAmount?: unknown; method?: unknown }
        | null;
      if (!res.ok || !data) {
        console.error("[toss/confirm] order lookup failed", { status: res.status, orderId });
        return { ok: false, data: null };
      }
      return { ok: true, data };
    },
    recordTopup: async (orderId, payAmountWon) => {
      let admin: ReturnType<typeof createServiceRoleClient>;
      try {
        admin = createServiceRoleClient();
      } catch (e) {
        console.error("[toss/confirm] service role client", e);
        return { ok: false, code: "server_config", message: "충전 기록에 실패했습니다." };
      }
      return recordCashTopupFromTossOrder({ admin, orderId, payAmountWon });
    },
  });
}
