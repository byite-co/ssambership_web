import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/lib/types/user";

/**
 * 계정 삭제 사전조건 검사 (스펙 docs/plans/account-deletion-spec.md §2-2).
 * service_role 클라이언트로 호출한다(RLS 무관 정확 집계 — 결과는 본인 화면에만 노출).
 * 읽기 전용 — 어떤 행도 수정하지 않는다.
 */

export type DeletionPrecondition = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  resolveHref: string | null;
};

export type DeletionPreconditionResult = {
  items: DeletionPrecondition[];
  /** 잔액 외 모든 조건 통과 여부 */
  blockersOk: boolean;
  /** 지갑 잔액(cents). >0이면 "환불 신청 선행" 또는 "소멸 동의"가 필요 */
  walletBalanceCents: number;
};

/** 주문 primary status 해석 — orderLifecycleConstants.ts:19의 우선순위(status→state→order_status→stage)를 그대로 따른다(정본 파일 무수정, 로컬 미러). */
function orderPrimaryStatus(row: Record<string, unknown>): string {
  for (const k of ["status", "state", "order_status", "stage"] as const) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
  }
  return "";
}

/** 터미널 주문 상태 — 통합보고서·orderLifecycleConstants 라벨맵의 terminal 집합과 동일 */
const ORDER_TERMINAL_STATUSES = new Set([
  "completed",
  "accepted",
  "closed",
  "finished",
  "cancelled",
  "canceled",
  "refunded",
  "rejected",
  "done",
  "resolved",
  "dispute_resolved",
]);

const IQ_ACTIVE_STATUSES = ["open", "assigned", "claimed", "answered"] as const;
const SUBSCRIPTION_ACTIVE_STATUSES = ["active", "past_due"] as const;
const DISPUTE_ACTIVE_STATUSES = ["open", "under_review"] as const;

async function countRows(
  admin: SupabaseClient,
  table: string,
  build: (q: ReturnType<SupabaseClient["from"]>["select"] extends never ? never : any) => any
): Promise<number> {
  const base = admin.from(table).select("id", { count: "exact", head: true });
  const { count, error } = await build(base);
  if (error) return -1; // 조회 실패는 보수적으로 "차단" 취급 (호출부에서 ok=false)
  return count ?? 0;
}

export async function checkAccountDeletionPreconditions(
  admin: SupabaseClient,
  userId: string,
  role: AppRole
): Promise<DeletionPreconditionResult> {
  const items: DeletionPrecondition[] = [];

  // ── 구독 ──────────────────────────────────────────────────────────────
  if (role === "student") {
    const n = await countRows(admin, "subscriptions", (q: any) =>
      q.eq("student_id", userId).in("status", SUBSCRIPTION_ACTIVE_STATUSES)
    );
    items.push({
      key: "subscriptions",
      label: "활성 구독 없음",
      ok: n === 0,
      detail: n > 0 ? `진행 중인 구독 ${n}건 — 먼저 해지해 주세요.` : "통과",
      resolveHref: n > 0 ? "/subscriptions" : null,
    });
  } else {
    // 멘토: 구독자 보유 시 기존 활동 해지 플로우 선행 필수 (스펙 §2-2)
    const n = await countRows(admin, "subscriptions", (q: any) =>
      q.eq("mentor_id", userId).in("status", SUBSCRIPTION_ACTIVE_STATUSES)
    );
    items.push({
      key: "subscribers",
      label: "구독자 없음 (활동 해지 완료)",
      ok: n === 0,
      detail:
        n > 0
          ? `구독자 ${n}명 보유 — 멘토 활동 해지 플로우를 먼저 완료해 주세요.`
          : "통과",
      resolveHref: n > 0 ? "/mentor/mypage" : null,
    });
  }

  // ── 개별질문(IQ) 진행 건 ──────────────────────────────────────────────
  {
    const q =
      role === "student"
        ? (b: any) => b.eq("student_id", userId).in("status", IQ_ACTIVE_STATUSES)
        : (b: any) =>
            b.or(`claimed_mentor_id.eq.${userId},designated_mentor_id.eq.${userId}`).in(
              "status",
              IQ_ACTIVE_STATUSES
            );
    const n = await countRows(admin, "individual_questions", q);
    items.push({
      key: "individual_questions",
      label: "진행 중인 개별질문 없음",
      ok: n === 0,
      detail: n > 0 ? `진행 중 ${n}건 — 답변 확인 또는 만료 후 다시 시도해 주세요.` : "통과",
      resolveHref:
        n > 0 ? (role === "student" ? "/individual-questions" : "/mentor/individual-questions") : null,
    });
  }

  // ── 맞춤의뢰 주문 (터미널 외) ─────────────────────────────────────────
  {
    const col = role === "student" ? "student_id" : "mentor_id";
    const { data, error } = await admin
      .from("custom_request_orders")
      .select("id, status, state, order_status, stage")
      .eq(col, userId)
      .limit(200);
    const active = error
      ? -1
      : (data ?? []).filter((r) => !ORDER_TERMINAL_STATUSES.has(orderPrimaryStatus(r as Record<string, unknown>)))
          .length;
    items.push({
      key: "custom_request_orders",
      label: "진행 중인 맞춤의뢰 주문 없음",
      ok: active === 0,
      detail: active > 0 ? `진행 중 주문 ${active}건 — 완료·취소 후 다시 시도해 주세요.` : "통과",
      resolveHref:
        active > 0
          ? role === "student"
            ? "/custom-request/orders"
            : "/mentor/custom-request/orders"
          : null,
    });
  }

  // ── 분쟁 ─────────────────────────────────────────────────────────────
  {
    const n = await countRows(admin, "disputes", (q: any) =>
      q.or(`student_id.eq.${userId},mentor_id.eq.${userId}`).in("status", DISPUTE_ACTIVE_STATUSES)
    );
    items.push({
      key: "disputes",
      label: "진행 중인 분쟁 없음",
      ok: n === 0,
      detail: n > 0 ? `진행 중 분쟁 ${n}건 — 종결 후 다시 시도해 주세요.` : "통과",
      resolveHref: n > 0 ? (role === "student" ? "/support/disputes" : "/mentor/support/disputes") : null,
    });
  }

  // ── 지갑 잔액 ────────────────────────────────────────────────────────
  let walletBalanceCents = 0;
  {
    const { data } = await admin
      .from("cash_wallets")
      .select("balance_cents")
      .eq("user_id", userId)
      .maybeSingle();
    const raw = Number((data as Record<string, unknown> | null)?.balance_cents ?? 0);
    walletBalanceCents = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
  }

  const blockersOk = items.every((i) => i.ok);
  return { items, blockersOk, walletBalanceCents };
}
