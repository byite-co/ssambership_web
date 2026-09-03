import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { ReviewQueueList } from "@/components/admin/ReviewQueueList";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import { countReviewTabs, loadReviewArchiveList, loadReviewList } from "@/lib/admin/adminReviewQueries";
import { CONTENT_REPORT_BASE_PATH } from "@/lib/admin/contentReportConsole";
import { REVIEW_DEFAULT_PAGE_SIZE, REVIEW_DEFAULT_TAB, REVIEW_DELETE_UNAVAILABLE_NOTE, resolveReviewTab, reviewFlashOkMessage, reviewTabIsArchive } from "@/lib/admin/reviewConsole";
import { createClient } from "@/lib/supabase/server";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * 관리자 · 리뷰 관리(PR-11 §2 · 패턴 A). `AdminPageLayout` + `AdminDataTable` 위에 있다.
 *
 * 쿼리: `status`(탭 — 공개 · 숨김 · 블라인드 · 격리 · 전체(기본)) · `q`(멘토·작성자·내용) · `page`. 전부 서버 조회.
 * 격리 탭은 보관함(`reviews_quarantine_archive` · `reviews_duplicates_archive`)을 읽는다. 조치는 리뷰 상세(`/admin/reviews/[reviewId]`)에서만 한다.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminReviewsPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: REVIEW_DEFAULT_PAGE_SIZE, defaultStatus: REVIEW_DEFAULT_TAB });
  const tab = resolveReviewTab(rawParams.status);
  const params: AdminListParams = { ...rawParams, status: tab, extra: {} };

  const flashOk = reviewFlashOkMessage(pick(sp.ok));
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "reviews") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const supabase = await createClient();
  const archive = reviewTabIsArchive(tab);
  const [list, archiveList, counts] = await Promise.all([
    archive ? Promise.resolve({ rows: [], totalCount: 0, error: null }) : loadReviewList(supabase, { tab, search: params.search, page: params.page, pageSize: params.pageSize }),
    archive ? loadReviewArchiveList({ search: params.search, page: params.page, pageSize: params.pageSize }) : Promise.resolve({ rows: [], totalCount: 0, error: null }),
    countReviewTabs(supabase),
  ]);

  return (
    <AdminPageLayout
      title="리뷰 관리"
      description={`멘토 리뷰를 찾아 숨김·블라인드·복원·검토 완료를 결정합니다. 숨김과 블라인드는 공개 화면에서 모두 비노출이지만 운영 기록상 구분됩니다. ${REVIEW_DELETE_UNAVAILABLE_NOTE}`}
      actions={
        <>
          <Link href={CONTENT_REPORT_BASE_PATH} className={ACTION_LINK} prefetch={false}>
            콘텐츠 검수(신고)
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

      <ReviewQueueList
        items={list.rows}
        archiveItems={archiveList.rows}
        params={params}
        tab={tab}
        counts={counts}
        totalCount={archive ? archiveList.totalCount : list.totalCount}
        error={archive ? archiveList.error : list.error}
      />
    </AdminPageLayout>
  );
}
