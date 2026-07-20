import type { SupabaseClient } from "@supabase/supabase-js";
import { partyUserIdFromRoomRow } from "@/lib/qna/questionRoomUiLabels";
import { assertRoomParty } from "@/lib/qna/questionRoomApiAuth";
import { nextRoomQuestionNumber } from "@/lib/qna/questionRoomMutations";
import { WEEKLY_QUESTION_LIMIT_MESSAGE } from "@/lib/qna/questionThreadStatus";
import { fetchWeeklyQuestionUsage } from "@/lib/qna/weeklyQuestionUsage";
import { assertFreeQuestionAllowed } from "@/lib/qna/freeQuestionUsage";
import { findActiveSubscriptionForPair } from "@/lib/subscribe/subscribeCheckoutService";
import { threadRowBelongsToMentorStudentRoom } from "@/lib/qna/questionThreadRoomRef";
import {
  confirmQuestionThreadViaRpc,
  createQuestionThreadViaRpc,
  flagWrongAnswerViaRpc,
} from "@/lib/qna/questionRoomRpc";

/** P1-8A RPC 가 raise 한 코드 → API HTTP status 매핑. */
function qnaRpcCodeToStatus(code: string): 400 | 403 | 404 | 429 | 500 {
  switch (code) {
    case "ROOM_NOT_FOUND":
    case "THREAD_NOT_FOUND":
      return 404;
    case "WEEKLY_LIMIT_EXHAUSTED":
      return 429;
    case "NOT_ANSWERED":
      return 400;
    case "AUTH_REQUIRED":
    case "NOT_ROOM_PARTY":
    case "STUDENT_ONLY":
    case "MENTOR_CANNOT_CREATE_THREAD":
    case "ACCOUNT_BANNED":
    case "ACCOUNT_SUSPENDED":
    case "BLOCKED":
    case "MENTOR_NOT_APPROVED":
    case "FREE_QUOTA_EXPIRED":
    case "FREE_QUOTA_TOTAL_EXHAUSTED":
    case "FREE_QUOTA_MENTOR_EXHAUSTED":
      return 403;
    default:
      return 500;
  }
}

export async function resolveMentorIdForRoom(
  supabase: SupabaseClient,
  roomId: string
): Promise<{ mentorId: string | null; studentId: string | null; error: string | null }> {
  const { data, error } = await supabase.from("mentor_student_rooms").select("*").eq("id", roomId).maybeSingle();
  if (error || !data) {
    return { mentorId: null, studentId: null, error: error?.message ?? "질문방을 찾을 수 없습니다." };
  }
  const row = data as Record<string, unknown>;
  return {
    mentorId: partyUserIdFromRoomRow(row, "mentor"),
    studentId: partyUserIdFromRoomRow(row, "student"),
    error: null,
  };
}

export async function assertStudentCanCreateThread(
  supabase: SupabaseClient,
  studentId: string,
  roomId: string
): Promise<
  | { ok: true; mentorId: string; useFreeQuota?: boolean }
  | { ok: false; status: 403 | 404 | 429; error: string }
