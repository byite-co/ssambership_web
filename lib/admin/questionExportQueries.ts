import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSubjectLabel } from "@/lib/subjects/subjectCatalog";
import {
  attachmentFileNameFromPath,
  buildQuestionQualityMetrics,
  displayNameForRole,
  individualAnsweringMentorId,
  individualEscrowState,
  mentorDisplayName,
  resolveMessageAuthorRole,
  sortByCreatedAt,
  studentDisplayName,
  type ConversationMessage,
  type PartyRole,
} from "@/lib/admin/questionDrilldownConsole";
import { loadPartyIdentities, type IdentityMap } from "@/lib/admin/questionDrilldownQueries";
import { QUESTION_EXPORT_LIMIT, questionExportKind, type QuestionExportAttachment, type QuestionExportRecord, type QuestionExportScope } from "@/lib/admin/questionExportConsole";

/**
 * 질문 내보내기(PR-13 §2) 조회 — PR-8 드릴다운 조회와 **같은 service_role 경로 · 같은 조건**(계정·방 단위, `created_at desc`), 쓰기 없음.
 * 목록이 페이지로 나눠 보여주던 것을 상한 200건까지 한 번에 읽고, 본문(메시지 전문)·첨부 **파일명**만 함께 읽는다(서명 URL 발급 없음 — 파일 반출 아님).
 * 이름은 PR-8 의 `loadPartyIdentities`(학생 실명 · 멘토 닉네임)를 그대로 쓴다. 감사 로그는 라우트가 남긴다(조회 모듈은 읽기 전용).
 */

type Row = Record<string, unknown>;

const THREAD_COLUMNS = "id, mentor_student_room_id, title, status, subject, topic, first_answered_at, confirmed_at, created_at";
const THREAD_MESSAGE_COLUMNS = "id, thread_id, author_id, body, created_at";
const THREAD_ATTACHMENT_COLUMNS = "id, thread_id, message_id, storage_path, file_name, created_at";
const INDIVIDUAL_COLUMNS = "id, student_id, question_type, designated_mentor_id, claimed_mentor_id, subject, title, body, price_cents, status, answered_at, hold_ledger_id, release_ledger_id, refund_ledger_id, created_at";
const INDIVIDUAL_MESSAGE_COLUMNS = "id, question_id, author_id, body, created_at";
const INDIVIDUAL_ATTACHMENT_COLUMNS = "id, question_id, message_id, storage_path, file_name, created_at";

const LOAD_ERROR = "질문 데이터를 불러오지 못했습니다.";
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type QuestionExportLoadResult = {
  records: QuestionExportRecord[];
  /** 조건에 맞는 전체 건수(상한과 무관) */
  totalCount: number;
  overLimit: boolean;
  error: string | null;
};

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
function subjectLabelOf(code: unknown): string | null {
  const s = str(code);
  return s ? getSubjectLabel(s) : null;
}

function chunk<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** `in (...)` 인자 상한을 지키며 부모 id 집합으로 자식 행을 모은다(200 × 메시지). */
async function loadChildRows(db: SupabaseClient, table: string, columns: string, parentColumn: string, parentIds: readonly string[]): Promise<{ rows: Row[]; error: string | null }> {
  const rows: Row[] = [];
  for (const ids of chunk(parentIds, 100)) {
    const { data, error } = await db.from(table).select(columns).in(parentColumn, ids).order("created_at", { ascending: true });
    if (error) {
      console.error(`[questionExport] ${table}:`, error.message);
      return { rows: [], error: LOAD_ERROR };
    }
    rows.push(...((data as unknown as Row[] | null) ?? []));
  }
  return { rows, error: null };
}

function toAttachment(r: Row): QuestionExportAttachment | null {
  const path = str(r.storage_path);
  const fileName = strOrNull(r.file_name) ?? (path ? attachmentFileNameFromPath(path) : null);
  if (!fileName) return null;
  return { messageId: strOrNull(r.message_id), fileName };
}

function toMessages(raw: readonly Row[], party: { studentId: string | null; mentorId: string | null }, names: IdentityMap): (ConversationMessage & { authorName: string })[] {
  return sortByCreatedAt(
    raw.map((m) => {
      const authorId = strOrNull(m.author_id);
      const role: PartyRole = resolveMessageAuthorRole(authorId, party, names.get(authorId ?? "")?.role);
      return { id: str(m.id), authorId, authorRole: role, authorName: displayNameForRole(role, names.get(authorId ?? ""), authorId), body: str(m.body), createdAt: strOrNull(m.created_at) };
    })
  );
}

function toExportMessages(messages: readonly ConversationMessage[]): QuestionExportRecord["messages"] {
  return messages.map((m, idx) => ({ id: m.id, order: idx + 1, role: m.authorRole, createdAt: m.createdAt, body: m.body }));
}

