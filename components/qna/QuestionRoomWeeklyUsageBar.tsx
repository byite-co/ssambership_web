"use client";

import { useCallback, useEffect, useState } from "react";

export type { WeeklyUsageSnapshot } from "@/lib/qna/weeklyQuestionUsageDisplay";
import type { WeeklyUsageSnapshot } from "@/lib/qna/weeklyQuestionUsageDisplay";
import { weeklyQuestionQuotaLabel } from "@/lib/qna/weeklyQuestionUsageDisplay";

export function QuestionRoomWeeklyUsageBar(props: {
  mentorId: string | null;
  onUsageChange?: (usage: WeeklyUsageSnapshot | null) => void;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const { mentorId, onUsageChange, onLoadingChange } = props;
  const [usage, setUsage] = useState<WeeklyUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 순수 fetch(설정 없음)와 결과 반영을 분리 — effect 본문에서 동기 setState 없이(await 이후에만) 반영.
  const fetchUsage = useCallback(async (): Promise<
    { kind: "none" } | { kind: "ok"; usage: WeeklyUsageSnapshot } | { kind: "error"; message: string }
  > => {
    if (!mentorId) return { kind: "none" };
    try {
      const res = await fetch(
        `/api/question-room/weekly-usage?mentorId=${encodeURIComponent(mentorId)}`,
        { credentials: "include" }
      );
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        usage?: WeeklyUsageSnapshot;
      };
      if (!res.ok || !json.ok || !json.usage) {
        return { kind: "error", message: json.error ?? "사용량을 불러오지 못했습니다." };
      }
      return { kind: "ok", usage: json.usage };
    } catch {
      return { kind: "error", message: "사용량을 불러오지 못했습니다." };
    }
  }, [mentorId]);

  const applyUsageResult = useCallback(
    (result: { kind: "none" } | { kind: "ok"; usage: WeeklyUsageSnapshot } | { kind: "error"; message: string }) => {
      if (result.kind === "none") {
        setLoading(false);
        onUsageChange?.(null);
        return;
      }
      if (result.kind === "error") {
        setError(result.message);
        setUsage(null);
        onUsageChange?.(null);
      } else {
        setUsage(result.usage);
        onUsageChange?.(result.usage);
      }
      setLoading(false);
      onLoadingChange?.(false);
    },
    [onUsageChange, onLoadingChange]
  );

  // 재시도 버튼용(로딩 상태 동기 표시 포함). effect 본문에서는 직접 호출하지 않는다.
  const load = useCallback(async () => {
    if (mentorId) {
      setLoading(true);
      onLoadingChange?.(true);
      setError(null);
    }
    applyUsageResult(await fetchUsage());
  }, [mentorId, onLoadingChange, applyUsageResult, fetchUsage]);

  useEffect(() => {
    // 초기 로드 — loading 초기값이 true 라 동기 setState 불필요, 반영은 await 이후.
    let cancelled = false;
    (async () => {
      const result = await fetchUsage();
      if (!cancelled) applyUsageResult(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchUsage, applyUsageResult]);

  if (!props.mentorId) return null;

  const used = usage?.used ?? 0;
  const unlimited = usage != null && usage.limit >= 999;
  const quotaLabel = weeklyQuestionQuotaLabel(usage);
  // F3.6: 막대 채움 = 남은 질문 비율(파랑), 회색 트랙 = 사용분. 다른 질문방 막대와 방향 통일.
  const pct =
    usage && !unlimited && usage.limit > 0
      ? Math.min(100, Math.max(0, Math.round(((usage.limit - used) / usage.limit) * 100)))
      : 0;

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-extrabold text-slate-700">이번 주 질문</p>
        {loading ? (
          <span className="text-[10px] font-bold text-slate-400">불러오는 중…</span>
        ) : error ? (
          <button
            type="button"
            onClick={() => void load()}
            className="text-[10px] font-bold text-blue-600 underline"
          >
            다시 시도
          </button>
        ) : (
          <span className="text-[10px] font-black text-slate-600">{quotaLabel}</span>
        )}
      </div>
      {!loading && !error && usage ? (
        <>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all ${
                usage.canAsk ? "bg-blue-600" : "bg-amber-500"
              }`}
              style={{ width: unlimited ? "8%" : `${pct}%` }}
            />
          </div>
          {!usage.canAsk ? (
            <p className="mt-2 text-[10px] font-bold leading-relaxed text-amber-800">
              이번 주 질문 한도를 모두 사용했습니다. 한도는 구독 시작일 기준 7일 주기로 갱신됩니다.
            </p>
          ) : (
            <p className="mt-2 text-[10px] font-medium text-slate-500">
              남은 질문 {unlimited ? "무제한" : `${usage.remaining}개`} · 등록하는 순간 차감됩니다(구독 시작일 기준 7일 주기).
            </p>
          )}
        </>
      ) : null}
      {error ? <p className="mt-2 text-[10px] font-medium text-slate-500">{error}</p> : null}
    </div>
  );
}