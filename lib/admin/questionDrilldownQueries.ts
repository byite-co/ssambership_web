import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createSignedStorageUrl } from "@/lib/storage/signedStorageUrl";
import { fetchWeeklyQuestionUsagePairParty } from "@/lib/qna/weeklyQuestionUsage";
import type { WeeklyQuestionUsage } from "@/lib/qna/weeklyQuestionUsageDisplay";
import { getSubjectLabel } from "@/lib/subjects/subjectCatalog";
import type { DocumentViewerSource } from "@/lib/admin/documentViewerModel";
import {
  INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET_NAME,
  QUESTION_ATTACHMENT_SIGNED_URL_TTL_SEC,
  QUESTION_ROOM_ATTACHMENTS_BUCKET_NAME,
  SCAN_ANNOTATIONS_BUCKET_NAME,
  attachmentFileNameFromPath,
  buildAccountDrilldownReturnPath,
  buildAttachmentViewerSource,
  buildQuestionQualityMetrics,
  buildQuestionRoomUrl,
  connectionNoteAuthorRole,
  displayNameForRole,
  firstAnswerCell,
  individualAnsweringMentorId,
  individualEscrowState,
  individualRequirementLabel,
  isIndividualAwaitingAnswer,
  isThreadAwaitingAnswer,
  isThreadUnanswered,
  isWebRenderableImageMime,
  mentorDisplayName,
  pageRange,
  parseQuestionAttachmentStoredRef,
  resolveMessageAuthorRole,
  scanAnnotationDisplayPath,
  sortByCreatedAt,
  sortConnectionNotesChronologically,
  studentDisplayName,
  type ConversationMessage,
  type EscrowState,
  type FirstAnswerCell,
  type PartyIdentity,
  type PartyRole,
  type QuestionQualityMetrics,
} from "@/lib/admin/questionDrilldownConsole";

/**
 * 질문 · 연결노트 드릴다운(PR-8) 조회 — 전부 `service_role` 읽기, 쓰기 없음.
 *
 * - 읽기 경로는 PR-7 계정 상세 조회 모듈(`accountDetailQueries` · `accountStudentQueries`)과 같은 패턴이다: 페이지가 `serviceRoleOrNull()` 로
 *   서비스 롤 클라이언트를 만들어 넘기고, 못 만들면 처리하지 않는다(세션 폴백 없음 — `adminWriteClient` 의 fail-closed 관례).
 *   질문 테이블 다섯 개(`question_threads`·`question_messages`·`question_attachments`·`connection_notes`·`mentor_student_rooms`)에는
 *   관리자 RLS 정책이 없어(PR-7 확인 · 인벤토리 policies.json) 세션 클라이언트로는 0행이다.
 * - 이름은 `users` 한 번 조회(`loadPartyIdentities`)로 실명(학생)·닉네임(멘토)을 함께 가져온다(원칙 1).
 * - 첨부·필기 주석의 서명 URL 은 표시 시점에 여기서 발급한다(1h — 질문방 첨부 v2 계약과 같은 TTL). 개별 발급 실패는 `error` 로 강등, 페이지를 막지 않는다.
 * - 주간 사용량은 RPC `get_weekly_question_usage`(pair-party 레거시 경로 — service_role 통과, PR-7 학생 탭과 같은 호출).
 * - 열람 기록(`question_body_viewed`)은 이 모듈이 아니라 **페이지**가 남긴다(조회 모듈은 읽기 전용).
 */

type Row = Record<string, unknown>;

const ROOM_COLUMNS = "id, student_id, mentor_id, subscription_id, payment_id, created_at, updated_at";
const THREAD_COLUMNS = "id, mentor_student_room_id, title, status, subject, topic, is_wrong_answer, mastery_status, first_answered_at, confirmed_at, view_count, created_at, updated_at";
const THREAD_AGGREGATE_COLUMNS = "id, mentor_student_room_id, status, first_answered_at";
const MESSAGE_COLUMNS = "id, thread_id, author_id, body, created_at";
const ATTACHMENT_COLUMNS = "id, thread_id, message_id, author_id, storage_path, file_name, mime_type, created_at";
const NOTE_COLUMNS = "id, mentor_student_room_id, author_id, author_role, body, created_at, updated_at";
const ANNOTATION_COLUMNS = "id, mentor_student_room_id, author_id, author_role, scan_image_path, preview_path, has_annotations, created_at";
const SUBSCRIPTION_COLUMNS = "id, student_id, mentor_id, status, created_at, started_at, current_period_start";
const INDIVIDUAL_COLUMNS =
  "id, student_id, question_type, designated_mentor_id, claimed_mentor_id, claimed_at, subject, topic, title, body, price_cents, status, expires_at, answered_at, released_at, refunded_at, hold_ledger_id, release_ledger_id, refund_ledger_id, required_school_tier, required_major_category, created_at, updated_at";
const INDIVIDUAL_MESSAGE_COLUMNS = "id, question_id, author_id, body, created_at";
const INDIVIDUAL_ATTACHMENT_COLUMNS = "id, question_id, message_id, author_id, storage_path, file_name, mime_type, created_at";

