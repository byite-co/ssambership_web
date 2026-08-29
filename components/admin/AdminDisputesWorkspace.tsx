"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AdminDisputeListItem } from "@/lib/disputes/disputeListQueries";
import { adminDisputeStatusLabel } from "@/lib/admin/disputeLabels";
import { applyDisputeSanctionAction } from "@/lib/admin/adminDisputeSanctionActions";
import { bulkUpdateDisputesAction } from "@/lib/admin/bulkActions";

type Props = {
  items: AdminDisputeListItem[];
  listError: string | null;
  table: string | null;
};

const TYPE_FILTERS = [
  { id: "all", label: "전체" },
  { id: "report", label: "신고" },
  { id: "dispute", label: "분쟁" },
] as const;

const STATUS_FILTERS = [
  { id: "all", label: "전체" },
  { id: "pending", label: "대기" },
  { id: "processing", label: "처리중" },
  { id: "done", label: "완료" },
] as const;

const SANCTIONS = [
  ["complete", "완료"],
  ["hold", "보류"],
  ["7d", "7일"],
  ["30d", "30일"],
  ["permanent", "영구"],
] as const;

function badge(s: string) {
  const u = s.toLowerCase();
  if (/open|new|submitted|pend|ing|escalat|hold/i.test(u)) return "bg-amber-50 text-amber-700 border-amber-100";
  if (/under_review|review|process/i.test(u)) return "bg-indigo-50 text-indigo-700 border-indigo-100";
  if (/close|resolv|done|dismiss|complete/i.test(u)) return "bg-emerald-50 text-emerald-700 border-emerald-100";
  return "bg-blue-50 text-blue-700 border-blue-100";
}

function matchType(it: AdminDisputeListItem, filter: string): boolean {
  if (filter === "all") return true;
  const t = `${it.typeLabel} ${it.titleLine}`.toLowerCase();
  if (filter === "report") return /report|abuse|content/i.test(t) || t.includes("신고");
  if (filter === "dispute") return /dispute|order|custom/i.test(t) || t.includes("분쟁");
  return true;
}

function matchStatus(it: AdminDisputeListItem, filter: string): boolean {
  if (filter === "all") return true;
  const s = (it.statusRaw || it.statusLabel).toLowerCase();
  if (filter === "pending") return /open|new|submitted|pend|await|hold/i.test(s);
  if (filter === "processing") return /review|process|escalat|progress/i.test(s);
  if (filter === "done") return /close|resolv|done|dismiss|complete|sanction/i.test(s);
  return true;
}

