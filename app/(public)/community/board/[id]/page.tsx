import { CommunityBoardDetail } from "@/components/community/CommunityBoardDetail";
import { CommunityLayoutShell } from "@/components/community/CommunityLayoutShell";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { createClient } from "@/lib/supabase/server";
import {
  getCommunityBoardPost,
  getPostReactionFlags,
  loadBoardComments,
} from "@/lib/community/communityBoardQueries";
import { isCommunityPostUuid } from "@/lib/community/communityQueries";
import { authorModerationNotice } from "@/lib/community/communityModerationVisibility";
import { BoardViewTracker } from "@/components/community/BoardViewTracker";
import { loadFavoriteMentorIdsForUser } from "@/lib/mentor/mentorFavorites";
import { BlockUserButton } from "@/components/blocks/BlockUserButton";
import { fetchBlockedUserIds, filterBlockedCommentNodes } from "@/lib/blocks/userBlocksQueries";
import { isUserBlocksEnabled } from "@/lib/shell/featureFlags";

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommunityBoardDetailPage(props: Props) {
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const commentErrorCode = typeof sp.commentError === "string" ? sp.commentError : null;
  const reportOk = sp.reportOk === "1" || sp.reportOk === "true";
  const reportErrorCode = typeof sp.reportError === "string" ? sp.reportError : null;

  const supabase = await createClient();
  const { user } = await getServerUserWithProfile();
  const loggedIn = user != null;
  const returnPath = `/community/board/${id}`;

  const idOk = isCommunityPostUuid(id);
  let post = null;
  let row: Record<string, unknown> | null = null;
  let loadError: string | null = null;

  if (idOk) {
    const res = await getCommunityBoardPost(supabase, id, user?.id ?? null);
    if (res.error) {
      loadError = "\uAC8C\uC2DC\uAE00\uC744 \uBD88\uB7EC\uC624\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
    } else if (res.post && res.row) {
      post = res.post;
      row = res.row;
      // 조회수는 클라이언트(BoardViewTracker)가 세션당 1회만 +1 — 서버 렌더 시 증가하지 않음.
    }
  }

  // 멘토가 쓴 글이면 작성자(멘토) 찜 상태를 가져온다(팔로우=찜 통합).
  const authorRole = (post?.authorRole ?? "").toLowerCase();
  const isMentorAuthor = (authorRole === "mentor" || post?.authorRole === "멘토") && !!post?.authorId;
  const authorMentorId = isMentorAuthor ? (post?.authorId ?? null) : null;
  let authorFavorited = false;
  if (authorMentorId && user) {
    const fav = await loadFavoriteMentorIdsForUser(supabase, user.id);
    authorFavorited = fav.ids.has(authorMentorId);
  }

  // 관리자 숨김 글은 작성자 본인에게만 행이 유지되고, 이 배너로 사유를 함께 보여준다.
  const moderationNotice = authorModerationNotice(row, user?.id ?? null);

  const missing = !idOk || (!post && !loadError);
  const { nodes: rawComments, error: commentsError } = post
    ? await loadBoardComments(supabase, id, user?.id ?? null)
    : { nodes: [], error: null };

  // W-blocks(v1): 플래그 ON + 로그인 시 차단 작성자의 댓글(답글 포함) 숨김 — OFF면 기존 결과 그대로 (스펙 §3)
  const blocksOn = isUserBlocksEnabled() && Boolean(user);
  const blockedIds = blocksOn && user ? await fetchBlockedUserIds(supabase, user.id) : [];
  const comments = blocksOn ? filterBlockedCommentNodes(rawComments, blockedIds) : rawComments;
  // 차단 버튼 노출 조건: 플래그 ON + 로그인 + 작성자 존재 + 본인 글 아님 + 아직 미차단
  const canBlockAuthor =
    blocksOn && user != null && !!post?.authorId && post.authorId !== user.id && !blockedIds.includes(post.authorId);

  const reactions = post ? await getPostReactionFlags(supabase, id, user?.id ?? null) : { liked: false, scrapped: false };

  return (
    <CommunityLayoutShell activeNav="board">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        {loadError ? <p className="text-sm font-semibold text-red-800">{loadError}</p> : null}
        {missing ? (
          <p className="text-sm text-slate-600">{"\uAC8C\uC2DC\uAE00\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4."}</p>
        ) : post && row ? (
          <>
            {moderationNotice ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-xs font-extrabold text-amber-900">{moderationNotice.badgeLabel}</p>
                <p className="mt-1 text-xs font-semibold text-amber-800">{moderationNotice.reason}</p>
              </div>
            ) : null}
            <BoardViewTracker postId={id} />
            <CommunityBoardDetail
              post={post}
              row={row}
              postId={id}
              returnPath={returnPath}
              comments={comments}
              commentsError={commentsError}
              canInteract={loggedIn}
              liked={reactions.liked}
              scrapped={reactions.scrapped}
              commentErrorCode={commentErrorCode}
              reportOk={reportOk}
              reportErrorCode={reportErrorCode}
              authorMentorId={authorMentorId}
              authorFavorited={authorFavorited}
              isAuthor={!!user && !!post.authorId && post.authorId === user.id}
            />
            {/* W-blocks(v1): 신고와 같은 화면에서 차단 접근(신고+차단 병존, 스펙 §4) */}
            {canBlockAuthor && post.authorId ? (
              <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
                <BlockUserButton blockedUserId={post.authorId} returnTo="/community/board" />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </CommunityLayoutShell>
  );
}
