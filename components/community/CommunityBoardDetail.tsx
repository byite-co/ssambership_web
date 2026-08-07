import Link from "next/link";
import { Bookmark, Flag, ThumbsUp } from "lucide-react";
import { AuthorRoleBadge } from "@/components/community/AuthorRoleBadge";
import { MentorFavoriteButton } from "@/components/mentor/MentorFavoriteButton";
import { StateBanner } from "@/components/community/StateBanner";
import type { CommunityBoardCommentNode, CommunityBoardPostCard } from "@/lib/community/communityBoardQueries";
import { pickPostBody } from "@/lib/community/communityBoardQueries";
import {
  deleteBoardCommentAction,
  deleteCommunityBoardPostAction,
  submitBoardCommentAction,
  toggleCommunityPostReactionAction,
} from "@/lib/community/communityBoardActions";
import { submitCommunityContentReportAction } from "@/lib/community/communityReportActions";

const PRIMARY = "#2563EB";
const REPORT_REASONS = ["\uBD80\uC801\uC808\uD55C \uB0B4\uC6A9", "\uC2A4\uD338\u00B7\uAD11\uACE0", "\uC6B4\uC124\u00B7\uBE44\uBC29", "\uAC1C\uC778\uC815\uBCF4 \uB178\uCD9C", "\uAE30\uD0C0"] as const;

