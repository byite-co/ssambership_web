import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONNECTION_NOTES_ROOM_FK,
  QUESTION_THREADS_ROOM_FK,
  threadMentorStudentRoomId,
} from "@/lib/qna/questionThreadRoomRef";

type QnaRole = "student" | "mentor";

// W4(C10) 정본: mentor_student_rooms 당사자 컬럼은 student_id · mentor_id 뿐이다
// (002_p0·187 baseline 실측 — student_user_id 등 별칭 열 부재). 후보 순회는 제거했다.

/** `mentor_student_rooms` 한 행에서 `userId`가 학생 당사자인지. */
export function userMatchesStudentInRoomRow(row: Record<string, unknown>, userId: string): boolean {
  return String(row.student_id ?? "").trim() === userId;
}

/** `mentor_student_rooms` 한 행에서 `userId`가 멘토 당사자인지. */
export function userMatchesMentorInRoomRow(row: Record<string, unknown>, userId: string): boolean {
  return String(row.mentor_id ?? "").trim() === userId;
}

export type QnaDataState<T> = {
  rows: T[];
  error: string | null;
  loading: boolean;
};

export type QuestionRoomBundle = {
  rooms: QnaDataState<Record<string, unknown>>;
  threads: QnaDataState<Record<string, unknown>>;
  messages: QnaDataState<Record<string, unknown>>;
  notes: QnaDataState<Record<string, unknown>>;
};

/** 목록 카드용 — room당 최신 스레드·해당 스레드의 최신 메시지(실조회, mock 없음) */
export type QuestionRoomListPreview = {
  roomId: string;
  latestThread: Record<string, unknown> | null;
  lastMessage: Record<string, unknown> | null;
};

export type QuestionRoomListBundleResult = QuestionRoomBundle & {
  listPreviewsByRoomId: Record<string, QuestionRoomListPreview>;
};

const QNA_LOAD_ERROR = "데이터를 불러오는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.";

export async function fetchRoomsForUser(
  supabase: SupabaseClient,
  role: QnaRole,
  userId: string
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  // W4(C10) 정본 고정: 당사자 컬럼 student_id/mentor_id, 정렬 updated_at desc(실측 존재).
  // 구 컬럼 후보 프로빙·정렬 후보 재시도(selectOrdered)·order 생략 fallback 은 제거했다.
  const col = role === "student" ? "student_id" : "mentor_id";
  const { data, error } = await supabase
    .from("mentor_student_rooms")
    .select("*")
    .eq(col, userId)
    .order("updated_at", { ascending: false });
  if (error) return { rows: [], error: QNA_LOAD_ERROR };
  return { rows: (data as Record<string, unknown>[]) ?? [], error: null };
}

/**
 * P0: 로그인 사용자가 볼 수 있는 `mentor_student_rooms` 행(목록/게이트 공통).
 * `fetchRoomsForUser`와 동일한 스키마 탐색 결과를 쓴다.
 */
export async function loadMyQuestionRooms(
  supabase: SupabaseClient,
  role: QnaRole,
  userId: string
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  return fetchRoomsForUser(supabase, role, userId);
}

/**
 * 페이지 게이트: roomId 행이 현재 사용자(학생·멘토 party)와 일치하는지.
 * RLS와 별도로 서버에서 한 번 더 거른다. 목록 조회 `fetchRoomsForUser`와 동일한 id 열 별칭을 허용한다.
 */
export async function userCanAccessMentorStudentRoom(
  supabase: SupabaseClient,
  userId: string,
  role: QnaRole,
  roomId: string
): Promise<boolean> {
  const { data, error } = await supabase.from("mentor_student_rooms").select("*").eq("id", roomId).maybeSingle();
  if (error || !data) {
    return false;
  }
  const row = data as Record<string, unknown>;
  if (role === "student") {
    return userMatchesStudentInRoomRow(row, userId);
  }
  return userMatchesMentorInRoomRow(row, userId);
}