// ── 구독 질문(방 단위) ───────────────────────────────────────────────────────

async function loadRoomThreadRecords(db: SupabaseClient, roomId: string): Promise<QuestionExportLoadResult> {
  const [roomResp, threadsResp] = await Promise.all([
    db.from("mentor_student_rooms").select("id, student_id, mentor_id").eq("id", roomId).maybeSingle(),
    db.from("question_threads").select(THREAD_COLUMNS, { count: "exact" }).eq("mentor_student_room_id", roomId).order("created_at", { ascending: false }).range(0, QUESTION_EXPORT_LIMIT),
  ]);
  if (roomResp.error) console.error("[questionExport] mentor_student_rooms:", roomResp.error.message);
  if (threadsResp.error) {
    console.error("[questionExport] question_threads:", threadsResp.error.message);
    return { records: [], totalCount: 0, overLimit: false, error: LOAD_ERROR };
  }
  const totalCount = threadsResp.count ?? (threadsResp.data as Row[] | null)?.length ?? 0;
  if (totalCount > QUESTION_EXPORT_LIMIT) return { records: [], totalCount, overLimit: true, error: null };
  const threads = ((threadsResp.data as Row[] | null) ?? []).slice(0, QUESTION_EXPORT_LIMIT);
  const room = roomResp.data as Row | null;
  const party = { studentId: strOrNull(room?.student_id), mentorId: strOrNull(room?.mentor_id) };
  const threadIds = threads.map((t) => str(t.id)).filter(Boolean);

  const [messages, attachments] = await Promise.all([
    loadChildRows(db, "question_messages", THREAD_MESSAGE_COLUMNS, "thread_id", threadIds),
    loadChildRows(db, "question_attachments", THREAD_ATTACHMENT_COLUMNS, "thread_id", threadIds),
  ]);
  if (messages.error) return { records: [], totalCount, overLimit: false, error: messages.error };
  const names = await loadPartyIdentities(db, [party.studentId, party.mentorId, ...messages.rows.map((m) => str(m.author_id))]);
  const studentName = studentDisplayName(party.studentId ? names.get(party.studentId) : null, party.studentId);
  const mentorName = party.mentorId ? mentorDisplayName(names.get(party.mentorId), party.mentorId) : null;

  const messagesByThread = new Map<string, Row[]>();
  for (const m of messages.rows) {
    const tid = str(m.thread_id);
    if (!messagesByThread.has(tid)) messagesByThread.set(tid, []);
    messagesByThread.get(tid)!.push(m);
  }
  const attachmentsByThread = new Map<string, QuestionExportAttachment[]>();
  for (const a of attachments.rows) {
    const tid = str(a.thread_id);
    const att = toAttachment(a);
    if (!att) continue;
    if (!attachmentsByThread.has(tid)) attachmentsByThread.set(tid, []);
    attachmentsByThread.get(tid)!.push(att);
  }

  const records: QuestionExportRecord[] = threads.map((t) => {
    const id = str(t.id);
    const conv = toMessages(messagesByThread.get(id) ?? [], party, names);
    const firstAnsweredAt = strOrNull(t.first_answered_at);
    const confirmedAt = strOrNull(t.confirmed_at);
    const metrics = buildQuestionQualityMetrics({ createdAt: strOrNull(t.created_at), firstAnsweredAt, confirmedAt, messages: conv });
    return {
      kind: "thread",
      id,
      studentName,
      mentorName,
      subjectLabel: subjectLabelOf(t.subject),
      title: str(t.title) || "(제목 없음)",
      createdAt: strOrNull(t.created_at),
      status: str(t.status),
      metrics: { firstAnswerMs: metrics.firstAnswerMs, roundTrips: metrics.roundTrips, confirmedAt, confirmMs: metrics.confirmMs },
      messages: toExportMessages(conv),
      attachments: attachmentsByThread.get(id) ?? [],
      individual: null,
    };
  });
  return { records, totalCount, overLimit: false, error: null };
}

// ── 개별질문(계정 단위) ──────────────────────────────────────────────────────

