import Link from "next/link";
import { AccountListTable } from "@/components/admin/AccountListTable";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  ACCOUNT_DEFAULT_PAGE_SIZE,
  ACCOUNT_DEFAULT_STATUS,
  ACCOUNT_ROLE_PARAM,
  ACCOUNT_VERIFIED_PARAM,
  accountDetailFlashOkMessage,
  resolveAccountRoleTab,
  resolveAccountStatusFilter,
  resolveAccountVerifiedFilter,
} from "@/lib/admin/accountDetailConsole";
import { countAccountRoleTabs, loadAccountList } from "@/lib/admin/accountListQueries";
import { loadRecentDeletionLogs, loadRecentUserBlocks } from "@/lib/admin/accountStatusQueries";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * 관리자 · 계정 목록(PR-7 §1 · 패턴 A).
 *
 * 쿼리: `role`(역할 탭 · extra) · `status`(계정 상태 필터) · `verified`(본인인증 필터 · extra) · `q` · `page`. 전부 서버 조회.
 * 행 → `/admin/users/[id]`. 정지·차단·경고는 목록에 없다(상세에서만). 하단의 사용자 차단 현황·회원 탈퇴 로그는 구 화면의 읽기 전용 참고를 그대로 둔다.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminUsersPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: ACCOUNT_DEFAULT_PAGE_SIZE, defaultStatus: ACCOUNT_DEFAULT_STATUS });
  const roleTab = resolveAccountRoleTab(rawParams.extra[ACCOUNT_ROLE_PARAM]);
  const verifiedFilter = resolveAccountVerifiedFilter(rawParams.extra[ACCOUNT_VERIFIED_PARAM]);
  const statusFilter = resolveAccountStatusFilter(rawParams.status);
  // 링크에 실을 extra 는 이 화면이 아는 두 키(정규화된 값)만 — 알 수 없는 키가 따라다니지 않게.
  const extra: Record<string, string> = {};
  if (roleTab !== "all") extra[ACCOUNT_ROLE_PARAM] = roleTab;
  if (verifiedFilter !== "all") extra[ACCOUNT_VERIFIED_PARAM] = verifiedFilter;
  const params: AdminListParams = { ...rawParams, status: statusFilter, extra };

  // 구 목록 액션의 기본 복귀 경로가 여기라 `?ok=`·`?error=` 플래시를 계속 받는다.
  const flashOk = accountDetailFlashOkMessage(pick(sp.ok));
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "default") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const [list, roleCounts, blocks, deletions] = await Promise.all([
    loadAccountList(params, { role: roleTab, verified: verifiedFilter }),
    countAccountRoleTabs(),
    loadRecentUserBlocks(10),
    loadRecentDeletionLogs(10),
  ]);

  return (
    <AdminPageLayout
      title="계정"
      description="모든 계정을 역할·상태·본인인증으로 찾고, 한 사람의 상태·이력·조치는 계정 상세에서 봅니다. 정지·차단은 상세에서만 합니다."
      actions={
        <>
          <Link href="/admin/mentor-approval" className={ACTION_LINK} prefetch={false}>
            멘토 승인
          </Link>
          <Link href="/admin/disputes" className={ACTION_LINK} prefetch={false}>
            신고·분쟁
          </Link>
        </>
      }
    >
      {flashOk ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          처리 실패 — {flashErr}
        </p>
      ) : null}

      <AccountListTable
        items={list.rows}
        params={params}
        roleTab={roleTab}
        roleCounts={roleCounts}
        statusFilter={statusFilter}
        verifiedFilter={verifiedFilter}
        totalCount={list.totalCount}
        error={list.error}
        identityError={list.identityError}
      />

      {/* 읽기 전용 참고(구 화면 유지): 사용자 차단 현황 · 회원 탈퇴 로그 */}
      <details className="rounded-2xl border border-slate-200 bg-white shadow-sm" data-account-list-reference>
        <summary className="cursor-pointer list-none px-4 py-3 text-xs font-black text-slate-700 [&::-webkit-details-marker]:hidden">
          참고 — 사용자 차단 현황 {blocks.ok ? `${blocks.totalCount}건` : "(조회 실패)"} · 회원 탈퇴 로그 {deletions.ok ? `${deletions.totalCount}건` : "(조회 실패)"}
        </summary>
        <div className="grid gap-4 border-t border-slate-100 px-4 py-4 lg:grid-cols-2">
          <section>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">사용자 차단 현황</h2>
            {blocks.rows.length === 0 ? (
              <p className="mt-2 text-xs font-semibold text-slate-400">{blocks.ok ? "차단 기록이 없습니다." : "차단 현황을 불러오지 못했습니다."}</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 text-xs">
                {blocks.rows.map((b) => (
                  <li key={`${b.blockerId}-${b.blockedId}`} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate font-bold text-slate-800">
                      <Link href={`/admin/users/${encodeURIComponent(b.blockerId)}`} className="hover:underline" prefetch={false}>
                        {b.blockerNickname ?? `${b.blockerId.slice(0, 8)}…`}
                      </Link>
                      <span className="mx-1 text-slate-400">→</span>
                      <Link href={`/admin/users/${encodeURIComponent(b.blockedId)}`} className="hover:underline" prefetch={false}>
                        {b.blockedNickname ?? `${b.blockedId.slice(0, 8)}…`}
                      </Link>
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-500">{formatKoDateTimeKst(b.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-slate-400">차단 생성·해제는 사용자 본인만 가능합니다(커뮤니티 노출 필터). 관리자 화면은 조회 전용입니다.</p>
          </section>
          <section>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">회원 탈퇴 로그</h2>
            {deletions.rows.length === 0 ? (
              <p className="mt-2 text-xs font-semibold text-slate-400">{deletions.ok ? "탈퇴 기록이 없습니다." : "탈퇴 로그를 불러오지 못했습니다."}</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 text-xs">
                {deletions.rows.map((d) => (
                  <li key={`${d.userId}-${d.requestedAt ?? ""}`} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate">
                      <span className="font-bold text-slate-800" title={d.userId}>
                        {d.nickname ?? `${d.userId.slice(0, 8)}… (익명화)`}
                      </span>
                      {d.reason ? <span className="ml-1 text-slate-500">· {d.reason}</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-slate-500">{formatKoDateTimeKst(d.requestedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-slate-400">탈퇴 완료 계정은 PII가 익명화되어 닉네임이 표시되지 않을 수 있습니다.</p>
          </section>
        </div>
      </details>
    </AdminPageLayout>
  );
}
