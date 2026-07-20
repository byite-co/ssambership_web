"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { PenLine } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { COMMUNITY_POST_CATEGORIES } from "@/lib/community/communityBoardConstants";
import type { CommunityBoardPostCard } from "@/lib/community/communityBoardQueries";
import { CommunityPostCard } from "@/components/community/CommunityPostCard";
import { communityFilterChipClass } from "@/components/community/communityFilterChipStyles";
import {
  CommunityBoardSortTabs,
} from "@/components/community/CommunityBoardSortTabs";
import {
  parseCommunityBoardSortTab,
  type CommunityBoardSortTab,
} from "@/lib/community/communityBoardSort";

const PRIMARY = "#2563EB";
const BOARD_PAGE_SIZE = 10;

type Props = {
  initialPosts: CommunityBoardPostCard[];
  initialCursor: string | null;
  initialCategory: string;
  initialSort?: CommunityBoardSortTab;
  showSortTabs?: boolean;
  /** 목록 URL 기준 (홈: /community, 게시판: /community/board) */
  basePath?: string;
  writeHref?: string;
  /** true: 이미 로드된 배열을 10개씩 클라이언트 페이지네이션(게시판). 기본 false: 기존 무한 스크롤(홈). */
  paginate?: boolean;
};

export function CommunityHomeFeed(props: Props) {
  const basePath = props.basePath ?? "/community";
  const writeHref = props.writeHref ?? "/community/new";
  const router = useRouter();
  const searchParams = useSearchParams();
  const category = searchParams.get("category") ?? props.initialCategory ?? "all";
  const sortTab = parseCommunityBoardSortTab(searchParams.get("tab") ?? props.initialSort ?? "all");

  const [posts, setPosts] = useState(props.initialPosts);
  const [cursor, setCursor] = useState<string | null>(props.initialCursor);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(!props.initialCursor);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const paginate = props.paginate ?? false;
  const [page, setPage] = useState(1);
  // 탭(정렬)·카테고리 변경 시 1페이지로 리셋 — effect 대신 렌더 중 파생 리셋(안전 변환 패턴).
  const listKey = `${category}|${sortTab}`;
  const [prevListKey, setPrevListKey] = useState(listKey);
  if (prevListKey !== listKey) {
    setPrevListKey(listKey);
    setPage(1);
  }
  // 모바일은 페이지당 5개, 데스크탑은 기존 10개. SSR 스냅샷=데스크탑 → hydration 후 보정(useMediaQuery).
  const isMobileList = useMediaQuery("(max-width: 767px)");
  const pageSize = isMobileList ? 5 : BOARD_PAGE_SIZE;

  // 서버가 새 initialPosts 를 내려주면(라우팅·revalidate) 현재 필터가 초기 필터와 일치할 때 목록 동기화.
  // effect 의 동기 setState 대신 렌더 중 파생 리셋.
  const [prevInitialPosts, setPrevInitialPosts] = useState(props.initialPosts);
  if (prevInitialPosts !== props.initialPosts) {
    setPrevInitialPosts(props.initialPosts);
    if (category === props.initialCategory && sortTab === (props.initialSort ?? "all")) {
      setPosts(props.initialPosts);
      setCursor(props.initialCursor);
      setDone(!props.initialCursor);
    }
  }

  useEffect(() => {
    // 초기 필터와 일치하면 목록은 서버 props(위 파생 리셋)가 정본 — fetch 불필요.
    if (category === props.initialCategory && sortTab === (props.initialSort ?? "all")) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ category, limit: "12" });
        if (sortTab !== "all") q.set("tab", sortTab);
        const res = await fetch(`/api/community/posts?${q.toString()}`);
        const json = (await res.json()) as { posts: CommunityBoardPostCard[]; nextCursor: string | null };
        if (!cancelled) {
          setPosts(json.posts);
          setCursor(json.nextCursor);
          setDone(!json.nextCursor);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.initialCategory, props.initialSort, category, sortTab]);

  const loadMore = useCallback(async () => {
    if (loading || done || !cursor) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ category, cursor, limit: "12" });
      if (sortTab !== "all") q.set("tab", sortTab);
      const res = await fetch(`/api/community/posts?${q.toString()}`);
      const json = (await res.json()) as {
        posts: CommunityBoardPostCard[];
        nextCursor: string | null;
      };
      setPosts((prev) => [...prev, ...json.posts]);
      setCursor(json.nextCursor);
      setDone(!json.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [category, cursor, done, loading, sortTab]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  function onTab(slug: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (slug === "all") p.delete("category");
    else p.set("category", slug);
    const qs = p.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  const totalPages = Math.max(1, Math.ceil(posts.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visiblePosts = paginate
    ? posts.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : posts;

  return (
    <section className="space-y-4">
      {props.showSortTabs ? (
        <CommunityBoardSortTabs active={sortTab} basePath={basePath} />
      ) : null}
      {/* 모바일: 가로 스크롤 한 줄(칩 → 마지막 칩 peek) · 데스크탑(md+): 기존 flex-wrap 그대로 */}
      <nav
        className="community-filter-scroll -mx-1 flex flex-nowrap gap-2 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
        aria-label="카테고리"
      >
        {COMMUNITY_POST_CATEGORIES.map((c) => {
          const active = category === c.slug;
          return (
            <button
              key={c.slug}
              type="button"
              onClick={() => onTab(c.slug)}
              className={`${communityFilterChipClass(active, "sm")} shrink-0 whitespace-nowrap`}
            >
              {c.label}
            </button>
          );
        })}
      </nav>

      {posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <PenLine className="h-12 w-12 text-slate-400" strokeWidth={1.5} aria-hidden />
          <h3 className="mt-4 text-lg font-black text-slate-900">아직 게시글이 없어요</h3>
          <p className="mt-2 text-sm font-medium text-slate-600">이 카테고리에 첫 번째 글을 작성해보세요.</p>
          <Link
            href={writeHref}
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-5 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
          >
            글 작성하기
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {visiblePosts.map((post) => (
            <li key={post.id}>
              <CommunityPostCard post={post} />
            </li>
          ))}
        </ul>
      )}

      {paginate ? (
        totalPages > 1 ? (
          <div className="mt-4 flex items-center justify-center gap-2" aria-label="페이지 이동">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
            >
              이전
            </button>
            <span className="text-xs font-bold" aria-live="polite">
              <span className="text-[#2563EB]">{currentPage}</span>
              <span className="text-slate-400"> · {totalPages}</span>
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
            >
              다음
            </button>
          </div>
        ) : null
      ) : (
        <>
          <div ref={sentinelRef} className="h-8" aria-hidden />
          {loading ? (
            <p className="text-center text-xs font-semibold text-slate-500">불러오는 중…</p>
          ) : null}
          {done && posts.length > 0 ? (
            <p className="text-center text-xs text-slate-400">모두 불러왔습니다.</p>
          ) : null}
        </>
      )}

      <Link
        href={writeHref}
        className="fixed bottom-6 right-6 z-40 flex h-14 items-center gap-1 rounded-full px-5 text-sm font-extrabold text-white shadow-lg transition hover:scale-105 sm:bottom-8 sm:right-8"
        style={{ backgroundColor: PRIMARY }}
        aria-label="글쓰기"
      >
        <span className="text-xl leading-none">+</span>
        <span>글쓰기</span>
      </Link>

      {/* 모바일 가로 스크롤 카테고리 필터의 스크롤바 숨김(webkit) — FF/IE는 위 arbitrary 클래스로 처리 */}
      <style jsx global>{`
        .community-filter-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </section>
  );
}
