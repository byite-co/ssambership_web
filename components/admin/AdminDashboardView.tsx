"use client";

import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import type { AdminDashboardExtended } from "@/lib/admin/adminDashboardExtended";

const PRIMARY = "#2563EB";

const QUICK_LINKS = [
  { href: "/admin/mentor-approval", label: "멘토 승인" },
  { href: "/admin/moderation", label: "콘텐츠 검수" },
  { href: "/admin/disputes", label: "신고·분쟁 확인" },
  { href: "/admin/reviews", label: "리뷰 관리" },
  { href: "/admin/refunds", label: "환불 요청 확인" },
  { href: "/admin/notices", label: "이벤트 만들기" },
] as const;

const kpiBorder: Record<string, string> = {
  blue: "border-blue-100",
  amber: "border-amber-100",
  red: "border-red-100",
  emerald: "border-emerald-100",
};

function formatIssueTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // TZ-FIX R3 #35: SSR(UTC)/해외 CSR 표기 갈림 → Asia/Seoul 고정.
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" }).format(d);
}

const issueKindClass: Record<string, string> = {
  신고: "bg-red-50 text-red-700 border-red-200",
  콘텐츠검수: "bg-blue-50 text-blue-700 border-blue-200",
  환불: "bg-amber-50 text-amber-800 border-amber-200",
  분쟁: "bg-orange-50 text-orange-800 border-orange-200",
};

export function AdminDashboardView(props: { data: AdminDashboardExtended }) {
  const { kpis, trend, donut, issues, schedule } = props.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-black text-slate-900">관리자 대시보드</h1>
        <p className="mt-1 text-sm text-slate-600">운영 현황을 한눈에 확인합니다.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <Link
            key={k.label}
            href={k.href}
            className={`rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md ${kpiBorder[k.tone]}`}
          >
            <p className="text-xs font-bold text-slate-500">{k.label}</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{k.value}</p>
            {k.sub ? <p className="mt-1 text-xs font-semibold text-slate-500">{k.sub}</p> : null}
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-extrabold text-slate-900">7일 가입·거래 추이</h2>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line yAxisId="left" type="monotone" dataKey="signups" name="가입" stroke={PRIMARY} strokeWidth={2} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="cashKrw" name="거래(원)" stroke="#059669" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-extrabold text-slate-900">문의·신고 처리 상태</h2>
          {donut.some((e) => e.value > 0) ? (
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {donut.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="mt-4 flex h-64 items-center justify-center text-sm font-medium text-slate-500">
              표시할 데이터가 없어요
            </div>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-extrabold text-slate-900">최근 운영 이슈</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-xs font-bold text-slate-600">
                <th className="px-5 py-3">유형</th>
                <th className="px-5 py-3">제목</th>
                <th className="px-5 py-3">상태</th>
                <th className="px-5 py-3">접수시간</th>
                <th className="px-5 py-3">담당자</th>
                <th className="px-5 py-3 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {issues.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                    아직 최근 운영 이슈가 없어요
                  </td>
                </tr>
              ) : (
                issues.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/50">
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${
                          issueKindClass[row.kind] ?? "bg-slate-50 text-slate-600 border-slate-200"
                        }`}
                      >
                        {row.kind}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link href={row.href} className="font-bold text-[#2563EB] hover:underline">
                        {row.title}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{row.status}</td>
                    <td className="px-5 py-3 text-slate-500">{formatIssueTime(row.createdAt)}</td>
                    <td className="px-5 py-3 text-slate-500">{row.assignee}</td>
                    <td className="px-5 py-3 text-center text-slate-400" aria-label="더보기">
                      ⋮
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-5 py-3 text-center">
          <button type="button" className="text-xs font-bold text-slate-500 hover:text-[#2563EB]">
            더 보기 ∨
          </button>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-extrabold text-slate-900">빠른 작업</h2>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {QUICK_LINKS.map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-bold text-slate-800 transition hover:border-[#2563EB] hover:bg-blue-50 hover:text-[#2563EB]"
              >
                {q.label}
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold text-slate-900">오늘 일정</h2>
            <Link href="/admin/notices" className="text-xs font-bold text-[#2563EB] hover:underline">
              전체 보기 &gt;
            </Link>
          </div>
          <ul className="mt-4 space-y-3">
            {schedule.length === 0 ? (
              <li className="text-sm text-slate-500">아직 등록된 일정이 없어요</li>
            ) : (
              schedule.map((s) => (
                <li key={s.time} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                  <span className="shrink-0 text-xs font-black text-[#2563EB]">{s.time}</span>
                  <span className="text-sm font-semibold text-slate-800">{s.title}</span>
                </li>
              ))
            )}
          </ul>
          <button
            type="button"
            className="mt-4 w-full rounded-xl border border-dashed border-slate-200 py-2.5 text-xs font-bold text-slate-600 hover:border-[#2563EB] hover:text-[#2563EB]"
          >
            + 일정 추가
          </button>
        </section>
      </div>
    </div>
  );
}
