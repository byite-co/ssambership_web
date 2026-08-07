import type { SupabaseClient } from "@supabase/supabase-js";
import { partyUserIdFromRoomRow } from "./questionRoomUiLabels.ts";

/**
 * 연결노트 쓰기(작성·수정·삭제) 가드 — 활성 구독이 있을 때만 통과.
 *
 * 정책: 만료/취소/refunded 구독에서는 ★읽기는 허용되지만 편집은 차단.
 *  - RLS는 방 멤버만 검증하므로 앱 가드가 추가로 필요.
 *  - 질문 쓰기 가드(`assertThreadCreationSubscriptionAllowed`)와 같은 시그널을 쓰되,
 *    노트는 무료 질문권/주간 한도 분기가 무관이라 별도 헬퍼.
 *  - 멘토·학생 모두 동일 정책(active 구독 필요).
 *
 *  active 판정: subscriptions(student_id, mentor_id) 에 status='active' 행 존재.
 *  (subscribeCheckoutService의 findActiveSubscriptionForPair와 동등한 시그널을
 *   여기서 직접 보고, server-only 모듈 체인을 피해 테스트 가능성을 높인다.)
 *
 *  D-QR-11: 무료 질문권 방(ensure_free_question_room 으로 생성 — subscription_id 링크 없음)은
 *  구독이 "만료"된 게 아니라 애초에 구독 이력이 없는 방이다. 이런 방까지 '구독 만료' 로 차단하면
 *  무료 체험 사용자는 연결노트를 한 번도 못 쓴다. 방 행의 subscription_id 가 비어 있으면 무료 방으로
 *  보고 편집을 허용한다(정본: mentor_student_rooms.subscription_id 는 구독 확정 시에만 채워진다 —
 *  20260730105244_core_private_room_ensure.sql §13.1). 구독 이력이 있으나 현재 비활성인 방만
 *  '만료' 로 차단한다.
 */
export function roomHasNoSubscriptionLink(row: Record<string, unknown>): boolean {
  const ref = row.subscription_id;
  return ref == null || String(ref).trim() === "";
}

export async function assertConnectionNoteWriteAllowed(
  supabase: SupabaseClient,
  roomId: string,
  actor: "student" | "mentor"
): Promise<{ ok: true } | { ok: false; userMessage: string }> {
  const { data, error } = await supabase
    .from("mentor_student_rooms")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (error) {
    console.error("[assertConnectionNoteWriteAllowed] room", { roomId, message: error.message });
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

  // D-QR-11: 무료 질문권 방(구독 링크 없음)은 '만료' 대상이 아니므로 편집 허용.
  if (roomHasNoSubscriptionLink(row)) {
    return { ok: true };
  }

  const { data: subs, error: subErr } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("student_id", studentId)
    .eq("mentor_id", mentorId);
  if (subErr) {
    console.error("[assertConnectionNoteWriteAllowed] sub lookup", { roomId, message: subErr.message });
    return { ok: false, userMessage: "구독 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
  const hasActive = ((subs ?? []) as Array<{ status?: string }>).some(
    (r) => String(r.status ?? "").trim().toLowerCase() === "active"
  );
  if (hasActive) return { ok: true };

  const userMessage =
    actor === "student"
      ? "구독이 만료되어 연결노트를 편집할 수 없어요. 읽기는 가능합니다. 멘토를 다시 구독하면 편집이 다시 열려요."
      : "학생의 구독이 만료되어 연결노트를 편집할 수 없어요. 기록 열람은 가능합니다.";
  return { ok: false, userMessage };
}
