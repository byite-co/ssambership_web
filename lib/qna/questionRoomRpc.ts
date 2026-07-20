import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FREE_QUESTION_EXPIRY_DAYS,
  FREE_QUESTION_PER_MENTOR_LIMIT,
  FREE_QUESTION_TOTAL_LIMIT,
} from "@/lib/mentor/freeQuestionPolicy";
import { WEEKLY_QUESTION_LIMIT_MESSAGE } from "@/lib/qna/questionThreadStatus";

/**
 * P1-8A 질문방 원자 RPC 래퍼 (정본 SQL: supabase/sql/136_p1_8a_question_room_atomic_rpc.sql).
 *
 * - qna_create_question_thread: 스레드 생성 + (선택)첫 메시지 + 무료/구독 자격 서버 분기(무료면 usage thread_id 링크).
 * - qna_append_message: 메시지 append + 멘토 첫 답변만 answered 전이 + record_domain_notification exactly-once.
 * - qna_confirm_thread / qna_flag_wrong_answer: 학생 전용 상태 전이.
 * - qna_register_attachment: 첨부 메타 등록(경로 thread-id 검증) + 멘토 첫 첨부 answered 전이 + exactly-once.
 *
 * 모든 RPC 는 SECURITY DEFINER + auth.uid() 재검사(당사자·역할·계정상태·차단·멘토승인·자격)로 방어한다.
 * 웹은 사용자 세션 클라이언트로 호출한다(폼/히든 신뢰 안 함).
 */

/** Postgres 에러 메시지에서 RPC 가 raise 한 코드(대문자_스네이크)만 추출. */
function extractRpcCode(message: string): string {
  const m = /\b([A-Z][A-Z0-9_]{3,})\b/.exec(String(message ?? ""));
  return m ? m[1] : "";
}

/** RPC 코드 → 사용자 노출 문구. 미지의 코드는 도메인별 일반 폴백. */
export function qnaRpcErrorToUserMessage(
  code: string,
  domain: "thread" | "message" | "confirm" | "wrong" | "attachment"
): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "로그인 정보가 만료되었어요. 다시 로그인해 주세요.";
    case "TITLE_REQUIRED":
      return "질문 제목을 입력해 주세요.";
    case "BODY_REQUIRED":
      return "메시지 내용을 입력해 주세요.";
    case "STORAGE_PATH_REQUIRED":
      return "첨부 파일을 선택해 주세요.";
    case "ROOM_NOT_FOUND":
      return "질문방을 찾을 수 없어요. 목록에서 다시 들어와 주세요.";
    case "THREAD_NOT_FOUND":
      return "질문을 찾을 수 없어요.";
    case "MENTOR_CANNOT_CREATE_THREAD":
      return "질문 주제(스레드)는 학생만 새로 만들 수 있습니다.";
    case "NOT_ROOM_PARTY":
      return "이 질문방의 당사자만 이 작업을 할 수 있어요.";
    case "STUDENT_ONLY":
      return "이 작업은 학생만 할 수 있어요.";
    case "ACCOUNT_BANNED":
      return "계정이 영구 제한되어 이 작업을 할 수 없어요. 고객센터로 문의해 주세요.";
    case "ACCOUNT_SUSPENDED":
      return "계정이 일시 정지되어 이 작업을 할 수 없어요. 정지 해제 후 다시 이용해 주세요.";
    case "BLOCKED":
      return "차단된 상대에게는 작업할 수 없어요.";
    case "MENTOR_NOT_APPROVED":
      return "아직 승인 전인 멘토라 이 작업을 할 수 없어요.";
    case "THREAD_LOCKED":
      return "완료된 질문에는 더 이상 메시지를 보낼 수 없어요. 새 질문을 작성해 주세요.";
    case "NOT_ANSWERED":
      return "멘토 답변이 도착한 뒤에만 확인할 수 있습니다.";
    case "STORAGE_PATH_MISMATCH":
    case "MESSAGE_THREAD_MISMATCH":
      return "첨부 경로가 이 질문과 일치하지 않아요. 다시 시도해 주세요.";
    case "FREE_QUOTA_EXPIRED":
      return `무료 질문권은 가입 후 ${FREE_QUESTION_EXPIRY_DAYS}일까지만 사용할 수 있습니다. 멘토를 구독한 뒤 질문해 주세요.`;
    case "FREE_QUOTA_TOTAL_EXHAUSTED":
      return `무료 질문권을 모두 사용했습니다(최대 ${FREE_QUESTION_TOTAL_LIMIT}회). 멘토를 구독한 뒤 질문해 주세요.`;
    case "FREE_QUOTA_MENTOR_EXHAUSTED":
      return `이 멘토에게는 무료 질문권을 ${FREE_QUESTION_PER_MENTOR_LIMIT}회까지 사용할 수 있습니다. 구독 후 질문해 주세요.`;
    case "WEEKLY_LIMIT_EXHAUSTED":
      return WEEKLY_QUESTION_LIMIT_MESSAGE;
    default:
      if (domain === "message") return "메시지를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.";
      if (domain === "confirm") return "확인 처리를 하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      if (domain === "wrong") return "오답 표시를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      if (domain === "attachment") return "첨부를 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.";
      return "질문을 작성하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

