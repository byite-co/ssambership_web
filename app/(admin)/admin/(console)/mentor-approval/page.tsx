import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { MentorApprovalDocumentsPane } from "@/components/admin/MentorApprovalDocumentsPane";
import { MentorApprovalQueueList } from "@/components/admin/MentorApprovalQueueList";
import { MentorApprovalReviewPanel } from "@/components/admin/MentorApprovalReviewPanel";
import { MentorApprovalShortcuts } from "@/components/admin/MentorApprovalShortcuts";
import { MentorApprovalWorkbenchFrame } from "@/components/admin/MentorApprovalWorkbenchFrame";
import { createClient } from "@/lib/supabase/server";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  MENTOR_APPROVAL_DEFAULT_PAGE_SIZE,
  MENTOR_APPROVAL_DEFAULT_TAB,
  MENTOR_APPROVAL_SELECTED_PARAM,
  buildMentorApprovalListUrl,
  isMentorApprovalPendingTabStatus,
  resolveMentorApprovalTab,
} from "@/lib/admin/mentorApprovalQueue";
import {
  countMentorApprovalTabs,
  countMentorDecisionsToday,
  loadMentorApprovalDetail,
  loadMentorApprovalQueue,
} from "@/lib/admin/mentorApprovalWorkbenchQueries";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * 관리자 · 멘토 승인 — 작업대형 3분할(PR-2).
 *
 * 쿼리: `status`(탭) · `q`(검색) · `page` · `mentor`(선택 지원자). 구 `filter` 키는 쓰지 않는다.
 * 목록·검색·탭은 전부 서버 조회다. 상세는 선택 1건만 조회한다.
 * 결정(승인·반려·재제출) 후 서버 액션은 `?ok=…` 로 돌아오고 선택이 비므로 첫 대기 건이 자동 선택된다.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminMentorApprovalPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, {
    defaultPageSize: MENTOR_APPROVAL_DEFAULT_PAGE_SIZE,
    defaultStatus: MENTOR_APPROVAL_DEFAULT_TAB,
  });
  const tab = resolveMentorApprovalTab(rawParams.status);
  const selectedParam = typeof sp[MENTOR_APPROVAL_SELECTED_PARAM] === "string" ? String(sp[MENTOR_APPROVAL_SELECTED_PARAM]).trim() : "";
  // 선택 지원자 키는 탭·검색·페이지 링크에 실리지 않게 목록 파라미터에서 뺀다.
  const { [MENTOR_APPROVAL_SELECTED_PARAM]: _selectedExtra, ...extraWithoutSelected } = rawParams.extra;
  const listParams: AdminListParams = { ...rawParams, status: tab, extra: extraWithoutSelected };

  const okParam = typeof sp.ok === "string" ? sp.ok : null;
  const errParam = typeof sp.error === "string" ? sp.error : null;
  const flashErr = errParam ? (toAdminDisplayError(errParam, "mentorApprovals") ?? "처리에 실패했습니다.") : null;
  const flashOk =
    okParam === "approve"
      ? "승인했습니다. 다음 대기 건으로 이동했습니다."
      : okParam === "reject"
        ? "반려했습니다. 다음 대기 건으로 이동했습니다."
        : okParam === "documents"
          ? "재제출을 요청했습니다. 다음 대기 건으로 이동했습니다."
          : okParam === "school-approve"
            ? "학교 등급을 확정했습니다."
            : okParam === "school-reject"
              ? "학교·전공 인증을 반려했습니다."
              : okParam === "school-resubmit"
                ? "학교·전공 인증 재제출을 요청했습니다."
                : null;

  const supabase = await createClient();
  const [queue, counts] = await Promise.all([
    loadMentorApprovalQueue(supabase, { tab, search: listParams.search, page: listParams.page, pageSize: listParams.pageSize }),
    countMentorApprovalTabs(supabase),
  ]);

  const selectedId = selectedParam || queue.rows[0]?.mentorUserId || null;
  const needsTodayCount = queue.rows.length === 0 || counts.pending === 0;
  const [detail, decisionsToday] = await Promise.all([
    selectedId ? loadMentorApprovalDetail(supabase, selectedId) : Promise.resolve(null),
    needsTodayCount ? countMentorDecisionsToday(supabase) : Promise.resolve(null),
  ]);

  const hrefFor = (id: string) =>
    buildMentorApprovalListUrl(listParams, { page: listParams.page, extra: { [MENTOR_APPROVAL_SELECTED_PARAM]: id } });
  const idx = queue.rows.findIndex((r) => r.mentorUserId === selectedId);
  const prevHref = idx > 0 ? hrefFor(queue.rows[idx - 1].mentorUserId) : null;
  const nextHref = idx >= 0 && idx < queue.rows.length - 1 ? hrefFor(queue.rows[idx + 1].mentorUserId) : null;
  const nextPendingOnPage = queue.rows.slice(idx + 1).find((r) => isMentorApprovalPendingTabStatus(r.status)) ?? null;
  const nextPendingHref = nextPendingOnPage
    ? hrefFor(nextPendingOnPage.mentorUserId)
    : counts.pending > 0
      ? buildMentorApprovalListUrl(listParams, { status: MENTOR_APPROVAL_DEFAULT_TAB, search: "" })
      : null;

  const listSummary = `대기 ${counts.pending} / 전체 ${counts.all}`;

  return (
    <AdminPageLayout
      title="멘토 승인"
      description="지원자 서류를 보고 신원·자격·학교 등급을 확인한 뒤 승인·반려·재제출을 결정합니다. 결정 후에는 다음 대기 건으로 이동합니다."
    >
      {flashOk ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900" role="status">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" role="alert">
          처리 실패 — {flashErr} 대상은 그대로이니 다시 시도해 주세요.
        </p>
      ) : null}

      <MentorApprovalWorkbenchFrame
        listSummary={listSummary}
        list={
          <MentorApprovalQueueList
            items={queue.rows}
            params={listParams}
            tab={tab}
            counts={counts}
            totalCount={queue.totalCount}
            selectedId={selectedId}
            error={queue.error}
            identityError={queue.identityError}
          />
        }
        viewer={
          <MentorApprovalDocumentsPane
            mentorUserId={detail?.mentorUserId ?? null}
            mentorName={detail?.displayName ?? ""}
            studentIdDocument={detail?.studentIdDocument ?? null}
            schoolDocument={detail?.schoolDocument ?? null}
          />
        }
        panel={<MentorApprovalReviewPanel detail={detail} flashError={flashErr} decisionsToday={decisionsToday} pendingCount={counts.pending} />}
      />

      <MentorApprovalShortcuts prevHref={prevHref} nextHref={nextHref} nextPendingHref={nextPendingHref} canDecide={Boolean(detail?.decidable)} />
    </AdminPageLayout>
  );
}
