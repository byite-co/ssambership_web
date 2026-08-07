import type { SupabaseClient } from "@supabase/supabase-js";
import { partyUserIdFromRoomRow } from "@/lib/qna/questionRoomUiLabels";
import { fetchThreadsForRooms } from "@/lib/qna/questionRoomQueries";
import { readQuestionThreadWorkflowStatus } from "@/lib/qna/questionThreadStatus";
import { threadMentorStudentRoomId } from "@/lib/qna/questionThreadRoomRef";
import { ANON_STUDENT_LABEL, fetchStudentDisplayNames } from "@/lib/qna/studentDisplayNames";

type Row = Record<string, unknown>;

export type StudentDisplayById = Record<string, { displayName: string; initial: string }>;

export async function loadStudentDisplaysForQuestionRooms(
  supabase: SupabaseClient,
  roomRows: Row[]
): Promise<StudentDisplayById> {
  const ids = new Set<string>();
  for (const r of roomRows) {
    const sid = partyUserIdFromRoomRow(r, "student");
    if (sid) ids.add(sid);
  }
  const idList = [...ids];
  if (idList.length === 0) return {};

  // D-QR-7: 표시명 조회를 Wave 0 공용 규약(fetchStudentDisplayNames)에 위임한다.
  //  구 동작은 RPC error 를 구조분해조차 하지 않아, 권한·배포 오류로 조회가 실패해도 전원
  //  '이름 미설정' 으로 조용히 강등돼 운영·사용자 모두 실패를 인지 못 했다. 이제 오류를 명시
  //  로그로 표면화하고(정상 빈결과와 구분), 익명 라벨은 안전 폴백으로만 쓴다.
  const { byId, error } = await fetchStudentDisplayNames(supabase, idList);
  if (error) {
    console.error("[loadStudentDisplaysForQuestionRooms] get_mentor_student_nicknames failed", {
      studentCount: idList.length,
    });
  }
  return byId;
}

/** 멘토 기준: 답변 대기(pending) 스레드 수 = 안읽음 */
export async function loadMentorUnreadCountsByRoomId(
  supabase: SupabaseClient,
  roomIds: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of roomIds) out[id] = 0;
  if (roomIds.length === 0) return out;

  const pack = await fetchThreadsForRooms(supabase, roomIds);
  if (pack.error) return out;

  for (const t of pack.rows) {
    const rid = threadMentorStudentRoomId(t) ?? "";
    if (!rid) continue;
    if (readQuestionThreadWorkflowStatus(t) === "pending") {
      out[rid] = (out[rid] ?? 0) + 1;
    }
  }
  return out;
}

export function studentLabelForRoom(
  room: Row,
  studentDisplays: StudentDisplayById
): string {
  const sid = partyUserIdFromRoomRow(room, "student");
  if (sid && studentDisplays[sid]) return studentDisplays[sid].displayName;
  for (const k of ["student_name", "title", "name", "label"] as const) {
    const v = room[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return ANON_STUDENT_LABEL;
}
