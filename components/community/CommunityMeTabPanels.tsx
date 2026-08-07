import type { ReactNode } from "react";
import Link from "next/link";
import type { CommunityMeDraftItem, CommunityMePostListItem } from "@/lib/community/communityQueries";
import type { CommunityBoardPostCard } from "@/lib/community/communityBoardQueries";
import { CommunityPostCard } from "@/components/community/CommunityPostCard";
import type { CommunityMeTab } from "@/lib/community/communityMeTab";
import { communityMePath } from "@/lib/community/communityMeTab";
import type { AppRole } from "@/lib/types/user";

const linkSlate =
  "inline-flex rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-800 shadow-sm hover:border-slate-300";
const btnMentor = "inline-flex rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700";

export type CommunityMeActivityPayload = {
  myPosts: CommunityMePostListItem[];
  myDrafts: CommunityMeDraftItem[];
  boardCount: number | null;
  shortformCount: number | null;
  recent: CommunityMePostListItem[];
  /** D-CM-13: 스크랩한 게시글 카드(최신순). */
  scraps: CommunityBoardPostCard[];
  /** 스크랩 조회 실패(빈 목록과 구분). */
  scrapsError: boolean;
  loadFailed: boolean;
};

/** D-CM-13: 스크랩 탭 본문 — 조회 실패·빈 목록·목록을 구분해 렌더한다. */
function ScrapsPanelBody(props: { activity: CommunityMeActivityPayload | null }) {
  const act = props.activity;
  if (act?.scrapsError) {
    return <p className="text-amber-900">스크랩 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>;
  }
  const scraps = act?.scraps ?? [];
  if (scraps.length === 0) {
    return (
      <>
        <p>아직 스크랩한 글이 없어요. 게시글 상세에서 「스크랩」을 누르면 여기에 모입니다.</p>
        <NavHint />
      </>
    );
  }
  return (
    <ul className="mt-2 space-y-3">
      {scraps.map((post) => (
        <li key={post.id}>
          <CommunityPostCard post={post} />
        </li>
      ))}
    </ul>
  );
}

function Panel(props: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-extrabold text-slate-900">{props.title}</h2>
      <div className="mt-3 text-sm leading-relaxed text-slate-600">{props.children}</div>
    </section>
  );
}

function NavHint() {
  return <p className="mt-3 text-xs text-slate-500">숏폼·게시판은 왼쪽 메뉴에서 바로 열 수 있어요.</p>;
}

function KindBadge(props: { kind: "board" | "shortform" }) {
  const label = props.kind === "board" ? "게시판" : "숏폼";
  const cls =
    props.kind === "board"
      ? "border-slate-200 bg-slate-100 text-slate-800"
      : "border-violet-200 bg-violet-50 text-violet-900";
  return (
    <span className={`inline-flex shrink-0 rounded-lg border px-2 py-0.5 text-[10px] font-extrabold ${cls}`}>{label}</span>
  );
}

