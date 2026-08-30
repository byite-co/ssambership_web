// 페이싱크 캐시 충전 코어 — 순수 모듈(포트 주입, next/supabase 미의존, node --test 대상).
//
// tossTopupCore.recordCashTopupCore 와 같은 자리·같은 역할이며, 다른 점은 하나다:
// **적립 직전 페이싱크에 재조회해 정본을 대조한다.**
//
// 왜 재조회가 필수인가 (2026-08-30 실측):
//   실제 `invoice.paid` 웹훅 본문이 `paid: false` 로 왔다. 같은 주문을
//   `GET /v1/invoices/{id}` 로 조회하면 `paid: true` 다 — 페이싱크가 상태 전이 커밋 전
//   스냅샷을 이벤트에 싣는다. 즉 **웹훅 페이로드의 상태·금액은 정본이 아니다.**
//   토스 웹훅이 적립 전 Toss 에 재조회하는 verifyWebhookPaymentWithToss 와 동일한 이유다.
//
// 검증 순서 계약(§1):
//   로컬 주문 조회 → 이미 적립됨 판정 → 소유자 대조 → (그제서야) 페이싱크 재조회 →
//   원격 paid·금액 대조 → F11 원장 → 로컬 status 전이 → past_due 복구.
//   로컬에 없는 주문·이미 적립된 주문·소유자 불일치에서는 **외부 호출 0회**이고,
//   원격 미결제·금액 불일치에서는 **F11 호출 0회**다. 계약 테스트가 호출 횟수를 센다.
//
// 멱등: F11 의 `p_order_ref` = 로컬 `ledger_order_ref`(발급 시 고정, 주문당 1개).
//   웹훅이 몇 번 재전송되든, 크론이 같은 주문을 다시 집어도 이중 적립이 없다.

/** 로컬 `paysync_invoices` 행에서 코어가 쓰는 필드만. */
export type LocalPaysyncInvoice = {
  id: string;
  userId: string;
  paysyncInvoiceId: string;
  ledgerOrderRef: string;
  payKrw: number;
  cashKrw: number;
  status: "pending" | "paid" | "expired" | "canceled";
};

export type RemotePaysyncInvoice = {
  paid: boolean;
  amountWon: number;
};

export type PaysyncTopupSkip =
  /** 로컬 `paysync_invoices` 에 없는 주문 — 우리가 발급하지 않았다(외부 호출 0). */
  | "unknown_invoice"
  /** 로컬이 이미 paid — 재전송·크론 중복(외부 호출 0, F11 0). 정상 멱등 경로다. */
  | "already_paid"
  /** 웹훅 metadata.userId 가 로컬 소유자와 다르다(외부 호출 0). */
  | "owner_mismatch"
  /** 페이싱크 재조회 실패(네트워크·404 등) — 크론이 나중에 다시 집는다. */
  | "lookup_failed"
  /** 재조회 결과가 아직 미결제 — 적립하지 않는다(F11 0). */
  | "remote_not_paid"
  /** 재조회 금액이 로컬 주문 금액과 다르다(F11 0). */
  | "amount_mismatch";

export type PaysyncTopupResult =
  | {
      ok: true;
      duplicate: boolean;
      userId: string;
      invoiceId: string;
      cashKrw: number;
      /** pending 이 아닌 주문에 입금이 도착한 이상 상황(적립은 진행하고 기록만 남긴다). */
      staleStatus: "expired" | "canceled" | null;
    }
  | { ok: false; skip: PaysyncTopupSkip }
  | { ok: false; failed: string; message: string };

export type PaysyncTopupPorts = {
  /** 로컬 정본 조회. 없으면 null. */
  findLocalInvoice: (paysyncInvoiceId: string) => Promise<LocalPaysyncInvoice | null>;
  /** 페이싱크 재조회(GET /v1/invoices/{id}). 실패는 코드만 돌려준다. */
  fetchRemoteInvoice: (
    paysyncInvoiceId: string,
  ) => Promise<{ ok: true; invoice: RemotePaysyncInvoice } | { ok: false; code: string }>;
  /** F11 `api_web_v1.record_cash_topup_v2` 포트. */
  recordTopupV2: (
    userId: string,
    amountCents: number,
    orderRef: string,
  ) => Promise<{ ok: true; duplicate: boolean } | { ok: false; code: string }>;
  /** 로컬 status → paid 전이(+paid_at·paid_trigger). F11 성공 뒤에만 호출된다. */
  markLocalPaid: (localId: string, trigger: string | null) => Promise<void>;
  /** 신규 적립 성공 직후 1회(best-effort). duplicate 재생에서는 호출하지 않는다. */
  recoverPastDue: (userId: string) => Promise<void>;
};

/**
 * 원(KRW) → cents(원×100).
 * 단일 소스는 lib/toss/tossTopupCore.ts 의 동명 함수다 — 두 채널이 같은 원장에 쓰므로
 * 환산 규칙이 갈라지면 안 된다. 순수 모듈 간 import 제약을 피하려 여기 복제하되,
 * 계약 테스트가 두 구현의 출력 동치를 검증해 드리프트를 막는다.
 */
