import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 멘토의 담당 학생 수 — `mentor_student_rooms.mentor_id` head count. 정지·제재 확인 모달의
 * "담당 학생 N명의 질문방이 영향받습니다" 문장에 쓴다. 조회 실패는 null(문장 생략 — 지시서 §1-2).
 */
export async function countMentorStudentRooms(client: SupabaseClient, mentorId: string): Promise<number | null> {
  const id = String(mentorId ?? "").trim();
  if (!id) return null;
  const { count, error } = await client.from("mentor_student_rooms").select("id", { count: "exact", head: true }).eq("mentor_id", id);
  if (error) {
    console.error("[countMentorStudentRooms]", error.message);
    return null;
  }
  return count ?? 0;
}