export const QUESTION_READ_UNAVAILABLE_MESSAGE = "서비스 키가 없어 질문 데이터를 조회할 수 없습니다.";
const LOAD_ERROR = "질문 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function subjectLabelOf(code: unknown): string | null {
  const s = str(code);
  return s ? getSubjectLabel(s) : null;
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** PostgREST `.or()` 문자열에 끼워 넣는 id 는 uuid 형식만 — 필터 문법 문자(`,` `(` `)`)가 섞인 값을 걸러 낸다. */
function uuidOnly(ids: readonly string[]): string[] {
  return [...new Set(ids.map((v) => str(v)).filter((v) => UUID_PATTERN.test(v)))];
}

export function serviceRoleOrNull(): SupabaseClient | null {
  try {
    return createServiceRoleClient();
  } catch {
    return null;
  }
}

// ── 이름 ─────────────────────────────────────────────────────────────────────

export type IdentityMap = Map<string, PartyIdentity>;

/** `users` 에서 역할·실명·닉네임·이메일을 한 번에. 실패는 빈 맵(이름은 id 앞 8자로 강등, 화면은 막지 않는다). */
export async function loadPartyIdentities(db: SupabaseClient, ids: readonly (string | null | undefined)[]): Promise<IdentityMap> {
  const map: IdentityMap = new Map();
  const unique = [...new Set(ids.map((v) => str(v)).filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await db.from("users").select("id, role, full_name, nickname, email").in("id", unique);
  if (error) {
    console.error("[questionDrilldown] users 이름 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.id);
    if (!id) continue;
    map.set(id, { id, role: strOrNull(row.role), fullName: strOrNull(row.full_name), nickname: strOrNull(row.nickname), email: strOrNull(row.email) });
  }
  return map;
}

async function loadMentorSubjectLabels(db: SupabaseClient, mentorIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(mentorIds.filter(Boolean))];
  if (!unique.length) return out;
  const { data, error } = await db.from("mentor_profiles").select("user_id, teaching_subjects").in("user_id", unique);
  if (error) {
    console.error("[questionDrilldown] mentor_profiles 과목 조회 실패:", error.message);
    return out;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.user_id);
    const subjects = Array.isArray(row.teaching_subjects) ? (row.teaching_subjects as unknown[]).map((s) => str(s)).filter(Boolean) : [];
    if (id && subjects.length) out.set(id, subjects.map((s) => getSubjectLabel(s)).join(" · "));
  }
  return out;
}

// ── 개별질문 목록(§1 학생 · §6 멘토) ────────────────────────────────────────

export type IndividualQuestionListRow = {
  id: string;
  questionType: string;
  status: string;
  subjectLabel: string | null;
  title: string;
  priceCents: number;
  createdAt: string | null;
  answeredAt: string | null;
  expiresAt: string | null;
  studentId: string;
  /** 실명 */
  studentName: string;
  mentorId: string | null;
  /** 닉네임 — 공개형 미배정이면 null(`—`) */
  mentorName: string | null;
  firstAnswer: FirstAnswerCell;
};

export type IndividualQuestionList = { rows: IndividualQuestionListRow[]; totalCount: number; error: string | null };

function toIndividualListRow(row: Row, names: IdentityMap, now: number): IndividualQuestionListRow {
  const studentId = str(row.student_id);
  const mentorId = individualAnsweringMentorId({
    question_type: strOrNull(row.question_type),
    designated_mentor_id: strOrNull(row.designated_mentor_id),
    claimed_mentor_id: strOrNull(row.claimed_mentor_id),
  });
  const status = str(row.status);
  return {
    id: str(row.id),
    questionType: str(row.question_type),
    status,
    subjectLabel: subjectLabelOf(row.subject),
    title: str(row.title) || "(제목 없음)",
    priceCents: numOrNull(row.price_cents) ?? 0,
    createdAt: strOrNull(row.created_at),
    answeredAt: strOrNull(row.answered_at),
    expiresAt: strOrNull(row.expires_at),
    studentId,
    studentName: studentDisplayName(names.get(studentId), studentId),
    mentorId,
    mentorName: mentorId ? mentorDisplayName(names.get(mentorId), mentorId) : null,
    firstAnswer: firstAnswerCell({ createdAt: strOrNull(row.created_at), answeredAt: strOrNull(row.answered_at), awaiting: isIndividualAwaitingAnswer(status) }, now),
  };
}

/**
 * 계정의 개별질문 — 학생이면 구매한 건(`student_id`), 멘토면 지정·수락한 건(`designated_mentor_id` 또는 `claimed_mentor_id`). 만료·환불 건도 남긴다.
 */
export async function loadIndividualQuestionsForAccount(
  db: SupabaseClient,
  input: { role: "student" | "mentor"; userId: string; page: number; pageSize: number; now?: number }
): Promise<IndividualQuestionList> {
  const { from, to } = pageRange(input.page, input.pageSize);
  const userId = str(input.userId);
  if (!UUID_PATTERN.test(userId)) return { rows: [], totalCount: 0, error: null };
  let query = db.from("individual_questions").select(INDIVIDUAL_COLUMNS, { count: "exact" });
  query = input.role === "student" ? query.eq("student_id", userId) : query.or(`designated_mentor_id.eq.${userId},claimed_mentor_id.eq.${userId}`);
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to);
  if (error) {
    console.error("[questionDrilldown] individual_questions:", error.message);
    return { rows: [], totalCount: 0, error: LOAD_ERROR };
  }
  const raw = (data as Row[] | null) ?? [];
  const names = await loadPartyIdentities(
    db,
    raw.flatMap((r) => [str(r.student_id), str(r.designated_mentor_id), str(r.claimed_mentor_id)])
  );
  const now = input.now ?? Date.now();
  return { rows: raw.map((r) => toIndividualListRow(r, names, now)), totalCount: count ?? raw.length, error: null };
}

