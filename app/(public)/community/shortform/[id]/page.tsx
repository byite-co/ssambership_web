import { CommunityLayoutShell } from "@/components/community/CommunityLayoutShell";
import { CommunityShortformDetailView } from "@/components/community/CommunityShortformDetailView";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { createClient } from "@/lib/supabase/server";
import { isCommunityPostUuid, loadCommunityComments } from "@/lib/community/communityQueries";
import { authorModerationNotice } from "@/lib/community/communityModerationVisibility";
import {
  getShortformDetail,
  getShortformReactionFlags,
  incrementShortformView,
} from "@/lib/community/communityShortformQueries";
import Link from "next/link";
import { VideoOff } from "lucide-react";
import { BlockUserButton } from "@/components/blocks/BlockUserButton";
import { ReportDialog } from "@/components/reports/ReportDialog";
import { StateBanner } from "@/components/community/StateBanner";
import { fetchBlockedUserIds, filterBlockedAuthors } from "@/lib/blocks/userBlocksQueries";
import { isUserBlocksEnabled } from "@/lib/shell/featureFlags";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommunityShortformDetailPage(props: Props) {
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const supabase = await createClient();
  const { user } = await getServerUserWithProfile();
  const idOk = isCommunityPostUuid(id);

  let item = null;
  let row: Record<string, unknown> | null = null;
  let loadError: string | null = null;
  if (idOk) {
    const res = await getShortformDetail(supabase, id, user?.id ?? null);
    if (res.error) loadError = "숏폼\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
    else if (res.item) {
      item = res.item;
      row = res.row;
    }
  }

  // 관리자 숨김 숏폼은 작성자 본인에게만 행이 유지되고, 이 배너로 사유를 함께 보여준다.
  const moderationNotice = authorModerationNotice(row, user?.id ?? null);
  // 숨김 상태에서는 조회수를 올리지 않는다(공개되지 않은 콘텐츠의 지표 왜곡 방지).
  if (item && !moderationNotice) {
    // D-CM-3: 뷰어·시간버킷 기반 결정적 event_key(멱등) — 로그인 uid 를 넘겨 새로고침 중복 계수 방지.
    await incrementShortformView(supabase, id, user?.id ?? null);
  }

  const { rows: rawComments, error: commentsQueryError } = item
    ? await loadCommunityComments(supabase, "shortform", id)
    : { rows: [], error: null };

  // W-blocks(v1): 플래그 ON + 로그인 시 차단 작성자 댓글 숨김 — OFF면 기존 결과 그대로 (스펙 §3)
  const blocksOn = isUserBlocksEnabled() && Boolean(user);
  const blockedIds = blocksOn && user ? await fetchBlockedUserIds(supabase, user.id) : [];
  const comments = blocksOn ? filterBlockedAuthors(rawComments, blockedIds, (c) => c.authorId) : rawComments;
  const canBlockAuthor =
    blocksOn && user != null && !!item?.authorId && item.authorId !== user.id && !blockedIds.includes(item.authorId);

  const reaction = item ? await getShortformReactionFlags(supabase, id, user?.id ?? null) : { liked: false };
  const returnPath = `/community/shortform/${id}`;
  const likeError = typeof sp.likeError === "string" ? sp.likeError : null;
  const commentErrorCode = typeof sp.commentError === "string" ? sp.commentError : null;
  const reportOk = sp.reportOk === "1" || sp.reportOk === "true";
  const reportErrorCode = typeof sp.reportError === "string" ? sp.reportError : null;

  return (
    <CommunityLayoutShell activeNav="shortform">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {loadError ? <p className="text-sm font-semibold text-red-800">{loadError}</p> : null}
        {!item && !loadError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <VideoOff className="h-12 w-12 text-slate-400" strokeWidth={1.5} aria-hidden />
            <h2 className="mt-4 text-xl font-black text-slate-900">숏폼을 찾을 수 없어요</h2>
            <p className="mt-2 text-sm font-medium text-slate-600">삭제되었거나 존재하지 않는 콘텐츠예요.</p>
            <Link
              href="/community/shortform"
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-5 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
            >
              숏폼 목록으로
            </Link>
          </div>
        ) : null}
        {item && moderationNotice ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-extrabold text-amber-900">{moderationNotice.badgeLabel}</p>
            <p className="mt-1 text-xs font-semibold text-amber-800">{moderationNotice.reason}</p>
          </div>
        ) : null}
        {item ? (
          <CommunityShortformDetailView
            item={item}
            postId={id}
            returnPath={returnPath}
            comments={comments}
            commentsError={commentsQueryError}
            commentErrorCode={commentErrorCode}
            viewerId={user?.id ?? null}
            canComment={user != null}
            canInteract={user != null}
            liked={reaction.liked}
            likeErrorCode={likeError}
          />
        ) : null}
        {/* D-CM-16: 숏폼 상세 신고 접점(액션은 shortform_post 지원). 신고+차단 병존(스펙 §4). */}
        {item ? (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            {reportOk ? <StateBanner kind="success" message="신고가 접수되었습니다." /> : null}
            {reportErrorCode ? (
              <StateBanner kind="error" message="신고를 접수하지 못했습니다. 잠시 후 다시 시도해 주세요." />
            ) : null}
            {user != null ? (
              <ReportDialog targetType="shortform" postId={id} returnPath={returnPath} />
            ) : (
              <p className="text-sm text-slate-600">
                로그인한 회원만 신고할 수 있어요.{" "}
                <Link className="font-bold text-[#2563EB] underline" href={`/login?next=${encodeURIComponent(returnPath)}`}>
                  로그인
                </Link>
              </p>
            )}
            {/* W-blocks(v1): 신고와 같은 화면에서 차단 접근(신고+차단 병존, 스펙 §4) */}
            {canBlockAuthor && item.authorId ? (
              <div className="flex justify-end">
                <BlockUserButton blockedUserId={item.authorId} returnTo="/community/shortform" />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </CommunityLayoutShell>
  );
}
