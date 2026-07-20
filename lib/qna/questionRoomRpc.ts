import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FREE_QUESTION_EXPIRY_DAYS,
  FREE_QUESTION_PER_MENTOR_LIMIT,
  FREE_QUESTION_TOTAL_LIMIT,
} from "@/lib/mentor/freeQuestionPolicy";

/**
 * P1-8A 질문방 원자 RPC 래퍼.
 *
 * 정본 SQL: supabase/sql/130_p1_8a_question_room_atomic_rpc.sql
 * - qna_create_free_question_thread: 무료 질문 스레드 생성 + 첫 메시지(선택) + 무료권 소비를 원자화.
 *   기존 "게이트가 usage 먼저 INSERT → 별도 thread INSERT → 시각 근접 짝짓기"의 비원자/오짝 문제 제거.
 * - qna_append_message / qna_confirm_thread / qna_flag_wrong_answer / qna_register_attachment: 잔여 전환 대상.
 *
 * RPC 는 SECURITY DEFINER + auth.uid() 재검사(당사자·역할·계정상태·차단·멘토승인·무료자격)로
 * 앱/웹 어느 경로로 호출돼도 동일하게 방어한다. 웹은 사용자 세션 클라이언트로 호출한다.
 */

/** RPC 가 raise 하는 코드 → 사용자 노출 문구 매핑. 미지의 코드는 일반 폴백. */
export function freeQuestionRpcErrorToUserMessage(code: string): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "로그인 정보가 만료되었어요. 다시 로그인해 주세요.";
    case "TITLE_REQUIRED":
      return "질문 제목을 입력해 주세요.";
    case "ROOM_NOT_FOUND":
      return "질문방을 찾을 수 없어요. 목록에서 다시 들어와 주세요.";
    case "MENTOR_CANNOT_CREATE_THREAD":
      return "질문 주제(스레드)는 학생만 새로 만들 수 있습니다.";
    case "NOT_ROOM_PARTY":
      return "이 질문방의 당사자만 질문을 작성할 수 있어요.";
    case "ACCOUNT_BANNED":
      return "계정이 영구 제한되어 이 작업을 할 수 없어요. 고객센터로 문의해 주세요.";
    case "ACCOUNT_SUSPENDED":
      return "계정이 일시 정지되어 이 작업을 할 수 없어요. 정지 해제 후 다시 이용해 주세요.";
    case "BLOCKED":
      return "차단된 상대에게는 질문을 작성할 수 없어요.";
    case "MENTOR_NOT_APPROVED":
      return "아직 승인 전인 멘토에게는 질문을 작성할 수 없어요.";
    case "FREE_QUOTA_EXPIRED":
      return `무료 질문권은 가입 후 ${FREE_QUESTION_EXPIRY_DAYS}일까지만 사용할 수 있습니다. 멘토를 구독한 뒤 질문해 주세요.`;
    case "FREE_QUOTA_TOTAL_EXHAUSTED":
      return `무료 질문권을 모두 사용했습니다(최대 ${FREE_QUESTION_TOTAL_LIMIT}회). 멘토를 구독한 뒤 질문해 주세요.`;
    case "FREE_QUOTA_MENTOR_EXHAUSTED":
      return `이 멘토에게는 무료 질문권을 ${FREE_QUESTION_PER_MENTOR_LIMIT}회까지 사용할 수 있습니다. 구독 후 질문해 주세요.`;
    default:
      return "질문을 작성하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

/** Postgres 에러 메시지에서 RPC 가 raise 한 코드(대문자_스네이크)만 추출. */
function extractRpcCode(message: string): string {
  const m = /([A-Z][A-Z0-9_]{3,})/.exec(String(message ?? ""));
  return m ? m[1] : "";
}

export type CreateFreeThreadResult =
  | { ok: true; threadId: string | null; messageId: string | null }
  | { ok: false; userMessage: string };

/**
 * 무료 질문 스레드 원자 생성. 활성 구독이 없는 학생 경로 전용.
 * (현행 UX 는 제목만 받고 메시지는 별도 액션이므로 firstMessageBody 는 기본 null.)
 */
export async function createFreeQuestionThreadViaRpc(
  supabase: SupabaseClient,
  params: {
    roomId: string;
    title: string;
    subject?: string | null;
    topic?: string | null;
    firstMessageBody?: string | null;
  }
): Promise<CreateFreeThreadResult> {
  const { data, error } = await supabase.rpc("qna_create_free_question_thread", {
    p_room_id: params.roomId,
    p_title: params.title,
    p_subject: params.subject ?? null,
    p_topic: params.topic ?? null,
    p_first_message_body: params.firstMessageBody ?? null,
  });

  if (error) {
    const code = extractRpcCode(error.message);
    console.error("[createFreeQuestionThreadViaRpc]", { code, message: error.message });
    return { ok: false, userMessage: freeQuestionRpcErrorToUserMessage(code) };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    threadId: typeof row.thread_id === "string" ? row.thread_id : null,
    messageId: typeof row.message_id === "string" ? row.message_id : null,
  };
}
