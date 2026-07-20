"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

type Props = {
  mentorId: string;
  mentorName: string;
  /** 서버에서 미리 계산한 자격 (없으면 API로 조회) */
  initialEligible?: boolean;
  initialReason?: string;
  onSubmitted?: () => void;
};

function StarPicker(props: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1" role="group" aria-label="별점 선택">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => props.onChange(n)}
          className={[
            "text-2xl transition",
            n <= props.value ? "text-amber-400" : "text-slate-300 hover:text-amber-300",
          ].join(" ")}
          aria-label={`${n}점`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

export function ReviewWriteModal(props: Props) {
  const [open, setOpen] = useState(false);
  const [eligible, setEligible] = useState(props.initialEligible ?? false);
  const [reason, setReason] = useState(
    props.initialReason ?? "같은 멘토에게 2회 이상 결제한 학생만 작성 가능합니다."
  );
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 초기 자격 조회 — setState 는 전부 await 이후(effect 동기 setState 금지 규칙 준수), stale 응답 무시.
    if (props.initialEligible !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/reviews/eligibility?mentorId=${encodeURIComponent(props.mentorId)}`);
        const json = (await res.json()) as { ok?: boolean; eligible?: boolean; reason?: string };
        if (cancelled) return;
        if (json.ok) {
          setEligible(Boolean(json.eligible));
          setReason(json.reason ?? "");
        }
      } catch {
        if (!cancelled) {
          setEligible(false);
          setReason("자격을 확인하지 못했습니다.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.initialEligible, props.mentorId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!eligible) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mentorId: props.mentorId, rating, body: content }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "제출에 실패했습니다.");
        return;
      }
      setOpen(false);
      setContent("");
      window.dispatchEvent(new Event("reviews-updated"));
      props.onSubmitted?.();
    } catch {
      setError("제출에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={!eligible}
        onClick={() => eligible && setOpen(true)}
        title={!eligible ? reason : undefined}
        className={[
          "w-full rounded-xl px-4 py-3 text-sm font-bold transition",
          eligible
            ? "bg-[#2563EB] text-white hover:bg-blue-700"
            : "cursor-not-allowed bg-slate-200 text-slate-500",
        ].join(" ")}
      >
        리뷰 작성하기
      </button>
      {!eligible ? <p className="mt-2 text-center text-xs text-slate-500">{reason}</p> : null}

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal
            aria-labelledby="review-modal-title"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 id="review-modal-title" className="text-lg font-black text-slate-900">
                {props.mentorName} 멘토 리뷰
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">작성 후 수정할 수 없습니다. 신중히 작성해 주세요.</p>

            <form onSubmit={onSubmit} className="mt-4 space-y-4">
              <div>
                <p className="text-xs font-bold text-slate-600">별점 (필수)</p>
                <StarPicker value={rating} onChange={setRating} />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600" htmlFor="review-content">
                  리뷰 내용 (20~500자)
                </label>
                <textarea
                  id="review-content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={5}
                  maxLength={500}
                  required
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="멘토링 경험을 구체적으로 남겨 주세요."
                />
                <p className="mt-1 text-right text-[10px] text-slate-400">{content.length}/500</p>
              </div>
              {error ? <p className="text-xs font-semibold text-red-600">{error}</p> : null}
              <button
                type="submit"
                disabled={submitting || content.trim().length < 20}
                className="w-full rounded-xl bg-[#2563EB] py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "제출 중…" : "리뷰 제출"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
