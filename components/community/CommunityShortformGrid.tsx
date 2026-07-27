"use client";

import { useState } from "react";
import { CommunityShortformVideoCard } from "@/components/community/CommunityShortformVideoCard";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import type { ShortformCard } from "@/lib/community/communityShortformQueries";

const PAGE_SIZE = 6;
const PAGE_SIZE_MOBILE = 4;

/**
 * 숏폼 그리드 — 이미 로드된 배열을 클라이언트 사이드로 페이지네이션(새 fetch 없음).
 * 데스크탑 3열·6개/page, 모바일 1열·4개/page. 카드·라우팅은 기존 그대로.
 */
export function CommunityShortformGrid({ items }: { items: ShortformCard[] }) {
  const [page, setPage] = useState(1);
  // 탭·카테고리 변경(=items 교체) 시 1페이지로 리셋 — effect 대신 렌더 중 파생 리셋(안전 변환 패턴).
  const [prevItems, setPrevItems] = useState(items);
  if (prevItems !== items) {
    setPrevItems(items);
    setPage(1);
  }
  // 모바일은 페이지당 4개, 데스크탑은 기존 6개. SSR 스냅샷=데스크탑 → hydration 후 보정(useMediaQuery).
  const pageSize = useMediaQuery("(max-width: 767px)") ? PAGE_SIZE_MOBILE : PAGE_SIZE;

  // pageSize 전환(데스크탑↔모바일) 시 currentPage 클램프로 범위 초과 방지.
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      <ul className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 sm:gap-4 md:grid-cols-3">
        {visible.map((item) => (
          <CommunityShortformVideoCard key={item.id} item={item} href={`/community/shortform/${item.id}`} />
        ))}
      </ul>

      {totalPages > 1 ? (
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
      ) : null}
    </div>
  );
}
