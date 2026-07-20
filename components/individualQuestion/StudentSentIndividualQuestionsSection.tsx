"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Inbox } from "lucide-react";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { listCardClassName, type ListCardTone } from "@/components/design-system/ListCard";
import { getSubjectLabel } from "@/lib/subjects/subjectCatalog";
import {
  formatIndividualQuestionDate,
  formatIndividualQuestionExpiryRemaining,
  formatIndividualQuestionPrice,
  individualQuestionStatusBadgeClass,
  individualQuestionStatusLabel,
  individualQuestionTypeLabel,
  isIndividualQuestionAnswered,
  isIndividualQuestionAwaitingAnswer,
  isIndividualQuestionExpiringSoon,
} from "@/lib/individualQuestion/individualQuestionFormat";
import type { IndividualQuestionListItem } from "@/lib/individualQuestion/individualQuestionQueries";

// 개별질문 상태 → 목록 카드 좌측 액센트 톤(IndividualQuestionViews와 동일 규약).
function iqCardTone(status: string | null | undefined): ListCardTone {
  switch ((status ?? "").toLowerCase()) {
    case "released":
      return "blue";
    case "answered":
      return "green";
    case "open":
    case "assigned":
    case "claimed":
    case "escrowed":
      return "amber";
    default:
      return "neutral";
  }
}

function ExpiringSoonBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-rose-100 bg-rose-50 px-2.5 py-1 text-xs font-extrabold text-rose-600">
      <Clock className="h-3 w-3" aria-hidden />
      마감 임박
    </span>
  );
}

