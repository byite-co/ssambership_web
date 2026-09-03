import Link from "next/link";
import { AccountDeletionQueueTable } from "@/components/admin/AccountDeletionQueueTable";
import { AccountDeletionQueueToolbar } from "@/components/admin/AccountDeletionQueueToolbar";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { EmptyState } from "@/components/common/EmptyState";
import {
  ACCOUNT_DELETION_DEFAULT_PAGE_SIZE,
  ACCOUNT_DELETION_DEFAULT_TAB,
  ACCOUNT_DELETION_PIPELINE_NOTICE,
  ACCOUNT_DELETION_WORKER_NOTE,
  accountDeletionEmptyState,
  resolveAccountDeletionTab,
} from "@/lib/admin/accountDeletionConsole";
import { countAccountDeletionStalled, countAccountDeletionTabs, loadAccountDeletionList } from "@/lib/admin/accountDeletionQueries";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

/**
 * 관리자 · 탈퇴 요청 현황(PR-13 §1 · 패턴 A · **조회 전용**) — `account_deletion_jobs` 파이프라인 감시.
 *
 * §1-1-B 결론: 관리자가 밀어줄 RPC 가 없다(`account_deletion_advance` 는 전이 함수 · 재시도 RPC 없음) → 조치 버튼 없이 상태·경과·오류를 보여준다.
 * 쿼리: `status`(탭 — 진행 중 · 완료 · 실패 · 취소) · `page`. 정렬은 요청 최신순. 요청자는 계정 상세로 링크하지 않는다.
 * 대시보드 `탈퇴 멈춤` 칸은 이 화면의 `멈춤` 건수와 같은 함수(`countAccountDeletionStalled`)로 센다.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminAccountDeletionsPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: ACCOUNT_DELETION_DEFAULT_PAGE_SIZE, defaultStatus: ACCOUNT_DELETION_DEFAULT_TAB });
  const tab = resolveAccountDeletionTab(rawParams.status);
  const params: AdminListParams = { ...rawParams, search: "", status: tab, extra: {} };
  const nowIso = new Date().toISOString();

  const [list, counts, stalled] = await Promise.all([loadAccountDeletionList(params, tab, nowIso), countAccountDeletionTabs(), countAccountDeletionStalled(nowIso)]);
  const summary = { active: counts.active, stalled, all: counts.active + counts.completed + counts.failed + counts.canceled };
  const empty = accountDeletionEmptyState(tab);

  return (
    <AdminPageLayout
      title="탈퇴 요청"
      description="회원 탈퇴 요청의 처리 단계와 경과를 봅니다. 단계 전이는 처리기가 자동으로 하며 이 화면에서 단계를 바꾸거나 직접 삭제하지 않습니다."
      actions={
        <>
          <Link href="/admin/users" className={ACTION_LINK} prefetch={false}>
            계정 관리
          </Link>
          <Link href="/admin/audit-logs" className={ACTION_LINK} prefetch={false}>
            감사 로그
          </Link>
        </>
      }
    >
      <p role="note" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900" data-deletion-notice>
        ⓘ {ACCOUNT_DELETION_PIPELINE_NOTICE}
      </p>
      <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs leading-5 text-slate-600" data-deletion-worker-note>
        {ACCOUNT_DELETION_WORKER_NOTE}
      </p>
      {stalled === null ? (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-900">
          멈춤 건수를 불러오지 못했습니다. 표시된 `—` 는 실제 0 이 아닐 수 있습니다.
        </p>
      ) : null}

      <AccountDeletionQueueToolbar params={params} tab={tab} counts={counts} summary={summary} />

      {list.error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{list.error}</p>
        </div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description} />
      ) : (
        <AccountDeletionQueueTable items={list.rows} params={params} totalCount={list.totalCount} />
      )}
    </AdminPageLayout>
  );
}
