/**
 * 구독 환불 표시 유틸 — 학원법 시행령 별표4 분기 사유 문구 · 캐시/일자 포맷.
 *
 * 웹 PR-2 §5-3: 학생 화면의 환불 **계산**은 `api_app_v1.refund_estimate`(DB-4 200 · SQL 정본
 * `core_private.subscription_refund_estimate_impl`)로 옮겼고, 이 모듈은 그 응답의 `bracket_reason`
 * (TS 이름 그대로: before_usage · lt_1_3 · lt_1_2 · ge_1_2 · invalid)을 사용자 문구로 바꾸는 표시 전용이다.
 * `subscriptionRefundProration.ts`(TS 계산 · 관리자 콘솔·멘토 종료 경로 잔존)도 이 문구를 re-export 한다.
 */

export type RefundBracketReason =
  | "before_usage" // 이용 개시 전 — 전액
  | "lt_1_3" // 학생자발: 경과율 < 1/3 → 2/3 환불
  | "lt_1_2" // 학생자발: 경과율 < 1/2 → 1/2 환불
  | "ge_1_2" // 학생자발: 경과율 ≥ 1/2 → 환불 없음
  | "mentor_remaining" // 멘토 사정: 남은 기간 일할비례
  | "invalid"; // 입력값 부족 — 계산 불가

export function isRefundBracketReason(v: unknown): v is RefundBracketReason {
  return (
    v === "before_usage" || v === "lt_1_3" || v === "lt_1_2" || v === "ge_1_2" || v === "mentor_remaining" || v === "invalid"
  );
}

export function formatCashFromCents(amountCents: number | null | undefined): string {
  const cash = Math.max(0, Math.round((amountCents ?? 0) / 100));
  return `${cash.toLocaleString("ko-KR")}캐시`;
}

export function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "일정 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "일정 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/** 학원법 분기 결과를 사용자에게 보여줄 사유 문구. */
export function refundBracketLabelKo(reason: RefundBracketReason): string {
  switch (reason) {
    case "before_usage":
      return "이용 개시 전 — 전액 환불";
    case "lt_1_3":
      return "기간 1/3 미경과 — 결제액의 2/3 환불";
    case "lt_1_2":
      return "기간 1/2 미경과 — 결제액의 1/2 환불";
    case "ge_1_2":
      return "기간 1/2 경과 — 환불 가능 금액 없음";
    case "mentor_remaining":
      return "제공자 사정 — 남은 기간만큼 환불";
    case "invalid":
      return "환불 추정 불가";
    default:
      return "";
  }
}
