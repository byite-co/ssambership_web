"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import type { WeeklyUsageSnapshot } from "@/lib/qna/weeklyQuestionUsageDisplay";
import { WEEKLY_QUESTION_LIMIT_MESSAGE } from "@/lib/qna/questionThreadStatus";
import { normalizeQuestionSubjectCode } from "@/lib/qna/questionSubjects";
import { SubjectSelectOptions } from "@/components/subjects/SubjectSelectOptions";

export function QuestionRoomStudentThreadForm(props: {
  roomId: string;
  contextThreadId?: string | null;
  usage: WeeklyUsageSnapshot | null;
  usageLoading?: boolean;
  subjectOptions?: string[];
  variant?: "inline" | "modal";
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [subjectCode, setSubjectCode] = useState("");
  const [topic, setTopic] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isModal = props.variant === "modal";

  const canAsk = props.usage?.canAsk !== false && !props.usageLoading;
  const limitBlocked = props.usage != null && !props.usage.canAsk;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canAsk) return;
    // 과목·메모·제목 모두 선택사항. 제목을 비우면 서버가 "질문 N"(질문방 단위 순번) 자동 생성.
    const trimmed = title.trim();
    const subject = normalizeQuestionSubjectCode(subjectCode);
    const topicText = topic.trim();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/question-room/threads", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: props.roomId,
          title: trimmed,
          subject: subject ?? undefined,
          subjectTag: subject ?? undefined,
          topic: topicText || null,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; threadId?: string | null };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "질문을 만들지 못했습니다.");
        return;
      }
      setTitle("");
      setSubjectCode("");
      setTopic("");
      props.onSuccess?.();
      const nextThread = json.threadId ?? props.contextThreadId ?? null;
      const base = `/question-room/${encodeURIComponent(props.roomId)}`;
      const url = nextThread
        ? `${base}?thread=${encodeURIComponent(nextThread)}&ok=${encodeURIComponent("새 질문이 등록되었습니다.")}`
        : `${base}?ok=${encodeURIComponent("새 질문이 등록되었습니다.")}`;
      router.push(url);
      router.refresh();
    } catch {
      setError("질문을 만들지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  // ★질문방 멘토가 지정한 과목만 후보로(없으면 전체 폴백). 라벨→코드 정규화해 중복 제거.
  const mentorSubjectOptions = (() => {
    const seen = new Set<string>();
    const out: { code: string; label: string }[] = [];
    for (const raw of props.subjectOptions ?? []) {
      const code = normalizeQuestionSubjectCode(raw);
      const key = code ?? raw;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ code: key, label: raw });
    }
    return out;
  })();

  const subjectField = (
    <div>
      <label className="mb-1 block text-[11px] font-bold text-slate-600">
        과목 <span className="font-medium text-slate-400">(선택)</span>
      </label>
      <select
        value={subjectCode}
        onChange={(e) => setSubjectCode(e.target.value)}
        disabled={!canAsk || pending}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[12px] font-medium outline-none focus:border-[#2563EB] disabled:bg-slate-50"
      >
        <option value="">과목 미지정</option>
        {mentorSubjectOptions.length > 0 ? (
          mentorSubjectOptions.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))
        ) : (
          <SubjectSelectOptions />
        )}
      </select>
    </div>
  );

  const topicField = (
    <div>
      <label className="mb-1 block text-[11px] font-bold text-slate-600">단원·개념 메모</label>
      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        disabled={!canAsk || pending}
        placeholder="예: 미적분, 확률과 통계, 지문 독해"
        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-[13px] font-medium outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 disabled:bg-slate-50"
      />
    </div>
  );

  if (isModal) {
    return (
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
        {limitBlocked ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-relaxed text-amber-900">
            {props.usage?.freeQuota
              ? "무료 질문권을 모두 사용했어요. 멘토를 구독하면 계속 질문할 수 있어요."
              : WEEKLY_QUESTION_LIMIT_MESSAGE}
          </p>
        ) : null}
        {subjectField}
        {topicField}
        <div>
          <label className="mb-1 block text-[11px] font-bold text-slate-600">
            질문 제목 <span className="font-medium text-slate-400">(선택)</span>
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={!canAsk || pending}
            placeholder="비우면 '질문 N'으로 자동 생성돼요"
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-[13px] font-medium outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20 disabled:bg-slate-50"
          />
        </div>
        {error ? <p className="text-[11px] font-bold text-amber-800">{error}</p> : null}
        <button
          type="submit"
          disabled={!canAsk || pending}
          className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[#2563EB] text-[13px] font-black text-white transition hover:bg-[#1D4ED8] disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          {pending ? "등록 중…" : "새로운 질문하기"}
        </button>
      </form>
    );
  }

  return null;
}
