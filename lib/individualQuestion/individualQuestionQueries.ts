import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IndividualQuestionStatus } from "@/lib/individualQuestion/individualQuestionTypes";
import { signIndividualQuestionAttachment } from "@/lib/individualQuestion/individualQuestionAttachmentStorage";
import { fetchStudentDisplayNames, type StudentDisplayResult } from "@/lib/qna/studentDisplayNames";

// [D-IQ-6] 멘토 세션은 RLS(users_select_own)로 학생 users 행을 직접 못 읽는다. 직접 select 는
// 조용히 빈 결과 → 전원 '학생' 폴백으로 강등되어 운영자가 실패인지 정상인지 구분할 수 없었다.
// 질문방과 동일하게 표시명 전용 RPC(get_mentor_student_nicknames, 오류/빈결과 구분)로 통일한다.
const STUDENT_DISPLAY_FAILURE_LABEL = "표시 실패";

// 표시 헬퍼는 individualQuestionFormat.ts를 단일 소스로 사용한다. (client/server 공용)
export {
  formatIndividualQuestionPrice,
  formatIndividualQuestionDate,
  individualQuestionTypeLabel,
  individualQuestionStatusLabel,
  individualQuestionStatusBadgeClass,
  isIndividualQuestionAwaitingAnswer,
  isIndividualQuestionAnswered,
  isIndividualQuestionExpiringSoon,
  formatIndividualQuestionExpiryRemaining,
} from "@/lib/individualQuestion/individualQuestionFormat";

export type IndividualQuestionRow = {
  id: string;
  student_id: string;
  question_type: "direct" | "open";
  designated_mentor_id: string | null;
  claimed_mentor_id: string | null;
  claimed_at: string | null;
  subject: string | null;
  topic: string | null;
  title: string;
  body: string;
  price_cents: number;
  status: IndividualQuestionStatus | string;
  expires_at: string | null;
  answered_at: string | null;
  released_at: string | null;
  refunded_at: string | null;
  hold_ledger_id: string | null;
  release_ledger_id: string | null;
  refund_ledger_id: string | null;
  created_at: string;
  updated_at: string;
};

export type IndividualQuestionMessageRow = {
  id: string;
  question_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

export type IndividualQuestionAttachmentRow = {
  id: string;
  question_id: string;
  message_id: string | null;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  created_at: string;
};

export type IndividualQuestionAttachmentView = IndividualQuestionAttachmentRow & {
  signedUrl: string | null;
};

export type IndividualQuestionListItem = IndividualQuestionRow & {
  studentName: string;
  mentorName: string;
};

export type IndividualQuestionDetail = IndividualQuestionListItem & {
  messages: Array<IndividualQuestionMessageRow & { authorName: string; authorRole: "student" | "mentor" | "unknown" }>;
  attachments: IndividualQuestionAttachmentView[];
};

export type OpenIndividualQuestionBrowseRow = {
  id: string;
  subject: string | null;
  topic: string | null;
  title: string;
  price_cents: number;
  expires_at: string | null;
  created_at: string;
};

/**
 * [QA-B7] users 표시명 행.
 *
 * 종전에는 `name` 필드가 있었고 select 도 그 컬럼을 요청했는데, public.users 에
 * **name 컬럼은 존재하지 않는다**. 그래서 이 조회는 매번
 * `column users.name does not exist` 로 실패했고(개별질문 사용 구간에서 DB 로그
 * 8회 이상 관측), 아래 fetchUserNameMap 이 오류를 삼키고 빈 맵을 돌려주는 바람에
 * **개별질문 목록의 학생·멘토 이름이 전부 '학생'·'멘토' 폴백으로 표시됐다** —
 * 로그 노이즈가 아니라 실제 표시 결함이었다.
 */
type UserNameRow = {
  id: string;
  full_name?: string | null;
  nickname?: string | null;
  email?: string | null;
  role?: string | null;
};

const QUESTION_COLUMNS =
  "id, student_id, question_type, designated_mentor_id, claimed_mentor_id, claimed_at, subject, topic, title, body, price_cents, status, expires_at, answered_at, released_at, refunded_at, hold_ledger_id, release_ledger_id, refund_ledger_id, created_at, updated_at";

function displayName(row: UserNameRow | null | undefined, fallback: string): string {
  const value = row?.full_name?.trim() || row?.nickname?.trim() || row?.email?.trim();
  return value || fallback;
}

async function fetchUserNameMap(supabase: SupabaseClient, ids: string[]): Promise<Map<string, UserNameRow>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, UserNameRow>();
  if (uniqueIds.length === 0) return map;

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, nickname, email, role")
    .in("id", uniqueIds);

  if (error || !data) {
    // 조용히 빈 맵을 돌려주면 이름이 전부 폴백으로 바뀌는데 아무도 모른다 —
    // 실제로 존재하지 않는 컬럼 요청이 이 경로에 오래 남아 있었다(QA-B7).
    if (error) console.error("[fetchUserNameMap] users 표시명 조회 실패", error.message);
    return map;
  }
  for (const row of data as UserNameRow[]) {
    if (row.id) map.set(row.id, row);
  }
  return map;
}

