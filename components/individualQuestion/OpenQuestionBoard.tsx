"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ClipboardList, Clock, Sparkles } from "lucide-react";
import { FormSubmitButton } from "@/components/qna/FormSubmitButton";
import { EmptyState } from "@/components/common/EmptyState";
import { getSubjectLabel } from "@/lib/subjects/subjectCatalog";
import { claimOpenIndividualQuestionAction } from "@/lib/individualQuestion/individualQuestionActions";
import {
  formatIndividualQuestionDate,
  formatIndividualQuestionExpiryRemaining,
  formatIndividualQuestionPrice,
  isIndividualQuestionExpiringSoon,
} from "@/lib/individualQuestion/individualQuestionFormat";
import type { OpenIndividualQuestionBrowseRow } from "@/lib/individualQuestion/individualQuestionQueries";

type SortKey = "newest" | "expiring" | "price";

/**
 * 공개 질문 게시판 — 로드된 공개 질문(rows)을 과목 칩·정렬로 훑고 원하는 질문을 골라
 * 먼저 답변을 맡는 보드형 UI. 필터·정렬은 전부 클라이언트 처리(서버 쿼리 미변경)이며,
 * claim 은 기존 claimOpenIndividualQuestionAction(questionId hidden input)을 그대로 사용한다.
 */
export function OpenQuestionBoard(props: {
  rows: OpenIndividualQuestionBrowseRow[];
  error?: string | null;
}) {
  const { rows } = props;
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("newest");

  // rows 에 실제 등장하는 과목만 칩으로 노출(중복 제거, 지어내지 않음).
  const subjects = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.subject) seen.add(r.subject);
    }
    return [...seen];
  }, [rows]);

  const visibleRows = useMemo(() => {
    const filtered = subjectFilter ? rows.filter((r) => r.subject === subjectFilter) : rows.slice();
    filtered.sort((a, b) => {
      if (sort === "price") return b.price_cents - a.price_cents;
      if (sort === "expiring") {
        // 마감임박순: expires_at 오름차순, 없는 건 맨 뒤로.
        const ea = a.expires_at ? Date.parse(a.expires_at) : Number.POSITIVE_INFINITY;
        const eb = b.expires_at ? Date.parse(b.expires_at) : Number.POSITIVE_INFINITY;
        return ea - eb;
      }
      // 최신순: created_at 내림차순.
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });
    return filtered;
  }, [rows, subjectFilter, sort]);

  if (props.error) {
    return (
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
        공개 질문 목록을 불러오지 못했습니다. {props.error}
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Sparkles className="h-5 w-5" aria-hidden />}
        title="답변할 수 있는 공개 질문이 없습니다"
        description="학생이 공개형 질문을 등록하면 이곳에 표시됩니다. 단가를 설정해 두면 지정 질문도 받을 수 있어요."
        action={
          <Link
            href="/mentor/profile/edit"
            className="inline-flex items-center rounded-xl bg-[#059669] px-4 py-2 text-sm font-extrabold text-white hover:bg-[#047857]"
          >
            단가 설정
          </Link>
        }
      />
    );
  }

  const chipClass = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-bold transition ${
      active
        ? "border-transparent bg-[#059669] text-white"
        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
    }`;

  return (
    <div>
      {/* 보드 헤더 */}
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-[#059669]">
          <ClipboardList className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-black text-slate-900">공개 질문 게시판</h3>
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-extrabold text-[#047857]">
              대기 {rows.length}건
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">답변하고 싶은 공개 질문을 골라 먼저 답변을 맡아보세요</p>
          <p className="mt-0.5 text-xs font-medium text-slate-400">
            학생 신원과 본문은 답변을 맡기 전에는 공개되지 않아요
          </p>
        </div>
      </div>

      {/* 필터/정렬 바 */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSubjectFilter(null)} className={chipClass(subjectFilter === null)}>
            전체
          </button>
          {subjects.map((s) => (
            <button key={s} type="button" onClick={() => setSubjectFilter(s)} className={chipClass(subjectFilter === s)}>
              {getSubjectLabel(s)}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 outline-none focus:border-[#059669]"
          aria-label="정렬"
        >
          <option value="newest">최신순</option>
          <option value="expiring">마감임박순</option>
          <option value="price">금액높은순</option>
        </select>
      </div>

      {/* 카드 그리드 */}
      {visibleRows.length === 0 ? (
        <p className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm font-bold text-slate-500">
          선택한 과목의 공개 질문이 없습니다.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {visibleRows.map((row) => {
            const expiringSoon = isIndividualQuestionExpiringSoon(row.expires_at, "open");
            const remainingLabel = formatIndividualQuestionExpiryRemaining(row.expires_at, "open");
            return (
              <article
                key={row.id}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {row.subject ? (
                    <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-extrabold text-[#047857]">
                      {getSubjectLabel(row.subject)}
                      {row.topic ? ` · ${row.topic}` : ""}
                    </span>
                  ) : null}
                  {remainingLabel ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold ${
                        expiringSoon ? "border border-rose-100 bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <Clock className="h-3 w-3" aria-hidden />
                      {remainingLabel}
                    </span>
                  ) : null}
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                    학생 신원 비공개
                  </span>
                </div>

                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-black text-[#059669]">
                    {formatIndividualQuestionPrice(row.price_cents)}
                  </span>
                  <span className="text-xs font-bold text-slate-500">안전 결제</span>
                </div>

                <h4 className="mt-3 text-base font-black leading-snug text-slate-900">{row.title}</h4>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  본문과 첨부는 답변을 맡은 뒤에만 열람할 수 있어요.
                </p>

                <div className="mt-auto border-t border-slate-100 pt-4">
                  <p className="text-xs font-bold text-slate-500">등록 {formatIndividualQuestionDate(row.created_at)}</p>
                  <form action={claimOpenIndividualQuestionAction} className="mt-3">
                    <input type="hidden" name="questionId" value={row.id} />
                    <FormSubmitButton
                      idleLabel="답변하기"
                      pendingLabel="확인 중..."
                      className="w-full rounded-xl bg-[#059669] px-5 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-[#047857] disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
