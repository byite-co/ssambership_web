/**
 * 계정 목록(PR-7 §1 · 패턴 A) — 검색(이름·이메일·닉네임) · 역할 탭 · 계정 상태/본인인증 선택 필터 · `N / M` · 표 · 페이지네이션 · 빈 상태. Server Component.
 *
 * - 검색·탭·필터·페이지는 전부 URL(서버) 기준이다. 필터는 GET form 의 select 두 개(`status` · `verified`) — JS 없이 동작한다.
 * - 역할 탭은 `role`(extra 키)이라 공용 `AdminDataTable.Tabs`(`status` 키 전용)를 쓸 수 없다 — prop 을 더하지 않고 이 화면이 같은 모양으로 직접 그린다.
 *   `AdminDataTable.Counts` 도 `pending` 키 전용이라 `N / M` 한 줄을 직접 그린다(분쟁 목록과 같은 처리). 페이지네이션은 공용 조각.
 * - 행의 이름 → 계정 상세. 목록에는 정지·차단 폼이 없다(사람을 보고 정지한다 — 상세에서만).
 * - 최근 활동 = 감사 로그 대상 시각 vs `updated_at` 중 늦은 쪽. 출처는 툴팁으로.
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { splitAdminListBasePath, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  ACCOUNT_BASE_PATH,
  ACCOUNT_LAST_ACTIVITY_SOURCE_LABELS,
  ACCOUNT_ROLE_PARAM,
  ACCOUNT_ROLE_TABS,
  ACCOUNT_STATUS_FILTER_LABELS,
  ACCOUNT_STATUS_FILTER_VALUES,
  ACCOUNT_VERIFIED_FILTER_LABELS,
  ACCOUNT_VERIFIED_FILTER_VALUES,
  ACCOUNT_VERIFIED_PARAM,
  accountDetailPath,
  buildAccountListUrl,
  buildAccountRoleTabUrl,
  type AccountRoleTab,
  type AccountStatusFilter,
  type AccountVerifiedFilter,
} from "@/lib/admin/accountDetailConsole";
import type { AccountListItem, AccountRoleTabCounts } from "@/lib/admin/accountListQueries";
import { accountRoleLabel } from "@/lib/admin/accountSanctionPolicy";
import { identityListBadgeLabel, identityReviewTone } from "@/lib/admin/mentorIdentityReview";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { cn } from "@/lib/utils/cn";

type Props = {
  items: AccountListItem[];
  params: AdminListParams;
  roleTab: AccountRoleTab;
  roleCounts: AccountRoleTabCounts;
  statusFilter: AccountStatusFilter;
  verifiedFilter: AccountVerifiedFilter;
  /** 필터(탭·검색·선택 필터) 후 건수 */
  totalCount: number;
  error: string | null;
  identityError: string | null;
};

const SELECT = "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