function enrichQuestions(rows: IndividualQuestionRow[], names: Map<string, UserNameRow>): IndividualQuestionListItem[] {
  return rows.map((row) => {
    const mentorId = row.designated_mentor_id ?? row.claimed_mentor_id;
    const mentorFallback = row.question_type === "open" && !mentorId ? "아직 배정 전" : "멘토";
    return {
      ...row,
      studentName: displayName(names.get(row.student_id), "학생"),
      mentorName: displayName(mentorId ? names.get(mentorId) : null, mentorFallback),
    };
  });
}

/**
 * [D-IQ-6] 멘토 화면에서 상대(학생) 표시명을 RPC 결과로 덮어쓴다. RPC 오류(error:true)는
 * '표시 실패'로 노출해 무음 강등을 없앤다. 정상 빈결과(관계 없음)만 익명 라벨로 남는다.
 */
function applyStudentDisplay(
  items: IndividualQuestionListItem[],
  studentDisplay: StudentDisplayResult
): IndividualQuestionListItem[] {
  return items.map((item) => ({
    ...item,
    studentName: studentDisplay.error
      ? STUDENT_DISPLAY_FAILURE_LABEL
      : studentDisplay.byId[item.student_id]?.displayName ?? item.studentName,
  }));
}

export async function fetchStudentDirectIndividualQuestions(
  supabase: SupabaseClient,
  studentId: string
): Promise<{ rows: IndividualQuestionListItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from("individual_questions")
    .select(QUESTION_COLUMNS)
    .eq("student_id", studentId)
    .eq("question_type", "direct")
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) return { rows: [], error: error.message };
  const rows = (data ?? []) as IndividualQuestionRow[];
  const names = await fetchUserNameMap(
    supabase,
    rows.flatMap((row) => [row.student_id, row.designated_mentor_id ?? row.claimed_mentor_id ?? ""])
  );
  return { rows: enrichQuestions(rows, names), error: null };
}

export async function fetchStudentIndividualQuestions(
  supabase: SupabaseClient,
  studentId: string
): Promise<{ rows: IndividualQuestionListItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from("individual_questions")
    .select(QUESTION_COLUMNS)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { rows: [], error: error.message };
  const rows = (data ?? []) as IndividualQuestionRow[];
  const names = await fetchUserNameMap(
    supabase,
    rows.flatMap((row) => [row.student_id, row.designated_mentor_id ?? row.claimed_mentor_id ?? ""])
  );
  return { rows: enrichQuestions(rows, names), error: null };
}

export async function fetchMentorDirectIndividualQuestions(
  supabase: SupabaseClient,
  mentorId: string
): Promise<{ rows: IndividualQuestionListItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from("individual_questions")
    .select(QUESTION_COLUMNS)
    .eq("question_type", "direct")
    .eq("designated_mentor_id", mentorId)
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) return { rows: [], error: error.message };
  const rows = (data ?? []) as IndividualQuestionRow[];
  const names = await fetchUserNameMap(
    supabase,
    rows.flatMap((row) => [row.student_id, row.designated_mentor_id ?? ""])
  );
  // [D-IQ-6] 멘토 화면의 상대(학생) 표시명은 전용 RPC로 — RLS 무음 강등 제거.
  const studentDisplay = await fetchStudentDisplayNames(
    supabase,
    rows.map((row) => row.student_id)
  );
  return { rows: applyStudentDisplay(enrichQuestions(rows, names), studentDisplay), error: null };
}