// ── 방 목록(§2 학생의 구독 멘토 · §5 멘토의 담당 학생) ─────────────────────

export type RoomListRow = {
  roomId: string;
  counterpartId: string;
  /** 학생 쪽 목록이면 멘토 닉네임, 멘토 쪽 목록이면 학생 실명 */
  counterpartName: string;
  /** 멘토의 담당 과목(mentor_profiles.teaching_subjects) — 없으면 null */
  subjectLabel: string | null;
  subscriptionStartAt: string | null;
  /** `subscriptions.status` — 구독 행이 없으면 null(해지됨) */
  subscriptionStatus: string | null;
  questionCount: number;
  unansweredCount: number;
  lastActivityAt: string | null;
};

export type RoomList = { rows: RoomListRow[]; totalCount: number; error: string | null };

type SubscriptionLite = { id: string; studentId: string; mentorId: string; status: string; startAt: string | null; createdAt: string | null };

function subscriptionStart(row: Row): string | null {
  return strOrNull(row.started_at) ?? strOrNull(row.current_period_start) ?? strOrNull(row.created_at);
}

/** 방 ↔ 구독 매칭 — 방의 `subscription_id` 와 같은 행이 우선, 없으면 같은 학생×멘토 쌍의 최신 행(해지 후에도 이력이 남는다). */
function pickSubscriptionForRoom(room: { subscriptionId: string | null; studentId: string; mentorId: string }, subs: readonly SubscriptionLite[]): SubscriptionLite | null {
  if (room.subscriptionId) {
    const exact = subs.find((s) => s.id === room.subscriptionId);
    if (exact) return exact;
  }
  return subs.find((s) => s.studentId === room.studentId && s.mentorId === room.mentorId) ?? null;
}

async function loadSubscriptionsForPairs(db: SupabaseClient, input: { role: "student" | "mentor"; userId: string; counterpartIds: readonly string[]; subscriptionIds: readonly string[] }): Promise<SubscriptionLite[]> {
  const counterparts = uuidOnly(input.counterpartIds);
  const subIds = uuidOnly(input.subscriptionIds);
  const userId = str(input.userId);
  if ((!counterparts.length && !subIds.length) || !UUID_PATTERN.test(userId)) return [];
  const ownColumn = input.role === "student" ? "student_id" : "mentor_id";
  const otherColumn = input.role === "student" ? "mentor_id" : "student_id";
  const filters: string[] = [];
  if (counterparts.length) filters.push(`and(${ownColumn}.eq.${userId},${otherColumn}.in.(${counterparts.join(",")}))`);
  if (subIds.length) filters.push(`id.in.(${subIds.join(",")})`);
  const { data, error } = await db.from("subscriptions").select(SUBSCRIPTION_COLUMNS).or(filters.join(",")).order("created_at", { ascending: false });
  if (error) {
    console.error("[questionDrilldown] subscriptions:", error.message);
    return [];
  }
  return ((data as Row[] | null) ?? []).map((r) => ({
    id: str(r.id),
    studentId: str(r.student_id),
    mentorId: str(r.mentor_id),
    status: str(r.status),
    startAt: subscriptionStart(r),
    createdAt: strOrNull(r.created_at),
  }));
}

type ThreadAggregate = { questionCount: number; unansweredCount: number; threadIds: string[] };

async function loadThreadAggregatesByRoom(db: SupabaseClient, roomIds: readonly string[]): Promise<Map<string, ThreadAggregate>> {
  const out = new Map<string, ThreadAggregate>();
  if (!roomIds.length) return out;
  const { data, error } = await db.from("question_threads").select(THREAD_AGGREGATE_COLUMNS).in("mentor_student_room_id", roomIds);
  if (error) {
    console.error("[questionDrilldown] question_threads(집계):", error.message);
    return out;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const roomId = str(row.mentor_student_room_id);
    const id = str(row.id);
    if (!roomId || !id) continue;
    const agg = out.get(roomId) ?? { questionCount: 0, unansweredCount: 0, threadIds: [] };
    agg.questionCount += 1;
    if (isThreadUnanswered({ status: strOrNull(row.status), first_answered_at: strOrNull(row.first_answered_at) })) agg.unansweredCount += 1;
    agg.threadIds.push(id);
    out.set(roomId, agg);
  }
  return out;
}

/** 방의 마지막 메시지 시각 — 스레드 id 집합으로 1건만. 스레드가 없으면 null. */
async function loadLastMessageAt(db: SupabaseClient, threadIds: readonly string[]): Promise<string | null> {
  if (!threadIds.length) return null;
  const { data, error } = await db.from("question_messages").select("created_at").in("thread_id", threadIds).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    console.error("[questionDrilldown] question_messages(최근):", error.message);
    return null;
  }
  return strOrNull((data as Row | null)?.created_at);
}

