"use client";

/**
 * 멘토 승인 작업대 — 3분할 틀(PR-2 §1).
 *
 *   [지원자 목록 300px] [서류 뷰어 — 가변 · 가장 크게] [심사 패널 380px]
 *
 * - 1280px(xl) 미만에서는 목록을 기본으로 접는다 — 뷰어는 가장 나중에 줄인다. 어느 폭에서든 토글로 펼치고 접을 수 있다.
 * - lg 미만은 세로로 쌓인다(관리자 콘솔은 데스크톱 우선).
 * - 각 칸은 자기 안에서 스크롤한다. 우측 결정 영역은 패널 컴포넌트가 flex 하단에 고정한다.
 */
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type ListVisibility = "auto" | "open" | "closed";

type Props = {
  list: ReactNode;
  viewer: ReactNode;
  panel: ReactNode;
  /** 뷰어 상단에 보이는 요약(예: 대기 1 / 전체 74) */
  listSummary: string;
};

const GRID_BY_VISIBILITY: Record<ListVisibility, string> = {
  auto: "lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[300px_minmax(0,1fr)_380px]",
  open: "lg:grid-cols-[300px_minmax(0,1fr)_380px]",
  closed: "lg:grid-cols-[minmax(0,1fr)_380px]",
};

const LIST_BY_VISIBILITY: Record<ListVisibility, string> = {
  auto: "hidden xl:block",
  open: "block",
  closed: "hidden",
};

export function MentorApprovalWorkbenchFrame(props: Props) {
  const { list, viewer, panel, listSummary } = props;
  const [visibility, setVisibility] = useState<ListVisibility>("auto");

  // 토글: auto → 현재 폭에서 보이던 반대 상태로. (xl 이상은 열려 있었으니 닫고, 미만은 닫혀 있었으니 연다)
  const toggle = () => {
    setVisibility((v) => {
      if (v === "open") return "closed";
      if (v === "closed") return "open";
      const isXl = typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;
      return isXl ? "closed" : "open";
    });
  };

  return (
    <div className={cn("grid grid-cols-1 gap-3 lg:h-[calc(100dvh-14rem)] lg:min-h-[600px]", GRID_BY_VISIBILITY[visibility])} data-workbench>
      <aside className={cn("min-h-0 lg:h-full", LIST_BY_VISIBILITY[visibility])} aria-label="지원자 목록">
        {list}
      </aside>
      <section className="flex min-h-0 flex-col gap-2 lg:h-full" aria-label="서류 뷰어">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={toggle}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-extrabold text-slate-700 hover:bg-slate-50"
            aria-expanded={visibility === "open" ? true : visibility === "closed" ? false : undefined}
          >
            {visibility === "closed" ? "목록 펼치기" : visibility === "open" ? "목록 접기" : "목록 접기/펼치기"}
          </button>
          <p className="text-[11px] font-bold text-slate-500">{listSummary}</p>
        </div>
        <div className="min-h-0 flex-1">{viewer}</div>
      </section>
      <aside className="min-h-0 lg:h-full" aria-label="심사 패널">
        {panel}
      </aside>
    </div>
  );
}
