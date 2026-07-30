import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { callApiWebV1Rpc } from "@/lib/apiWebV1/rpc";
import {
  FREE_QUESTION_EXPIRY_DAYS,
  FREE_QUESTION_PER_MENTOR_LIMIT,
  FREE_QUESTION_TOTAL_LIMIT,
} from "@/lib/mentor/freeQuestionPolicy";

export type FreeQuestionRoomResult = { ok: true; roomId: string } | { ok: false; userMessage: string };

/** F2 오류코드(계약 §7 F2 — 12종) → 사용자 문구. 사전 밖은 일반 문구(성공 위장 금지). */
function f2CodeToUserMessage(code: string): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "로그인 정보가 만료되었어요. 다시 로그인해 주세요.";
    case "ROLE_NOT_STUDENT":
      return "질문방은 학생만 열 수 있어요.";
    case "ACCOUNT_BANNED":
      return "계정이 영구 제한되어 질문방을 열 수 없어요. 고객센터로 문의해 주세요.";
    case "ACCOUNT_SUSPENDED":
      return "계정이 일시 정지되어 질문방을 열 수 없어요. 정지 해제 후 다시 이용해 주세요.";
    case "ACCOUNT_DELETION_IN_PROGRESS":
      return "탈퇴 처리 중인 계정은 질문방을 열 수 없어요.";
    case "MENTOR_NOT_FOUND":
      return "멘토를 찾을 수 없어요. 목록에서 다시 시도해 주세요.";
    case "MENTOR_NOT_APPROVED":
      return "아직 승인 전인 멘토라 질문방을 열 수 없어요.";
    case "BLOCKED":
      return "차단된 상대와는 질문방을 열 수 없어요.";
    case "FREE_QUOTA_EXPIRED":
      return `무료 질문권은 가입 후 ${FREE_QUESTION_EXPIRY_DAYS}일까지만 사용할 수 있습니다. 멘토를 구독한 뒤 질문해 주세요.`;
    case "FREE_QUOTA_TOTAL_EXHAUSTED":
      return `무료 질문권을 모두 사용했습니다(최대 ${FREE_QUESTION_TOTAL_LIMIT}회). 멘토를 구독한 뒤 질문해 주세요.`;
    case "FREE_QUOTA_MENTOR_EXHAUSTED":
      return `이 멘토에게는 무료 질문권을 ${FREE_QUESTION_PER_MENTOR_LIMIT}회까지 사용할 수 있습니다. 구독 후 질문해 주세요.`;
    default:
      return "질문방을 여는 데 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

/**
 * S2-2 전환 W1(C3): 무료 질문권 질문방 확보 — F2 `api_web_v1.ensure_free_question_room`.
 *
 * 멘토 상세의 "무료 질문권 사용하기" 버튼은 `/question-room?mentorId=` 로 연결되고,
 * 이 함수가 방 진입 공백을 메운다. 구 경로(JS 승인·자격 게이트 + service_role 직접
 * INSERT + 컬럼 프로빙 + 23505 재조회)는 제거했다 — 학생 역할·계정 상태·승인 멘토·
 * 상호 차단·구독/무료 자격·원자 INSERT 전부 서버(F2 → core_private F10)가 판정한다
 * (계약 §7 F2 — 원자성 순서 ①~⑦, 클라이언트 자격 복제 금지). 실제 무료 질문권
 * 차감은 F3(스레드 생성)이 수행한다 — 방 확보는 소비하지 않는다.
 *
 * `supabase` 는 학생 세션 클라이언트여야 한다(F2 가 `auth.uid()` 로 학생을 도출).
 */
export async function ensureFreeQuestionRoomForStudent(
  supabase: SupabaseClient,
  mentorId: string
): Promise<FreeQuestionRoomResult> {
  const res = await callApiWebV1Rpc(supabase, "ensure_free_question_room", {
    p_mentor_id: mentorId,
  });
  if (!res.ok) {
    if (res.message) {
      console.error("[ensureFreeQuestionRoomForStudent] ensure_free_question_room", {
        code: res.code,
        message: res.message,
      });
    }
    return { ok: false, userMessage: f2CodeToUserMessage(res.code) };
  }
  const roomId = typeof res.row.room_id === "string" ? res.row.room_id : "";
  if (!roomId) {
    return { ok: false, userMessage: f2CodeToUserMessage("") };
  }
  return { ok: true, roomId };
}