/**
 * 계정의 방 목록 — `mentor_student_rooms` 기준(해지된 방도 남긴다). 구독 상태·시작은 매칭된 `subscriptions` 행, 질문 수·미답변은 `question_threads` 집계,
 * 최종 활동은 마지막 메시지 `created_at`.
 */
export async function loadRoomsForAccount(db: SupabaseClient, input: { role: "student" | "mentor"; userId: string; page: number; pageSize: number }): Promise<RoomList> {
  const { from, to } = pageRange(input.page, input.pageSize);
  const ownColumn = input.role === "student" ? "student_id" : "mentor_id";
  const { data, error, count } = await db.from("mentor_student_rooms").select(ROOM_COLUMNS, { count: "exact" }).eq(ownColumn, input.userId).order("created_at", { ascending: false }).range(from, to);
  if (error) {
    console.error("[questionDrilldown] mentor_student_rooms:", error.message);
    return { rows: [], totalCount: 0, error: LOAD_ERROR };
  }
  const rooms = ((data as Row[] | null) ?? []).map((r) => ({
    id: str(r.id),
    studentId: str(r.student_id),
    mentorId: str(r.mentor_id),
    subscriptionId: strOrNull(r.subscription_id),
    createdAt: strOrNull(r.created_at),
  }));
  const counterpartOf = (room: (typeof rooms)[number]) => (input.role === "student" ? room.mentorId : room.studentId);
  const counterpartIds = rooms.map(counterpartOf);
  const mentorIds = rooms.map((r) => r.mentorId);
  const [names, subjects, subs, aggregates] = await Promise.all([
    loadPartyIdentities(db, counterpartIds),
    loadMentorSubjectLabels(db, mentorIds),
    loadSubscriptionsForPairs(db, { role: input.role, userId: input.userId, counterpartIds, subscriptionIds: rooms.map((r) => r.subscriptionId ?? "") }),
    loadThreadAggregatesByRoom(db, rooms.map((r) => r.id)),
  ]);
  const lastMessageAts = await Promise.all(rooms.map((room) => loadLastMessageAt(db, aggregates.get(room.id)?.threadIds ?? [])));

  return {
    rows: rooms.map((room, idx) => {
      const counterpartId = counterpartOf(room);
      const sub = pickSubscriptionForRoom(room, subs);
      const agg = aggregates.get(room.id);
      return {
        roomId: room.id,
        counterpartId,
        counterpartName: input.role === "student" ? mentorDisplayName(names.get(counterpartId), counterpartId) : studentDisplayName(names.get(counterpartId), counterpartId),
        subjectLabel: subjects.get(room.mentorId) ?? null,
        subscriptionStartAt: sub?.startAt ?? null,
        subscriptionStatus: sub?.status ?? null,
        questionCount: agg?.questionCount ?? 0,
        unansweredCount: agg?.unansweredCount ?? 0,
        lastActivityAt: lastMessageAts[idx],
      };
    }),
    totalCount: count ?? rooms.length,
    error: null,
  };
}

// ── 멘토별 화면(§3) ──────────────────────────────────────────────────────────

export type QuestionRoomOverview = {
  room: { id: string; studentId: string; mentorId: string; subscriptionId: string | null; createdAt: string | null };
  /** 실명 */
  studentName: string;
  /** 닉네임 */
  mentorName: string;
  subjectLabel: string | null;
  subscription: { status: string | null; startAt: string | null };
  questionCount: number;
  unansweredCount: number;
  lastActivityAt: string | null;
  usage: WeeklyQuestionUsage | null;
  usageError: string | null;
};

export async function loadQuestionRoomOverview(db: SupabaseClient, roomId: string): Promise<{ overview: QuestionRoomOverview | null; error: string | null }> {
  const id = str(roomId);
  if (!id) return { overview: null, error: null };
  const { data, error } = await db.from("mentor_student_rooms").select(ROOM_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[questionDrilldown] mentor_student_rooms(1건):", error.message);
    return { overview: null, error: LOAD_ERROR };
  }
  const row = data as Row | null;
  if (!row) return { overview: null, error: null };
  const room = { id: str(row.id), studentId: str(row.student_id), mentorId: str(row.mentor_id), subscriptionId: strOrNull(row.subscription_id), createdAt: strOrNull(row.created_at) };

  const [names, subjects, subs, aggregates, usage] = await Promise.all([
    loadPartyIdentities(db, [room.studentId, room.mentorId]),
    loadMentorSubjectLabels(db, [room.mentorId]),
    loadSubscriptionsForPairs(db, { role: "student", userId: room.studentId, counterpartIds: [room.mentorId], subscriptionIds: [room.subscriptionId ?? ""] }),
    loadThreadAggregatesByRoom(db, [room.id]),
    fetchWeeklyQuestionUsagePairParty(db, room.studentId, room.mentorId),
  ]);
  if (usage.error) console.error("[questionDrilldown] get_weekly_question_usage:", usage.error);
  const agg = aggregates.get(room.id);
  const sub = pickSubscriptionForRoom(room, subs);
  const lastActivityAt = await loadLastMessageAt(db, agg?.threadIds ?? []);

  return {
    overview: {
      room,
      studentName: studentDisplayName(names.get(room.studentId), room.studentId),
      mentorName: mentorDisplayName(names.get(room.mentorId), room.mentorId),
      subjectLabel: subjects.get(room.mentorId) ?? null,
      subscription: { status: sub?.status ?? null, startAt: sub?.startAt ?? null },
      questionCount: agg?.questionCount ?? 0,
      unansweredCount: agg?.unansweredCount ?? 0,
      lastActivityAt,
      usage: usage.error ? null : usage.usage,
      usageError: usage.error ? "이번 주 사용량을 불러오지 못했습니다." : null,
    },
    error: null,
  };
}

