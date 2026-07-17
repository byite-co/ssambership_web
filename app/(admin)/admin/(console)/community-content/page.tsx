import { requireRole } from "@/lib/auth/routeGuard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  countAdminCommunityByStatus,
  loadAdminBoardCommentsListPaged,
  loadAdminCommunityCommentsListPaged,
  loadAdminCommunityPostsListPaged,
  loadAdminShortformPostsListPaged,
} from "@/lib/admin/adminCommunityContentQueries";
import {
  directDeleteBoardCommentAction,
  directDeleteCommentAction,
  directDeleteCommunityPostAction,
  directDeleteShortformAction,
  directHideBoardCommentAction,
  directHideCommentAction,
  directHideCommunityPostAction,
  directHideShortformAction,
  directRestoreBoardCommentAction,
  directRestoreCommentAction,
  directRestoreCommunityPostAction,
  directRestoreShortformAction,
} from "@/lib/admin/communityModerationActions";
import { AdminListToolbar } from "@/components/admin/AdminListToolbar";
import { AdminListPagination } from "@/components/admin/AdminListPagination";
import { parseAdminListParams } from "@/lib/admin/adminListParams";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const BASE_PATH = "/admin/community-content";

type ContentType = "posts" | "shortforms" | "board-comments" | "comments";

function parseType(raw: string | string[] | undefined): ContentType {
  const v = typeof raw === "string" ? raw.trim() : Array.isArray(raw) ? raw[0] : "";
  if (v === "shortforms" || v === "board-comments" || v === "comments") return v;
  return "posts";
}

function previewId(raw: unknown, maxLen = 10): { display: string; title?: string } {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return { display: "—" };
  if (s.length <= maxLen) return { display: s, title: s };
  return { display: `${s.slice(0, maxLen)}…`, title: s };
}

