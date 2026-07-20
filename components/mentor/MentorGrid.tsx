"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import type { MentorsListView } from "@/lib/mentor/mentorsListSearchParams";
import type { MentorPublicListCard } from "@/lib/mentor/publicMentorsListQueries";
import { MentorCard } from "@/components/mentor/MentorCard";

// ★공개 멘토 카드 그리드: 이미 로드·정렬·필터된 배열을 클라이언트 사이드 slice.
// (새 fetch/limit 없음 — 받은 cards 배열만 쪼갠다. 서버 정렬/페이지네이션은 미터치.)
// 데스크탑 6/page, 모바일(≤767px) 4/page — 클라이언트 슬라이스 크기만 반응형 분기.
const MENTORS_PER_PAGE_DESKTOP = 6;
const MENTORS_PER_PAGE_MOBILE = 4;

export function MentorGrid(props: {
  cards: MentorPublicListCard[];
  favoriteIds: Set<string>;
  isLoggedIn: boolean;
  view?: MentorsListView;
}) {
  const view = props.view ?? "list";

  // 검색/필터(학교·과목·가격대·정렬) 변경 → 결과 배열(순서·구성)이 바뀜 → 1페이지 리셋.
  // effect 대신 렌더 중 파생 리셋(안전 변환 패턴).
  const cardsSignature = props.cards.map((c) => c.mentorId).join("|");
  const [page, setPage] = useState(1);
  const [prevSignature, setPrevSignature] = useState(cardsSignature);
  if (prevSignature !== cardsSignature) {
    setPrevSignature(cardsSignature);
    setPage(1);
  }

  // SSR 스냅샷=데스크탑(6) → hydration 후 모바일(≤767px)이면 4로 보정(useMediaQuery).
  const pageSize = useMediaQuery("(max-width: 767px)") ? MENTORS_PER_PAGE_MOBILE : MENTORS_PER_PAGE_DESKTOP;

  // pageSize 전환(데스크탑↔모바일) 시 safePage 클램프로 현재 페이지가 범위를 넘지 않게.
  const totalPages = Math.max(1, Math.ceil(props.cards.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedCards = props.cards.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const grid =
    view === "grid" ? (
      <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-2">
        {pagedCards.map((c) => (
          <MentorCard
            key={c.mentorId}
            card={c}
            isLoggedIn={props.isLoggedIn}
            isFavorited={props.favoriteIds.has(c.mentorId)}
            layout="grid"
          />
        ))}
      </div>
    ) : (
      <div className="flex min-w-0 flex-col gap-4">
        {pagedCards.map((c) => (
          <MentorCard
            key={c.mentorId}
            card={c}
            isLoggedIn={props.isLoggedIn}
            isFavorited={props.favoriteIds.has(c.mentorId)}
            layout="list"
          />
        ))}
      </div>
    );

  return (
    <>
      {grid}

      {totalPages > 1 ? (
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="이전 페이지"
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#2563EB]/40 bg-white px-3 text-sm font-extrabold text-[#2563EB] transition hover:bg-blue-50 disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-white"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            이전
          </button>
          <span className="px-1 text-sm font-bold text-slate-500 tabular-nums">
            {safePage} · {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            aria-label="다음 페이지"
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#2563EB]/40 bg-white px-3 text-sm font-extrabold text-[#2563EB] transition hover:bg-blue-50 disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-white"
          >
            다음
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  );
}