export type RoomThreadRow = {
  id: string;
  title: string;
  status: string;
  subjectLabel: string | null;
  topic: string | null;
  createdAt: string | null;
  firstAnsweredAt: string | null;
  confirmedAt: string | null;
  isWrongAnswer: boolean;
  masteryStatus: string | null;
  viewCount: number | null;
  /** 왕복 = 스레드 메시지 수 */
  messageCount: number;
  firstAnswer: FirstAnswerCell;
};

export type RoomThreadList = { rows: RoomThreadRow[]; totalCount: number; error: string | null };

async function countMessagesByThread(db: SupabaseClient, threadIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!threadIds.length) return out;
  const { data, error } = await db.from("question_messages").select("thread_id").in("thread_id", threadIds);
  if (error) {
    console.error("[questionDrilldown] question_messages(건수):", error.message);
    return out;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.thread_id);
    if (id) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/** 방의 질문(스레드) 목록 — 최신순 페이지 + 스레드별 메시지 수. */
export async function loadRoomThreads(db: SupabaseClient, roomId: string, input: { page: number; pageSize: number; now?: number }): Promise<RoomThreadList> {
  const { from, to } = pageRange(input.page, input.pageSize);
  const { data, error, count } = await db.from("question_threads").select(THREAD_COLUMNS, { count: "exact" }).eq("mentor_student_room_id", roomId).order("created_at", { ascending: false }).range(from, to);
  if (error) {
    console.error("[questionDrilldown] question_threads:", error.message);
    return { rows: [], totalCount: 0, error: LOAD_ERROR };
  }
  const raw = (data as Row[] | null) ?? [];
  const counts = await countMessagesByThread(db, raw.map((r) => str(r.id)));
  const now = input.now ?? Date.now();
  return {
    rows: raw.map((r) => {
      const status = strOrNull(r.status);
      const firstAnsweredAt = strOrNull(r.first_answered_at);
      return {
        id: str(r.id),
        title: str(r.title) || "(제목 없음)",
        status: status ?? "",
        subjectLabel: subjectLabelOf(r.subject),
        topic: strOrNull(r.topic),
        createdAt: strOrNull(r.created_at),
        firstAnsweredAt,
        confirmedAt: strOrNull(r.confirmed_at),
        isWrongAnswer: r.is_wrong_answer === true,
        masteryStatus: strOrNull(r.mastery_status),
        viewCount: numOrNull(r.view_count),
        messageCount: counts.get(str(r.id)) ?? 0,
        firstAnswer: firstAnswerCell({ createdAt: strOrNull(r.created_at), answeredAt: firstAnsweredAt, awaiting: isThreadAwaitingAnswer({ status, first_answered_at: firstAnsweredAt }) }, now),
      };
    }),
    totalCount: count ?? raw.length,
    error: null,
  };
}

export type ConnectionNoteView = {
  id: string;
  authorId: string | null;
  authorRole: "mentor" | "student" | "unknown";
  authorName: string;
  body: string;
  createdAt: string | null;
};

/** 연결노트 — `created_at` 순 전부(건수 가정 없음). 작성자 이름은 역할 규칙(멘토 닉네임 · 학생 실명). */
export async function loadRoomConnectionNotes(db: SupabaseClient, roomId: string, party: { studentId: string; mentorId: string }): Promise<{ rows: ConnectionNoteView[]; error: string | null }> {
  const { data, error } = await db.from("connection_notes").select(NOTE_COLUMNS).eq("mentor_student_room_id", roomId).order("created_at", { ascending: true });
  if (error) {
    console.error("[questionDrilldown] connection_notes:", error.message);
    return { rows: [], error: "연결노트를 불러오지 못했습니다." };
  }
  const raw = ((data as Row[] | null) ?? []).map((r) => ({
    id: str(r.id),
    author_id: strOrNull(r.author_id),
    author_role: strOrNull(r.author_role),
    body: strOrNull(r.body),
    created_at: strOrNull(r.created_at),
  }));
  const names = await loadPartyIdentities(db, raw.map((r) => r.author_id));
  return {
    rows: sortConnectionNotesChronologically(raw).map((r) => {
      const declared = connectionNoteAuthorRole(r);
      const role: PartyRole = declared === "unknown" ? resolveMessageAuthorRole(r.author_id, party, names.get(r.author_id ?? "")?.role) : declared;
      return {
        id: r.id,
        authorId: r.author_id,
        authorRole: declared === "unknown" && (role === "mentor" || role === "student") ? role : declared,
        authorName: displayNameForRole(role, names.get(r.author_id ?? ""), r.author_id),
        body: r.body ?? "",
        createdAt: r.created_at,
      };
    }),
    error: null,
  };
}

