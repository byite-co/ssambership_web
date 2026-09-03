import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAdminUsersSearchOr, normalizeAdminListSearchTerm } from "@/lib/admin/adminDataTable";
import {
  MENTOR_ACTIVITY_ROW_LIMIT,
  MENTOR_ACTIVITY_TAB_VALUES,
  compareMentorActivityItems,
  mentorActivityMatchesTab,
  mentorActivityRowState,
  mentorUnansweredElapsed,
  resolveMentorLastActivity,
  type MentorActivityListItem,
  type MentorActivityTab,
  type MentorPendingEvent,
} from "@/lib/admin/mentorActivityConsole";
import { createServiceRoleClient } from "@/lib/supabase/admin";

/**
 * 멘토 활동(PR-11 §4) 서버 조회 — 승인된 멘토 전원(상한 500)을 한 번 읽고 담당 학생 · 미답변 · 최근 활동 · 검토 대기 이벤트를 붙인 뒤
 * **메모리에서** 탭·검색·정렬(미답변 오래된 순)·페이지를 적용한다. 계산값 정렬이라 서버 range 페이징을 쓰지 않는다(멘토 74명).
 *
 * `mentor_profiles` · `mentor_student_rooms` · `question_threads` · `mentor_activity_events` 는 본인 행 RLS 라 service_role 로 읽는다
 * (이관 전 `loadMentorActivityEvents` 와 같은 우회). 서비스 키가 없으면 error. 쓰기 없음.
 */

const PROFILE_COLUMNS = "user_id, verification_status, activity_status, pause_until, termination_effective_at, abandonment_flagged_at, updated_at";
const USER_COLUMNS = "id, full_name, nickname, email";
const ROOM_ROW_LIMIT = 5000;
const THREAD_ROW_LIMIT = 5000;
const ANSWERED_ROW_LIMIT = 2000;
const EVENT_ROW_LIMIT = 500;

type Row = Record<string, unknown>;

export type MentorActivityListResult = { rows: MentorActivityListItem[]; totalCount: number; error: string | null };
export type MentorActivityTabCounts = Record<MentorActivityTab, number>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

function serviceRoleOrNull(): SupabaseClient | null {
  try {
    return createServiceRoleClient();
  } catch {
    return null;
  }
}

type Aggregates = {
  studentCount: Map<string, number>;
  unansweredCount: Map<string, number>;
  oldestUnansweredAt: Map<string, string>;
  lastAnswerAt: Map<string, string>;
  pendingEvents: Map<string, MentorPendingEvent[]>;
};

