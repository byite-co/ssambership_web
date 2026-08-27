"use client";

import dynamic from "next/dynamic";
import type { SettlementTrendPoint } from "@/lib/mentor/mentorSettlementDisplay";

const MentorPayoutsMonthlyAreaChartInner = dynamic(
  () => import("./MentorPayoutsCharts").then((m) => m.MentorPayoutsMonthlyAreaChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-48 items-center justify-center text-xs text-slate-400">차트 불러오는 중…</div>
    ),
  }
);

export function MentorPayoutsMonthlyAreaChartLazy(props: { trend: SettlementTrendPoint[] }) {
  return <MentorPayoutsMonthlyAreaChartInner trend={props.trend} />;
}
