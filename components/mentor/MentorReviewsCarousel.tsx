"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ReviewCardItem } from "@/lib/reviews/reviewQueries";
import { starIcons } from "@/lib/reviews/reviewDisplay";

type ListResponse = {
  ok: boolean;
  items?: ReviewCardItem[];
  total?: number;
  avgRating?: number | null;
  error?: string;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(d);
}

export function MentorReviewsCarousel(props: { mentorId: string }) {
  const [items, setItems] = useState<ReviewCardItem[]>([]);
  const [total, setTotal] = useState(0);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [activeDot, setActiveDot] = useState(0);
  const [loading, setLoading] = useState(true);

  // fetch(순수)와 결과 반영 분리 — effect 본문에서 동기 setState 없이(await 이후에만) 반영.
  const fetchReviews = useCallback(async (): Promise<ListResponse> => {
    const res = await fetch(
      `/api/reviews?mentorId=${encodeURIComponent(props.mentorId)}&page=1&limit=8`
    );
    return (await res.json()) as ListResponse;
  }, [props.mentorId]);

  const applyReviews = useCallback((json: ListResponse) => {
    if (json.ok && json.items) {
      setItems(json.items);
      setTotal(json.total ?? json.items.length);
      setAvgRating(json.avgRating ?? null);
    }
  }, []);

  // 이벤트 콜백용(스피너 동기 표시 포함). effect 본문에서는 직접 호출하지 않는다.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      applyReviews(await fetchReviews());
    } finally {
      setLoading(false);
    }
  }, [applyReviews, fetchReviews]);

  useEffect(() => {
    // 초기 로드 — loading 초기값이 true 라 동기 setState 불필요, 반영은 전부 await 이후.
    let cancelled = false;
    (async () => {
      try {
        const json = await fetchReviews();
        if (!cancelled) applyReviews(json);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchReviews, applyReviews]);

  useEffect(() => {
    const onUpdate = () => void load();
    window.addEventListener("reviews-updated", onUpdate);
    return () => window.removeEventListener("reviews-updated", onUpdate);
  }, [load]);

  const pages = Math.max(1, Math.ceil(items.length / 4));
  const visible = items.slice(activeDot * 4, activeDot * 4 + 4);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" id="reviews">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-slate-900">학생 후기</h2>
          {avgRating != null ? (
            <p className="mt-0.5 text-sm font-bold text-slate-600">
              <span className="text-[#2563EB]">★ {avgRating.toFixed(1)}</span>
              {total > 0 ? ` (${total.toLocaleString("ko-KR")})` : null}
            </p>
          ) : null}
        </div>
        <Link
          href={`/mentors/${props.mentorId}#reviews`}
          className="text-xs font-extrabold text-[#2563EB] hover:underline"
        >
          전체 보기 &gt;
        </Link>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">후기를 불러오는 중…</p>
      ) : !items.length ? (
        <p className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
          아직 공개된 후기가 없어요.
        </p>
      ) : (
        <>
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 snap-x snap-mandatory lg:overflow-visible lg:flex-wrap">
            {visible.map((item) => (
              <article
                key={item.id}
                className="w-[260px] shrink-0 snap-start rounded-2xl border border-slate-200 bg-slate-50/50 p-4 lg:w-[calc(25%-0.75rem)] lg:min-w-[220px]"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2563EB]/10 text-sm font-black text-[#2563EB]">
                    {item.studentInitial}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-900">{item.studentMaskedName}</p>
                    <p className="text-xs text-amber-500">{starIcons(item.rating)}</p>
                  </div>
                </div>
                <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-slate-700">{item.content}</p>
                <p className="mt-2 text-[10px] font-semibold text-slate-500">
                  {item.gradeSubject} · {formatDate(item.createdAt)}
                </p>
              </article>
            ))}
          </div>
          {pages > 1 ? (
            <div className="mt-4 flex justify-center gap-1.5" role="tablist" aria-label="후기 페이지">
              {Array.from({ length: pages }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={activeDot === i}
                  onClick={() => setActiveDot(i)}
                  className={[
                    "h-2 w-2 rounded-full transition",
                    activeDot === i ? "bg-[#2563EB] w-5" : "bg-slate-300 hover:bg-slate-400",
                  ].join(" ")}
                  aria-label={`후기 ${i + 1}페이지`}
                />
              ))}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