// ── 질문 상세(§4 구독·개별 공통) ─────────────────────────────────────────────

export type ConversationMessageView = ConversationMessage & { authorName: string };

export type QuestionAttachmentView = {
  id: string;
  messageId: string | null;
  authorId: string | null;
  fileName: string;
  mimeType: string | null;
  isImage: boolean;
  createdAt: string | null;
  source: DocumentViewerSource;
};

export type ScanAnnotationView = {
  id: string;
  authorRole: PartyRole;
  authorName: string;
  createdAt: string | null;
  /** 주석이 구워진 미리보기(`preview_path`)인가 — 아니면 원본 스캔 */
  annotated: boolean;
  source: DocumentViewerSource;
};

export type QuestionConversation = {
  kind: "thread" | "individual";
  id: string;
  title: string;
  subjectLabel: string | null;
  topic: string | null;
  createdAt: string | null;
  status: string;
  party: { studentId: string | null; mentorId: string | null; studentName: string; mentorName: string | null };
  roomId: string | null;
  messages: ConversationMessageView[];
  attachments: QuestionAttachmentView[];
  annotations: ScanAnnotationView[];
  metrics: QuestionQualityMetrics;
  thread: { isWrongAnswer: boolean; masteryStatus: string | null; firstAnsweredAt: string | null; confirmedAt: string | null; viewCount: number | null } | null;
  individual: {
    questionType: string;
    priceCents: number;
    escrow: EscrowState;
    requirementLabel: string;
    expiresAt: string | null;
    answeredAt: string | null;
    claimedAt: string | null;
    releasedAt: string | null;
    refundedAt: string | null;
  } | null;
  /** `returnTo` 가 없거나 허용 밖일 때 돌아갈 곳 — 구독질문은 멘토별 화면, 개별질문은 학생의 개별질문 탭 */
  defaultReturnPath: string;
};

async function signAttachment(db: SupabaseClient, bucket: string, path: string, mimeType: string | null): Promise<DocumentViewerSource> {
  const issuedAt = Date.now();
  const signed = await createSignedStorageUrl(db, bucket, path, QUESTION_ATTACHMENT_SIGNED_URL_TTL_SEC);
  if (signed.error) console.error("[questionDrilldown] 서명 URL 실패:", bucket, signed.error);
  return buildAttachmentViewerSource({ bucket, path, signedUrl: signed.url, mimeType, issuedAt });
}

async function toAttachmentViews(db: SupabaseClient, bucket: string, rows: readonly Row[]): Promise<QuestionAttachmentView[]> {
  const views = await Promise.all(
    rows.map(async (r): Promise<QuestionAttachmentView | null> => {
      const id = str(r.id);
      const path = str(r.storage_path);
      if (!id || !path) return null;
      const mimeType = strOrNull(r.mime_type);
      return {
        id,
        messageId: strOrNull(r.message_id),
        authorId: strOrNull(r.author_id),
        fileName: strOrNull(r.file_name) ?? attachmentFileNameFromPath(path),
        mimeType,
        isImage: isWebRenderableImageMime(mimeType),
        createdAt: strOrNull(r.created_at),
        source: await signAttachment(db, bucket, path, mimeType),
      };
    })
  );
  return sortByCreatedAt(views.filter((v): v is QuestionAttachmentView => v !== null));
}

async function loadScanAnnotations(db: SupabaseClient, roomId: string, party: { studentId: string | null; mentorId: string | null }, names: IdentityMap): Promise<ScanAnnotationView[]> {
  const { data, error } = await db.from("scan_annotations").select(ANNOTATION_COLUMNS).eq("mentor_student_room_id", roomId).order("created_at", { ascending: true });
  if (error) {
    console.error("[questionDrilldown] scan_annotations:", error.message);
    return [];
  }
  const rows = (data as Row[] | null) ?? [];
  const views = await Promise.all(
    rows.map(async (r): Promise<ScanAnnotationView | null> => {
      const id = str(r.id);
      const display = scanAnnotationDisplayPath({ scan_image_path: strOrNull(r.scan_image_path), preview_path: strOrNull(r.preview_path), has_annotations: boolOrNull(r.has_annotations) });
      if (!id || !display) return null;
      const authorId = strOrNull(r.author_id);
      const declared = str(r.author_role).toLowerCase();
      const role: PartyRole = declared === "mentor" || declared === "student" ? declared : resolveMessageAuthorRole(authorId, party, names.get(authorId ?? "")?.role);
      return {
        id,
        authorRole: role,
        authorName: displayNameForRole(role, names.get(authorId ?? ""), authorId),
        createdAt: strOrNull(r.created_at),
        annotated: display.annotated,
        source: await signAttachment(db, SCAN_ANNOTATIONS_BUCKET_NAME, display.path, null),
      };
    })
  );
  return sortByCreatedAt(views.filter((v): v is ScanAnnotationView => v !== null));
}

