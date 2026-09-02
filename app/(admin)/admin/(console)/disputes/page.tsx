import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { DisputeQueueList } from "@/components/admin/DisputeQueueList";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/routeGuard";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import { DISPUTE_DEFAULT_PAGE_SIZE, DISPUTE_DEFAULT_TAB, disputeListFlashOkMessage, resolveDisputeTab } from "@/lib/admin/disputeConsole";
import { countDisputeTabs, loadDisputeQueue } from "@/lib/admin/disputeConsoleQueries";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

/**
 * 관리자 · 분쟁 — 목록(PR-6 §2-2 · 패턴 A). `AdminPageLayout` + `AdminDataTable`(Tabs·Pagination) 위에 있다.
 *
 * 쿼리: `status`(탭 — 유일한 필터 키 · 제재 3종은 `sanction` 한 탭) · `q`(당사자 이름·이메일·접수 내용) · `page`. 목록·검색·탭·건수는 전부 서버 조회다.
 * 전체 탭 링크는 `status=all` 을 유지한다(구 `AdminListToolbar` 는 지워서 접수 탭으로 튀었다 — PR #111 §8 결함, 이 화면에서 해소).
 * 조치는 분쟁 상세에서 건별로 한다. 목록의 일괄 처리는 상태 변경뿐이다(자금 일괄 없음).
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminDisputesListPage(props: PageProps) {
  await requireRole("admin");
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: DISPUTE_DEFAULT_PAGE_SIZE, defaultStatus: DISPUTE_DEFAULT_TAB });
  const tab = resolveDisputeTab(rawParams.status);
  const params: AdminListParams = { ...rawParams, status: tab };

  const flashOk = disputeListFlashOkMessage(pick(sp.ok));
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "disputes") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const supabase = await createClient();
  const [queue, counts] = await Promise.all([
    loadDisputeQueue(supabase, { tab, search: params.search, page: params.page, pageSize: params.pageSize }),
    countDisputeTabs(supabase),
  ]);

  return (
    <AdminPageLayout
      title="분쟁"
      description="접수된 분쟁을 오래된 것부터 검토하고, 상세에서 예치금 처리(환불·분할·지급)와 제재를 결정합니다. 24시간이 지나면 주의색으로 표시됩니다."
      actions={
        <>
          <Link href="/admin/refunds" className={ACTION_LINK} prefetch={false}>
            환불 관리
          </Link>
          <Link href="/admin/users" className={ACTION_LINK} prefetch={false}>
            계정 관리
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
          처리 실패 — {flashErr} 대상은 그대로이니 같은 버튼으로 다시 시도할 수 있습니다.
        </p>
      ) : null}

      <DisputeQueueList items={queue.rows} params={params} tab={tab} counts={counts} totalCount={queue.totalCount} error={queue.error} />
    </AdminPageLayout>
  );
}
