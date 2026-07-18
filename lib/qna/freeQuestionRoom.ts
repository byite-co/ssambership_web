import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertFreeQuestionAllowed } from "@/lib/qna/freeQuestionUsage";
import { assertMentorApprovedForAction } from "@/lib/mentor/mentorVerificationGate";
import { ensureMentorStudentRoom } from "@/lib/subscribe/subscribeCheckoutService";
import { createServiceRoleClient } from "@/lib/supabase/admin";

export type FreeQuestionRoomResult = { ok: true; roomId: string } | { ok: false; userMessage: string };

/**
 * 무료 질문권 사용을 위한 질문방 확보(ensure).
 *
 * 멘토 상세의 "무료 질문권 사용하기" 버튼은 `/question-room?mentorId=` 로 연결되는데,
 * 구독 전에는 `mentor_student_rooms` 행이 없어 질문방에 들어갈 수 없었다(무료 질문
 * 차감·한도 로직은 방 안의 새 스레드 생성 시점에만 동작). 이 함수가 그 진입 공백을
 * 메운다: 무료 질문권이 유효한 학생에게 구독 없이 방을 만들어 주고, 실제 차감은
 * 기존 게이트(questionThreadSubscriptionGuard)가 스레드 생성 시 수행한다.
 *
 * room insert RLS는 활성 구독을 요구하므로 구독 체크아웃과 동일하게 service role로
 * 생성한다(ensureMentorStudentRoom은 기존 방이 있으면 재사용하는 멱등 함수).
 */
export async function ensureFreeQuestionRoomForStudent(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<FreeQuestionRoomResult> {
  const mentor = await assertMentorApprovedForAction(supabase, mentorId);
  if (!mentor.ok) {
    return { ok: false, userMessage: mentor.error };
  }

  const allowed = await assertFreeQuestionAllowed(supabase, studentId, mentorId);
  if (!allowed.ok) {
    return { ok: false, userMessage: allowed.userMessage };
  }

  let admin: SupabaseClient;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    console.error("[ensureFreeQuestionRoomForStudent] service role unavailable", e);
    return { ok: false, userMessage: "질문방을 여는 데 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const room = await ensureMentorStudentRoom(admin, studentId, mentorId, null, null);
  if (!room.ok) {
    console.error("[ensureFreeQuestionRoomForStudent] room ensure failed", room.error);
    return { ok: false, userMessage: "질문방을 여는 데 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
  return { ok: true, roomId: room.roomId };
}
