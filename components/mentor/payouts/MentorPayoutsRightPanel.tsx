import Link from "next/link";
import { PAGE_COL_GAP, SURFACE_CARD } from "@/lib/ui/surfaceCard";
import {
  MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE,
  MENTOR_SUBSCRIPTION_PLATFORM_SHARE,
} from "@/lib/mentor/mentorPayoutsConstants";
import type { MentorPayoutMonthlyCard, MentorPayoutScheduleInfo } from "@/lib/mentor/mentorPayoutsTypes";
import { MentorPayoutsMonthlyAreaChartLazy } from "./MentorPayoutsChartLazy";

type Props = {
  schedule: MentorPayoutScheduleInfo;
  months: MentorPayoutMonthlyCard[];
};

export function MentorPayoutsRightPanel(props: Props) {
  const { schedule } = props;

  return (
    <aside className={`flex w-full flex-col self-start xl:sticky xl:top-24 ${PAGE_COL_GAP}`}>
      <section className={SURFACE_CARD}>
        <h3 className="text-sm font-extrabold text-slate-900">지급 일정</h3>
        <p className="mt-3 text-xs font-semibold text-slate-500">다음 지급 예정일</p>
        <p className="mt-1 text-lg font-black text-slate-900">{schedule.nextPayoutLabel}</p>
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
            <span>{schedule.monthLabel} 정산 진행 현황</span>
            <span>{schedule.monthProgressPct}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-[#059669] transition-all"
              style={{ width: `${schedule.monthProgressPct}%` }}
            />
          </div>
        </div>
      </section>

      <section className={SURFACE_CARD}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-slate-900">월간 추이</h3>
          <span className="rounded-lg border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
            최근 6개월
          </span>
        </div>
        <div className="mt-3">
          <MentorPayoutsMonthlyAreaChartLazy months={props.months} />
        </div>
      </section>

      <section className={SURFACE_CARD}>
        <h3 className="text-sm font-extrabold text-slate-900">정산 안내</h3>
        <dl className="mt-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-[11px] font-medium text-slate-400">지급일</dt>
            <dd className="text-right text-[13px] font-medium text-slate-700">매월 10일 · 등록 계좌</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-[11px] font-medium text-slate-400">수수료</dt>
            <dd className="text-right text-[13px] font-medium text-slate-700">
              구독 {Math.round(MENTOR_SUBSCRIPTION_PLATFORM_SHARE * 100)}% · 맞춤의뢰{" "}
              {Math.round(MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE * 100)}%
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-[11px] font-medium text-slate-400">환불·취소</dt>
            <dd className="text-right text-[13px] font-medium text-slate-700">익월 정산 반영</dd>
          </div>
        </dl>
        <Link href="/mentor/support/disputes" className="mt-4 inline-flex text-xs font-bold text-[#059669] hover:underline">
          1:1 문의하기 →
        </Link>
      </section>
    </aside>
  );
}