export function MeDraftsList(props: { items: CommunityMeDraftItem[] }) {
  if (props.items.length === 0) return null;
  return (
    <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/40">
      {props.items.map((item) => (
        <li key={`${item.kind}-${item.id}`} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <KindBadge kind={item.kind} />
            <div className="min-w-0 flex-1">
              <span className="font-bold text-slate-900 line-clamp-2">{item.title}</span>
              {item.dateLabel ? <p className="mt-0.5 text-xs text-slate-500">{item.dateLabel}</p> : null}
            </div>
          </div>
          <Link href={item.continueHref} className={linkSlate}>
            이어서 작성
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * 관리자 처분 배지 — 작성자 본인 표면에서만 렌더된다(item.moderation 은 본인일 때만 채워진다).
 * 공개 목록·타인 표면에는 애초에 행이 오지 않으므로 이 배지도 노출되지 않는다.
 */
function ModerationBadge(props: { label: string }) {
  return (
    <span className="inline-flex shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-800">
      {props.label}
    </span>
  );
}

export function MePostsList(props: { items: CommunityMePostListItem[] }) {
  if (props.items.length === 0) return null;
  return (
    <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-slate-50/40">
      {props.items.map((item) => (
        <li key={`${item.kind}-${item.id}`} className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <KindBadge kind={item.kind} />
            <div className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                {item.linkHref ? (
                  <Link href={item.linkHref} className="font-bold text-slate-900 hover:text-blue-700">
                    <span className="line-clamp-2">{item.title}</span>
                  </Link>
                ) : (
                  <span className="font-bold text-slate-700 line-clamp-2">{item.title}</span>
                )}
                {item.moderation ? <ModerationBadge label={item.moderation.badgeLabel} /> : null}
              </span>
              {item.moderation ? (
                <p className="mt-1 text-xs font-semibold text-amber-800">{item.moderation.reason}</p>
              ) : null}
              {item.dateLabel ? <p className="mt-0.5 text-xs text-slate-500">{item.dateLabel}</p> : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function countLine(board: number | null, shortform: number | null): string | null {
  const parts: string[] = [];
  if (typeof board === "number") parts.push(`게시글 ${board}개`);
  if (typeof shortform === "number") parts.push(`숏폼 ${shortform}개`);
  return parts.length ? parts.join(" · ") : null;
}

export function CommunityMeTabPanels(props: {
  tab: CommunityMeTab;
  loggedIn: boolean;
  role: AppRole | null | undefined;
  loginNextPath: string;
  activity: CommunityMeActivityPayload | null;
}) {
  const { tab, loggedIn, role, activity } = props;
  const isMentor = role === "mentor";
  const act = activity;

  if (!loggedIn) {
    const tabHint: Record<CommunityMeTab, string> = {
      overview: "요약과 탭별 화면은 로그인 후 이용할 수 있어요.",
      posts: "내 게시글 탭은 로그인 후 이용할 수 있어요.",
      drafts: "임시저장 목록은 로그인 후 이용할 수 있어요.",
      scraps: "스크랩한 글 목록은 로그인 후 이용할 수 있어요.",
    };
    return (
      <Panel title="로그인이 필요해요">
        <p>{tabHint[tab]}</p>
        <NavHint />
      </Panel>
    );
  }

  const overviewCounts = act ? countLine(act.boardCount, act.shortformCount) : null;
  const hasPosts = (act?.myPosts.length ?? 0) > 0;
  const hasDrafts = (act?.myDrafts.length ?? 0) > 0;

  if (isMentor) {
    if (tab === "overview") {
      return (
        <div className="space-y-4">
          <Panel title="내 커뮤니티 활동 요약">
            <p>작성한 글·숏폼은 「내 게시글」 탭에서 모아 볼 수 있어요.</p>
            {act?.loadFailed ? (
              <p className="mt-2 text-xs font-semibold text-amber-800">내 글 개수·목록을 일시적으로 불러오지 못했어요. 잠시 후 다시 열어 주세요.</p>
            ) : null}
            {overviewCounts ? <p className="mt-2 text-sm font-bold text-slate-900">{overviewCounts}</p> : null}
            {act && act.recent.length > 0 ? (
              <div className="mt-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">최근 작성</p>
                <MePostsList items={act.recent} />
              </div>
            ) : !act?.loadFailed && !overviewCounts ? (
              <p className="mt-2 text-xs text-slate-500">아직 반영할 활동 요약이 없어요. 글을 작성하면 여기에 모입니다.</p>
            ) : null}
            <div className="mt-4">
              <Link href={communityMePath("posts")} className={linkSlate}>
                내 게시글 탭으로 이동
              </Link>
            </div>
            <NavHint />
          </Panel>
        </div>
      );
    }
    if (tab === "posts") {
      return (
        <Panel title="내 게시글">
          {act?.loadFailed ? (
            <p className="text-amber-900">목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
          ) : hasPosts ? (
            <p className="text-slate-600">작성한 게시판 글과 숏폼이 최신순으로 표시됩니다.</p>
          ) : (
            <p>작성한 게시글이 아직 없어요. 첫 글은 작성 화면에서 시작할 수 있어요.</p>
          )}
          <MePostsList items={act?.myPosts ?? []} />
          <div className="mt-4">
            <Link href="/community/new" className={btnMentor}>
              게시글 작성
            </Link>
          </div>
        </Panel>
      );
    }
    if (tab === "drafts") {
      return (
        <Panel title="임시저장">
          {act?.loadFailed ? (
            <p className="text-amber-900">목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
          ) : hasDrafts ? (
            <p className="text-slate-600">임시저장한 게시글·숏폼을 이어서 작성할 수 있어요.</p>
          ) : (
            <p>임시저장된 글이 없어요. 작성 중 「임시저장」을 누르면 여기에 모입니다.</p>
          )}
          <MeDraftsList items={act?.myDrafts ?? []} />
        </Panel>
      );
    }
    if (tab === "scraps") {
      return (
        <Panel title="스크랩">
          <ScrapsPanelBody activity={act} />
        </Panel>
      );
    }
    return null;
  }

  /* student · admin · 기타 로그인 — 작성 CTA 없음 */
  if (tab === "overview") {
    return (
      <Panel title="커뮤니티 활동 요약">
        <p>댓글로 소통하는 등 참여 활동은 이 허브에서 이어 확인할 수 있어요.</p>
        {act?.loadFailed ? (
          <p className="mt-2 text-xs font-semibold text-amber-800">내 글 요약을 일시적으로 불러오지 못했어요.</p>
        ) : null}
        {overviewCounts ? <p className="mt-2 text-sm font-bold text-slate-900">{overviewCounts}</p> : null}
        {act && act.recent.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">최근 작성</p>
            <MePostsList items={act.recent} />
          </div>
        ) : null}
        <NavHint />
      </Panel>
    );
  }
  if (tab === "posts") {
    return (
      <Panel title="내 게시글">
        {act?.loadFailed ? (
          <p className="text-amber-900">목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
        ) : hasPosts ? (
          <p className="text-slate-600">작성한 게시판 글·숏폼이 최신순으로 표시됩니다.</p>
        ) : (
          <p>작성 가능한 커뮤니티 게시글이 없거나, 아직 작성한 글이 없어요. 멘토의 게시글과 숏폼을 둘러보세요.</p>
        )}
        <MePostsList items={act?.myPosts ?? []} />
        <NavHint />
      </Panel>
    );
  }
  if (tab === "drafts") {
    return (
      <Panel title="임시저장">
        {act?.loadFailed ? (
          <p className="text-amber-900">목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>
        ) : hasDrafts ? (
          <p className="text-slate-600">임시저장한 게시글을 이어서 작성할 수 있어요.</p>
        ) : (
          <p>임시저장된 글이 없어요. 작성 중 「임시저장」을 누르면 여기에 모입니다.</p>
        )}
        <MeDraftsList items={act?.myDrafts ?? []} />
        <div className="mt-4">
          <Link href="/community/new" className={linkSlate}>
            새 글 작성
          </Link>
        </div>
      </Panel>
    );
  }
  if (tab === "scraps") {
    return (
      <Panel title="스크랩">
        <ScrapsPanelBody activity={act} />
      </Panel>
    );
  }
  return null;
}
