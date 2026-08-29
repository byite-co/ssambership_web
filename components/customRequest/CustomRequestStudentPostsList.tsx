"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import { deleteCustomRequestDraftAction } from "@/lib/customRequest/customRequestComposeActions";
import { mapPostRowToPublicDetail } from "@/lib/customRequest/customRequestPostMappers";
import {
  applicationCountFromRow,
  bodyPreviewTwoLines,
  formatBudgetRangeCash,
  formatDeadlineDday,
  isDraftStudentPost,
  studentPostStatusBadge,
  studentPostStatusBucket,
  type StudentPostListFilter,
} from "@/lib/customRequest/studentPostDisplay";

type Row = Record<string, unknown>;

const STUDENT_POSTS_PAGE_SIZE = 10;

function formatSavedAt(row: Row): string {
  const raw = row.updated_at ?? row.created_at;
  if (raw == null) return "저장 시각 없음";
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return "저장 시각 없음";
  // TZ-FIX R3 #35: SSR(UTC)/해외 CSR 표기 갈림 → Asia/Seoul 고정.
  return d.toLocaleString("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });
}

export function CustomRequestStudentPostsList(props: { rows: Row[]; initialFilter?: StudentPostListFilter }) {
  const [filter, setFilter] = useState<StudentPostListFilter>(props.initialFilter ?? "all");
  const filtered = useMemo(() => {
    if (filter === "all") return props.rows;
    return props.rows.filter((r) => studentPostStatusBucket(r) === filter);
  }, [props.rows, filter]);

  const [page, setPage] = useState(1);
  // 모바일은 페이지당 5개, 데스크탑은 기존 10개. 초기값은 데스크탑 기준(SSR/hydration 일치) → 마운트 후 보정.
  const [pageSize, setPageSize] = useState(STUDENT_POSTS_PAGE_SIZE);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setPageSize(mq.matches ? 5 : STUDENT_POSTS_PAGE_SIZE);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const tabs: { id: StudentPostListFilter; label: string }[] = [
    { id: "all", label: "전체" },
    { id: "draft", label: "임시저장" },
    { id: "waiting", label: "지원대기" },
    { id: "active", label: "진행중" },
    { id: "done", label: "완료" },
  ];

  return (
    <div className="space-y-4">
      {props.rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <ClipboardList className="h-12 w-12 text-slate-400" strokeWidth={1.5} aria-hidden />
          <h3 className="mt-4 text-lg font-black text-slate-900">아직 등록한 의뢰가 없어요</h3>
          <p className="mt-2 max-w-md text-sm font-medium text-slate-600">
            <span className="md:hidden">전문 멘토에게 의뢰해 보세요.</span>
            <span className="hidden md:inline">혼자 해결하기 어려운 공부 고민을 전문 멘토에게 맡겨보세요.</span>
          </p>
          <Link
            href="/custom-request/new"
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-5 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
          >
            첫 의뢰 등록하기
          </Link>
        </div>
      ) : (
        <>
          {/* 모바일: 가로 스크롤 + peek(마지막 칩 살짝 잘림) / 데스크탑(md+): 기존 wrap 복원 */}
          <nav className="student-posts-filter-scroll -mx-1 flex flex-nowrap gap-2 overflow-x-auto px-1 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setFilter(t.id);
                  setPage(1);
                }}
                className={[
                  "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold",
                  filter === t.id ? "bg-[#2563EB] text-white" : "border border-slate-200 bg-white text-slate-700",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {filtered.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-500">
              해당 상태의 의뢰가 없습니다.
            </p>
          ) : (
            <ul className="space-y-3">
              {visible.map((r) => {
                const d = mapPostRowToPublicDetail(r);
                const id = typeof r.id === "string" ? r.id : String(r.id ?? "");
                const badge = studentPostStatusBadge(r);
                const dday = formatDeadlineDday(r);
                const apps = applicationCountFromRow(r);
                const preview = bodyPreviewTwoLines(d.body !== "—" ? d.body : "");
                const isDraft = isDraftStudentPost(r);

                return (
                  <li key={id}>
                    {isDraft ? (
                      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <span className="inline-flex rounded-full border border-blue-200 bg-white px-2.5 py-0.5 text-xs font-bold text-[#2563EB]">
                            {d.category && d.category !== "—" ? d.category : "기타"}
                          </span>
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>
                        <h3 className="mt-3 text-base font-extrabold text-slate-900">
                          {d.title && d.title !== "—" ? d.title : "제목 없는 임시글"}
                        </h3>
                        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
                          <span>저장 {formatSavedAt(r)}</span>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link
                            href={`/custom-request/new?draftId=${encodeURIComponent(id)}`}
                            className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-[#2563EB] px-4 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
                          >
                            이어서 작성
                          </Link>
                          <form action={deleteCustomRequestDraftAction}>
                            <input type="hidden" name="postId" value={id} />
                            <button
                              type="submit"
                              className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                            >
                              삭제
                            </button>
                          </form>
                        </div>
                      </div>
                    ) : (
                    <Link
                      href={`/custom-request/${id}/applications`}
                      className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-[box-shadow,border-color] duration-150 hover:border-blue-300 hover:shadow-[0_2px_8px_rgba(0,0,0,0.09)]"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <span className="inline-flex rounded-full border border-blue-200 bg-white px-2.5 py-0.5 text-xs font-bold text-[#2563EB]">
                          {d.category && d.category !== "—" ? d.category : "기타"}
                        </span>
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-bold ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                      <h3 className="mt-3 text-base font-extrabold text-slate-900">{d.title}</h3>
                      {preview ? (
                        <p className="mt-2 line-clamp-2 text-sm font-medium leading-relaxed text-slate-600">{preview}</p>
                      ) : null}
                      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
                        <span className={dday.urgent ? "font-bold text-red-600" : ""}>마감 {dday.label}</span>
                        <span>{formatBudgetRangeCash(r)}</span>
                        <span>지원 {apps}명</span>
                      </div>
                    </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
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
        </>
      )}
      <style jsx global>{`
        .student-posts-filter-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </div>
  );
}
