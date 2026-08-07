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
 *  무료 체험 사용자는 연결노트를 한 번도 못 쓴다. 단, subscription_id FK 는 on delete set null 이라
 *  구독 행이 삭제·정리되면 링크가 NULL 로 회귀한다 — 링크 부재만으로 '무료 방' 단정은 fail-open.
 *  따라서 링크가 없으면 (student, mentor) 쌍의 subscriptions 이력을 직접 조회해
 *  0건일 때만 무료 방으로 허용하고, 이력이 있으나 활성이 없으면 '만료' 로 차단한다
 *  (e2e/connection-note-guard.spec.ts 가 이 계약의 정본). 조회 오류는 fail-closed.
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

  const { data: subs, error: subErr } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("student_id", studentId)
    .eq("mentor_id", mentorId);
  if (subErr) {
    console.error("[assertConnectionNoteWriteAllowed] sub lookup", { roomId, message: subErr.message });
    return { ok: false, userMessage: "구독 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
  const subRows = (subs ?? []) as Array<{ status?: string }>;

  // D-QR-11: 진짜 무료 질문권 방 = 구독 링크도 없고 (student, mentor) 구독 이력도 0건.
  // (링크는 FK on delete set null 로 회귀할 수 있으므로 링크 부재만으로는 무료 방 단정 금지.)
  if (roomHasNoSubscriptionLink(row) && subRows.length === 0) {
    return { ok: true };
  }

  const hasActive = subRows.some(
    (r) => String(r.status ?? "").trim().toLowerCase() === "active"
  );
  if (hasActive) return { ok: true };

  const userMessage =
    actor === "student"
      ? "구독이 만료되어 연결노트를 편집할 수 없어요. 읽기는 가능합니다. 멘토를 다시 구독하면 편집이 다시 열려요."
      : "학생의 구독이 만료되어 연결노트를 편집할 수 없어요. 기록 열람은 가능합니다.";
  return { ok: false, userMessage };
}