async function loadAggregates(admin: SupabaseClient, mentorIds: ReadonlySet<string>): Promise<Aggregates> {
  const agg: Aggregates = { studentCount: new Map(), unansweredCount: new Map(), oldestUnansweredAt: new Map(), lastAnswerAt: new Map(), pendingEvents: new Map() };
  if (!mentorIds.size) return agg;

  // id 목록을 쿼리스트링에 싣지 않는다(멘토·방이 늘면 URL 상한을 넘는다) — 상한 안에서 전체를 읽고 메모리에서 매핑한다.
  const rooms = await admin.from("mentor_student_rooms").select("id, mentor_id").limit(ROOM_ROW_LIMIT);
  if (rooms.error) console.error("[loadMentorActivityList] mentor_student_rooms:", rooms.error.message);
  const roomMentor = new Map<string, string>();
  for (const r of (rooms.data as Row[] | null) ?? []) {
    const roomId = str(r.id);
    const mentorId = str(r.mentor_id);
    if (!roomId || !mentorIds.has(mentorId)) continue;
    roomMentor.set(roomId, mentorId);
    agg.studentCount.set(mentorId, (agg.studentCount.get(mentorId) ?? 0) + 1);
  }

  const [unanswered, answered, events] = await Promise.all([
    roomMentor.size
      ? admin.from("question_threads").select("mentor_student_room_id, created_at").is("first_answered_at", null).order("created_at", { ascending: true }).limit(THREAD_ROW_LIMIT)
      : Promise.resolve({ data: [] as Row[], error: null }),
    roomMentor.size
      ? admin.from("question_threads").select("mentor_student_room_id, first_answered_at").not("first_answered_at", "is", null).order("first_answered_at", { ascending: false }).limit(ANSWERED_ROW_LIMIT)
      : Promise.resolve({ data: [] as Row[], error: null }),
    admin.from("mentor_activity_events").select("id, mentor_id, event_type, reason, created_at").eq("status", "pending_review").order("created_at", { ascending: false }).limit(EVENT_ROW_LIMIT),
  ]);
  if (unanswered.error) console.error("[loadMentorActivityList] question_threads(unanswered):", unanswered.error.message);
  if (answered.error) console.error("[loadMentorActivityList] question_threads(answered):", answered.error.message);
  if (events.error) console.error("[loadMentorActivityList] mentor_activity_events:", events.error.message);

  for (const t of (unanswered.data as Row[] | null) ?? []) {
    const mentorId = roomMentor.get(str(t.mentor_student_room_id));
    if (!mentorId) continue;
    agg.unansweredCount.set(mentorId, (agg.unansweredCount.get(mentorId) ?? 0) + 1);
    const created = str(t.created_at);
    if (created && !agg.oldestUnansweredAt.has(mentorId)) agg.oldestUnansweredAt.set(mentorId, created); // created_at asc — 첫 행이 가장 오래됨
  }
  for (const t of (answered.data as Row[] | null) ?? []) {
    const mentorId = roomMentor.get(str(t.mentor_student_room_id));
    if (!mentorId) continue;
    const at = str(t.first_answered_at);
    if (at && !agg.lastAnswerAt.has(mentorId)) agg.lastAnswerAt.set(mentorId, at); // desc — 첫 행이 최신
  }
  for (const e of (events.data as Row[] | null) ?? []) {
    const mentorId = str(e.mentor_id);
    if (!mentorIds.has(mentorId)) continue;
    const list = agg.pendingEvents.get(mentorId) ?? [];
    list.push({ id: str(e.id), eventType: str(e.event_type), reason: strOrNull(e.reason), createdAt: strOrNull(e.created_at) });
    agg.pendingEvents.set(mentorId, list);
  }
  return agg;
}

async function loadAllItems(admin: SupabaseClient, now: Date): Promise<{ items: MentorActivityListItem[]; error: string | null }> {
  const { data, error } = await admin.from("mentor_profiles").select(PROFILE_COLUMNS).eq("verification_status", "approved").limit(MENTOR_ACTIVITY_ROW_LIMIT);
  if (error) return { items: [], error: error.message };
  const profiles = (data as Row[] | null) ?? [];
  const mentorIds = new Set(profiles.map((p) => str(p.user_id)).filter(Boolean));

  // 표시명은 users(role=mentor)를 상한 안에서 읽어 메모리 매핑 — id 목록을 쿼리에 싣지 않는다.
  const [users, agg] = await Promise.all([
    mentorIds.size ? admin.from("users").select(USER_COLUMNS).eq("role", "mentor").limit(MENTOR_ACTIVITY_ROW_LIMIT) : Promise.resolve({ data: [] as Row[], error: null }),
    loadAggregates(admin, mentorIds),
  ]);
  if (users.error) console.error("[loadMentorActivityList] users:", users.error.message);
  const userById = new Map<string, Row>();
  for (const u of (users.data as Row[] | null) ?? []) userById.set(str(u.id), u);

  const nowMs = now.getTime();
  const items = profiles.map((p): MentorActivityListItem => {
    const mentorId = str(p.user_id);
    const u = userById.get(mentorId);
    const oldest = agg.oldestUnansweredAt.get(mentorId) ?? null;
    const last = resolveMentorLastActivity(agg.lastAnswerAt.get(mentorId) ?? null, strOrNull(p.updated_at));
    return {
      mentorId,
      name: str(u?.full_name) || str(u?.nickname) || str(u?.email) || mentorId.slice(0, 8),
      email: strOrNull(u?.email),
      studentCount: agg.studentCount.get(mentorId) ?? 0,
      unansweredCount: agg.unansweredCount.get(mentorId) ?? 0,
      oldestUnansweredAt: oldest,
      elapsed: mentorUnansweredElapsed(oldest, nowMs),
      state: mentorActivityRowState({ activityStatus: strOrNull(p.activity_status), pauseUntil: strOrNull(p.pause_until), terminationEffectiveAt: strOrNull(p.termination_effective_at) }, now),
      activityStatusRaw: strOrNull(p.activity_status),
      pauseUntil: strOrNull(p.pause_until),
      terminationEffectiveAt: strOrNull(p.termination_effective_at),
      abandonmentFlaggedAt: strOrNull(p.abandonment_flagged_at),
      lastActivityAt: last.at,
      lastActivitySource: last.source,
      pendingEvents: agg.pendingEvents.get(mentorId) ?? [],
    };
  });
  return { items, error: null };
}