async function loadIndividualRecords(db: SupabaseClient, scope: { role: "student" | "mentor"; userId: string }): Promise<QuestionExportLoadResult> {
  let query = db.from("individual_questions").select(INDIVIDUAL_COLUMNS, { count: "exact" });
  query = scope.role === "student" ? query.eq("student_id", scope.userId) : query.or(`designated_mentor_id.eq.${scope.userId},claimed_mentor_id.eq.${scope.userId}`);
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(0, QUESTION_EXPORT_LIMIT);
  if (error) {
    console.error("[questionExport] individual_questions:", error.message);
    return { records: [], totalCount: 0, overLimit: false, error: LOAD_ERROR };
  }
  const totalCount = count ?? (data as Row[] | null)?.length ?? 0;
  if (totalCount > QUESTION_EXPORT_LIMIT) return { records: [], totalCount, overLimit: true, error: null };
  const questions = ((data as Row[] | null) ?? []).slice(0, QUESTION_EXPORT_LIMIT);
  const questionIds = questions.map((q) => str(q.id)).filter(Boolean);

  const [messages, attachments] = await Promise.all([
    loadChildRows(db, "individual_question_messages", INDIVIDUAL_MESSAGE_COLUMNS, "question_id", questionIds),
    loadChildRows(db, "individual_question_attachments", INDIVIDUAL_ATTACHMENT_COLUMNS, "question_id", questionIds),
  ]);
  if (messages.error) return { records: [], totalCount, overLimit: false, error: messages.error };
  const names = await loadPartyIdentities(db, [
    ...questions.flatMap((q) => [str(q.student_id), str(q.designated_mentor_id), str(q.claimed_mentor_id)]),
    ...messages.rows.map((m) => str(m.author_id)),
  ]);

  const messagesByQuestion = new Map<string, Row[]>();
  for (const m of messages.rows) {
    const qid = str(m.question_id);
    if (!messagesByQuestion.has(qid)) messagesByQuestion.set(qid, []);
    messagesByQuestion.get(qid)!.push(m);
  }
  const attachmentsByQuestion = new Map<string, QuestionExportAttachment[]>();
  for (const a of attachments.rows) {
    const qid = str(a.question_id);
    const att = toAttachment(a);
    if (!att) continue;
    if (!attachmentsByQuestion.has(qid)) attachmentsByQuestion.set(qid, []);
    attachmentsByQuestion.get(qid)!.push(att);
  }

  const records: QuestionExportRecord[] = questions.map((q) => {
    const id = str(q.id);
    const studentId = str(q.student_id);
    const mentorId = individualAnsweringMentorId({ question_type: strOrNull(q.question_type), designated_mentor_id: strOrNull(q.designated_mentor_id), claimed_mentor_id: strOrNull(q.claimed_mentor_id) });
    const party = { studentId: studentId || null, mentorId };
    // 질문 본문(`individual_questions.body`)이 대화의 첫 메시지 — PR-8 질문 상세와 같은 구성.
    const opening: ConversationMessage = { id: `question-${id}`, authorId: studentId || null, authorRole: "student", body: str(q.body), createdAt: strOrNull(q.created_at) };
    const conv = [opening, ...toMessages(messagesByQuestion.get(id) ?? [], party, names)];
    const answeredAt = strOrNull(q.answered_at);
    const metrics = buildQuestionQualityMetrics({ createdAt: strOrNull(q.created_at), firstAnsweredAt: answeredAt, confirmedAt: null, messages: conv });
    return {
      kind: "individual",
      id,
      studentName: studentDisplayName(names.get(studentId), studentId),
      mentorName: mentorId ? mentorDisplayName(names.get(mentorId), mentorId) : null,
      subjectLabel: subjectLabelOf(q.subject),
      title: str(q.title) || "(제목 없음)",
      createdAt: strOrNull(q.created_at),
      status: str(q.status),
      metrics: { firstAnswerMs: metrics.firstAnswerMs, roundTrips: metrics.roundTrips, confirmedAt: null, confirmMs: null },
      messages: toExportMessages(conv),
      attachments: attachmentsByQuestion.get(id) ?? [],
      individual: {
        priceCents: numOrNull(q.price_cents) ?? 0,
        escrow: individualEscrowState({ status: strOrNull(q.status), hold_ledger_id: strOrNull(q.hold_ledger_id), release_ledger_id: strOrNull(q.release_ledger_id), refund_ledger_id: strOrNull(q.refund_ledger_id) }),
        questionType: str(q.question_type),
      },
    };
  });
  return { records, totalCount, overLimit: false, error: null };
}

/** 범위(현재 목록과 같은 조건) → 레코드(≤200). 상한 초과면 레코드 없이 `overLimit` · 실패면 `error`. */
export async function loadQuestionExportRecords(db: SupabaseClient, scope: QuestionExportScope): Promise<QuestionExportLoadResult> {
  if (!UUID_PATTERN.test(scope.id)) return { records: [], totalCount: 0, overLimit: false, error: null };
  if (questionExportKind(scope.kind) === "thread") return loadRoomThreadRecords(db, scope.id);
  return loadIndividualRecords(db, { role: scope.kind === "student_individual" ? "student" : "mentor", userId: scope.id });
}
