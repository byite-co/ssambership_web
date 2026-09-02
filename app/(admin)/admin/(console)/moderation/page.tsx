import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { ContentReportQueueList } from "@/components/admin/ContentReportQueueList";
import { createClient } from "@/lib/supabase/server";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  CONTENT_REPORT_DEFAULT_PAGE_SIZE,
  CONTENT_REPORT_DEFAULT_TAB,
  contentReportFlashOkMessage,
  resolveContentReportTab,
} from "@/lib/admin/contentReportConsole";
import { countContentReportTabs, loadContentReportQueue } from "@/lib/admin/contentReportQueueQueries";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * 관리자 · 콘텐츠 검수 — 신고 목록(PR-5 §1-1). `AdminPageLayout` + `AdminDataTable` 위에 있다.
 *
 * 쿼리: `status`(탭 — 유일한 필터 키) · `q`(신고 대상 ID·신고자 이름·이메일·사유) · `page`. 목록·검색·탭·건수는 전부 서버 조회다.
 * 전체 탭 링크는 `status=all` 을 유지한다(구 `AdminListToolbar` 는 지워서 대기 탭으로 튀었다 — PR #111 §8 결함, 이 화면에서 해소).
 * 조치는 신고 상세(`/admin/reports/[id]`)에서만 한다. (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminModerationPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: CONTENT_REPORT_DEFAULT_PAGE_SIZE, defaultStatus: CONTENT_REPORT_DEFAULT_TAB });
  const tab = resolveContentReportTab(rawParams.status);
  const params: AdminListParams = { ...rawParams, status: tab };

  const flashOk = contentReportFlashOkMessage(pick(sp.ok));
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "reports") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const supabase = await createClient();
  const [queue, counts] = await Promise.all([
    loadContentReportQueue(supabase, { tab, search: params.search, page: params.page, pageSize: params.pageSize }),
    countContentReportTabs(supabase),
  ]);

  return (
    <AdminPageLayout
      title="콘텐츠 검수"
      description="신고된 게시글·댓글·숏폼을 확인하고 숨김·삭제·기각을 결정합니다. 오래된 신고가 위에 오고, 24시간이 지나면 주의색으로 표시됩니다."
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

      <ContentReportQueueList items={queue.rows} params={params} tab={tab} counts={counts} totalCount={queue.totalCount} error={queue.error} />
    </AdminPageLayout>
  );
}
