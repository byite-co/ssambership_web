import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { MentorApprovalDocumentsPane } from "@/components/admin/MentorApprovalDocumentsPane";
import { MentorApprovalPresenceProvider } from "@/components/admin/MentorApprovalPresenceProvider";
import { MentorApprovalQueueList } from "@/components/admin/MentorApprovalQueueList";
import { MentorApprovalReviewPanel } from "@/components/admin/MentorApprovalReviewPanel";
import { MentorApprovalShortcuts } from "@/components/admin/MentorApprovalShortcuts";
import { MentorApprovalTodayPanel } from "@/components/admin/MentorApprovalTodayPanel";
import { MentorApprovalWorkbenchFrame } from "@/components/admin/MentorApprovalWorkbenchFrame";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { ALREADY_PROCESSED_PARAM, ALREADY_PROCESSED_PREFIX, sanitizeAlreadyProcessedParam } from "@/lib/admin/mentorApprovalHold";
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
  loadMyMentorDecisionsToday,
} from "@/lib/admin/mentorApprovalWorkbenchQueries";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * 관리자 · 멘토 승인 — 작업대형 3분할(PR-2).
 *
 * 쿼리: `status`(탭) · `q`(검색) · `page` · `mentor`(선택 지원자). 구 `filter` 키는 쓰지 않는다.
 * 목록·검색·탭은 전부 서버 조회다. 상세는 선택 1건만 조회한다.
 * 결정(승인·반려·재제출·보류) 후 서버 액션은 `?ok=…` 로 돌아오고 선택이 비므로 첫 대기 건이 자동 선택된다(보류 건은 대기 집합 밖이라 건너뛴다).
 * 보류 해제·승인 취소·반려 되돌리기는 `?ok=…&mentor=<id>` 로 그 지원자를 선택한 채 돌아온다.
 * `?already=…` 는 `.in(...)` 게이트에 걸린 결정 — `이미 처리됨 — 09-03 14:20 박운영 승인`(PR-2b §2-3).
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다. 여기서 한 번 더 부르는 것은 Presence 와
 * "오늘 내가 처리한 건" 에 쓸 관리자 id·표시명 때문이다(React cache 로 조회는 1회).
 */
export default async function AdminMentorApprovalPage(props: PageProps) {
  const { user, profile } = await requireRole("admin");
  const adminName = profile?.full_name?.trim() || profile?.nickname?.trim() || "관리자";
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
  const alreadyText = sanitizeAlreadyProcessedParam(sp[ALREADY_PROCESSED_PARAM]);
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
                : okParam === "hold"
                  ? "보류했습니다. 다음 대기 건으로 이동했습니다. 멘토에게는 알리지 않았습니다."
                  : okParam === "hold-release"
                    ? "보류를 해제했습니다. 대기 상태로 돌아왔습니다."
                    : okParam === "revoke"
                      ? "승인을 취소했습니다. 대기 상태로 돌아왔습니다. 학교 등급 확정·요금제는 유지됩니다."
                      : okParam === "reject-revert"
                        ? "반려를 되돌렸습니다. 대기 상태로 돌아왔습니다."
                        : null;

  const supabase = await createClient();
  const [queue, counts] = await Promise.all([
    loadMentorApprovalQueue(supabase, { tab, search: listParams.search, page: listParams.page, pageSize: listParams.pageSize }),
    countMentorApprovalTabs(supabase),
  ]);

  const selectedId = selectedParam || queue.rows[0]?.mentorUserId || null;
  const needsTodayCount = queue.rows.length === 0 || counts.pending === 0;
  const [detail, decisionsToday, myToday] = await Promise.all([
    selectedId ? loadMentorApprovalDetail(supabase, selectedId) : Promise.resolve(null),
    needsTodayCount ? countMentorDecisionsToday(supabase) : Promise.resolve(null),
    loadMyMentorDecisionsToday(supabase, user.id),
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
      description="지원자 서류를 보고 신원·자격·학교 등급을 확인한 뒤 승인·반려·재제출을 결정합니다. 애매하면 보류(H)해 두고, 결정 후에는 다음 대기 건으로 이동합니다."
    >
      {flashOk ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900" role="status">
          {flashOk}
        </p>
      ) : null}
      {alreadyText ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="alert" data-already-flash>
          {ALREADY_PROCESSED_PREFIX} — {alreadyText}. 다른 관리자가 먼저 처리했습니다. 이 건은 바뀌지 않았고 목록을 새로 불러왔습니다.
        </p>
      ) : null}
      {flashErr ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" role="alert">
          처리 실패 — {flashErr} 대상은 그대로이니 다시 시도해 주세요.
        </p>
      ) : null}

      <MentorApprovalTodayPanel data={myToday} listParams={listParams} />

      <MentorApprovalPresenceProvider adminId={user.id} adminName={adminName} selectedMentorId={selectedId}>
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
      </MentorApprovalPresenceProvider>

      <MentorApprovalShortcuts prevHref={prevHref} nextHref={nextHref} nextPendingHref={nextPendingHref} canDecide={Boolean(detail?.decidable)} />
    </AdminPageLayout>
  );
}