export async function fetchThreadsForRoom(
  supabase: SupabaseClient,
  roomId: string
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  // W4(C10) 정본 고정: question_threads.mentor_student_room_id, 정렬 updated_at desc.
  const { data, error } = await supabase
    .from("question_threads")
    .select("*")
    .eq(QUESTION_THREADS_ROOM_FK, roomId)
    .order("updated_at", { ascending: false });
  if (error) return { rows: [], error: QNA_LOAD_ERROR };
  return { rows: (data as Record<string, unknown>[]) ?? [], error: null };
}

/** 여러 room에 속한 question_threads 를 한 번에 조회(목록 미리보기용). */
export async function fetchThreadsForRooms(
  supabase: SupabaseClient,
  roomIds: string[]
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  if (roomIds.length === 0) {
    return { rows: [], error: null };
  }
  const { data, error } = await supabase
    .from("question_threads")
    .select("*")
    .in(QUESTION_THREADS_ROOM_FK, roomIds);
  if (error) {
    return { rows: [], error: error.message };
  }
  const rows = (data as Record<string, unknown>[]) ?? [];
  const rank = (r: Record<string, unknown>) => {
    const u = Date.parse(String(r.updated_at ?? ""));
    const c = Date.parse(String(r.created_at ?? ""));
    const tu = Number.isNaN(u) ? 0 : u;
    const tc = Number.isNaN(c) ? 0 : c;
    return Math.max(tu, tc);
  };
  rows.sort((a, b) => rank(b) - rank(a));
  return { rows, error: null };
}

/** 여러 thread의 question_messages 를 한 번에 조회 후, 호출측에서 thread별 최신을 고른다. */
export async function fetchMessagesForThreads(
  supabase: SupabaseClient,
  threadIds: string[]
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  if (threadIds.length === 0) {
    return { rows: [], error: null };
  }
  // W4(C10) 정본 고정: question_messages.thread_id (question_thread_id 별칭 열 부재).
  const { data, error } = await supabase.from("question_messages").select("*").in("thread_id", threadIds);
  if (error) {
    return { rows: [], error: error.message };
  }
  const rows = (data as Record<string, unknown>[]) ?? [];
  const time = (m: Record<string, unknown>) => {
    const t = Date.parse(String(m.created_at ?? ""));
    return Number.isNaN(t) ? 0 : t;
  };
  rows.sort((a, b) => time(a) - time(b));
  return { rows, error: null };
}

