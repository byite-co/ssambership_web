import {
  CUSTOM_REQUEST_PLATFORM_FEE_LABEL,
  INDIVIDUAL_QUESTION_PLATFORM_FEE_LABEL,
  PAYOUT_WITHHOLDING_LABEL,
  PAYOUT_WITHHOLDING_TOOLTIP,
  SUBSCRIPTION_PLATFORM_FEE_LABEL,
} from "@/lib/mentor/mentorPayoutsConstants";
import { Repeat, Briefcase, MessageCircleQuestion, TriangleAlert, Wallet } from "lucide-react";
import { centsToCash, formatKstMonthDay, type MentorSettlementSummary } from "@/lib/mentor/mentorSettlementSchema";
import { formatRunDateLabel, monthNumberOf } from "@/lib/mentor/mentorSettlementDisplay";
import { SURFACE_CARD } from "@/lib/ui/surfaceCard";
import { formatCashKrw } from "./payoutUi";

// 색 위계: 발생 전 단순 정보 = 중립 slate / "지급 완료 합계" = 완료 초록 #059669. (멘토 정체성 초록 #059669는 본문에 쓰지 않음)
const TILE_NEUTRAL = "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F1F5F9] text-[#64748B]";
const TILE_DONE = "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#059669]";

type Props = {
  summary: MentorSettlementSummary;
  /** KST 오늘 'YYYY-MM-DD' — run_date 경과 여부(과거 월은 지급 완료분이 confirmed 에 포함) */
  todayKst: string;
};

/**
 * 상단 카드 — 모든 금액은 mentor_settlement_summary RPC 값 그대로.
 * 산식 줄은 confirmed 버킷만 쓴다(적립중·확정 모집단 혼합 표시 버그 수정).
 */
export function MentorPayoutsHeroCard(props: Props) {
  const { summary, todayKst } = props;
  const monthNumber = monthNumberOf(summary.month);
  // run_date 가 오늘(KST) 이전이면 이미 지급이 실행된 월 — "예정" 표기를 뗀다
  const runDatePassed = summary.runDate < todayKst;
  const headline = runDatePassed
    ? `${monthNumber}월 확정 실지급액`
    : `${monthNumber}월 확정 실지급 예정액`;

  const bySource = summary.bySourceThisMonth;
  const subscriptionCash = centsToCash(bySource.subscription?.mentorAmountCents ?? 0);
  const customRequestCash = centsToCash(bySource.custom_request?.mentorAmountCents ?? 0);
  const individualQuestionCash = centsToCash(bySource.individual_question?.mentorAmountCents ?? 0);

  return (
    <section className={`${SURFACE_CARD} border-l-[4px] border-l-[#059669]`}>
      {!summary.payoutAccountRegistered ? (
        <a
          href="#payout-account"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-[13px] leading-snug text-amber-950 hover:bg-amber-100"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <span>
            <strong className="font-extrabold">정산 계좌 미등록</strong> — 등록 전까지 지급이 다음 달로
            이월됩니다. <span className="font-bold underline underline-offset-2">계좌 등록하기</span>
          </span>
        </a>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-slate-500">{headline}</p>
          <p className="mt-2 text-[38px] font-bold leading-none tabular-nums tracking-tight text-slate-900">
            {formatCashKrw(centsToCash(summary.confirmed.netCents))}
          </p>
          {/* 산식 줄 — 네 값 모두 confirmed 버킷(RPC 값 그대로). 적립중 포함 총수익과 섞지 않는다. */}
          <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
            총 수익{" "}
            <span className="font-semibold tabular-nums text-slate-700">
              {formatCashKrw(centsToCash(summary.confirmed.grossCents))}
            </span>
            {" − "}플랫폼 수수료{" "}
            <span className="font-semibold tabular-nums text-slate-700">
              {formatCashKrw(centsToCash(summary.confirmed.platformFeeCents))}
            </span>
            {" − "}
            <strong className="font-extrabold text-rose-600" title={PAYOUT_WITHHOLDING_TOOLTIP}>
              {PAYOUT_WITHHOLDING_LABEL} {formatCashKrw(centsToCash(summary.confirmed.withholdingCents))}
            </strong>
            {" = "}
            {runDatePassed ? "실지급액" : "실지급 예정액"}
          </p>
          {/* 적립중 — 아직 확정되지 않은 금액. 확정 시점·지급 예정일을 RPC 값으로 안내한다. */}
          {summary.accruing.count > 0 ? (
            <p className="mt-2 inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-[12px] text-sky-900">
              <span className="font-extrabold">적립중</span>
              <span className="font-semibold tabular-nums">
                {formatCashKrw(centsToCash(summary.accruing.mentorAmountCents))}
              </span>
              <span className="tabular-nums text-sky-800">
                (원천징수 후 {centsToCash(summary.accruing.netCents).toLocaleString("ko-KR")})
              </span>
              {summary.accruing.lastPeriodEnd ? (
                <span className="text-sky-700">· {formatKstMonthDay(summary.accruing.lastPeriodEnd)} 확정</span>
              ) : null}
              {summary.accruing.expectedRunDate ? (
                <span className="text-sky-700">· {summary.accruing.expectedRunDate} 지급 예정</span>
              ) : null}
            </p>
          ) : null}
          {summary.held.count > 0 ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-[12px] text-slate-700">
              <span className="font-extrabold">보류</span>
              <span className="font-semibold tabular-nums">
                {formatCashKrw(centsToCash(summary.held.mentorAmountCents))}
              </span>
              <span className="text-slate-500">· {summary.held.count}건</span>
            </p>
          ) : null}
        </div>
        <div className="sm:text-right">
          <p className="text-[12px] font-semibold text-slate-500">{runDatePassed ? "지급일" : "지급 예정일"}</p>
          <p className="mt-1 text-base font-bold text-slate-900">{formatRunDateLabel(summary.runDate)}</p>
          <span className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-extrabold text-amber-900">
            정산 예정
          </span>
        </div>
      </div>

      {/* 하단 4칸 — 소스별 이번 달 발생 수익(by_source_this_month)·누적 정산(paid_total) 전부 RPC 값 */}
      <div className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 pt-6 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={TILE_NEUTRAL}>
              <Repeat className="h-3.5 w-3.5" aria-hidden />
            </span>
            <p className="text-[12px] font-semibold text-slate-500">구독 수익</p>
          </div>
          <p className="mt-2 text-[20px] font-bold tabular-nums text-slate-900">
            {formatCashKrw(subscriptionCash)}
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
            {formatCashKrw(customRequestCash)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">{CUSTOM_REQUEST_PLATFORM_FEE_LABEL}</p>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className={TILE_NEUTRAL}>
              <MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />
            </span>
            <p className="text-[12px] font-semibold text-slate-500">개별질문 수익</p>
          </div>
          <p className="mt-2 text-[20px] font-bold tabular-nums text-slate-900">
            {formatCashKrw(individualQuestionCash)}
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
          <p className="mt-2 text-[20px] font-bold tabular-nums text-[#059669]">
            {formatCashKrw(centsToCash(summary.paidTotal.netCents))}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">지급 완료 합계</p>
        </div>
      </div>
    </section>
  );
}
