"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Star } from "lucide-react";
import type { ReviewCardItem } from "@/lib/reviews/reviewQueries";
import { starIcons } from "@/lib/reviews/reviewDisplay";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function MentorReviewsManage(props: { initialItems: ReviewCardItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(props.initialItems);
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitReply(reviewId: string) {
    const reply = (replyDraft[reviewId] ?? "").trim();
    if (!reply) return;
    setBusyId(reviewId);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/reply`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "답글 저장에 실패했습니다.");
        return;
      }
      setItems((prev) =>
        prev.map((it) =>
          it.id === reviewId
            ? { ...it, mentorReply: reply, mentorRepliedAt: new Date().toISOString() }
            : it
        )
      );
      setReplyDraft((d) => {
        const next = { ...d };
        delete next[reviewId];
        return next;
      });
      router.refresh();
    } catch {
      setError("답글 저장에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      <header>
        <h1 className="text-2xl font-black text-slate-900">받은 리뷰</h1>
        <p className="mt-1 text-sm text-slate-600">학생 리뷰에 답글은 1회만 작성할 수 있습니다.</p>
      </header>

      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</p> : null}

      {!items.length ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 px-6 py-16 text-center">
          <Star className="h-12 w-12 text-slate-400" strokeWidth={1.5} aria-hidden />
          <h3 className="mt-4 text-lg font-black text-slate-900">아직 받은 후기가 없어요</h3>
          <p className="mt-2 max-w-md text-sm font-medium text-slate-600">
            구독 중이거나 개별 질문을 이용한 학생이 후기를 남길 수 있어요.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900">{item.studentMaskedName}</span>
                <span className="text-amber-500 text-sm">{starIcons(item.rating)}</span>
                <span className="text-xs text-slate-400">{formatDate(item.createdAt)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{item.gradeSubject}</p>
              <p className="mt-3 text-sm leading-relaxed text-slate-800">{item.content}</p>

              {item.mentorReply ? (
                <div className="mt-4 border-l-2 border-[#059669]/30 pl-3">
                  <p className="text-xs font-bold text-[#059669]">내 답글</p>
                  <p className="mt-1 text-sm text-slate-700">{item.mentorReply}</p>
                </div>
              ) : (
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  <textarea
                    value={replyDraft[item.id] ?? ""}
                    onChange={(e) => setReplyDraft((d) => ({ ...d, [item.id]: e.target.value }))}
                    rows={3}
                    maxLength={500}
                    placeholder="답글을 입력하세요 (1회만 작성 가능)"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={busyId === item.id || !(replyDraft[item.id] ?? "").trim()}
                    onClick={() => void submitReply(item.id)}
                    className="rounded-xl bg-[#059669] px-4 py-2 text-xs font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                  >
                    {busyId === item.id ? "저장 중…" : "답글 작성"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