function formatDate(v: unknown): string {
  if (v == null) return "—";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function statusBadgeClass(s: string): string {
  if (s === "hidden") return "border-amber-200 bg-amber-50 text-amber-800";
  if (s === "draft") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default async function AdminCommunityContentPage(props: PageProps) {
  await requireRole("admin");
  const sp = (await props.searchParams) ?? {};
  const type = parseType(sp.type);
  const params = parseAdminListParams(sp, { defaultPageSize: 25, defaultStatus: "all" });
  const flashOk = typeof sp.ok === "string" ? sp.ok : null;
  const flashErr = typeof sp.error === "string" ? sp.error : null;

  let supabase = await createClient();
  try {
    // 관리자 운영 화면은 RLS 우회 — 이중 requireRole("admin") 가드 아래.
    supabase = createServiceRoleClient();
  } catch {
    /* session client fallback */
  }

  let listPromise:
    | ReturnType<typeof loadAdminCommunityPostsListPaged>
    | ReturnType<typeof loadAdminShortformPostsListPaged>
    | ReturnType<typeof loadAdminBoardCommentsListPaged>
    | ReturnType<typeof loadAdminCommunityCommentsListPaged>;
  let countPromise: ReturnType<typeof countAdminCommunityByStatus>;
  let statusTabs: Array<{ value: string; label: string; count?: number }> = [];
  let searchPlaceholder = "";
  if (type === "posts") {
    listPromise = loadAdminCommunityPostsListPaged(supabase, params);
    countPromise = countAdminCommunityByStatus(supabase, "community_posts");
    searchPlaceholder = "글 ID/제목/본문/카테고리/작성자 검색";
  } else if (type === "shortforms") {
    listPromise = loadAdminShortformPostsListPaged(supabase, params);
    countPromise = countAdminCommunityByStatus(supabase, "shortform_posts");
    searchPlaceholder = "숏폼 ID/제목/설명/카테고리/작성자 검색";
  } else if (type === "board-comments") {
    listPromise = loadAdminBoardCommentsListPaged(supabase, params);
    countPromise = countAdminCommunityByStatus(supabase, "comments");
    searchPlaceholder = "댓글 ID/내용/post_id/작성자 검색";
  } else {
    listPromise = loadAdminCommunityCommentsListPaged(supabase, params);
    countPromise = countAdminCommunityByStatus(supabase, "community_comments");
    searchPlaceholder = "댓글 ID/본문/post_id/작성자 검색";
  }

  const [list, byStatus] = await Promise.all([listPromise, countPromise]);

  if (type === "comments" || type === "board-comments") {
    statusTabs = [
      { value: "all", label: "전체", count: byStatus.all ?? 0 },
      { value: "visible", label: "노출", count: byStatus.visible ?? 0 },
      { value: "hidden", label: "숨김", count: byStatus.hidden ?? 0 },
    ];
  } else {
    statusTabs = [
      { value: "all", label: "전체", count: byStatus.all ?? 0 },
      { value: "published", label: "공개", count: byStatus.published ?? 0 },
      { value: "hidden", label: "숨김", count: byStatus.hidden ?? 0 },
      { value: "draft", label: "임시", count: byStatus.draft ?? 0 },
    ];
  }

  const typeTabs: Array<{ value: ContentType; label: string }> = [
    { value: "posts", label: "글" },
    { value: "shortforms", label: "숏폼" },
    { value: "board-comments", label: "게시판 댓글" },
    { value: "comments", label: "댓글(레거시)" },
  ];

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-black text-slate-900">커뮤니티 콘텐츠 직접 관리</h1>
        <p className="mt-1 text-sm text-slate-500">
          신고가 없어도 글·숏폼·댓글을 검색해서 직접 숨김·삭제·복구할 수 있어요.
          처리 시 일반 사용자에게는 즉시 안 보이게 됩니다.
        </p>
      </header>

      {flashOk ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
          처리 완료: {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">
          {flashErr}
        </p>
      ) : null}

      {/* 콘텐츠 타입 탭 */}
      <nav className="flex flex-wrap gap-1.5">
        {typeTabs.map((t) => {
          const isActive = t.value === type;
          const usp = new URLSearchParams();
          if (t.value !== "posts") usp.set("type", t.value);
          const href = usp.toString() ? `${BASE_PATH}?${usp.toString()}` : BASE_PATH;
          return (
            <a
              key={t.value}
              href={href}
              className={[
                "rounded-xl border px-3.5 py-1.5 text-xs font-extrabold transition",
                isActive
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
            >
              {t.label}
            </a>
          );
        })}
      </nav>

      <AdminListToolbar
        basePath={`${BASE_PATH}${type !== "posts" ? `?type=${type}` : ""}`}
        params={params}
        searchPlaceholder={searchPlaceholder}
        statusTabs={statusTabs}
      />

      {list.error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          목록 조회 실패: {list.error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-5 py-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {type === "posts"
              ? "커뮤니티 글"
              : type === "shortforms"
                ? "숏폼"
                : type === "board-comments"
                  ? "게시판 댓글"
                  : "댓글(레거시)"}
          </h2>
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">
            {list.totalCount.toLocaleString("ko-KR")}건
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[920px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-extrabold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">내용</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">작성자</th>
                <th className="px-4 py-3">생성일</th>
                <th className="px-4 py-3">조치</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm font-semibold text-slate-500">
                    표시할 콘텐츠가 없습니다.
                  </td>
                </tr>
              ) : (
                list.rows.map((row) => {
                  const id = String(row.id ?? "");
                  const idPv = previewId(id);
                  // 게시판 v2 댓글은 status 컬럼이 없고 is_deleted 로 노출을 제어한다.
                  const status =
                    type === "board-comments"
                      ? row.is_deleted === true
                        ? "hidden"
                        : "visible"
                      : String(row.status ?? "");
                  const isHidden = status === "hidden";
                  const titleOrBody =
                    typeof row.title === "string" && row.title.trim()
                      ? row.title
                      : typeof row.body === "string" && row.body.trim()
                        ? (row.body as string).slice(0, 80)
                        : typeof row.content === "string" && row.content.trim()
                          ? (row.content as string).slice(0, 80)
                          : typeof row.description === "string" && row.description.trim()
                            ? (row.description as string).slice(0, 80)
                            : "—";
                  const authorPv = previewId(row.author_id);
                  const authorLabel = typeof row.author_label === "string" ? row.author_label : null;

                  const hideAction =
                    type === "posts"
                      ? directHideCommunityPostAction
                      : type === "shortforms"
                        ? directHideShortformAction
                        : type === "board-comments"
                          ? directHideBoardCommentAction
                          : directHideCommentAction;
                  const restoreAction =
                    type === "posts"
                      ? directRestoreCommunityPostAction
                      : type === "shortforms"
                        ? directRestoreShortformAction
                        : type === "board-comments"
                          ? directRestoreBoardCommentAction
                          : directRestoreCommentAction;
                  const deleteAction =
                    type === "posts"
                      ? directDeleteCommunityPostAction
                      : type === "shortforms"
                        ? directDeleteShortformAction
                        : type === "board-comments"
                          ? directDeleteBoardCommentAction
                          : directDeleteCommentAction;

                  return (
                    <tr key={id} className="align-top">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700" title={idPv.title}>
                        {idPv.display}
                      </td>
                      <td className="max-w-[360px] truncate px-4 py-3 text-sm text-slate-800" title={String(titleOrBody)}>
                        {titleOrBody}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-block rounded-lg border px-2.5 py-1 text-xs font-bold ${statusBadgeClass(status)}`}
                        >
                          {status || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">
                        <div className="space-y-0.5">
                          <p className="font-mono text-[11px]" title={authorPv.title}>{authorPv.display}</p>
                          {authorLabel ? <p className="text-slate-500">{authorLabel}</p> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{formatDate(row.created_at)}</td>
                      <td className="px-4 py-3 align-top">
                        <form className="flex flex-col gap-2 min-w-[260px]">
                          <input type="hidden" name="targetId" value={id} />
                          <input
                            type="text"
                            name="reason"
                            placeholder="조치 사유(선택)"
                            className="w-full rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                            autoComplete="off"
                          />
                          <div className="flex flex-wrap gap-2">
                            {isHidden ? (
                              <button
                                type="submit"
                                formAction={restoreAction}
                                className="flex-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                              >
                                복구
                              </button>
                            ) : (
                              <button
                                type="submit"
                                formAction={hideAction}
                                className="flex-1 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500"
                              >
                                숨김
                              </button>
                            )}
                            <button
                              type="submit"
                              formAction={deleteAction}
                              className="flex-1 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
                            >
                              삭제
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <AdminListPagination
          basePath={`${BASE_PATH}${type !== "posts" ? `?type=${type}` : ""}`}
          params={params}
          totalCount={list.totalCount}
          rowsOnPage={list.rows.length}
        />
      </div>
    </div>
  );
}