> {
  const party = await assertRoomParty(supabase, roomId, studentId, "student");
  if (!party.ok) {
    return { ok: false, status: party.status, error: party.error };
  }
  const mentorId = partyUserIdFromRoomRow(party.row, "mentor");
  if (!mentorId) {
    return { ok: false, status: 404, error: "멘토 정보를 확인할 수 없습니다." };
  }

  const active = await findActiveSubscriptionForPair(supabase, studentId, mentorId);
  if (!active) {
    const free = await assertFreeQuestionAllowed(supabase, studentId, mentorId);
    if (!free.ok) {
      return { ok: false, status: 403, error: free.userMessage };
    }
    return { ok: true, mentorId, useFreeQuota: true };
  }

  const { usage, error: usageError } = await fetchWeeklyQuestionUsage(supabase, studentId, mentorId);
  if (usageError) {
    console.error("[assertStudentCanCreateThread] get_weekly_question_usage", usageError);
    return {
      ok: false,
      status: 403,
      error: "질문 한도를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
  if (!usage?.canAsk) {
    return { ok: false, status: 429, error: WEEKLY_QUESTION_LIMIT_MESSAGE };
  }

  return { ok: true, mentorId };
}

export async function createStudentQuestionThread(
  supabase: SupabaseClient,
  studentId: string,
  roomId: string,
  title: string,
  subject?: string | null,
  topic?: string | null
): Promise<
  | { ok: true; threadId: string | null }
  | { ok: false; status: 400 | 403 | 404 | 429 | 500; error: string }
> {
  // 제목은 선택사항 — 비우면 질문방 단위 누적 순번으로 "질문 N" 자동 생성.
  // ★N은 이 room의 thread 수 + 1 (학생 전체 합산 아님).
  let finalTitle = title.trim();
  if (!finalTitle) {
    finalTitle = `질문 ${await nextRoomQuestionNumber(supabase, roomId)}`;
  }

  // P1-8A: 원자 RPC 로 생성 — 무료/구독 자격 서버 분기 + 무료면 usage thread_id 링크.
  const rpc = await createQuestionThreadViaRpc(supabase, {
    roomId,
    title: finalTitle,
    subject: subject?.trim() || null,
    topic: topic?.trim() || null,
  });
  if (!rpc.ok) {
    return { ok: false, status: qnaRpcCodeToStatus(rpc.code), error: rpc.userMessage };
  }
  return { ok: true, threadId: rpc.threadId };
}

export async function assertThreadInRoom(
  supabase: SupabaseClient,
  roomId: string,
  threadId: string
): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; status: 404; error: string }> {
  const { data, error } = await supabase.from("question_threads").select("*").eq("id", threadId).maybeSingle();
  if (error || !data) {
    return { ok: false, status: 404, error: "질문을 찾을 수 없습니다." };
  }
  const row = data as Record<string, unknown>;
  if (!threadRowBelongsToMentorStudentRoom(row, roomId)) {
    return { ok: false, status: 404, error: "이 질문은 현재 질문방에 속하지 않습니다." };
  }
  return { ok: true, row };
}

export async function confirmQuestionThreadForStudent(
  supabase: SupabaseClient,
  studentId: string,
  roomId: string,
  threadId: string
): Promise<{ ok: true } | { ok: false; status: 400 | 403 | 404 | 500; error: string }> {
  // P1-8A: 확인 RPC(answered→confirmed, 학생 전용). roomId 는 API 계약 유지용(RPC 는 thread→room 도출).
  void roomId;
  void studentId;
  const rpc = await confirmQuestionThreadViaRpc(supabase, threadId);
  if (!rpc.ok) {
    const st = qnaRpcCodeToStatus(rpc.code);
    return { ok: false, status: st === 429 ? 400 : st, error: rpc.userMessage };
  }
  return { ok: true };
}

// P1-8A: 멘토 "답변 완료" status-only 직접 write 경로 폐지. answered 전이는 오직
//  qna_append_message(첫 메시지)/qna_register_attachment(첫 첨부) RPC 내부에서만 발생한다.
//  (구 markQuestionThreadAnsweredForMentor + /api/.../answer 라우트 제거.)

export async function updateQuestionThreadWrongAnswerForStudent(
  supabase: SupabaseClient,
  studentId: string,
  roomId: string,
  threadId: string,
  isWrongAnswer: boolean
): Promise<{ ok: true } | { ok: false; status: 403 | 404 | 500; error: string }> {
  // P1-8A: 오답 표시 RPC(학생 전용). roomId 는 API 계약 유지용(RPC 는 thread→room 도출).
  void roomId;
  void studentId;
  const rpc = await flagWrongAnswerViaRpc(supabase, threadId, isWrongAnswer);
  if (!rpc.ok) {
    const st = qnaRpcCodeToStatus(rpc.code);
    return { ok: false, status: st === 404 ? 404 : st === 403 ? 403 : 500, error: rpc.userMessage };
  }
  return { ok: true };
}
