/**
 * 감사 로그 상단(PR-10 §2-2) — 검색(대상) · 실행자 ▾ · 액션 ▾ · 기간 ▾ · ☐ 열람 기록 제외 · `N / M`. 탭 없음. Server Component(GET form — JS 없이 동작).
 * 실행자 옵션은 관리자 N명 + 시스템(웹훅·배치). 액션 옵션은 사전 계열. 공용 `AdminDataTable` 조각은 prop 추가 없이 페이지네이션만 쓴다.
 */
import Link from "next/link";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { splitAdminListBasePath } from "@/lib/admin/adminListParams";
import {
  AUDIT_LOG_ACTION_OPTIONS,
  AUDIT_LOG_ACTION_PARAM,
  AUDIT_LOG_ACTOR_PARAM,
  AUDIT_LOG_BASE_PATH,
  AUDIT_LOG_HIDE_VIEWS_PARAM,
  AUDIT_LOG_PERIODS,
  AUDIT_LOG_PERIOD_PARAM,
  auditLogFiltersActive,
  type AuditLogActorOption,
  type AuditLogFilters,
} from "@/lib/admin/auditLogConsole";

type Props = {
  params: AdminListParams;
  filters: AuditLogFilters;
  actorOptions: AuditLogActorOption[];
  /** 필터·검색 후 건수 */
  totalCount: number;
  /** 전체 건수 */
  allCount: number;
};

const SELECT = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

export function AuditLogToolbar({ params, filters, actorOptions, totalCount, allCount }: Props) {
  const { path: actionPath } = splitAdminListBasePath(AUDIT_LOG_BASE_PATH);
  const filtered = auditLogFiltersActive(filters, params.search);

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3" data-audit-toolbar>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form action={actionPath} method="GET" className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="search">
          <input
            type="search"
            name="q"
            defaultValue={params.search}
            placeholder="대상 이름 · 이메일 · ID"
            autoComplete="off"
            aria-label="대상 검색"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
          />
          <select name={AUDIT_LOG_ACTOR_PARAM} defaultValue={filters.actor ?? ""} aria-label="실행자 필터" className={SELECT}>
            {actorOptions.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select name={AUDIT_LOG_ACTION_PARAM} defaultValue={filters.group ?? ""} aria-label="액션 필터" className={SELECT}>
            {AUDIT_LOG_ACTION_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select name={AUDIT_LOG_PERIOD_PARAM} defaultValue={filters.period === "all" ? "" : filters.period} aria-label="기간 필터" className={SELECT}>
            {AUDIT_LOG_PERIODS.map((p) => (
              <option key={p.value} value={p.value === "all" ? "" : p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <input type="checkbox" name={AUDIT_LOG_HIDE_VIEWS_PARAM} value="1" defaultChecked={filters.hideViews} />
            열람 기록 제외
          </label>
          <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
            적용
          </button>
          {filtered ? (
            <Link href={AUDIT_LOG_BASE_PATH} className="text-xs font-bold text-blue-700 hover:underline" prefetch={false}>
              초기화
            </Link>
          ) : null}
        </form>
        {/* 건수 줄 — 공용 Counts 는 `대기 N` 전용이라 직접 그린다(prop 추가 0). */}
        <p className="text-xs font-bold text-slate-600" aria-live="polite" data-audit-counts>
          <span className="tabular-nums text-slate-900">{totalCount.toLocaleString("ko-KR")}</span>
          {" / "}
          <span className="tabular-nums text-slate-900">{allCount.toLocaleString("ko-KR")}</span>
        </p>
      </div>
    </div>
  );
}