export async function fetchMentorOwnedIndividualQuestions(
  supabase: SupabaseClient,
  mentorId: string
): Promise<{ rows: IndividualQuestionListItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from("individual_questions")
    .select(QUESTION_COLUMNS)
    .or(`designated_mentor_id.eq.${mentorId},claimed_mentor_id.eq.${mentorId}`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { rows: [], error: error.message };
  const rows = (data ?? []) as IndividualQuestionRow[];
  const names = await fetchUserNameMap(
    supabase,
    rows.flatMap((row) => [row.student_id, row.designated_mentor_id ?? row.claimed_mentor_id ?? ""])
  );
  // [D-IQ-6] 멘토 화면의 상대(학생) 표시명은 전용 RPC로 — RLS 무음 강등 제거.
  const studentDisplay = await fetchStudentDisplayNames(
    supabase,
    rows.map((row) => row.student_id)
  );
  return { rows: applyStudentDisplay(enrichQuestions(rows, names), studentDisplay), error: null };
}

export async function fetchOpenIndividualQuestionsForMentor(
  supabase: SupabaseClient,
  limit = 80
): Promise<{ rows: OpenIndividualQuestionBrowseRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc("list_open_individual_questions_for_mentor", {
    p_limit: limit,
  });

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as OpenIndividualQuestionBrowseRow[], error: null };
}

export type IndividualQuestionTransferInfo = {
  roomId: string | null;
  threadId: string | null;
  transferredAt: string | null;
};

/**
 * 이 개별질문이 구독 질문방으로 이전됐는지 조회(075 매핑 테이블).
 * 사용자 세션 클라이언트로 호출 → RLS(본인 학생 select)로 본인 것만 보인다.
 */
export async function fetchIndividualQuestionTransfer(
  supabase: SupabaseClient,
  questionId: string
): Promise<IndividualQuestionTransferInfo | null> {
  const { data, error } = await supabase
    .from("individual_question_transfers")
    .select("room_id, thread_id, transferred_at")
    .eq("individual_question_id", questionId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { room_id: string | null; thread_id: string | null; transferred_at: string | null };
  return { roomId: row.room_id, threadId: row.thread_id, transferredAt: row.transferred_at };
}

export async function fetchIndividualQuestionDetail(
  supabase: SupabaseClient,
  questionId: string
): Promise<{ detail: IndividualQuestionDetail | null; error: string | null }> {
  const { data: question, error: questionError } = await supabase
    .from("individual_questions")
    .select(QUESTION_COLUMNS)
    .eq("id", questionId)
    .maybeSingle();

  if (questionError) return { detail: null, error: questionError.message };
  if (!question) return { detail: null, error: "개별 질문을 찾을 수 없습니다." };

  const row = question as IndividualQuestionRow;
  const [messagesResp, attachmentsResp] = await Promise.all([
    supabase
      .from("individual_question_messages")
      .select("id, question_id, author_id, body, created_at")
      .eq("question_id", questionId)
      .order("created_at", { ascending: true }),
    supabase
      .from("individual_question_attachments")
      .select("id, question_id, message_id, storage_path, file_name, mime_type, created_at")
      .eq("question_id", questionId)
      .order("created_at", { ascending: true }),
  ]);

  if (messagesResp.error) return { detail: null, error: messagesResp.error.message };
  if (attachmentsResp.error) return { detail: null, error: attachmentsResp.error.message };

  const messages = (messagesResp.data ?? []) as IndividualQuestionMessageRow[];
  const attachments = (attachmentsResp.data ?? []) as IndividualQuestionAttachmentRow[];
  const names = await fetchUserNameMap(
    supabase,
    [
      row.student_id,
      row.designated_mentor_id ?? "",
      row.claimed_mentor_id ?? "",
      ...messages.map((message) => message.author_id),
    ].filter(Boolean)
  );

  // [D-IQ-6] 상대(학생) 표시명은 전용 RPC로 덮어쓴다 — 멘토 세션에서 학생명이 무음 강등되지 않게.
  // (학생 세션에서는 자기 학생명이 상대 표시로 쓰이지 않으므로 영향 없음.)
  const studentDisplay = await fetchStudentDisplayNames(supabase, [row.student_id]);
  const [enriched] = applyStudentDisplay(enrichQuestions([row], names), studentDisplay);
  const signedAttachments = await Promise.all(
    attachments.map(async (attachment) => ({
      ...attachment,
      signedUrl: await signIndividualQuestionAttachment(supabase, attachment.storage_path),
    }))
  );

  return {
    detail: {
      ...enriched,
      messages: messages.map((message) => {
        const role = names.get(message.author_id)?.role;
        return {
          ...message,
          authorName: displayName(names.get(message.author_id), "사용자"),
          authorRole: role === "student" || role === "mentor" ? role : "unknown",
        };
      }),
      attachments: signedAttachments,
    },
    error: null,
  };
}