function CommentItem(props: {
  node: CommunityBoardCommentNode;
  postId: string;
  returnPath: string;
  canInteract: boolean;
  depth: number;
}) {
  const { node, returnPath, canInteract, depth } = props;
  return (
    <li className={depth > 0 ? "ml-6 border-l-2 border-slate-100 pl-4" : ""}>
      <article className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
        <header className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-slate-800">{node.authorLabel}</span>
          <span className="text-slate-400">{node.createdAtLabel}</span>
        </header>
        <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{node.content}</p>
        {canInteract ? (
          <footer className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
            <span>{"\uC88B\uC544\uC694"} {node.likeCount}</span>
            {node.isOwn ? (
              <form action={deleteBoardCommentAction} className="inline">
                <input type="hidden" name="commentId" value={node.id} />
                <input type="hidden" name="postId" value={props.postId} />
                <input type="hidden" name="returnPath" value={returnPath} />
                <button type="submit" className="text-red-600 hover:underline">
                  {"\uC0AD\uC81C"}
                </button>
              </form>
            ) : null}
            {depth === 0 ? (
              <details className="text-[#2563EB]">
                <summary className="cursor-pointer">{"\uB2F5\uAE00"}</summary>
                <form action={submitBoardCommentAction} className="mt-2 space-y-2">
                  <input type="hidden" name="postId" value={props.postId} />
                  <input type="hidden" name="parentId" value={node.id} />
                  <input type="hidden" name="returnPath" value={returnPath} />
                  <textarea
                    name="content"
                    required
                    maxLength={2000}
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                    placeholder={"\uB2F5\uAE00 \uC791\uC131"}
                  />
                  <button type="submit" className="rounded-lg px-3 py-1 text-xs font-bold text-white" style={{ backgroundColor: PRIMARY }}>
                    {"\uB4F1\uB85D"}
                  </button>
                </form>
              </details>
            ) : null}
          </footer>
        ) : null}
      </article>
      {node.replies.length ? (
        <ul className="mt-2 space-y-2">
          {node.replies.map((r) => (
            <CommentItem key={r.id} node={r} postId={props.postId} returnPath={returnPath} canInteract={canInteract} depth={1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function CommunityBoardDetail(props: {
  post: CommunityBoardPostCard;
  row: Record<string, unknown>;
  postId: string;
  returnPath: string;
  comments: CommunityBoardCommentNode[];
  commentsError: string | null;
  canInteract: boolean;
  liked: boolean;
  scrapped: boolean;
  commentErrorCode: string | null;
  /** 좋아요·스크랩 토글 실패(reactionError 쿼리스트링) — D-CM-6 무음 실패 표면화. */
  reactionError?: boolean;
  reportOk: boolean;
  reportErrorCode: string | null;
  /** 작성자가 멘토면 그 멘토의 user_id(찜 대상). 아니면 null → 버튼 숨김. */
  authorMentorId?: string | null;
  authorFavorited?: boolean;
  /** 조회자가 이 글의 작성자인지 — 수정·삭제 UI 노출(서버가 소유권 재검사). */
  isAuthor?: boolean;
}) {
  const body = pickPostBody(props.row);
  const images = props.post.imageUrls;

  return (
    <article className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex gap-3">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-black text-white"
            style={{ backgroundColor: PRIMARY }}
          >
            {props.post.authorLabel.charAt(0)}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-extrabold text-slate-900">{props.post.authorLabel}</h2>
              {props.post.authorRole ? <AuthorRoleBadge row={{ author_role: props.post.authorRole }} /> : null}
            </div>
            <p className="text-xs text-slate-500">{props.post.createdAtLabel}</p>
          </div>
        </div>
        {props.authorMentorId ? (
          <MentorFavoriteButton
            mentorId={props.authorMentorId}
            initialFavorited={props.authorFavorited ?? false}
            isLoggedIn={props.canInteract}
            loginNext={props.returnPath}
            showText
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600 transition hover:border-[#2563EB] hover:text-[#2563EB] disabled:opacity-60"
          />
        ) : null}
      </header>

      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-xl font-black text-slate-900 sm:text-2xl">{props.post.title}</h1>
        {props.isAuthor ? (
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/community/board/${props.postId}/edit`}
              className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600 hover:border-[#2563EB] hover:text-[#2563EB]"
            >
              수정
            </Link>
            <form action={deleteCommunityBoardPostAction} className="inline">
              <input type="hidden" name="postId" value={props.postId} />
              <input type="hidden" name="returnPath" value={props.returnPath} />
              <button
                type="submit"
                className="rounded-lg border border-red-200 px-3 py-1 text-xs font-bold text-red-600 hover:bg-red-50"
              >
                삭제
              </button>
            </form>
          </div>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 sm:text-base">{body}</p>

      {images.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {images.map((url) => (
            <li key={url} className="overflow-hidden rounded-xl border border-slate-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="max-h-80 w-full object-cover" />
            </li>
          ))}
        </ul>
      ) : null}

      {props.post.hashtags.length ? (
        <p className="flex flex-wrap gap-2 text-sm font-semibold text-[#2563EB]">
          {props.post.hashtags.map((t) => (
            <span key={t}>#{t}</span>
          ))}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-y border-slate-100 py-3 text-sm">
        {props.canInteract ? (
          <>
            <form action={toggleCommunityPostReactionAction} className="inline">
              <input type="hidden" name="postId" value={props.postId} />
              <input type="hidden" name="type" value="like" />
              <input type="hidden" name="returnPath" value={props.returnPath} />
              <button
                type="submit"
                className={[
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold",
                  props.liked ? "bg-[#2563EB] text-white" : "border border-slate-200 text-slate-700",
                ].join(" ")}
              >
                <ThumbsUp className="h-3.5 w-3.5" aria-hidden /> {"\uC88B\uC544\uC694"} {props.post.likeCount}
              </button>
            </form>
            <form action={toggleCommunityPostReactionAction} className="inline">
              <input type="hidden" name="postId" value={props.postId} />
              <input type="hidden" name="type" value="scrap" />
              <input type="hidden" name="returnPath" value={props.returnPath} />
              <button
                type="submit"
                className={[
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold",
                  props.scrapped ? "bg-slate-800 text-white" : "border border-slate-200 text-slate-700",
                ].join(" ")}
              >
                <Bookmark className="h-3.5 w-3.5" aria-hidden /> {props.scrapped ? "\uC2A4\uD06C\uB7A9 \uCDE8\uC18C" : "\uC2A4\uD06C\uB7A9"}
              </button>
            </form>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <ThumbsUp className="h-3.5 w-3.5" aria-hidden /> {"\uC88B\uC544\uC694"} {props.post.likeCount}
          </span>
        )}
        <span className="ml-auto inline-flex items-center text-xs text-slate-400">{"\uC870\uD68C"} {props.post.viewCount}</span>
      </div>

      {props.reactionError ? (
        <StateBanner kind="error" message={"\uC694\uCCAD\uC744 \uCC98\uB9AC\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694."} />
      ) : null}

      {props.canInteract ? (
        <details className="text-xs">
          <summary className="inline-flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 font-bold text-slate-500 transition hover:text-slate-700 [&::-webkit-details-marker]:hidden">
            <Flag className="h-3.5 w-3.5" aria-hidden /> {"\uC2E0\uACE0"}
          </summary>
          <form action={submitCommunityContentReportAction} className="mt-2 max-w-sm space-y-2 rounded-xl border border-slate-200 p-3">
            <input type="hidden" name="postVariant" value="board" />
            <input type="hidden" name="postId" value={props.postId} />
            <input type="hidden" name="returnPath" value={props.returnPath} />
            <select name="reason" required className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm">
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <textarea name="description" rows={2} className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm" placeholder={"\uC0C1\uC138 \uC124\uBA85 (\uC120\uD0DD)"} />
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{ backgroundColor: PRIMARY }}>
              <Flag className="h-3.5 w-3.5" aria-hidden /> {"\uC2E0\uACE0 \uC811\uC218"}
            </button>
          </form>
        </details>
      ) : null}

      {props.reportOk ? <StateBanner kind="success" message={"\uC2E0\uACE0\uAC00 \uC811\uC218\uB418\uC5C8\uC2B5\uB2C8\uB2E4."} /> : null}
      {props.reportErrorCode ? <StateBanner kind="error" message={"\uC2E0\uACE0 \uC811\uC218\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."} /> : null}

      <section className="space-y-4">
        <h3 className="text-base font-extrabold text-slate-900">
          {"\uB313\uAE00"} {props.post.commentCount}
        </h3>
        {props.commentsError ? <StateBanner kind="error" message={props.commentsError} /> : null}
        {props.commentErrorCode ? (
          <StateBanner
            kind="error"
            message={
              props.commentErrorCode === "policy"
                ? "외부 연락처·대필 요청은 정책상 제한됩니다."
                : props.commentErrorCode === "delete"
                  ? "\uB313\uAE00\uC744 \uC0AD\uC81C\uD558\uC9C0 \uBABB\uD588\uC5B4\uC694. \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694."
                  : props.commentErrorCode === "account_blocked"
                    ? "\uACC4\uC815 \uC0C1\uD0DC\uB85C \uC778\uD574 \uB313\uAE00\uC744 \uC791\uC131\uD560 \uC218 \uC5C6\uC5B4\uC694."
                    : "\uB313\uAE00 \uB4F1\uB85D\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4."
            }
          />
        ) : null}

        {props.canInteract ? (
          <form action={submitBoardCommentAction} className="space-y-2 rounded-xl border border-slate-200 p-3">
            <input type="hidden" name="postId" value={props.postId} />
            <input type="hidden" name="returnPath" value={props.returnPath} />
            <textarea
              name="content"
              required
              maxLength={2000}
              rows={3}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder={"\uB313\uAE00\uC744 \uC785\uB825\uD574 \uC8FC\uC138\uC694."}
            />
            <button type="submit" className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: PRIMARY }}>
              {"\uB313\uAE00 \uB4F1\uB85D"}
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-500">
            <Link href={`/login?next=${encodeURIComponent(props.returnPath)}`} className="font-bold text-[#2563EB]">
              {"\uB85C\uADF8\uC778"}
            </Link>
            {" \uD6C4 \uB313\uAE00\uC744 \uC791\uC131\uD560 \uC218 \uC788\uC5B4\uC694."}
          </p>
        )}

        <ul className="space-y-3">
          {props.comments.map((c) => (
            <CommentItem
              key={c.id}
              node={c}
              postId={props.postId}
              returnPath={props.returnPath}
              canInteract={props.canInteract}
              depth={0}
            />
          ))}
        </ul>
      </section>

      <Link href="/community" className="inline-flex text-sm font-bold text-[#2563EB] hover:underline">
        {"\u2190 \uCEE4\uBBA4\uB2C8\uD2F0 \uD648"}
      </Link>
    </article>
  );
}
