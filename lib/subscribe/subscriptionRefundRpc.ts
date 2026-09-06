import { isRefundBracketReason, type RefundBracketReason } from "./subscriptionRefundDisplay.ts";

/**
 * 학생 구독 환불 RPC 계약(DB-4 200 · `api_app_v1` · authenticated 세션 클라이언트) — 순수 코어.
 *
 * - `refund_estimate(p_subscription_id uuid) returns jsonb`
 *     성공 `{ok:true, refundable_cents, amount_cents, rule, bracket_reason, usage_started, elapsed_days, period_days,
 *            remaining_days, remaining_ratio, elapsed_ratio, period_start, period_end, billing_event_id, billing_payment_id, as_of}`
 *     실패 `{ok:false, code: AUTH_REQUIRED | SUBSCRIPTION_NOT_FOUND | NOT_SUBSCRIPTION_OWNER}`
 * - `refund_request_create(p_subscription_id uuid, p_reason text) returns jsonb`
 *     성공 `{ok:true, refund_id, subscription_id, amount_cents, rule, bracket_reason, status:'pending'}`
 *     실패 `{ok:false, code: … REASON_TOO_SHORT(min_length) · ALREADY_REQUESTED(refund_id) · REFUND_NOT_AVAILABLE(rule·bracket_reason)
 *            · SUBSCRIPTION_NOT_CURRENT · ROLE_NOT_STUDENT · 계정 4종 …}`
 *
 * 웹 PR-2 §5-3: 학생 화면의 예상액 표시·환불 신청 생성은 이 두 RPC 만 쓴다(앱 A-4b 와 같은 함수 · 같은 숫자).
 * 구 TS 계산(`subscriptionRefundProration.computeProratedRefundEstimate`)은 학생 경로에서 쓰지 않는다.
 */

export const REFUND_RPC_SCHEMA = "api_app_v1" as const;
export const REFUND_ESTIMATE_RPC = "refund_estimate" as const;
export const REFUND_REQUEST_CREATE_RPC = "refund_request_create" as const;

export type SubscriptionRefundEstimateView = {
  /** 환불 예상액(cents · 원×100) */
  amountCents: number;
  remainingDays: number;
  totalDays: number;
  bracketReason: RefundBracketReason;
  /** 서버 규칙 문구(`rule` · 예 "1/3 전") — 표시 보조 */
  rule: string | null;
  usageStarted: boolean | null;
  /** RPC 실패(권한·조회 오류) — 화면은 '확인 불가' 로 안내하고 신청 버튼을 열지 않는다 */
  unavailable: boolean;
};

function intOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return null;
}

function readString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function unavailableRefundEstimate(): SubscriptionRefundEstimateView {
  return { amountCents: 0, remainingDays: 0, totalDays: 0, bracketReason: "invalid", rule: null, usageStarted: null, unavailable: true };
}

/** `refund_estimate` 응답 → 표시 모델. ok:false·RPC 오류·깨진 응답은 unavailable(금액 0 · 신청 불가). */
export function parseRefundEstimateResponse(data: unknown, rpcError?: { message?: string } | null): SubscriptionRefundEstimateView {
  if (rpcError || !data || typeof data !== "object" || Array.isArray(data)) return unavailableRefundEstimate();
  const o = data as Record<string, unknown>;
  if (o.ok !== true) return unavailableRefundEstimate();
  const bracket = isRefundBracketReason(o.bracket_reason) ? o.bracket_reason : "invalid";
  return {
    amountCents: Math.max(0, intOrNull(o.refundable_cents) ?? 0),
    remainingDays: Math.max(0, intOrNull(o.remaining_days) ?? 0),
    totalDays: Math.max(0, intOrNull(o.period_days) ?? 0),
    bracketReason: bracket,
    rule: readString(o, "rule"),
    usageStarted: typeof o.usage_started === "boolean" ? o.usage_started : null,
    unavailable: false,
  };
}

export type RefundRequestCreateOutcome =
  | { ok: true; refundId: string | null; amountCents: number; bracketReason: RefundBracketReason }
  | { ok: false; code: string | null; message: string };

export const REFUND_REQUEST_ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "로그인이 만료됐어요. 다시 로그인해 주세요.",
  ROLE_NOT_STUDENT: "학생 계정만 환불을 신청할 수 있어요.",
  ACCOUNT_BANNED: "이용이 제한된 계정이에요. 고객센터에 문의해 주세요.",
  ACCOUNT_SUSPENDED: "일시 정지된 계정은 환불을 신청할 수 없어요.",
  ACCOUNT_NOT_ACTIVE: "지금은 환불을 신청할 수 없는 계정 상태예요. 고객센터에 문의해 주세요.",
  ACCOUNT_DELETION_IN_PROGRESS: "탈퇴가 진행 중인 계정이에요. 탈퇴를 취소한 뒤 다시 시도해 주세요.",
  REASON_TOO_SHORT: "환불 신청 사유를 5자 이상 입력해 주세요.",
  REASON_TOO_LONG: "환불 신청 사유가 너무 길어요. 2,000자 이하로 줄여 주세요.",
  SUBSCRIPTION_NOT_FOUND: "구독을 찾을 수 없습니다.",
  NOT_SUBSCRIPTION_OWNER: "본인 구독만 처리할 수 있습니다.",
  SUBSCRIPTION_NOT_CURRENT: "이미 종료되었거나 환불 신청할 수 없는 구독입니다.",
  ALREADY_REQUESTED: "이미 검토 중인 환불 신청이 있습니다.",
  REFUND_NOT_AVAILABLE: "남은 이용 기간이 없거나 환불 예상액을 계산할 수 없습니다.",
};

export const REFUND_REQUEST_GENERIC_ERROR = "환불 신청을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";

/** `refund_request_create` 응답 → 결과. REFUND_NOT_AVAILABLE 은 bracket_reason 이 ge_1_2 면 학원법 문구로 세분화. */
export function parseRefundRequestCreateResponse(data: unknown, rpcError?: { message?: string } | null): RefundRequestCreateOutcome {
  if (rpcError || !data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, code: null, message: REFUND_REQUEST_GENERIC_ERROR };
  }
  const o = data as Record<string, unknown>;
  if (o.ok === true) {
    return {
      ok: true,
      refundId: readString(o, "refund_id"),
      amountCents: Math.max(0, intOrNull(o.amount_cents) ?? 0),
      bracketReason: isRefundBracketReason(o.bracket_reason) ? o.bracket_reason : "invalid",
    };
  }
  const code = readString(o, "code");
  if (code === "REFUND_NOT_AVAILABLE" && o.bracket_reason === "ge_1_2") {
    return { ok: false, code, message: "학원법 기준으로 기간 1/2를 경과하여 환불 가능 금액이 없습니다." };
  }
  if (code && REFUND_REQUEST_ERROR_MESSAGES[code]) {
    return { ok: false, code, message: REFUND_REQUEST_ERROR_MESSAGES[code] };
  }
  return { ok: false, code, message: REFUND_REQUEST_GENERIC_ERROR };
}
