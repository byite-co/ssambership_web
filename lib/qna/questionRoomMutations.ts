import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchRoomsForUser } from "@/lib/qna/questionRoomQueries";
import { CONNECTION_NOTES_ROOM_FK, QUESTION_THREADS_ROOM_FK } from "@/lib/qna/questionThreadRoomRef";

type QnaRole = "student" | "mentor";

type MutationFail = {
  ok: false;
  error: string;
};

// S2-2 전환 W4(C10): thread·message 직접 INSERT 경로(createQuestionThread /
// createQuestionMessage — 컬럼 후보 payload 순회 insertWithCandidates)는 호출부 0의
// dead code 로 삭제했다. 정본 쓰기 경로는 P1-8A RPC(createQuestionThreadViaRpc /
// appendQuestionMessageViaRpc — lib/qna/questionRoomRpc.ts)다.

function textFromFormValue(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function includesAny(message: string, words: string[]): boolean {
  const lower = message.toLowerCase();
  return words.some((w) => lower.includes(w.toLowerCase()));
}

async function ensureRoomScope(
  supabase: SupabaseClient,
  role: QnaRole,
  userId: string,
  roomId: string
): Promise<MutationFail | null> {
  const roomsQ = await fetchRoomsForUser(supabase, role, userId);
  if (roomsQ.error) return { ok: false, error: roomsQ.error };
  const inScope = roomsQ.rows.some(
    (room) => room.id != null && String(room.id) === String(roomId)
  );
  if (!inScope) return { ok: false, error: "이 room에 대한 쓰기 권한이 없습니다." };
  return null;
}

export async function saveConnectionNote(params: {
  supabase: SupabaseClient;
  role: QnaRole;
  userId: string;
  roomId: string;
  content: string;
}): Promise<{ ok: true; row: Record<string, unknown> | null } | MutationFail> {
  const { supabase, role, userId, roomId, content } = params;
  if (!content.trim()) return { ok: false, error: "connection note 내용을 입력하세요." };

  const scopeError = await ensureRoomScope(supabase, role, userId, roomId);
  if (scopeError) return scopeError;

  // W4(C10) 정본 고정: connection_notes(mentor_student_room_id, body, author_id, author_role)
  // — 187 baseline 실측 컬럼. 구 컬럼 후보 payload 순회(body/content/note/… × 작성자 유무)는
  // 제거했다. 작성자별 카드를 유지하기 위해 매 저장마다 새 노트를 append (room 단위 공유).
  const { data, error } = await supabase
    .from("connection_notes")
    .insert({ [CONNECTION_NOTES_ROOM_FK]: roomId, body: content.trim(), author_id: userId, author_role: role })
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[saveConnectionNote] insert failed", { roomId, code: error.code });
    return { ok: false, error: error.message };
  }
  return { ok: true, row: (data as Record<string, unknown> | null) ?? null };
}

/**
 * 해당 질문방(room) 내 질문 누적 순번 = 그 room의 thread 개수 + 1.
 * ★room id로만 필터(학생 전체 합산 아님) → 질문방마다 1,2,3… 독립 카운트.
 */
export async function nextRoomQuestionNumber(supabase: SupabaseClient, roomId: string): Promise<number> {
  const { count, error } = await supabase
    .from("question_threads")
    .select("id", { count: "exact", head: true })
    .eq(QUESTION_THREADS_ROOM_FK, roomId);
  if (error || count == null) return 1;
  return count + 1;
}

export function formatActionError(action: "thread" | "message" | "note", raw: string): string {
  if (includesAny(raw, ["쓰기 권한", "permission", "not authorized", "rls"])) {
    return "권한 오류: 이 room에서 해당 작업을 수행할 수 없습니다.";
  }
  if (includesAny(raw, ["foreign key", "violates"])) {
    return "연결 오류: room/thread 관계를 확인해 주세요.";
  }
  if (includesAny(raw, ["not-null", "null value"])) {
    return "입력 오류: 필수 필드가 비어 있습니다.";
  }
  if (includesAny(raw, ["could not find any of", "column", "schema cache"])) {
    return "스키마 오류: 필수 컬럼을 찾지 못했습니다. 테이블 컬럼명을 확인해 주세요.";
  }

  if (action === "thread") return `thread 생성 실패: ${raw}`;
  if (action === "message") return `message 저장 실패: ${raw}`;
  return "connection note를 저장할 수 없습니다.";
}

export function readThreadTitleFromForm(formData: FormData): string {
  return textFromFormValue(formData.get("threadTitle"));
}

/** threadId·본문만 — author_id 등은 서버 `auth.uid()` 전용 (폼/히든으로 받지 않음). */
export function readMessageFromForm(formData: FormData): { threadId: string; content: string } {
  return {
    threadId: textFromFormValue(formData.get("threadId")),
    content: textFromFormValue(formData.get("messageBody")),
  };
}

/** connection_notes 본문만 — room·user는 서버 액션에서만 결정 */
export function readNoteFromForm(formData: FormData): string {
  return textFromFormValue(formData.get("noteBody"));
}

/** W4(C10): 정본 컬럼 `connection_notes.body` 단일 참조(구 후보 키 6종 순회 제거). */
export function extractNoteText(row: Record<string, unknown> | null | undefined): string {
  if (!row) return "";
  const val = row.body;
  return typeof val === "string" && val.trim() ? val : "";
}