export function AdminDisputesWorkspace(props: Props) {
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]["id"]>("all");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]["id"]>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    return props.items.filter((it) => {
      if (!matchType(it, typeFilter)) return false;
      if (!matchStatus(it, statusFilter)) return false;
      if (dateFrom || dateTo) {
        // TZ-FIX R3 #18: 표기 문자열 재파싱(항상 Invalid) → 원본 ISO(createdAtIso) 비교,
        // 경계는 KST 달력일 +09:00 명시.
        const raw = it.createdAtIso !== "—" ? it.createdAtIso : "";
        const d = raw ? new Date(raw) : null;
        if (!d || Number.isNaN(d.getTime())) return false;
        if (dateFrom && d < new Date(`${dateFrom}T00:00:00+09:00`)) return false;
        if (dateTo && d > new Date(`${dateTo}T23:59:59.999+09:00`)) return false;
      }
      return true;
    });
  }, [props.items, typeFilter, statusFilter, dateFrom, dateTo]);

  if (props.listError && !props.items.length) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
        <p className="font-bold">신고·분쟁 목록을 불러오지 못했습니다.</p>
        <p className="mt-1 text-xs">테이블 연결 및 RLS 권한을 확인해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-black text-slate-900">신고·분쟁 관리</h1>
        <p className="mt-1 text-sm text-slate-600">접수된 신고와 분쟁 건을 검토하고 조치합니다.</p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <FilterGroup label="유형" filters={TYPE_FILTERS} active={typeFilter} onSelect={setTypeFilter} />
        <FilterGroup label="상태" filters={STATUS_FILTERS} active={statusFilter} onSelect={setStatusFilter} />
        <label className="text-xs font-semibold text-slate-600">
          시작일
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 block rounded-lg border px-2 py-1.5" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          종료일
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1 block rounded-lg border px-2 py-1.5" />
        </label>
      </div>

      {/* P1 ③ 일괄 처리 — 체크박스는 form 속성으로 이 폼에 연결 */}
      <form
        id="disputeBulkForm"
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5"
      >
        <span className="text-[11px] font-bold text-slate-500">선택 항목 일괄</span>
        <button
          type="submit"
          name="bulkStatus"
          value="under_review"
          formAction={bulkUpdateDisputesAction}
          className="rounded-lg border border-indigo-300 bg-white px-3 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
        >
          처리중으로
        </button>
        <button
          type="submit"
          name="bulkStatus"
          value="resolved"
          formAction={bulkUpdateDisputesAction}
          className="rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
        >
          완료(resolved)로
        </button>
      </form>

      {!props.table ? (
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          연결된 분쟁 테이블이 없습니다. 스키마 마이그레이션을 확인해 주세요.
        </p>
      ) : !filtered.length ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
          아직 데이터가 없어요. 조건을 바꾸거나 새 접수 건을 기다려 주세요.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-600">
                <th className="px-3 py-3">선택</th>
                <th className="px-4 py-3">유형</th>
                <th className="px-4 py-3">제목·요약</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">접수일</th>
                <th className="px-4 py-3">조치</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((it) => {
                const st = adminDisputeStatusLabel(it.statusRaw || it.statusLabel);
                return (
                  <tr key={it.id} className="align-top hover:bg-slate-50/40">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        name="ids"
                        value={it.id}
                        form="disputeBulkForm"
                        aria-label="분쟁 선택"
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-700">{it.typeLabel}</td>
                    <td className="max-w-xs px-4 py-3">
                      <p className="font-semibold text-slate-900">{it.titleLine}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500" title={it.summaryReason}>
                        {it.summaryReason}
                      </p>
                      <Link
                        href={`/admin/disputes/${encodeURIComponent(it.id)}`}
                        className="mt-1 inline-block text-xs font-bold text-[#2563EB] hover:underline"
                      >
                        상세 보기
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-lg border px-2 py-0.5 text-xs font-bold ${badge(it.statusRaw)}`}>
                        {st}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{it.createdAt}</td>
                    <td className="px-4 py-3">
                      <form action={applyDisputeSanctionAction} className="flex min-w-[200px] flex-col gap-1.5">
                        <input type="hidden" name="disputeId" value={it.id} />
                        <select
                          name="target"
                          defaultValue="mentor"
                          className="rounded-lg border px-2 py-1 text-xs font-semibold text-slate-700"
                          title="제재 대상 (정지/차단이 실제 계정에 적용됩니다)"
                        >
                          <option value="mentor">제재 대상: 멘토</option>
                          <option value="student">제재 대상: 학생</option>
                        </select>
                        <input name="note" placeholder="메모(선택)" className="rounded-lg border px-2 py-1 text-xs" />
                        <div className="flex flex-wrap gap-1">
                          {SANCTIONS.map(([sanction, label]) => (
                            <button
                              key={sanction}
                              type="submit"
                              name="sanction"
                              value={sanction}
                              className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-50"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterGroup<T extends string>(props: {
  label: string;
  filters: readonly { id: T; label: string }[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">{props.label}</p>
      <div className="flex flex-wrap gap-1.5">
        {props.filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => props.onSelect(f.id)}
            className={[
              "rounded-full px-3 py-1 text-xs font-bold",
              props.active === f.id ? "bg-[#2563EB] text-white" : "border border-slate-200 text-slate-700",
            ].join(" ")}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