/** 구독질문 상세 — 스레드 + 방 + 메시지 전문 + 첨부(서명) + 방의 필기 주석(서명) + 품질 지표. */
export async function loadQuestionThreadConversation(db: SupabaseClient, threadId: string): Promise<{ conversation: QuestionConversation | null; error: string | null }> {
  const id = str(threadId);
  if (!id) return { conversation: null, error: null };
  const { data, error } = await db.from("question_threads").select(THREAD_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[questionDrilldown] question_threads(1건):", error.message);
    return { conversation: null, error: LOAD_ERROR };
  }
  const thread = data as Row | null;
  if (!thread) return { conversation: null, error: null };
  const roomId = str(thread.mentor_student_room_id);

  const [roomResp, messagesResp, attachmentsResp] = await Promise.all([
    db.from("mentor_student_rooms").select(ROOM_COLUMNS).eq("id", roomId).maybeSingle(),
    db.from("question_messages").select(MESSAGE_COLUMNS).eq("thread_id", id).order("created_at", { ascending: true }),
    db.from("question_attachments").select(ATTACHMENT_COLUMNS).eq("thread_id", id).order("created_at", { ascending: true }),
  ]);
  if (roomResp.error) console.error("[questionDrilldown] mentor_student_rooms(상세):", roomResp.error.message);
  if (messagesResp.error) {
    console.error("[questionDrilldown] question_messages:", messagesResp.error.message);
    return { conversation: null, error: LOAD_ERROR };
  }
  if (attachmentsResp.error) console.error("[questionDrilldown] question_attachments:", attachmentsResp.error.message);

  const room = roomResp.data as Row | null;
  const party = { studentId: strOrNull(room?.student_id), mentorId: strOrNull(room?.mentor_id) };
  const rawMessages = (messagesResp.data as Row[] | null) ?? [];
  const rawAttachments = (attachmentsResp.data as Row[] | null) ?? [];
  const names = await loadPartyIdentities(db, [party.studentId, party.mentorId, ...rawMessages.map((m) => str(m.author_id)), ...rawAttachments.map((a) => str(a.author_id))]);

  const messages: ConversationMessageView[] = sortByCreatedAt(
    rawMessages.map((m) => {
      const authorId = strOrNull(m.author_id);
      const role = resolveMessageAuthorRole(authorId, party, names.get(authorId ?? "")?.role);
      return { id: str(m.id), authorId, authorRole: role, authorName: displayNameForRole(role, names.get(authorId ?? ""), authorId), body: str(m.body), createdAt: strOrNull(m.created_at) };
    })
  );
  const [attachments, annotations] = await Promise.all([toAttachmentViews(db, QUESTION_ROOM_ATTACHMENTS_BUCKET_NAME, rawAttachments), roomId ? loadScanAnnotations(db, roomId, party, names) : Promise.resolve([])]);

  const firstAnsweredAt = strOrNull(thread.first_answered_at);
  const confirmedAt = strOrNull(thread.confirmed_at);
  return {
    conversation: {
      kind: "thread",
      id,
      title: str(thread.title) || "(제목 없음)",
      subjectLabel: subjectLabelOf(thread.subject),
      topic: strOrNull(thread.topic),
      createdAt: strOrNull(thread.created_at),
      status: str(thread.status),
      party: {
        ...party,
        studentName: studentDisplayName(party.studentId ? names.get(party.studentId) : null, party.studentId),
        mentorName: party.mentorId ? mentorDisplayName(names.get(party.mentorId), party.mentorId) : null,
      },
      roomId: roomId || null,
      messages,
      attachments,
      annotations,
      metrics: buildQuestionQualityMetrics({ createdAt: strOrNull(thread.created_at), firstAnsweredAt, confirmedAt, messages }),
      thread: { isWrongAnswer: thread.is_wrong_answer === true, masteryStatus: strOrNull(thread.mastery_status), firstAnsweredAt, confirmedAt, viewCount: numOrNull(thread.view_count) },
      individual: null,
      defaultReturnPath: roomId ? buildQuestionRoomUrl(roomId) : "/admin/users",
    },
    error: null,
  };
}