export function krwWonToCents(won: number): number {
  if (!Number.isFinite(won) || won <= 0 || won > 10_000_000) return 0;
  return Math.round(won) * 100;
}

/** F11 envelope 실패 코드 → 안정 실패(코드 은폐·성공 승격 금지 — 토스 경로와 동일). */
function failureFromF11Code(code: string): PaysyncTopupResult {
  switch (code) {
    case "ORDER_REF_INVALID":
      // ledger_order_ref 형식 오류. DB CHECK 가 막고 있어 도달 불가여야 한다.
      return { ok: false, failed: "invalid_order", message: "주문 번호 형식이 올바르지 않습니다." };
    case "ORDER_REF_OWNER_MISMATCH":
      return { ok: false, failed: "order_owner_mismatch", message: "본인 주문만 확인할 수 있습니다." };
    case "LEDGER_FIELD_MISMATCH":
      return {
        ok: false,
        failed: "LEDGER_FIELD_MISMATCH",
        message: "충전 기록이 기존 결제 내역과 일치하지 않습니다. 고객센터로 문의해 주세요.",
      };
    default:
      return { ok: false, failed: "ledger_failed", message: "충전 기록에 실패했습니다." };
  }
}

export async function recordPaysyncTopupCore(
  input: {
    paysyncInvoiceId: string;
    /** 웹훅 metadata.userId (크론 경로에서는 null — 로컬이 정본이므로 대조를 건너뛴다). */
    eventUserId: string | null;
    /** 감사용 trigger. 로직 분기 없음. */
    trigger: string | null;
  },
  ports: PaysyncTopupPorts,
): Promise<PaysyncTopupResult> {
  const invoiceId = String(input.paysyncInvoiceId ?? "").trim();
  if (!invoiceId) return { ok: false, skip: "unknown_invoice" };

  // 1) 로컬 정본 — 우리가 발급한 주문만 적립 대상이다(외부 호출 전).
  const local = await ports.findLocalInvoice(invoiceId);
  if (!local) return { ok: false, skip: "unknown_invoice" };

  // 2) 이미 적립됨 — 재전송·크론 중복의 정상 경로. 외부 호출·F11 둘 다 0회.
  if (local.status === "paid") return { ok: false, skip: "already_paid" };

  // 3) 소유자 대조 — 웹훅이 준 userId 가 있으면 로컬과 같아야 한다.
  if (input.eventUserId && input.eventUserId !== local.userId) {
    return { ok: false, skip: "owner_mismatch" };
  }

  // 4) 여기서야 외부 재조회 — 위 단계에서 걸리면 호출 0회다.
  const remote = await ports.fetchRemoteInvoice(invoiceId);
  if (!remote.ok) return { ok: false, skip: "lookup_failed" };

  // 5) 원격 정본 대조 — 웹훅 페이로드가 아니라 이 값이 결제 완료의 근거다.
  if (remote.invoice.paid !== true) return { ok: false, skip: "remote_not_paid" };
  if (remote.invoice.amountWon !== local.payKrw) return { ok: false, skip: "amount_mismatch" };

  const amountCents = krwWonToCents(local.cashKrw);
  if (amountCents <= 0) {
    return { ok: false, failed: "invalid_amount", message: "충전 금액이 올바르지 않습니다." };
  }

  // 6) F11 원장 — p_order_ref 가 멱등키다. 중복 호출은 duplicate 로 통과한다.
  const rpc = await ports.recordTopupV2(local.userId, amountCents, local.ledgerOrderRef);
  if (!rpc.ok) return failureFromF11Code(rpc.code);

  // 7) 로컬 전이. F11 성공 뒤에만 — 순서가 뒤집히면 원장 없이 paid 로 보이는 행이 생긴다.
  //    (F11 성공 후 이 단계가 실패하면 로컬은 pending 으로 남고, 다음 재시도가 F11
  //     duplicate 를 거쳐 다시 여기로 와서 스스로 복구된다.)
  await ports.markLocalPaid(local.id, input.trigger);

  // 8) 신규 적립일 때만 past_due 복구 1회(best-effort — 실패해도 적립을 되돌리지 않는다).
  if (!rpc.duplicate) {
    try {
      await ports.recoverPastDue(local.userId);
    } catch {
      /* 적립 결과 유지 */
    }
  }

  return {
    ok: true,
    duplicate: rpc.duplicate,
    userId: local.userId,
    invoiceId,
    cashKrw: local.cashKrw,
    // pending 이 아닌 주문에 입금이 도착했다 — 돈은 실제로 들어왔으므로 적립은 하고
    // 이상 상황만 기록한다(막으면 돈이 묶인다).
    staleStatus: local.status === "expired" || local.status === "canceled" ? local.status : null,
  };
}
