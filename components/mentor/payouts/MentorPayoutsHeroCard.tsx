import {
  CUSTOM_REQUEST_PLATFORM_FEE_LABEL,
  INDIVIDUAL_QUESTION_PLATFORM_FEE_LABEL,
  PAYOUT_WITHHOLDING_LABEL,
  PAYOUT_WITHHOLDING_TOOLTIP,
  SUBSCRIPTION_PLATFORM_FEE_LABEL,
} from "@/lib/mentor/mentorPayoutsConstants";
import { Repeat, Briefcase, MessageCircleQuestion, Wallet } from "lucide-react";
import type { MentorPayoutScheduleInfo, MentorPayoutSummary } from "@/lib/mentor/mentorPayoutsTypes";
import { SURFACE_CARD } from "@/lib/ui/surfaceCard";
import { formatCashKrw } from "./payoutUi";

// 색 위계: 발생 전 단순 정보 = 중립 slate / "지급 완료 합계" = 완료 초록 #059669. (멘토 정체성 초록 #059669는 본문에 쓰지 않음)
const TILE_NEUTRAL = "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F1F5F9] text-[#64748B]";
const TILE_DONE = "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#059669]";

type Props = {
  summary: MentorPayoutSummary;
  schedule: MentorPayoutScheduleInfo;
  lifetimePaid: number;
};

export function MentorPayoutsHeroCard(props: Props) {
  const { summary, schedule, lifetimePaid } = props;

  return (
    <section className={`${SURFACE_CARD} border-l-[4px] border-l-[#059669]`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-slate-500">이번 달 실지급 예정액 · {schedule.monthLabel}</p>
          <p className="mt-2 text-[38px] font-bold leading-none tabular-nums tracking-tight text-slate-900">
            {formatCashKrw(summary.thisMonthNetScheduledPayout)}
          </p>
          {/* W-01 4단 구조: 총 수익 → 플랫폼 수수료 → 원천징수 3.3%(강조) → 실지급 예정액 */}
          <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
            총 수익 <span className="font-semibold tabular-nums text-slate-700">{formatCashKrw(summary.thisMonthGross)}</span>
            {" − "}플랫폼 수수료{" "}
            <span className="font-semibold tabular-nums text-slate-700">{formatCashKrw(summary.thisMonthFee)}</span>
            {" − "}
            <strong className="font-extrabold text-rose-600" title={PAYOUT_WITHHOLDING_TOOLTIP}>
              {PAYOUT_WITHHOLDING_LABEL} {formatCashKrw(summary.thisMonthWithholding)}
            </strong>
            {" = "}실지급 예정액
          </p>
        </div>
        <div className="sm:text-right">
          <p className="text-[12px] font-semibold text-slate-500">지급 예정일</p>
          <p className="mt-1 text-base font-bold text-slate-900">{schedule.nextPayoutLabel}</p>
          <span className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-extrabold text-amber-900">
            정산 예정
          </span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 pt-6 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={TILE_NEUTRAL}>
              <Repeat className="h-3.5 w-3.5" aria-hidden />
            </span>
            <p className="text-[12px] font-semibold text-slate-500">구독 수익</p>
          </div>
          <p className="mt-2 text-[20px] font-bold tabular-nums text-slate-900">
            {formatCashKrw(summary.thisMonthSubscription)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">{SUBSCRIPTION_PLATFORM_FEE_LABEL}</p>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className={TILE_NEUTRAL}>
              <Briefcase className="h-3.5 w-3.5" aria-hidden />
            </span>
            <p className="text-[12px] font-semibold text-slate-500">맞춤의뢰 수익</p>
          </div>
          <p className="mt-2 text-[20px] font-bold tabular-nums text-slate-900">
            {formatCashKrw(summary.thisMonthCustomRequest)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">{CUSTOM_REQUEST_PLATFORM_FEE_LABEL}</p>
        </div>
        {/* W-04: 개별질문 수익 라인 */}
        <div>
          <div className="flex items-center gap-2">
            <span className={TILE_NEUTRAL}>
              <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />
            </span>
            <p className="text-[12px] font-semibold text-slate-500">개별질문 수익</p>
          </div>
          <p className="mt-2 text-[20px] font-bold tabular-nums text-slate-900">
            {formatCashKrw(summary.thisMonthIndividualQuestion)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">{INDIVIDUAL_QUESTION_PLATFORM_FEE_LABEL}</p>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className={TILE_DONE}>
              <Wallet className="h-3.5 w-3.5" aria-hidden />
            </span>
            <p className="text-[12px] font-semibold text-slate-500">누적 정산</p>
          </div>
          <p className="mt-2 text-[20px] font-bold tabular-nums text-[#059669]">{formatCashKrw(lifetimePaid)}</p>
          <p className="mt-1 text-[11px] text-slate-400">지급 완료 합계</p>
        </div>
      </div>
    </section>
  );
}
