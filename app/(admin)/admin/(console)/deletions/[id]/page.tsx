import Link from "next/link";
import { AccountDeletionJobDetail } from "@/components/admin/AccountDeletionJobDetail";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { EmptyState } from "@/components/common/EmptyState";
import { requireRole } from "@/lib/auth/routeGuard";
import { ACCOUNT_DELETION_BASE_PATH } from "@/lib/admin/accountDeletionConsole";
import { loadAccountDeletionJob } from "@/lib/admin/accountDeletionQueries";

type Props = { params: Promise<{ id: string }> };

const BACK_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

/**
 * 관리자 · 탈퇴 요청 상세(PR-13 §1-2) — job 한 건의 9단계 타임라인 + 잔액 포기 동의 + 조치(없음 — §1-1-B).
 * 요청자를 계정 상세로 링크하지 않는다. 읽기 전용. (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminAccountDeletionJobPage(props: Props) {
  await requireRole("admin");
  const { id } = await props.params;
  const nowIso = new Date().toISOString();
  const { item, error } = await loadAccountDeletionJob(id, nowIso);

  const backLink = (
    <Link href={ACCOUNT_DELETION_BASE_PATH} className={BACK_LINK} prefetch={false}>
      ← 탈퇴 요청
    </Link>
  );

  if (!item) {
    return (
      <AdminPageLayout title="탈퇴 요청 상세" actions={backLink}>
        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
            {error}
          </p>
        ) : (
          <EmptyState title="해당 탈퇴 요청을 찾을 수 없습니다" description="주소가 잘못되었을 수 있습니다. 목록에서 다시 선택해 주세요." />
        )}
      </AdminPageLayout>
    );
  }

  return (
    <AdminPageLayout
      title={`탈퇴 요청 · ${item.requesterLabel}`}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{item.requesterRoleLabel}</span>
          <span aria-hidden="true">·</span>
          <span>요청자는 삭제 절차 중이라 계정 상세로 연결하지 않습니다.</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-xs text-slate-500" title="account_deletion_jobs.id">
            {item.job.id}
          </span>
        </span>
      }
      actions={backLink}
    >
      <AccountDeletionJobDetail item={item} />
    </AdminPageLayout>
  );
}