export type RpcThreadResult =
  | { ok: true; threadId: string | null; messageId: string | null; path: "free" | "subscription" | null }
  | { ok: false; code: string; userMessage: string };

/** 질문 스레드 원자 생성(무료/구독 서버 분기). 학생 전용. */
export async function createQuestionThreadViaRpc(
  supabase: SupabaseClient,
  params: { roomId: string; title: string; subject?: string | null; topic?: string | null; firstMessageBody?: string | null }
): Promise<RpcThreadResult> {
  const { data, error } = await supabase.rpc("qna_create_question_thread", {
    p_room_id: params.roomId,
    p_title: params.title,
    p_subject: params.subject ?? null,
    p_topic: params.topic ?? null,
    p_first_message_body: params.firstMessageBody ?? null,
  });
  if (error) {
    const code = extractRpcCode(error.message);
    console.error("[createQuestionThreadViaRpc]", { code, message: error.message });
    return { ok: false, code, userMessage: qnaRpcErrorToUserMessage(code, "thread") };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const path = row.path === "free" || row.path === "subscription" ? row.path : null;
  return {
    ok: true,
    threadId: typeof row.thread_id === "string" ? row.thread_id : null,
    messageId: typeof row.message_id === "string" ? row.message_id : null,
    path,
  };
}

export type RpcAppendResult =
  | { ok: true; messageId: string | null; answeredTransition: boolean }
  | { ok: false; code: string; userMessage: string };

/** 메시지 append(학생·멘토 공통). 멘토 첫 답변 시 answered 전이 + exactly-once 알림은 RPC 내부에서. */
export async function appendQuestionMessageViaRpc(
  supabase: SupabaseClient,
  params: { threadId: string; body: string }
): Promise<RpcAppendResult> {
  const { data, error } = await supabase.rpc("qna_append_message", {
    p_thread_id: params.threadId,
    p_body: params.body,
  });
  if (error) {
    const code = extractRpcCode(error.message);
    console.error("[appendQuestionMessageViaRpc]", { code, message: error.message });
    return { ok: false, code, userMessage: qnaRpcErrorToUserMessage(code, "message") };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    messageId: typeof row.message_id === "string" ? row.message_id : null,
    answeredTransition: row.answered_transition === true,
  };
}

export type RpcSimpleResult = { ok: true } | { ok: false; code: string; userMessage: string };

/** 학생 확인(answered→confirmed). */
export async function confirmQuestionThreadViaRpc(
  supabase: SupabaseClient,
  threadId: string
): Promise<RpcSimpleResult> {
  const { error } = await supabase.rpc("qna_confirm_thread", { p_thread_id: threadId });
  if (error) {
    const code = extractRpcCode(error.message);
    console.error("[confirmQuestionThreadViaRpc]", { code, message: error.message });
    return { ok: false, code, userMessage: qnaRpcErrorToUserMessage(code, "confirm") };
  }
  return { ok: true };
}

/** 오답 표시(학생). */
export async function flagWrongAnswerViaRpc(
  supabase: SupabaseClient,
  threadId: string,
  isWrong: boolean
): Promise<RpcSimpleResult> {
  const { error } = await supabase.rpc("qna_flag_wrong_answer", { p_thread_id: threadId, p_is_wrong: isWrong });
  if (error) {
    const code = extractRpcCode(error.message);
    console.error("[flagWrongAnswerViaRpc]", { code, message: error.message });
    return { ok: false, code, userMessage: qnaRpcErrorToUserMessage(code, "wrong") };
  }
  return { ok: true };
}

export type RpcAttachmentResult =
  | { ok: true; attachmentId: string | null; answeredTransition: boolean }
  | { ok: false; code: string; userMessage: string };

/** 첨부 메타 등록(경로 thread-id 검증). 멘토 첫 첨부 시 answered 전이 + exactly-once 알림은 RPC 내부에서. */
export async function registerQuestionAttachmentViaRpc(
  supabase: SupabaseClient,
  params: { threadId: string; storagePath: string; fileName?: string | null; mimeType?: string | null; messageId?: string | null }
): Promise<RpcAttachmentResult> {
  const { data, error } = await supabase.rpc("qna_register_attachment", {
    p_thread_id: params.threadId,
    p_storage_path: params.storagePath,
    p_file_name: params.fileName ?? null,
    p_mime_type: params.mimeType ?? null,
    p_message_id: params.messageId ?? null,
  });
  if (error) {
    const code = extractRpcCode(error.message);
    console.error("[registerQuestionAttachmentViaRpc]", { code, message: error.message });
    return { ok: false, code, userMessage: qnaRpcErrorToUserMessage(code, "attachment") };
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    attachmentId: typeof row.attachment_id === "string" ? row.attachment_id : null,
    answeredTransition: row.answered_transition === true,
  };
}
