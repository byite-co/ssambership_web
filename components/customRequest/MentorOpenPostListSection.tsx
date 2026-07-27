"use client";

import { useState } from "react";
import Link from "next/link";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { EmptyState, LinkButton } from "@/components/design-system";
import { mapPostRowToPublicDetail } from "@/lib/customRequest/customRequestPostMappers";

type Row = Record<string, unknown>;

const PAGE_SIZE = 5;

function timeAgo(dateStr: string): string {
  if (!dateStr || dateStr === "—") return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMin = Math.round((now.getTime() - d.getTime()) / (1000 * 60));
    if (diffMin < 1) return "방금 전";
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}시간 전`;
    return `${Math.round(diffMin / (60 * 24))}일 전`;
  } catch {
    return "";
  }
}

export function MentorOpenPostListSection(props: {
  rows: Row[];
  listStatus: "ok" | "empty" | "rpc_unavailable";
}) {
  const [page, setPage] = useState(1);

  // 탭/카테고리 변경 시 서버에서 새 rows가 내려오므로 1페이지로 리셋 — effect 대신 렌더 중 파생 리셋.
  const [prevRows, setPrevRows] = useState(props.rows);
  if (prevRows !== props.rows) {
    setPrevRows(props.rows);
    setPage(1);
  }

  // 모바일은 페이지당 4개, 데스크탑은 기존 5개. SSR 스냅샷=데스크탑 → hydration 후 보정(useMediaQuery).
  const pageSize = useMediaQuery("(max-width: 767px)") ? 4 : PAGE_SIZE;

  if (props.listStatus === "rpc_unavailable") {
    return (
      <div className="rounded-2xl border border-ds-border-subtle bg-white px-5 py-5">
        <p className="text-sm font-bold text-slate-900">모집 목록을 잠시 불러올 수 없어요</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          운영 환경에 맞춰 연결 중이에요. 잠시 후 다시 열어 보시거나, 제안한 의뢰 탭을 확인해 주세요.
        </p>
      </div>
    );
  }
  if (!props.rows.length) {
    return (
      <EmptyState
        title="모집 중인 맞춤의뢰가 아직 없어요"
        description="새로운 의뢰가 등록되면 여기에 표시됩니다."
      />
    );
  }
  const totalPages = Math.max(1, Math.ceil(props.rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleRows = props.rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="space-y-4">
    <ul className="space-y-3">
      {visibleRows.map((r, i) => {
        const d = mapPostRowToPublicDetail(r);
        const id = String(r.id ?? i);
        const detailHref = `/mentor/custom-request/posts/${id}`;
        const applyHref = `/mentor/custom-request/posts/${id}/apply`;
        const createdAt = String(r.created_at ?? "");
        const timeLabel = timeAgo(createdAt);
        const categoryLabel = d.category !== "—" ? d.category : "";
        const statusLabel = d.status && d.status !== "—" ? d.status : "";
        const summary =
          d.body !== "—" ? d.body : d.goal !== "—" ? d.goal : d.subject !== "—" ? d.subject : "";
        const budgetLabel = d.budgetLine !== "—" ? d.budgetLine : "";
        const deadlineLabel = d.deadline !== "—" ? d.deadline : "";

        return (
          <li key={id}>
            {/* 크몽식 거래 카드 — 분류/상태 칩 + 식별 가능한 제목·요약 + 1차 정보(예상금액·마감) 강조. 멘토 화면=초록 액센트. */}
            <div className="flex items-stretch justify-between gap-4 rounded-2xl border border-ds-border-subtle border-l-[3px] border-l-emerald-600 bg-white px-5 py-4 transition-[box-shadow,border-color] duration-150 hover:border-emerald-400 hover:shadow-[0_2px_10px_rgba(0,0,0,0.09)]">
              <Link href={detailHref} className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {categoryLabel ? (
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-extrabold text-[#047857]">
                      {categoryLabel}
                    </span>
                  ) : null}
                  {statusLabel ? (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
                      {statusLabel}
                    </span>
                  ) : null}
                  {timeLabel ? <span className="text-[11px] font-medium text-slate-400">{timeLabel}</span> : null}
                </div>
                <p className="mt-2 truncate text-base font-extrabold text-slate-900">{d.title}</p>
                {summary ? (
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{summary}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  {budgetLabel ? (
                    <span className="font-extrabold text-[#047857]">예상 {budgetLabel}</span>
                  ) : (
                    <span className="font-bold text-slate-400">예상 금액 협의</span>
                  )}
                  {deadlineLabel ? <span className="font-bold text-slate-700">마감 {deadlineLabel}</span> : null}
                </div>
              </Link>
              <div className="flex shrink-0 items-center">
                <LinkButton href={applyHref} variant="secondary" className="text-xs">
                  제안하기
                </LinkButton>
              </div>
            </div>
          </li>
        );
      })}
    </ul>

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2" aria-label="페이지 이동">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-xs font-bold" aria-live="polite">
            <span className="text-[#059669]">{currentPage}</span>
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
