import type { SupabaseClient } from "@supabase/supabase-js";
import { assertFreeQuestionAllowedAndRecord, isFreeQuestionThreadInRoom } from "@/lib/qna/freeQuestionUsage";
import { partyUserIdFromRoomRow } from "@/lib/qna/questionRoomUiLabels";
import { WEEKLY_QUESTION_LIMIT_MESSAGE } from "@/lib/qna/questionThreadStatus";
import { fetchWeeklyQuestionUsage } from "@/lib/qna/weeklyQuestionUsage";
import { findActiveSubscriptionForPair } from "@/lib/subscribe/subscribeCheckoutService";

export async function assertThreadCreationSubscriptionAllowed(
  supabase: SupabaseClient,
  roomId: string,
  actor: "student" | "mentor",
  options?: { isNewThread?: boolean; threadId?: string | null }
): Promise<{ ok: true; usedFreeQuota?: boolean } | { ok: false; userMessage: string }> {
  const { data, error } = await supabase.from("mentor_student_rooms").select("*").eq("id", roomId).maybeSingle();
  if (error) {
    console.error("[assertThreadCreationSubscriptionAllowed] mentor_student_rooms", { roomId, message: error.message });
    return { ok: false, userMessage: "이 질문방을 확인하는 중 오류가 났습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (!data) {
    return { ok: false, userMessage: "질문방을 찾을 수 없어요. 목록에서 다시 들어와 주세요." };
  }
  const row = data as Record<string, unknown>;
  const studentId = partyUserIdFromRoomRow(row, "student");
  const mentorId = partyUserIdFromRoomRow(row, "mentor");
  if (!studentId || !mentorId) {
    return { ok: false, userMessage: "질문방 정보(학생·멘토)를 확인할 수 없어요. 잠시 후 다시 시도해 주세요." };
  }

  const active = await findActiveSubscriptionForPair(supabase, studentId, mentorId);
  if (active.error) {
    // W4: 구독 조회 실패를 "구독 없음"으로 취급하지 않는다(fail-closed).
    console.error("[assertThreadCreationSubscriptionAllowed] subscriptions select", active.error);
    return { ok: false, userMessage: "구독 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (!active.active) {
    if (actor === "student" && options?.isNewThread) {
      const free = await assertFreeQuestionAllowedAndRecord(supabase, studentId, mentorId);
      if (!free.ok) {
        return { ok: false, userMessage: free.userMessage };
      }
      return { ok: true, usedFreeQuota: true };
    }

    const messageThreadId =
      !options?.isNewThread && typeof options?.threadId === "string" ? options.threadId.trim() : "";
    if (messageThreadId) {
      const freeThread = await isFreeQuestionThreadInRoom(
        supabase,
        studentId,
        mentorId,
        roomId,
        messageThreadId
      );
      if (freeThread.error) {
        // W4: 무료 스레드 여부를 확인할 수 없으면 통과시키지 않는다(fail-closed·오류 구분).
        console.error("[assertThreadCreationSubscriptionAllowed] free thread check", freeThread.error);
        return { ok: false, userMessage: "질문 유형을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
      }
      if (freeThread.isFree) {
        return { ok: true };
      }
    }

    const userMessage =
      actor === "student"
        ? "활성 구독을 찾을 수 없습니다. 멘토 구독 후 질문을 작성해 주세요."
        : "학생의 활성 구독이 없어 현재 답변을 작성할 수 없습니다.";
    return { ok: false, userMessage };
  }

  if (options?.isNewThread && actor === "student") {
    const { usage, error: usageError } = await fetchWeeklyQuestionUsage(supabase, studentId, mentorId);
    if (usageError) {
      console.error("[assertThreadCreationSubscriptionAllowed] get_weekly_question_usage", usageError);
      return {
        ok: false,
        userMessage: "질문 한도를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      };
    }
    if (!usage?.canAsk) {
      return { ok: false, userMessage: WEEKLY_QUESTION_LIMIT_MESSAGE };
    }
  }

  return { ok: true };
}