export async function fetchMessagesForThread(
  supabase: SupabaseClient,
  threadId: string
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  // W4(C10) 정본 고정: question_messages.thread_id, 정렬 created_at asc.
  const { data, error } = await supabase
    .from("question_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (error) return { rows: [], error: QNA_LOAD_ERROR };
  return { rows: (data as Record<string, unknown>[]) ?? [], error: null };
}

export async function fetchConnectionNotesForRoom(
  supabase: SupabaseClient,
  roomId: string
): Promise<{ rows: Record<string, unknown>[]; error: string | null }> {
  // W4(C10) 정본 고정: connection_notes.mentor_student_room_id, 정렬 updated_at desc.
  const { data, error } = await supabase
    .from("connection_notes")
    .select("*")
    .eq(CONNECTION_NOTES_ROOM_FK, roomId)
    .order("updated_at", { ascending: false });
  if (error) return { rows: [], error: QNA_LOAD_ERROR };
  return { rows: (data as Record<string, unknown>[]) ?? [], error: null };
}

function emptyBundle(partial: Partial<QuestionRoomBundle>): QuestionRoomBundle {
  const base: QuestionRoomBundle = {
    rooms: { rows: [], error: null, loading: false },
    threads: { rows: [], error: null, loading: false },
    messages: { rows: [], error: null, loading: false },
    notes: { rows: [], error: null, loading: false },
  };
  return { ...base, ...partial };
}

function messageThreadIdFromRow(m: Record<string, unknown>): string | null {
  const v = m.thread_id;
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function threadRecencyScore(t: Record<string, unknown>): number {
  const u = Date.parse(String(t.updated_at ?? ""));
  const c = Date.parse(String(t.created_at ?? ""));
  return Math.max(Number.isNaN(u) ? 0 : u, Number.isNaN(c) ? 0 : c);
}

/**
 * 목록 카드용 미리보기 — 읽기 전용 Supabase 호출만 추가(스키마·RLS·SQL 파일 변경 없음).
 */
async function buildListPreviewsByRoomId(
  supabase: SupabaseClient,
  roomRows: Record<string, unknown>[]
): Promise<Record<string, QuestionRoomListPreview>> {
  const out: Record<string, QuestionRoomListPreview> = {};
  const maxRooms = 48;
  const capped = roomRows.slice(0, maxRooms);
  const roomIds = capped.map((r) => (r.id != null ? String(r.id) : "")).filter((id) => id.length > 0);
  for (const id of roomIds) {
    out[id] = { roomId: id, latestThread: null, lastMessage: null };
  }
  if (roomIds.length === 0) {
    return out;
  }

  const threadsPack = await fetchThreadsForRooms(supabase, roomIds);
  if (threadsPack.error || threadsPack.rows.length === 0) {
    return out;
  }

  const threadsByRoom = new Map<string, Record<string, unknown>[]>();
  for (const t of threadsPack.rows) {
    const rid = threadMentorStudentRoomId(t);
    if (!rid) continue;
    const arr = threadsByRoom.get(rid) ?? [];
    arr.push(t);
    threadsByRoom.set(rid, arr);
  }

  const bestThreadByRoom = new Map<string, Record<string, unknown>>();
  for (const [rid, arr] of threadsByRoom) {
    let best = arr[0];
    for (const t of arr) {
      if (threadRecencyScore(t) > threadRecencyScore(best)) best = t;
    }
    bestThreadByRoom.set(rid, best);
  }

  const threadIds: string[] = [];
  for (const id of roomIds) {
    const th = bestThreadByRoom.get(id);
    if (th && typeof th.id === "string" && th.id.trim()) threadIds.push(th.id.trim());
  }

  const msgPack = await fetchMessagesForThreads(supabase, threadIds);
  const lastMessageByThread = new Map<string, Record<string, unknown>>();
  if (!msgPack.error) {
    for (const m of msgPack.rows) {
      const tid = messageThreadIdFromRow(m);
      if (tid) lastMessageByThread.set(tid, m);
    }
  }

  for (const id of roomIds) {
    const th = bestThreadByRoom.get(id) ?? null;
    const tid = th && typeof th.id === "string" ? th.id.trim() : "";
    const last = tid ? lastMessageByThread.get(tid) ?? null : null;
    out[id] = { roomId: id, latestThread: th, lastMessage: last };
  }
  return out;
}

function listBundleBase(
  partial: Partial<QuestionRoomBundle>,
  listPreviewsByRoomId: Record<string, QuestionRoomListPreview>
): QuestionRoomListBundleResult {
  const b = emptyBundle(partial);
  return { ...b, listPreviewsByRoomId };
}

/**
 * 목록 페이지: rooms 전체 + 카드용 스레드·최신 메시지 미리보기(상세 수준의 전 스레드/전 메시지는 로드하지 않음).
 */
export async function loadQuestionRoomListBundle(
  supabase: SupabaseClient,
  role: QnaRole,
  userId: string
): Promise<QuestionRoomListBundleResult> {
  const rooms = await loadMyQuestionRooms(supabase, role, userId);
  if (rooms.error) {
    return listBundleBase(
      {
        rooms: { rows: [], error: rooms.error, loading: false },
        threads: { rows: [], error: null, loading: false },
        messages: { rows: [], error: null, loading: false },
        notes: { rows: [], error: null, loading: false },
      },
      {}
    );
  }
  if (rooms.rows.length === 0) {
    return listBundleBase(
      {
        rooms: { rows: [], error: null, loading: false },
        threads: { rows: [], error: null, loading: false },
        messages: { rows: [], error: null, loading: false },
        notes: { rows: [], error: null, loading: false },
      },
      {}
    );
  }

  const firstId = rooms.rows[0]?.id;
  if (firstId == null || String(firstId).length === 0) {
    return listBundleBase(
      {
        rooms: { rows: rooms.rows, error: "질문방 정보를 확인할 수 없습니다. 고객센터로 문의해 주세요.", loading: false },
        threads: { rows: [], error: null, loading: false },
        messages: { rows: [], error: null, loading: false },
        notes: { rows: [], error: null, loading: false },
      },
      {}
    );
  }

  const listPreviewsByRoomId = await buildListPreviewsByRoomId(supabase, rooms.rows);

  return listBundleBase(
    {
      rooms: { rows: rooms.rows, error: null, loading: false },
      threads: { rows: [], error: null, loading: false },
      messages: { rows: [], error: null, loading: false },
      notes: { rows: [], error: null, loading: false },
    },
    listPreviewsByRoomId
  );
}

export type QuestionRoomDetailLoadResult = QuestionRoomBundle & {
  /**
   * 쿼리 `?thread=` 가 이 room에 속한 thread이면 그 id, 아니면 첫 thread, 없으면 null.
   * 타 room threadId로 메시지를 끌어오지 않는다.
   */
  resolvedThreadId: string | null;
};

/**
 * 상세 페이지: roomId 단위 thread/note + threadId(옵션) 기반 message
 */
export async function loadQuestionRoomDetailBundle(
  supabase: SupabaseClient,
  userId: string,
  role: QnaRole,
  roomId: string,
  threadId: string | null
): Promise<QuestionRoomDetailLoadResult> {
  const allRooms = await loadMyQuestionRooms(supabase, role, userId);
  if (allRooms.error) {
    return {
      ...emptyBundle({
        rooms: { rows: [], error: allRooms.error, loading: false },
        threads: { rows: [], error: null, loading: false },
        messages: { rows: [], error: null, loading: false },
        notes: { rows: [], error: null, loading: false },
      }),
      resolvedThreadId: null,
    };
  }

  const inScope = allRooms.rows.some((r) => r.id != null && String(r.id) === String(roomId));
  if (!inScope) {
    return {
      ...emptyBundle({
        rooms: { rows: allRooms.rows, error: "질문방을 찾을 수 없거나 접근 권한이 없습니다.", loading: false },
        threads: { rows: [], error: null, loading: false },
        messages: { rows: [], error: null, loading: false },
        notes: { rows: [], error: null, loading: false },
      }),
      resolvedThreadId: null,
    };
  }

  const threadsQ = await fetchThreadsForRoom(supabase, roomId);
  const notesQ = await fetchConnectionNotesForRoom(supabase, roomId);

  const firstIdRaw = threadsQ.rows[0]?.id;
  const firstTid = firstIdRaw == null || String(firstIdRaw).length === 0 ? null : String(firstIdRaw);
  const threadInRoom =
    threadId &&
    threadsQ.rows.some((r) => r.id != null && String(r.id) === String(threadId));
  let threadIdToUse: string | null = null;
  if (threadInRoom) {
    threadIdToUse = String(threadId);
  } else {
    threadIdToUse = firstTid;
  }

  const messagesQ = threadIdToUse
    ? await fetchMessagesForThread(supabase, threadIdToUse)
    : { rows: [] as Record<string, unknown>[], error: null as string | null };

  return {
    ...emptyBundle({
      rooms: { rows: allRooms.rows, error: null, loading: false },
      threads: { rows: threadsQ.rows, error: threadsQ.error, loading: false },
      messages: { rows: messagesQ.rows, error: messagesQ.error, loading: false },
      notes: { rows: notesQ.rows, error: notesQ.error, loading: false },
    }),
    resolvedThreadId: threadIdToUse,
  };
}
