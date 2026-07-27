"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MentorsListView } from "@/lib/mentor/mentorsListSearchParams";
import type { MentorPublicListCard } from "@/lib/mentor/publicMentorsListQueries";
import { readRecentMentorIds } from "@/lib/mentor/recentMentorsStorage";
import { MentorGrid } from "@/components/mentor/MentorGrid";

type Status = "loading" | "empty" | "error" | "ready";

// P2-27 recent: localStorage 최근 본 ID(최신순·dedup·cap)를 읽어 제한된 서버 API 로 카드 조회.
// URL 에 ID 를 노출하지 않고, 접근 불가능(삭제·비활성) 멘토는 서버가 제외한다.
export function RecentMentorsScope(props: { isLoggedIn: boolean; favoriteIds: string[]; view: MentorsListView }) {
  const [status, setStatus] = useState<Status>("loading");
  const [cards, setCards] = useState<MentorPublicListCard[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // localStorage 읽기·상태 갱신을 모두 비동기 콜백에서 수행(효과 본문 동기 setState 회피).
    void (async () => {
      const ids = readRecentMentorIds(); // 손상 JSON·저장소 접근 실패 시 안전하게 [] 반환
      if (!ids.length) {
        if (!cancelled) setStatus("empty");
        return;
      }
      if (!cancelled) setStatus("loading");
      try {
        const res = await fetch("/api/mentors/scoped", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        const json = (await res.json()) as { ok: boolean; cards?: MentorPublicListCard[] };
        if (cancelled) return;
        if (!json.ok || !Array.isArray(json.cards)) {
          setStatus("error");
          return;
        }
        // 서버가 요청 순서를 보존하지만 방어적으로 localStorage 순서로 재정렬.
        const order = new Map(ids.map((id, i) => [id, i] as const));
        const ordered = [...json.cards].sort(
          (a, b) => (order.get(a.mentorId) ?? 1e9) - (order.get(b.mentorId) ?? 1e9)
        );
        setCards(ordered);
        setStatus(ordered.length ? "ready" : "empty");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (status === "loading") {
    return <p className="py-10 text-center text-sm text-slate-500">최근 본 멘토를 불러오는 중…</p>;
  }
  if (status === "error") {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
        <p className="text-lg font-black text-slate-900">최근 본 멘토를 불러오지 못했어요</p>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-extrabold text-slate-700 hover:bg-slate-50"
        >
          다시 시도
        </button>
      </div>
    );
  }
  if (status === "empty") {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
        <p className="text-lg font-black text-slate-900">아직 최근 본 멘토가 없어요</p>
        <p className="mt-2 text-sm text-slate-600">멘토 상세를 열어보면 여기에 최근 본 멘토가 쌓여요.</p>
        <Link href="/mentors" className="mt-4 inline-block text-sm font-bold text-[#2563EB] underline">
          멘토 둘러보기
        </Link>
      </div>
    );
  }

  return (
    <MentorGrid
      cards={cards}
      favoriteIds={new Set(props.favoriteIds)}
      isLoggedIn={props.isLoggedIn}
      view={props.view}
    />
  );
}
