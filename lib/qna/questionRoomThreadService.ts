import type { SupabaseClient } from "@supabase/supabase-js";
import { nextRoomQuestionNumber } from "@/lib/qna/questionRoomMutations";
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

// (W4 C10: resolveMentorIdForRoom · assertStudentCanCreateThread — 외부 호출 0 의 dead export
//  삭제. 자격 판정 정본은 P1-8A RPC(qna_create_question_thread) 서버 분기다.)

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

// (W4 C10: assertThreadInRoom — 외부 호출 0 의 dead export 삭제. thread→room 소속 판정은
//  P1-8A RPC 가 서버에서 수행한다.)

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