function matchesSearch(item: MentorActivityListItem, term: string): boolean {
  if (!term) return true;
  const t = term.toLowerCase();
  return item.name.toLowerCase().includes(t) || (item.email ?? "").toLowerCase().includes(t);
}

/** 닉네임 검색은 users(role=mentor) 검색 or()(이름·닉네임·이메일)로 id 집합을 얻어 거른다 — 표시명에 없는 닉네임도 맞는다. */
async function searchMentorIds(admin: SupabaseClient, term: string): Promise<Set<string> | null> {
  if (!term) return null;
  const { data, error } = await admin.from("users").select("id").eq("role", "mentor").or(buildAdminUsersSearchOr(term)).limit(MENTOR_ACTIVITY_ROW_LIMIT);
  if (error) {
    console.error("[loadMentorActivityList] users 검색 실패:", error.message);
    return null;
  }
  return new Set(((data as Row[] | null) ?? []).map((r) => str(r.id)).filter(Boolean));
}

export async function loadMentorActivityList(args: {
  tab: MentorActivityTab;
  search: string;
  page: number;
  pageSize: number;
  now?: Date;
}): Promise<{ list: MentorActivityListResult; counts: MentorActivityTabCounts }> {
  const counts = { active: 0, paused: 0, terminating: 0, abandoned: 0, all: 0 } as MentorActivityTabCounts;
  const admin = serviceRoleOrNull();
  if (!admin) return { list: { rows: [], totalCount: 0, error: "서비스 키가 없어 멘토 활동을 조회할 수 없습니다." }, counts };

  const now = args.now ?? new Date();
  const { items, error } = await loadAllItems(admin, now);
  if (error) return { list: { rows: [], totalCount: 0, error }, counts };

  for (const it of items) {
    for (const tab of MENTOR_ACTIVITY_TAB_VALUES) if (mentorActivityMatchesTab(tab, it.state, it.abandonmentFlaggedAt)) counts[tab] += 1;
  }

  const term = normalizeAdminListSearchTerm(args.search);
  const matchedIds = await searchMentorIds(admin, term);
  const filtered = items
    .filter((it) => mentorActivityMatchesTab(args.tab, it.state, it.abandonmentFlaggedAt))
    .filter((it) => (matchedIds ? matchedIds.has(it.mentorId) || matchesSearch(it, term) : matchesSearch(it, term)))
    .sort(compareMentorActivityItems);
  const from = Math.max(0, (args.page - 1) * args.pageSize);
  return { list: { rows: filtered.slice(from, from + args.pageSize), totalCount: filtered.length, error: null }, counts };
}
