"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BadgeCheck, Search, UserSearch } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import type { DirectMentorBoardCard } from "@/lib/individualQuestion/directMentorBoard";
import { formatIndividualQuestionPrice } from "@/lib/individualQuestion/individualQuestionFormat";
import { getMajorSubjects } from "@/lib/subjects/subjectCatalog";

type SortKey = "popular" | "rating" | "price_asc" | "price_desc";

const PAGE_STEP = 8;

/** 사진 있으면 사진, 없거나 로딩 실패 시 이름 첫 글자 이니셜 폴백(멘토 찾기 카드와 동일 규칙). */
function BoardMentorAvatar(props: { photo: string | null; name: string }) {
  const initial = (props.name || "멘").trim().slice(0, 1);
  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 border-white bg-[#2563EB]/10 shadow ring-1 ring-slate-100">
      <span className="absolute inset-0 flex items-center justify-center text-lg font-black text-[#2563EB]">
        {initial}
      </span>
      {props.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={props.photo}
          alt=""
          className="relative h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * 지정 질문 멘토 게시판 — 학생 개별 질문 탭 안에서 멘토 지정과 질문 전송을 끝내는 보드형 UI.
 * 멘토 찾기 탭을 축소해 따온 형태로, 필터·정렬·검색은 전부 클라이언트 처리(서버 쿼리 미변경).
 * 카드의 "지정 질문 보내기"는 /individual-questions/direct/[mentorId] (탭 내 작성 화면)로 이동한다.
 */
export function DirectMentorPickBoard(props: {
  cards: DirectMentorBoardCard[];
  pricesVisible: boolean;
  error?: string | null;
}) {
  const { cards, pricesVisible } = props;
  const [query, setQuery] = useState("");
  const [majorFilter, setMajorFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("popular");
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);

  // 카드에 실제 등장하는 과목 대분류만 칩으로 노출(공개 질문 게시판과 동일 규칙 — 지어내지 않음).
  const majorOptions = useMemo(() => {
    const present = new Set<string>();
    for (const c of cards) {
      for (const code of c.majorCodes) present.add(code);
    }
    return getMajorSubjects().filter((m) => present.has(m.code));
  }, [cards]);

  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = cards.filter((c) => {
      if (majorFilter && !c.majorCodes.includes(majorFilter)) return false;
      if (q && !c.searchBlob.includes(q)) return false;
      return true;
    });
    filtered.sort((a, b) => {
      // 단가를 아는 상태에서는 "질문받지 않음"(단가 미설정) 멘토를 항상 뒤로 보낸다.
      if (pricesVisible) {
        const aNone = a.iqPriceCents == null;
        const bNone = b.iqPriceCents == null;
        if (aNone !== bNone) return aNone ? 1 : -1;
      }
      if (sort === "price_asc") {
        return (a.iqPriceCents ?? Number.POSITIVE_INFINITY) - (b.iqPriceCents ?? Number.POSITIVE_INFINITY);
      }
      if (sort === "price_desc") {
        return (b.iqPriceCents ?? -1) - (a.iqPriceCents ?? -1);
      }
      if (sort === "rating") {
        return (b.avgRating ?? -1) - (a.avgRating ?? -1);
      }
      // 인기순: 멘토 찾기와 동일 점수(리뷰 수 가중 + 평점).
      const scoreA = (a.reviewCount ?? 0) * 10 + (a.avgRating ?? 0);
      const scoreB = (b.reviewCount ?? 0) * 10 + (b.avgRating ?? 0);
      return scoreB - scoreA;
    });
    return filtered;
  }, [cards, query, majorFilter, sort, pricesVisible]);

  if (props.error) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
        멘토 목록을 불러오지 못했습니다. {props.error}
      </p>
    );
  }

  if (cards.length === 0) {
    return (
      <EmptyState
        compact
        icon={<UserSearch className="h-5 w-5" aria-hidden />}
        title="아직 표시할 멘토가 없습니다"
        description="승인된 멘토가 등록되면 이곳에서 바로 지정 질문을 보낼 수 있어요."
        action={
          <Link
            href="/mentors"
            className="inline-flex items-center rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
          >
            멘토 찾기로 이동
          </Link>
        }
      />
    );
  }

  const chipClass = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-bold transition ${
      active
        ? "border-transparent bg-[#2563EB] text-white"
        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
    }`;

  const shownRows = visibleRows.slice(0, visibleCount);

  return (
    <div>
      {/* 보드 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-[#2563EB]">
            <UserSearch className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-black text-slate-900">지정 질문 멘토 게시판</h3>
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-extrabold text-[#1D4ED8]">
                멘토 {cards.length}명
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">원하는 멘토를 골라 이 탭에서 바로 1:1 지정 질문을 보내세요</p>
            <p className="mt-0.5 text-xs font-medium text-slate-400">
              등록 시 캐시 안전 결제 · 답변 완료 시 멘토에게 지급돼요
            </p>
          </div>
        </div>
        <Link
          href="/mentors"
          className="hidden shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-600 hover:bg-slate-50 sm:inline-flex"
        >
          멘토 찾기 전체 보기 →
        </Link>
      </div>

      {/* 검색/필터/정렬 바 */}
      <div className="mt-4 flex flex-col gap-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisibleCount(PAGE_STEP);
            }}
            placeholder="멘토 이름·학교·과목 검색"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm font-semibold text-slate-900 outline-none placeholder:font-medium placeholder:text-slate-400 focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
            aria-label="멘토 검색"
          />
        </label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setMajorFilter(null);
                setVisibleCount(PAGE_STEP);
              }}
              className={chipClass(majorFilter === null)}
            >
              전체
            </button>
            {majorOptions.map((m) => (
              <button
                key={m.code}
                type="button"
                onClick={() => {
                  setMajorFilter(m.code);
                  setVisibleCount(PAGE_STEP);
                }}
                className={chipClass(majorFilter === m.code)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 outline-none focus:border-[#2563EB]"
            aria-label="정렬"
          >
            <option value="popular">인기순</option>
            <option value="rating">평점순</option>
            {pricesVisible ? (
              <>
                <option value="price_asc">단가 낮은순</option>
                <option value="price_desc">단가 높은순</option>
              </>
            ) : null}
          </select>
        </div>
      </div>

      {/* 카드 그리드 */}
      {visibleRows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm font-bold text-slate-500">
          조건에 맞는 멘토가 없습니다. 검색어나 과목 필터를 바꿔 보세요.
        </p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {shownRows.map((card) => {
            const priced = card.iqPriceCents != null;
            const canAsk = priced || !pricesVisible;
            const ratingLabel =
              card.avgRating != null && Number.isFinite(card.avgRating)
                ? `★ ${card.avgRating.toFixed(1)}${card.reviewCount != null ? ` (${card.reviewCount})` : ""}`
                : "신규 멘토";
            return (
              <article key={card.mentorId} className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <BoardMentorAvatar photo={card.photoUrl} name={card.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <Link
                        href={`/mentors/${encodeURIComponent(card.mentorId)}`}
                        className="truncate text-sm font-black text-slate-900 hover:text-[#2563EB]"
                      >
                        {card.name}
                      </Link>
                      {card.verified ? (
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-[#059669] px-1.5 py-0.5 text-[10px] font-black text-white">
                          <BadgeCheck className="h-3 w-3" aria-hidden />
                          인증
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-600">
                      <span className="truncate">{card.schoolLine}</span>
                      <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-black ${card.badgeClass}`}>
                        {card.badgeLabel}
                      </span>
                    </div>
                  </div>
                </div>

                {card.chips.length > 0 ? (
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {card.chips.map((c) => (
                      <span
                        key={c}
                        className="rounded-md border border-[#2563EB]/40 bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#2563EB]"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                ) : null}

                <p className="mt-2 text-xs font-semibold text-slate-500">{ratingLabel}</p>

                <div className="mt-auto border-t border-slate-100 pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-extrabold text-slate-500">개별 질문 단가</span>
                    {pricesVisible ? (
                      priced ? (
                        <span className="text-lg font-black text-[#2563EB]">
                          {formatIndividualQuestionPrice(card.iqPriceCents)}
                        </span>
                      ) : (
                        <span className="text-sm font-extrabold text-slate-400">질문받지 않음</span>
                      )
                    ) : (
                      <span className="text-sm font-extrabold text-slate-500">로그인 후 확인</span>
                    )}
                  </div>
                  {canAsk ? (
                    <Link
                      href={`/individual-questions/direct/${encodeURIComponent(card.mentorId)}`}
                      className="mt-2.5 flex min-h-[40px] w-full items-center justify-center rounded-xl bg-[#2563EB] text-sm font-extrabold text-white shadow-sm hover:bg-[#1D4ED8]"
                    >
                      지정 질문 보내기
                    </Link>
                  ) : (
                    <Link
                      href={`/mentors/${encodeURIComponent(card.mentorId)}`}
                      className="mt-2.5 flex min-h-[40px] w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-extrabold text-slate-600 hover:bg-slate-50"
                    >
                      프로필 보기
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {visibleRows.length > visibleCount ? (
        <button
          type="button"
          onClick={() => setVisibleCount((n) => n + PAGE_STEP)}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-extrabold text-slate-700 hover:bg-slate-50"
        >
          멘토 더 보기 ({visibleRows.length - visibleCount}명 남음)
        </button>
      ) : null}
    </div>
  );
}
