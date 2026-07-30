/**
 * S2-2 전환 W4(C10): 질문방 FK 정본 리터럴.
 * question_threads.mentor_student_room_id · connection_notes.mentor_student_room_id
 * (002_p0 스키마·187 baseline 실측 — room_id/msr_id 등 후보 별칭 열은 존재하지 않는다).
 * 구 후보 배열(QUESTION_THREADS_ROOM_FK_CANDIDATES 등)과 후보 순회는 제거했다.
 */
export const QUESTION_THREADS_ROOM_FK = "mentor_student_room_id" as const;
export const CONNECTION_NOTES_ROOM_FK = "mentor_student_room_id" as const;

/** thread 행에서 mentor_student_rooms.id 에 해당하는 FK 값을 정본 컬럼에서 꺼낸다. */
export function threadMentorStudentRoomId(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  const v = row[QUESTION_THREADS_ROOM_FK];
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function threadRowBelongsToMentorStudentRoom(
  row: Record<string, unknown> | null | undefined,
  mentorStudentRoomId: string
): boolean {
  if (!row) return false;
  const got = threadMentorStudentRoomId(row);
  if (!got) return false;
  return got.toLowerCase() === mentorStudentRoomId.trim().toLowerCase();
}