export function AccountListTable(props: Props) {
  const { items, params, roleTab, roleCounts, statusFilter, verifiedFilter, totalCount, error, identityError } = props;
  const { path: actionPath } = splitAdminListBasePath(ACCOUNT_BASE_PATH);
  const filtered = Boolean(params.search) || statusFilter !== "all" || verifiedFilter !== "all";

  return (
    <div className="space-y-4" data-account-list>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action={actionPath} method="GET" className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="search">
            <input
              type="search"
              name="q"
              defaultValue={params.search}
              placeholder="이름 · 이메일 · 닉네임"
              autoComplete="off"
              aria-label="계정 검색"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
            />
            {roleTab !== "all" ? <input type="hidden" name={ACCOUNT_ROLE_PARAM} value={roleTab} /> : null}
            <select name="status" defaultValue={statusFilter} aria-label="계정 상태 필터" className={SELECT}>
              {ACCOUNT_STATUS_FILTER_VALUES.map((v) => (
                <option key={v} value={v}>
                  {ACCOUNT_STATUS_FILTER_LABELS[v]}
                </option>
              ))}
            </select>
            <select name={ACCOUNT_VERIFIED_PARAM} defaultValue={verifiedFilter} aria-label="본인인증 필터" className={SELECT}>
              {ACCOUNT_VERIFIED_FILTER_VALUES.map((v) => (
                <option key={v} value={v}>
                  {ACCOUNT_VERIFIED_FILTER_LABELS[v]}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
              적용
            </button>
            {filtered ? (
              <Link href={buildAccountListUrl(params, { search: "", status: "all", extra: { ...params.extra, [ACCOUNT_VERIFIED_PARAM]: "" } })} className="text-xs font-bold text-blue-700 hover:underline">
                초기화
              </Link>
            ) : null}
          </form>
          {/* 건수 줄 — 공용 Counts 는 pending 키 전용이라 직접 그린다(prop 추가 0). */}
          <p className="text-xs font-bold text-slate-600" aria-live="polite" data-account-counts>
            <span className="tabular-nums text-slate-900">{totalCount.toLocaleString("ko-KR")}</span>
            {" / "}
            전체 <span className="tabular-nums text-slate-900">{roleCounts.all.toLocaleString("ko-KR")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* 역할 탭 — AdminDataTable.Tabs 와 같은 모양, 키만 role(extra). */}
          <nav className="flex flex-wrap gap-1" aria-label="역할 탭" data-account-role-tabs>
            {ACCOUNT_ROLE_TABS.map((t) => {
              const active = t.value === roleTab;
              return (
                <Link
                  key={t.value}
                  href={buildAccountRoleTabUrl(params, t.value)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-[11px] font-extrabold transition",
                    active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  )}
                >
                  {t.label}
                  <span className={cn("ml-1 tabular-nums", active ? "text-blue-100" : "text-slate-400")}>{roleCounts[t.value]}</span>
                </Link>
              );
            })}
          </nav>
          {params.search ? (
            <p className="text-[11px] font-semibold text-slate-500">
              &lsquo;{params.search}&rsquo; 검색 결과 <span className="tabular-nums text-slate-800">{totalCount}</span>건
            </p>
          ) : null}
        </div>
      </div>

      {identityError ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">{identityError}</p>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">계정 목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">잠시 후 다시 시도하거나 담당자에게 문의해 주세요.</p>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="조건에 맞는 계정이 없습니다"
          description={filtered ? "검색어나 필터를 바꾸거나 초기화해 주세요." : "아직 가입한 계정이 없습니다."}
        >
          {filtered ? (
            <Link
              href={buildAccountListUrl(params, { search: "", status: "all", extra: { ...params.extra, [ACCOUNT_VERIFIED_PARAM]: "" } })}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              초기화
            </Link>
          ) : null}
        </EmptyState>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
                  <th scope="col" className="px-3 py-3">이름</th>
                  <th scope="col" className="px-3 py-3">역할</th>
                  <th scope="col" className="px-3 py-3">계정 상태</th>
                  <th scope="col" className="px-3 py-3">승인 상태(멘토)</th>
                  <th scope="col" className="px-3 py-3">본인인증</th>
                  <th scope="col" className="px-3 py-3">가입일</th>
                  <th scope="col" className="px-3 py-3">최근 활동</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-slate-50/60" data-account-row={item.id}>
                    <td className="max-w-[260px] px-3 py-3 align-top">
                      <Link href={accountDetailPath(item.id)} className="block truncate font-extrabold text-slate-900 hover:underline" prefetch={false} title="계정 상세">
                        {item.name}
                      </Link>
                      <p className="truncate text-[11px] text-slate-500" title={item.email ?? undefined}>
                        {item.email ?? "이메일 없음"}
                        {item.nickname && item.nickname !== item.name ? ` · ${item.nickname}` : ""}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 align-top text-xs font-bold text-slate-700">{accountRoleLabel(item.role)}</td>
                    <td className="px-3 py-3 align-top">
                      <AdminStatusPill table="users" column="status" value={item.effectiveStatus} size="sm" />
                      {item.effectiveStatus === "suspended" && item.suspendedUntil ? (
                        <p className="mt-0.5 text-[11px] font-semibold text-amber-700">{formatKoreanDate(item.suspendedUntil)} 해제</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {item.role === "mentor" ? (
                        <AdminStatusPill table="mentor_profiles" column="verification_status" value={item.verificationStatus ?? ""} size="sm" />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 align-top">
                      {item.identity ? (
                        <StatusBadge label={identityListBadgeLabel(item.identity)} tone={identityReviewTone(item.identity)} size="sm" />
                      ) : (
                        <StatusBadge label="인증 확인 불가" tone="neutral" size="sm" />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600">{formatKoreanDate(item.createdAt)}</td>
                    <td
                      className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600"
                      title={item.lastActivitySource ? ACCOUNT_LAST_ACTIVITY_SOURCE_LABELS[item.lastActivitySource] : undefined}
                      data-last-activity-source={item.lastActivitySource ?? ""}
                    >
                      {formatKoreanDate(item.lastActivityAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AdminDataTable.Pagination className="border-t border-slate-100 px-4 py-2" basePath={ACCOUNT_BASE_PATH} params={params} totalCount={totalCount} rowsOnPage={items.length} />
        </div>
      )}
    </div>
  );
}