/** 개별질문 상세 — 질문 본문(첫 메시지로) + 후속 메시지 + 첨부(서명) + 요약 필드 + 품질 지표. */
export async function loadIndividualQuestionConversation(db: SupabaseClient, questionId: string): Promise<{ conversation: QuestionConversation | null; error: string | null }> {
  const id = str(questionId);
  if (!id) return { conversation: null, error: null };
  const { data, error } = await db.from("individual_questions").select(INDIVIDUAL_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[questionDrilldown] individual_questions(1건):", error.message);
    return { conversation: null, error: LOAD_ERROR };
  }
  const q = data as Row | null;
  if (!q) return { conversation: null, error: null };

  const [messagesResp, attachmentsResp] = await Promise.all([
    db.from("individual_question_messages").select(INDIVIDUAL_MESSAGE_COLUMNS).eq("question_id", id).order("created_at", { ascending: true }),
    db.from("individual_question_attachments").select(INDIVIDUAL_ATTACHMENT_COLUMNS).eq("question_id", id).order("created_at", { ascending: true }),
  ]);
  if (messagesResp.error) {
    console.error("[questionDrilldown] individual_question_messages:", messagesResp.error.message);
    return { conversation: null, error: LOAD_ERROR };
  }
  if (attachmentsResp.error) console.error("[questionDrilldown] individual_question_attachments:", attachmentsResp.error.message);

  const studentId = str(q.student_id);
  const mentorId = individualAnsweringMentorId({ question_type: strOrNull(q.question_type), designated_mentor_id: strOrNull(q.designated_mentor_id), claimed_mentor_id: strOrNull(q.claimed_mentor_id) });
  const party = { studentId: studentId || null, mentorId };
  const rawMessages = (messagesResp.data as Row[] | null) ?? [];
  const rawAttachments = (attachmentsResp.data as Row[] | null) ?? [];
  const names = await loadPartyIdentities(db, [studentId, mentorId, str(q.designated_mentor_id), str(q.claimed_mentor_id), ...rawMessages.map((m) => str(m.author_id))]);

  // 질문 본문(`individual_questions.body`)이 대화의 첫 메시지 — 학생이 쓴 것.
  const opening: ConversationMessageView = {
    id: `question-${id}`,
    authorId: studentId || null,
    authorRole: "student",
    authorName: studentDisplayName(names.get(studentId), studentId),
    body: str(q.body),
    createdAt: strOrNull(q.created_at),
  };
  const followUps: ConversationMessageView[] = rawMessages.map((m) => {
    const authorId = strOrNull(m.author_id);
    const role = resolveMessageAuthorRole(authorId, party, names.get(authorId ?? "")?.role);
    return { id: str(m.id), authorId, authorRole: role, authorName: displayNameForRole(role, names.get(authorId ?? ""), authorId), body: str(m.body), createdAt: strOrNull(m.created_at) };
  });
  const messages = [opening, ...sortByCreatedAt(followUps)];
  const attachments = await toAttachmentViews(db, INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET_NAME, rawAttachments);
  const answeredAt = strOrNull(q.answered_at);

  return {
    conversation: {
      kind: "individual",
      id,
      title: str(q.title) || "(제목 없음)",
      subjectLabel: subjectLabelOf(q.subject),
      topic: strOrNull(q.topic),
      createdAt: strOrNull(q.created_at),
      status: str(q.status),
      party: {
        ...party,
        studentName: opening.authorName,
        mentorName: mentorId ? mentorDisplayName(names.get(mentorId), mentorId) : null,
      },
      roomId: null,
      messages,
      attachments,
      annotations: [],
      metrics: buildQuestionQualityMetrics({ createdAt: strOrNull(q.created_at), firstAnsweredAt: answeredAt, confirmedAt: null, messages }),
      thread: null,
      individual: {
        questionType: str(q.question_type),
        priceCents: numOrNull(q.price_cents) ?? 0,
        escrow: individualEscrowState({ status: strOrNull(q.status), hold_ledger_id: strOrNull(q.hold_ledger_id), release_ledger_id: strOrNull(q.release_ledger_id), refund_ledger_id: strOrNull(q.refund_ledger_id) }),
        requirementLabel: individualRequirementLabel({ required_school_tier: strOrNull(q.required_school_tier), required_major_category: strOrNull(q.required_major_category) }),
        expiresAt: strOrNull(q.expires_at),
        answeredAt,
        claimedAt: strOrNull(q.claimed_at),
        releasedAt: strOrNull(q.released_at),
        refundedAt: strOrNull(q.refunded_at),
      },
      defaultReturnPath: studentId ? buildAccountDrilldownReturnPath(studentId, "individual") : "/admin/users",
    },
    error: null,
  };
}

// ── 뷰어 재요청(서버 액션이 호출) ────────────────────────────────────────────

const METADATA_LIST_LIMIT = 50;

async function readStorageMetadata(db: SupabaseClient, bucket: string, path: string): Promise<{ mimeType: string | null; sizeBytes: number | null }> {
  const idx = path.lastIndexOf("/");
  const dir = idx < 0 ? "" : path.slice(0, idx);
  const fileName = idx < 0 ? path : path.slice(idx + 1);
  try {
    const { data, error } = await db.storage.from(bucket).list(dir, { limit: METADATA_LIST_LIMIT, search: fileName });
    if (error || !Array.isArray(data)) return { mimeType: null, sizeBytes: null };
    const hit = (data as { name?: string | null; metadata?: { mimetype?: unknown; size?: unknown } | null }[]).find((item) => item.name === fileName) ?? null;
    const mimeType = typeof hit?.metadata?.mimetype === "string" && hit.metadata.mimetype.trim() ? hit.metadata.mimetype.trim() : null;
    return { mimeType, sizeBytes: numOrNull(hit?.metadata?.size) };
  } catch {
    return { mimeType: null, sizeBytes: null };
  }
}

/** `bucket/path`(허용 3종) → 새 서명 URL + 메타. 파싱 불가·발급 실패도 throw 하지 않고 `error` 로. */
export async function describeQuestionAttachmentDocument(db: SupabaseClient, storedRef: string): Promise<DocumentViewerSource> {
  const ref = parseQuestionAttachmentStoredRef(storedRef);
  if (!ref) {
    return { storedRef, storagePath: null, signedUrl: null, mimeType: null, sizeBytes: null, kind: "unknown", expiresAt: null, error: "첨부 경로를 해석할 수 없습니다. 허용된 버킷이 아닙니다." };
  }
  const meta = await readStorageMetadata(db, ref.bucket, ref.path);
  const source = await signAttachment(db, ref.bucket, ref.path, meta.mimeType);
  return { ...source, sizeBytes: meta.sizeBytes };
}
