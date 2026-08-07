import Link from "next/link";
import { Eye, Heart } from "lucide-react";
import { AuthorRoleBadge } from "@/components/community/AuthorRoleBadge";
import type { ShortformCard } from "@/lib/community/communityShortformQueries";
import type { CommunityCommentListItem } from "@/lib/community/communityQueries";
import { deleteShortformCommentAction, submitCommunityCommentAction } from "@/lib/community/commentActions";
import { toggleShortformLikeAction } from "@/lib/community/communityShortformActions";

const PRIMARY = "#2563EB";

function mapCommentErrorCode(code: string | null): string | null {
  if (!code) return null;
  if (code === "length") return "댓글은 1자 이상 1,000자 이하로 입력해 주세요.";
  if (code === "account_blocked") return "계정 상태로 인해 댓글을 작성할 수 없어요.";
  if (code === "policy") return "외부 연락처·대필 요청은 정책상 제한됩니다.";
  if (code === "delete") return "댓글을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.";
  if (code === "save") return "댓글을 등록하지 못했어요. 잠시 후 다시 시도해 주세요.";
  return "요청을 처리하지 못했어요.";
}

export function CommunityShortformDetailView(props: {
  item: ShortformCard;
  postId: string;
  returnPath: string;
  comments: CommunityCommentListItem[];
  /** 댓글 조회 실패 메시지(D-CM-12) — null 이면 정상. */
  commentsError: string | null;
  /** 댓글 작성·삭제 실패 코드(commentError 쿼리스트링). */
  commentErrorCode: string | null;
  /** 로그인 뷰어 id — 본인 댓글 삭제 버튼 노출 판정(D-CM-8). */
  viewerId: string | null;
  canComment: boolean;
  canInteract: boolean;
  liked: boolean;
  likeErrorCode: string | null;
}) {
  const commentErrorMessage = mapCommentErrorCode(props.commentErrorCode);
  const v = props.item;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start">
      <div className="mx-auto w-full max-w-[320px]">
        <div className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-slate-200 bg-black shadow-lg">
          {v.videoUrl ? (
            <video
              src={v.videoUrl}
              controls
              playsInline
              poster={v.thumbnailUrl ?? undefined}
              className="h-full w-full object-contain"
            />
          ) : v.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.thumbnailUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm font-bold text-white/80">{"\uC601\uC0C1 \uC900\uBE44 \uC911"}</div>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-black text-slate-900">{v.title}</h1>
          {v.authorRole ? <AuthorRoleBadge row={{ author_role: v.authorRole }} /> : null}
        </header>
        <p className="text-sm font-semibold text-slate-600">
          {v.authorLabel} {"\u00B7"} {v.createdAtLabel}
        </p>
        {v.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{v.description}</p> : null}
        {v.tags.length ? (
          <p className="flex flex-wrap gap-2 text-sm font-semibold text-[#2563EB]">
            {v.tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </p>
        ) : null}
        {props.likeErrorCode ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
            {"\uC88B\uC544\uC694 \uAE30\uB2A5\uC740 DB \uC801\uC6A9 \uD6C4 \uC0AC\uC6A9\uD560 \uC218 \uC788\uC5B4\uC694."}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 text-sm font-bold text-slate-600">
          {props.canInteract ? (
            <form action={toggleShortformLikeAction} className="inline">
              <input type="hidden" name="postId" value={props.postId} />
              <input type="hidden" name="returnPath" value={props.returnPath} />
              <button
                type="submit"
                className={[
                  "inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold transition",
                  props.liked
                    ? "bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
                    : "border border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-[#2563EB]",
                ].join(" ")}
              >
                <Heart className="h-4 w-4" fill={props.liked ? "currentColor" : "none"} aria-hidden />
                {"\uC88B\uC544\uC694"} {v.likeCount.toLocaleString("ko-KR")}
              </button>
            </form>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(props.returnPath)}`}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:text-[#2563EB]"
            >
              <Heart className="h-4 w-4" aria-hidden />
              {"\uC88B\uC544\uC694"} {v.likeCount.toLocaleString("ko-KR")}
            </Link>
          )}
          <span className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-extrabold text-slate-600">
            <Eye className="h-4 w-4" aria-hidden />
            {"\uC870\uD68C"} {v.viewCount.toLocaleString("ko-KR")}
          </span>
          <button type="button" disabled className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
            {"\uACF5\uC720 (\uC900\uBE44 \uC911)"}
          </button>
        </div>

        <section className="space-y-3 border-t border-slate-100 pt-4">
          <h2 className="text-base font-extrabold text-slate-900">{"\uB313\uAE00"}</h2>
          {props.commentsError ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
              {props.commentsError}
            </p>
          ) : null}
          {commentErrorMessage ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
              {commentErrorMessage}
            </p>
          ) : null}
          {props.canComment ? (
            <form action={submitCommunityCommentAction} className="space-y-2">
              <input type="hidden" name="postType" value="shortform" />
              <input type="hidden" name="postId" value={props.postId} />
              <input type="hidden" name="returnPath" value={props.returnPath} />
              <textarea name="body" required maxLength={1000} rows={2} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" />
              <button type="submit" className="rounded-lg px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: PRIMARY }}>
                {"\uB4F1\uB85D"}
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
          <ul className="space-y-2">
            {props.comments.map((c) => {
              const isOwn = props.viewerId != null && c.authorId != null && c.authorId === props.viewerId;
              return (
                <li key={c.id} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold text-slate-700">{c.authorLabel}</p>
                    {isOwn ? (
                      <form action={deleteShortformCommentAction} className="inline">
                        <input type="hidden" name="commentId" value={c.id} />
                        <input type="hidden" name="returnPath" value={props.returnPath} />
                        <button type="submit" className="text-xs font-bold text-red-600 hover:underline">
                          {"삭제"}
                        </button>
                      </form>
                    ) : null}
                  </div>
                  <p className="mt-1 text-slate-800">{c.body}</p>
                </li>
              );
            })}
          </ul>
        </section>

        <Link href="/community/shortform" className="inline-flex text-sm font-bold text-[#2563EB] hover:underline">
          {"\u2190 숏폼 \uBAA9\uB85D"}
        </Link>
      </div>
    </div>
  );
}
