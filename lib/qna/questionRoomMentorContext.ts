import type { SupabaseClient } from "@supabase/supabase-js";
import { partyUserIdFromRoomRow } from "@/lib/qna/questionRoomUiLabels";
import { fetchThreadsForRooms } from "@/lib/qna/questionRoomQueries";
import { readQuestionThreadWorkflowStatus } from "@/lib/qna/questionThreadStatus";
import { threadMentorStudentRoomId } from "@/lib/qna/questionThreadRoomRef";

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
  const out: StudentDisplayById = {};
  const idList = [...ids];
  if (idList.length === 0) return out;
  try {
    const { data } = await supabase.rpc("get_mentor_student_nicknames", { p_student_ids: idList });
    const rows = (data as Row[]) ?? [];
    for (const id of idList) {
      const row = rows.find((u) => u.id === id);
      const name =
        (row && typeof row.full_name === "string" && row.full_name.trim()) ||
        (row && typeof row.nickname === "string" && row.nickname.trim()) ||
        "이름 미설정";
      out[id] = { displayName: name, initial: name.slice(0, 1) };
    }
  } catch {
    for (const id of idList) out[id] = { displayName: "이름 미설정", initial: "?" };
  }
  return out;
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
  return "이름 미설정";
}
