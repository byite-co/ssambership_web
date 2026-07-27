"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ReviewEligibilityMode } from "@/lib/reviews/reviewEligibilityPolicy";

type Props = {
  mentorId: string;
  mentorName: string;
  /** 서버에서 미리 계산한 자격 (없으면 API로 조회) */
  initialEligible?: boolean;
  initialReason?: string;
  /** 'create' = 신규 작성 · 'edit' = 기존 후기 수정 */
  initialMode?: ReviewEligibilityMode;
  initialReviewId?: string | null;
  /** mode==='edit' 이어도 모더레이션된 후기는 수정 불가 */
  initialCanEdit?: boolean;
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
    props.initialReason ?? "이 멘토의 구독 또는 개별 질문 이용 이력이 있는 학생만 작성 가능합니다."
  );
  const [mode, setMode] = useState<ReviewEligibilityMode>(props.initialMode ?? "create");
  const [reviewId, setReviewId] = useState<string | null>(props.initialReviewId ?? null);
  const [canEdit, setCanEdit] = useState(props.initialCanEdit ?? false);
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [prefilled, setPrefilled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 초기 자격 조회 — setState 는 전부 await 이후(effect 동기 setState 금지 규칙 준수), stale 응답 무시.
    if (props.initialEligible !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/reviews/eligibility?mentorId=${encodeURIComponent(props.mentorId)}`);
        const json = (await res.json()) as {
          ok?: boolean;
          eligible?: boolean;
          reason?: string;
          mode?: ReviewEligibilityMode;
          existingReviewId?: string | null;
          canEdit?: boolean;
        };
        if (cancelled) return;
        if (json.ok) {
          setEligible(Boolean(json.eligible));
          setReason(json.reason ?? "");
          setMode(json.mode ?? "create");
          setReviewId(json.existingReviewId ?? null);
          setCanEdit(Boolean(json.canEdit));
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

  useEffect(() => {
    // 편집 모드로 모달을 열면 기존 rating·body 를 prefill 한다.
    if (!open || mode !== "edit" || !reviewId || prefilled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}`);
        const json = (await res.json()) as {
          ok?: boolean;
          review?: { rating?: number; body?: string };
        };
        if (cancelled) return;
        if (json.ok && json.review) {
          setRating(Number(json.review.rating) || 5);
          setContent(String(json.review.body ?? ""));
          setPrefilled(true);
        }
      } catch {
        if (!cancelled) setError("기존 후기를 불러오지 못했습니다.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, reviewId, prefilled]);

  const isEdit = mode === "edit";
  // 편집 모드에서 모더레이션된 후기는 진입 자체를 막는다.
  const canOpen = eligible && (!isEdit || canEdit);
  const buttonLabel = isEdit ? "후기 수정하기" : "리뷰 작성하기";
  const submitLabel = isEdit ? "후기 수정" : "리뷰 제출";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canOpen) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(isEdit && reviewId ? `/api/reviews/${encodeURIComponent(reviewId)}` : "/api/reviews", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEdit ? { rating, body: content } : { mentorId: props.mentorId, rating, body: content }
        ),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!json.ok) {
        setError(json.error ?? "제출에 실패했습니다.");
        return;
      }
      setOpen(false);
      if (!isEdit) setContent("");
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
        disabled={!canOpen}
        onClick={() => canOpen && setOpen(true)}
        title={!canOpen ? reason : undefined}
        className={[
          "w-full rounded-xl px-4 py-3 text-sm font-bold transition",
          canOpen
            ? "bg-[#2563EB] text-white hover:bg-blue-700"
            : "cursor-not-allowed bg-slate-200 text-slate-500",
        ].join(" ")}
      >
        {buttonLabel}
      </button>
      {!canOpen ? <p className="mt-2 text-center text-xs text-slate-500">{reason}</p> : null}

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
                {props.mentorName} 멘토 {isEdit ? "후기 수정" : "리뷰"}
              </h2>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {isEdit
                ? "작성한 후기는 별점과 내용만 수정할 수 있습니다."
                : "작성 후에도 별점과 내용은 수정할 수 있습니다."}
            </p>

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
                {submitting ? "제출 중…" : submitLabel}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
