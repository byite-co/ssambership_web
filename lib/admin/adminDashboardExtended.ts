import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAdminDashboardSummary, type AdminDashboardSummary } from "@/lib/admin/adminQueries";

export type AdminKpiCard = {
  label: string;
  value: string;
  sub?: string;
  href: string;
  tone: "blue" | "amber" | "red" | "emerald";
};

// D-AD-11: 조회 실패는 0 이 아니라 null(—)로 구분한다.
export type AdminTrendPoint = { date: string; signups: number | null; cashKrw: number | null };

export type AdminIssueKind = "신고" | "콘텐츠검수" | "환불" | "분쟁";

export type AdminIssueRow = {
  id: string;
  kind: AdminIssueKind;
  title: string;
  status: string;
  createdAt: string;
  assignee: string;
  href: string;
};

export type AdminDashboardExtended = {
  summary: AdminDashboardSummary;
  kpis: AdminKpiCard[];
  trend: AdminTrendPoint[];
  donut: { name: string; value: number; fill: string }[];
  issues: AdminIssueRow[];
  schedule: { time: string; title: string }[];
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function pctChange(today: number | null, yesterday: number | null): string {
  if (today === null || yesterday === null) return "—";
  if (yesterday <= 0) return today > 0 ? "+100%" : "0%";
  const p = Math.round(((today - yesterday) / yesterday) * 100);
  return `${p >= 0 ? "+" : ""}${p}%`;
}

// D-AD-11: 조회 실패 시 0 이 아니라 null 을 반환해 '0건'과 '조회 실패'를 구분한다.
async function countUsersCreatedBetween(
  supabase: SupabaseClient,
  from: Date,
  to: Date
): Promise<number | null> {
  const { count, error } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString());
  if (error) return null;
  return count ?? 0;
}

async function sumCashLedgerBetween(supabase: SupabaseClient, from: Date, to: Date): Promise<number | null> {
  const { data, error } = await supabase
    .from("cash_ledger")
    .select("delta_cents, created_at")
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString())
    .limit(5000);
  if (error) return null;
  let sum = 0;
  for (const r of data ?? []) {
    const c = typeof (r as { delta_cents?: number }).delta_cents === "number" ? (r as { delta_cents: number }).delta_cents : 0;
    sum += Math.abs(c);
  }
  return Math.round(sum / 100);
}

export async function loadAdminDashboardExtended(supabase: SupabaseClient): Promise<AdminDashboardExtended> {
  const summary = await loadAdminDashboardSummary(supabase);

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  // D-AD-11: 순차 14+3 쿼리를 병렬로 실행해 TTFB 지연을 줄인다.
  // 7일 추이 각 일자의 (가입수, 캐시합계)를 한 번에 모은다.
  const dayWindows: Array<{ from: Date; to: Date; label: string }> = [];
  for (let i = 6; i >= 0; i--) {
    const d0 = new Date(todayStart);
    d0.setDate(d0.getDate() - i);
    const d1 = new Date(d0);
    d1.setDate(d1.getDate() + 1);
    dayWindows.push({ from: d0, to: d1, label: dayKey(d0).slice(5) });
  }

  const [signupsToday, signupsYesterday, cashToday, trendDays] = await Promise.all([
    countUsersCreatedBetween(supabase, todayStart, tomorrow),
    countUsersCreatedBetween(supabase, yesterdayStart, todayStart),
    sumCashLedgerBetween(supabase, todayStart, tomorrow),
    Promise.all(
      dayWindows.map(async (w) => {
        const [signups, cashKrw] = await Promise.all([
          countUsersCreatedBetween(supabase, w.from, w.to),
          sumCashLedgerBetween(supabase, w.from, w.to),
        ]);
        return { date: w.label, signups, cashKrw };
      })
    ),
  ]);

  const kpis: AdminKpiCard[] = [
    {
      label: "오늘 신규 가입",
      value: signupsToday === null ? "—" : String(signupsToday),
      sub: `어제 대비 ${pctChange(signupsToday, signupsYesterday)}`,
      href: "/admin/audit-logs",
      tone: "blue",
    },
    {
      label: "승인 대기 멘토",
      value: summary.mentorApprovalPendingCount == null ? "—" : String(summary.mentorApprovalPendingCount),
      sub: "승인 대기",
      href: "/admin/mentor-approval",
      tone: "amber",
    },
    {
      label: "미처리 신고",
      value: summary.reportOpenCount == null ? "—" : String(summary.reportOpenCount),
      sub: "검토·대기",
      href: "/admin/moderation",
      tone: "red",
    },
    {
      label: "금일 캐시 거래액",
      value: cashToday === null ? "—" : `${new Intl.NumberFormat("ko-KR").format(cashToday)}원`,
      sub: cashToday === null ? "조회 실패" : "원장 기준 추정",
      href: "/admin/refunds",
      tone: "emerald",
    },
  ];

  const trend: AdminTrendPoint[] = trendDays;

  // 실집계만 사용 — KPI(신고 대기·분쟁 처리중)와 수치를 일치시킴. 임의 샘플값 제거.
  const donut = [
    { name: "분쟁 처리중", value: summary.disputeActiveCount ?? 0, fill: "#2563EB" },
    { name: "신고 대기", value: summary.reportOpenCount ?? 0, fill: "#F59E0B" },
  ];

  const issues: AdminIssueRow[] = [];
  const { data: reports } = await supabase
    .from("content_reports")
    .select("id, reason, status, created_at, target_type")
    .order("created_at", { ascending: false })
    .limit(5);
  for (const r of reports ?? []) {
    const row = r as Record<string, unknown>;
    issues.push({
      id: String(row.id ?? ""),
      kind: "신고",
      title: String(row.reason ?? row.target_type ?? "콘텐츠 신고"),
      status: String(row.status ?? "pending"),
      createdAt: String(row.created_at ?? ""),
      assignee: "—",
      href: `/admin/moderation`,
    });
  }

  // 실데이터 연동 전까지 하드코딩 일정 제거 — 뷰에서 빈 상태("예정된 일정 없음") 처리
  const schedule: { time: string; title: string }[] = [];

  return { summary, kpis, trend, donut, issues, schedule };
}
