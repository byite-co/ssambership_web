/**
 * 구독 환불 추정 계산 — 학원법 시행령 별표4 분기형.
 *
 * ⚠️ 웹 PR-2 §5-3(설계상 폐기): **학생 화면·학생 환불 신청 경로는 이 TS 계산을 쓰지 않는다.**
 *    표시는 `api_app_v1.refund_estimate`, 생성은 `api_app_v1.refund_request_create`(DB-4 200 · SQL 정본
 *    `core_private.subscription_refund_estimate_impl` · 앱 A-4b 와 같은 함수 · 같은 숫자) — `subscriptionRefundRpc.ts`.
 *    이 모듈은 관리자 환불 콘솔(`lib/admin/refundConsole*.ts` · 이 PR 범위 밖)과 멘토 활동 종료 잔여 환불
 *    (`lib/mentor/mentorActivityService.ts` · mentor_suspended 모드)의 소비처가 남아 있어 유지한다.
 *    두 소비처를 SQL 정본으로 옮기는 것은 DB-6/관리자 PR 몫이며, 그때 이 모듈을 삭제한다.
 *    학생 경로에 다시 import 하지 마라(계약 테스트 subscriptionRefundRpc 가 감시).
 *
 * 모드:
 *  - "student_voluntary" (default): 학원법 별표4 적용
 *    · 이용 개시 전(usageStarted=false): 전액
 *    · 경과율 < 1/3: 2/3 환불
 *    · 경과율 < 1/2: 1/2 환불
 *    · 경과율 ≥ 1/2: 환불 없음
 *  - "mentor_suspended" (제공자 사정 중단): 남은 기간 × 결제액 (잔여 100% 일할비례)
 *    학원법 "제공자 사정으로 교습 불가 시 남은 기간 환불" 조항 반영.
 *
 * 1개월 초과 결제(분기·연간) 대응은 현 monthly 모델 범위 밖이라 추후.
 */

import { type RefundBracketReason } from "./subscriptionRefundDisplay.ts";

export { formatCashFromCents, formatDateLabel, refundBracketLabelKo } from "./subscriptionRefundDisplay.ts";
export type { RefundBracketReason } from "./subscriptionRefundDisplay.ts";

export type RefundMode = "student_voluntary" | "mentor_suspended";

export type ProratedRefundEstimate = {
  amountCents: number;
  remainingDays: number;
  totalDays: number;
  remainingRatio: number;
  bracketReason: RefundBracketReason;
  mode: RefundMode;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function computeProratedRefundEstimate(args: {
  amountCents: number | null | undefined;
  periodStartIso: string | null | undefined;
  periodEndIso: string | null | undefined;
  now?: Date;
  /** 학원법 "이용 개시" 판정 — 첫 질문 작성 여부. mode='student_voluntary' 에서만 사용. */
  usageStarted?: boolean;
  /** 환불 사유 모드. default = student_voluntary */
  mode?: RefundMode;
}): ProratedRefundEstimate {
  const amountCents = Math.max(0, Math.trunc(args.amountCents ?? 0));
  const start = validDate(args.periodStartIso);
  const end = validDate(args.periodEndIso);
  const now = args.now && !Number.isNaN(args.now.getTime()) ? args.now : new Date();
  const mode: RefundMode = args.mode ?? "student_voluntary";

  if (!amountCents || !start || !end || end.getTime() <= start.getTime()) {
    return {
      amountCents: 0,
      remainingDays: 0,
      totalDays: 0,
      remainingRatio: 0,
      bracketReason: "invalid",
      mode,
    };
  }

  const totalMs = end.getTime() - start.getTime();
  const elapsedMs = Math.max(0, now.getTime() - start.getTime());
  const remainingMs = Math.max(0, end.getTime() - now.getTime());
  const remainingRatio = Math.min(1, remainingMs / totalMs);
  const elapsedRatio = Math.min(1, elapsedMs / totalMs);
  const totalDays = Math.max(1, Math.ceil(totalMs / DAY_MS));
  const remainingDays = Math.ceil(remainingMs / DAY_MS);

  // (1) 멘토 사정 중단 — 학원법 "남은 기간 환불" 그대로(잔여 일할비례 100%).
  //     "이용 개시" 구간 가산은 적용하지 않는다(과실이 제공자에 있으므로).
  if (mode === "mentor_suspended") {
    return {
      amountCents: Math.floor(amountCents * remainingRatio),
      remainingDays,
      totalDays,
      remainingRatio,
      bracketReason: "mentor_remaining",
      mode,
    };
  }

  // (2) 학생 자발 환불 — 학원법 별표4 분기형

  // 이용 개시 전: 전액 환불
  if (args.usageStarted === false) {
    return {
      amountCents,
      remainingDays,
      totalDays,
      remainingRatio,
      bracketReason: "before_usage",
      mode,
    };
  }

  // 경과율 < 1/3 → 결제액 × 2/3
  if (elapsedRatio < 1 / 3) {
    return {
      amountCents: Math.floor((amountCents * 2) / 3),
      remainingDays,
      totalDays,
      remainingRatio,
      bracketReason: "lt_1_3",
      mode,
    };
  }

  // 경과율 < 1/2 → 결제액 × 1/2
  if (elapsedRatio < 1 / 2) {
    return {
      amountCents: Math.floor(amountCents / 2),
      remainingDays,
      totalDays,
      remainingRatio,
      bracketReason: "lt_1_2",
      mode,
    };
  }

  // 경과율 ≥ 1/2 → 환불 없음
  return {
    amountCents: 0,
    remainingDays,
    totalDays,
    remainingRatio,
    bracketReason: "ge_1_2",
    mode,
  };
}