// 카드 마크업은 IndividualQuestionViews의 IndividualQuestionListCards(학생 변형)와 동일(구조 미터치, 클라이언트 분류용 복제).
function SentQuestionCard(props: { row: IndividualQuestionListItem; detailBaseHref: string }) {
  const { row } = props;
  const expiringSoon = isIndividualQuestionExpiringSoon(row.expires_at, row.status);
  const remainingLabel = formatIndividualQuestionExpiryRemaining(row.expires_at, row.status);
  return (
    <Link
      href={`${props.detailBaseHref}/${row.id}`}
      className={listCardClassName(iqCardTone(row.status), true, "group block")}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-extrabold ${individualQuestionStatusBadgeClass(row.status)}`}>
              {individualQuestionStatusLabel(row.status)}
            </span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
              {individualQuestionTypeLabel(row.question_type)}
            </span>
            {row.subject ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                {getSubjectLabel(row.subject)}
                {row.topic ? ` · ${row.topic}` : ""}
              </span>
            ) : null}
            <span className="text-xs font-bold text-slate-900">{formatIndividualQuestionPrice(row.price_cents)} 안전 결제</span>
            {expiringSoon ? <ExpiringSoonBadge /> : null}
          </div>
          <h2 className="mt-2 truncate text-lg font-black text-slate-900 group-hover:text-blue-700">{row.title}</h2>
          <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{row.body}</p>
          {remainingLabel ? (
            <p className={`mt-2 text-xs font-bold ${expiringSoon ? "text-rose-600" : "text-slate-500"}`}>{remainingLabel}</p>
          ) : null}
        </div>
        <dl className="grid min-w-[180px] gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm">
          <div>
            <dt className="text-xs font-bold text-slate-500">멘토</dt>
            <dd className="mt-0.5 font-extrabold text-slate-900">{row.mentorName}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-slate-500">등록일</dt>
            <dd className="mt-0.5 font-extrabold text-slate-900">{formatIndividualQuestionDate(row.created_at)}</dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}

const PAGE_SIZE = 5;
const PAGE_SIZE_MOBILE = 4;

type StatusTab = "all" | "in_progress" | "done" | "closed";

/**
 * 학생 "보낸 개별 질문" — 상태(진행 중/완료/종료) 탭으로 클라이언트 분류 + 5개/페이지 페이지네이션.
 * 데이터/쿼리는 그대로(이미 로드된 배열 필터만). 분류는 상태 배지 규약(individualQuestionFormat) 재사용.
 *   - 진행 중 = isIndividualQuestionAwaitingAnswer (예치중/공개중/답변중)
 *   - 완료    = isIndividualQuestionAnswered (답변완료/완료 = answered·released)
 *   - 종료    = 그 외(환불/만료/취소)
 */
export function StudentSentIndividualQuestionsSection(props: {
  rows: IndividualQuestionListItem[];
  emptyTitle: string;
  emptyDescription: string;
  detailBaseHref: string;
}) {
  const [tab, setTab] = useState<StatusTab>("all");
  const [page, setPage] = useState(1);

  const inProgressCount = useMemo(
    () => props.rows.filter((row) => isIndividualQuestionAwaitingAnswer(row.status)).length,
    [props.rows]
  );
  const doneCount = useMemo(
    () => props.rows.filter((row) => isIndividualQuestionAnswered(row.status)).length,
    [props.rows]
  );
  const closedCount = props.rows.length - inProgressCount - doneCount;

  const filteredRows = useMemo(() => {
    switch (tab) {
      case "in_progress":
        return props.rows.filter((row) => isIndividualQuestionAwaitingAnswer(row.status));
      case "done":
        return props.rows.filter((row) => isIndividualQuestionAnswered(row.status));
      case "closed":
        return props.rows.filter(
          (row) => !isIndividualQuestionAwaitingAnswer(row.status) && !isIndividualQuestionAnswered(row.status)
        );
      default:
        return props.rows;
    }
  }, [props.rows, tab]);

  // 탭(필터) 변경 시 1페이지 리셋 — effect 대신 렌더 중 파생 리셋(안전 변환 패턴).
  const [prevTab, setPrevTab] = useState(tab);
  if (prevTab !== tab) {
    setPrevTab(tab);
    setPage(1);
  }

  // 모바일은 페이지당 4개, 데스크탑은 기존 5개. SSR 스냅샷=데스크탑 → hydration 후 보정(useMediaQuery).
  const pageSize = useMediaQuery("(max-width: 767px)") ? PAGE_SIZE_MOBILE : PAGE_SIZE;

  const tabs: { id: StatusTab; label: string; count: number }[] = [
    { id: "all", label: "전체", count: props.rows.length },
    { id: "in_progress", label: "진행 중", count: inProgressCount },
    { id: "done", label: "완료", count: doneCount },
    { id: "closed", label: "종료", count: closedCount },
  ];

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <section>
      {/* 모바일: 가로 스크롤 한 줄(줄바꿈 방지) · 데스크탑(md+): 기존 flex-wrap 그대로 */}
      <div
        className="iq-status-filter-scroll -mx-1 mb-5 flex flex-nowrap gap-2 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
        role="tablist"
        aria-label="질문 상태 필터"
      >
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={[
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-bold transition",
                active
                  ? "border-[#2563EB] bg-[#2563EB] text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-[#1D4ED8]",
              ].join(" ")}
            >
              {t.label}
              <span
                className={[
                  "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold tabular-nums",
                  active ? "bg-white/25 text-white" : "bg-slate-100 text-slate-500",
                ].join(" ")}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {filteredRows.length === 0 ? (
        // EmptyState(compact)와 동일 마크업 — 설명만 모바일 1줄 축약(데스크탑 원문 보존) 위해 인라인.
        <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EBF1FE] text-[#2563EB]">
            <Inbox className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold text-slate-900">
              {tab === "all" ? props.emptyTitle : "해당 상태의 질문이 없어요"}
            </p>
            {tab === "all" ? (
              <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-600">
                <span className="md:hidden">멘토에게 바로 질문해 보세요.</span>
                <span className="hidden md:inline">{props.emptyDescription}</span>
              </p>
            ) : (
              <p className="mt-0.5 text-xs font-medium leading-relaxed text-slate-600">다른 상태 탭을 확인해 보세요.</p>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-4">
            {pagedRows.map((row) => (
              <SentQuestionCard key={row.id} row={row} detailBaseHref={props.detailBaseHref} />
            ))}
          </div>

          {totalPages > 1 ? (
            <nav className="mt-6 flex items-center justify-center gap-3" aria-label="페이지 이동">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage(Math.max(1, safePage - 1))}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                이전
              </button>
              <span className="text-sm font-bold tabular-nums text-slate-500">
                <span className="text-[#2563EB]">{safePage}</span> · {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                다음
              </button>
            </nav>
          ) : null}
        </>
      )}

      {/* 모바일 가로 스크롤 필터의 스크롤바 숨김(webkit) — Firefox/IE는 위 arbitrary 클래스로 처리 */}
      <style jsx global>{`
        .iq-status-filter-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </section>
  );
}
