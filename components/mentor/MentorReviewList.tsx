"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReviewCardItem } from "@/lib/reviews/reviewQueries";
import { starIcons } from "@/lib/reviews/reviewDisplay";

type ListResponse = {
  ok: boolean;
  items?: ReviewCardItem[];
  total?: number;
  page?: number;
  limit?: number;
  avgRating?: number | null;
  distribution?: Record<"1" | "2" | "3" | "4" | "5", number>;
  error?: string;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(d);
}

function DistributionBar(props: { star: number; count: number; total: number }) {
  const pct = props.total > 0 ? Math.round((props.count / props.total) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-6 font-bold text-slate-600">{props.star}점</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-[#2563EB]" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right tabular-nums text-slate-500">{pct}%</span>
    </div>
  );
}

export function MentorReviewList(props: { mentorId: string }) {
  const [items, setItems] = useState<ReviewCardItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [distribution, setDistribution] = useState<Record<1 | 2 | 3 | 4 | 5, number>>({
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const limit = 5;

  // fetch(순수)와 결과 반영을 분리 — effect 본문에서 동기 setState 없이(await 이후에만) 반영하기 위함.
  const fetchPage = useCallback(
    async (pageNum: number): Promise<ListResponse> => {
      const res = await fetch(
        `/api/reviews?mentorId=${encodeURIComponent(props.mentorId)}&page=${pageNum}&limit=${limit}`
      );
      return (await res.json()) as ListResponse;
    },
    [props.mentorId]
  );

  const applyListResponse = useCallback((json: ListResponse, pageNum: number, append: boolean) => {
    if (!json.ok || !json.items) return;
    const items = json.items;
    setItems((prev) => (append ? [...prev, ...items] : items));
    setTotal(json.total ?? 0);
    setAvgRating(json.avgRating ?? null);
    if (json.distribution) {
      setDistribution({
        1: json.distribution[1] ?? 0,
        2: json.distribution[2] ?? 0,
        3: json.distribution[3] ?? 0,
        4: json.distribution[4] ?? 0,
        5: json.distribution[5] ?? 0,
      });
    }
    setPage(pageNum);
  }, []);

  // 이벤트 콜백·버튼 핸들러용(스피너 동기 표시 포함). effect 본문에서는 직접 호출하지 않는다.
  const load = useCallback(
    async (pageNum: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        applyListResponse(await fetchPage(pageNum), pageNum, append);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [applyListResponse, fetchPage]
  );

  useEffect(() => {
    // 초기 로드 — loading 초기값이 true 라 동기 setState 불필요, 반영은 전부 await 이후.
    let cancelled = false;
    (async () => {
      try {
        const json = await fetchPage(1);
        if (!cancelled) applyListResponse(json, 1, false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage, applyListResponse]);

  useEffect(() => {
    const onUpdate = () => void load(1, false);
    window.addEventListener("reviews-updated", onUpdate);
    return () => window.removeEventListener("reviews-updated", onUpdate);
  }, [load]);

  const hasMore = items.length < total;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-4 sm:grid-cols-[140px_1fr]">
        <div className="text-center sm:text-left">
          <p className="text-3xl font-black text-[#2563EB] tabular-nums">{avgRating != null ? avgRating.toFixed(1) : "—"}</p>
          <p className="mt-1 text-sm text-amber-500">{avgRating != null ? starIcons(Math.round(avgRating)) : "☆☆☆☆☆"}</p>
          <p className="mt-1 text-xs text-slate-500">{total}개 리뷰</p>
        </div>
        <div className="space-y-1.5">
          {([5, 4, 3, 2, 1] as const).map((s) => (
            <DistributionBar key={s} star={s} count={distribution[s]} total={total} />
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-center text-sm text-slate-500">리뷰를 불러오는 중…</p>
      ) : !items.length ? (
        <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
          아직 공개된 리뷰가 없습니다.
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#2563EB]/10 text-sm font-black text-[#2563EB]"
                  aria-hidden
                >
                  {item.studentInitial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900">{item.studentMaskedName}</span>
                    <span className="text-amber-500 text-sm">{starIcons(item.rating)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.gradeSubject} · {formatDate(item.createdAt)}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-800">{item.content}</p>
                  {item.mentorReply ? (
                    <div className="mt-3 ml-2 border-l-2 border-[#2563EB]/30 pl-3">
                      <p className="text-[10px] font-bold text-[#2563EB]">멘토 답글</p>
                      <p className="mt-1 text-sm text-slate-700">{item.mentorReply}</p>
                      {item.mentorRepliedAt ? (
                        <p className="mt-1 text-[10px] text-slate-400">{formatDate(item.mentorRepliedAt)}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {hasMore ? (
        <div className="text-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void load(page + 1, true)}
            className="rounded-xl border border-slate-200 bg-white px-6 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingMore ? "불러오는 중…" : "더보기"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
