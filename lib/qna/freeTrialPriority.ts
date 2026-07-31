import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFreeQuestionThreadIdsInRoom } from "@/lib/qna/freeQuestionUsage";

export { FREE_TRIAL_PRIORITY_LABEL } from "@/lib/qna/freeTrialPriorityLabel";

type Row = Record<string, unknown>;

/**
 * 멘토 화면용: 방(room)의 무료 체험(무료 질문권) 스레드 id 목록.
 * usage 행 조회는 내부에서 service_role로 수행되므로 멘토 세션에서도 동작한다.
 * 실패 시 빈 배열(우선노출 없이 기존 정렬 유지) — 목록 자체를 깨뜨리지 않는다.
 */
export async function loadFreeTrialThreadIdsForMentorRoom(
  supabase: SupabaseClient,
  mentorId: string,
  studentId: string | null,
  roomId: string
): Promise<string[]> {
  if (!studentId || !mentorId || !roomId) return [];
  try {
    const { ids, error } = await loadFreeQuestionThreadIdsInRoom(supabase, studentId, mentorId, roomId);
    if (error) {
      // 우선노출 배지는 표시 전용 — 실패를 명시 로그로 남기고 기존 정렬을 유지한다(성공 위장 아님).
      console.error("[freeTrialPriority] load failed", { mentorId, roomId, error });
      return [];
    }
    return [...ids];
  } catch (e) {
    console.error("[freeTrialPriority] load failed", { mentorId, roomId, e });
    return [];
  }
}

/**
 * 무료 체험 스레드를 최상단으로 고정한다.
 * 그룹 내부에서는 기존 정렬(최신순)을 그대로 유지하는 안정 정렬.
 */
export function sortThreadsFreeTrialFirst(rows: Row[], freeTrialThreadIds: readonly string[]): Row[] {
  if (!freeTrialThreadIds.length || !rows.length) return rows;
  const freeSet = new Set(freeTrialThreadIds);
  const free: Row[] = [];
  const rest: Row[] = [];
  for (const r of rows) {
    const id = r?.id != null ? String(r.id) : "";
    (id && freeSet.has(id) ? free : rest).push(r);
  }
  if (!free.length) return rows;
  return [...free, ...rest];
}
