import type { MentorSettlementPageData } from "@/lib/mentor/mentorSettlementDisplay";
import { ResponsivePageColumns } from "@/components/shell/ResponsivePageColumns";
import { MentorPayoutsHeroCard } from "./MentorPayoutsHeroCard";
import { MentorPayoutsMain } from "./MentorPayoutsMain";
import { MentorPayoutAccountPanel } from "./MentorPayoutAccountPanel";
import { MentorPayoutsRightPanel } from "./MentorPayoutsRightPanel";

export function MentorPayoutsPage(props: { data: MentorSettlementPageData }) {
  const { data } = props;
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-6">
      <header className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">멘토 정산</h1>
        <p className="mt-1 text-sm text-slate-600">예상 정산 금액과 서비스 수익을 확인하세요.</p>
      </header>
      {/* lg+ 데스크탑은 기존 2단(본문 + 300px 우측 패널) 그대로, 모바일은 단일컬럼(본문→우측 패널 아래로). */}
      <ResponsivePageColumns
        gap="gap-[18px]"
        desktopGrid="xl:grid-cols-[1fr_300px]"
        main={
          <div className="min-w-0 space-y-[18px]">
            <MentorPayoutsHeroCard summary={data.summary} todayKst={data.todayKst} />
            <MentorPayoutAccountPanel
              bankName={data.bank.bankName}
              accountNumber={data.bank.accountMasked}
              editable={data.bank.editable}
            />
            <MentorPayoutsMain
              defaultMonth={data.month}
              initialLines={data.lines}
              performanceLines={data.performanceLines}
            />
          </div>
        }
        aside={
          <MentorPayoutsRightPanel
            runDate={data.summary.runDate}
            monthLabel={`${Number(data.month.slice(5, 7))}월`}
            monthProgressPct={data.monthProgressPct}
            trend={data.trend}
          />
        }
      />
    </div>
  );
}
