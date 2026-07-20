import "server-only";

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSubjectCode } from "@/lib/subjects/subjectCatalog";
import { INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET } from "@/lib/individualQuestion/individualQuestionAttachmentStorage";
import { QUESTION_ROOM_ATTACHMENTS_BUCKET } from "@/lib/qna/questionRoomAttachmentStorage";

type Row = Record<string, unknown>;

type ReleasedQuestionRow = {
  id: string;
  student_id: string;
  title: string | null;
  subject: string | null;
  body: string | null;
  created_at: string | null;
  answered_at: string | null;
  released_at: string | null;
};

type IqMessageRow = { id: string; author_id: string; body: string; created_at: string | null };
type IqAttachmentRow = {
  id: string;
  message_id: string | null;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
};

export type TransferSummary = {
  scanned: number;
  transferred: number;
  skipped: number;
  errors: Array<{ questionId: string | null; message: string }>;
};

function safeName(name: string | null | undefined): string {
  const base = (name ?? "file").replace(/[^\w.\-]+/g, "_").slice(0, 80);
  return base || "file";
}

/** question_threads insert — 060 확장 컬럼(subject/first_answered_at/confirmed_at) 우선, 없으면 최소 컬럼으로 폴백. */
async function insertRoomThread(
  admin: SupabaseClient,
  args: { roomId: string; title: string; subjectCode: string | null; answeredAt: string | null; releasedAt: string | null }
): Promise<string | null> {
  const base: Row = { mentor_student_room_id: args.roomId, title: args.title, status: "closed" };
  const full: Row = {
    ...base,
    ...(args.subjectCode ? { subject: args.subjectCode } : {}),
    ...(args.answeredAt ? { first_answered_at: args.answeredAt } : {}),
    ...(args.releasedAt ? { confirmed_at: args.releasedAt } : {}),
  };
  for (const payload of [full, base]) {
    const { data, error } = await admin.from("question_threads").insert(payload).select("id").maybeSingle();
    if (!error && data && typeof (data as Row).id === "string") return (data as Row).id as string;
    if (error && !/column|schema cache|does not exist/i.test(error.message)) {
      console.error("[iqTransfer] thread insert failed", { roomId: args.roomId, error: error.message });
      return null;
    }
  }
  return null;
}

/** question_messages 직접 insert — author_id/body/created_at 보존(작성자 박는 헬퍼 미사용). */
async function insertRoomMessage(
  admin: SupabaseClient,
  args: { threadId: string; authorId: string; body: string; createdAt: string | null }
): Promise<string | null> {
  const payload: Row = { thread_id: args.threadId, author_id: args.authorId, body: args.body };
  if (args.createdAt) payload.created_at = args.createdAt;
  const { data, error } = await admin.from("question_messages").insert(payload).select("id").maybeSingle();
  if (error || !data || typeof (data as Row).id !== "string") {
    console.error("[iqTransfer] message insert failed", { threadId: args.threadId, error: error?.message });
    return null;
  }
  return (data as Row).id as string;
}

/** 첨부 storage 복제 + question_attachments insert. 실패 시 해당 첨부만 skip. */
async function cloneAttachment(
  admin: SupabaseClient,
  args: { roomId: string; threadId: string; messageId: string | null; att: IqAttachmentRow }
): Promise<void> {
  try {
    const { data: blob, error: dlErr } = await admin.storage
      .from(INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET)
      .download(args.att.storage_path);
    if (dlErr || !blob) {
      console.error("[iqTransfer] attachment download failed", { path: args.att.storage_path, error: dlErr?.message });
      return;
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    const mime = args.att.mime_type || "application/octet-stream";
    const destPath = `${args.roomId}/${args.threadId}/${randomUUID()}-${safeName(args.att.file_name)}`;
    const { error: upErr } = await admin.storage
      .from(QUESTION_ROOM_ATTACHMENTS_BUCKET)
      .upload(destPath, buffer, { contentType: mime, upsert: false });
    if (upErr) {
      console.error("[iqTransfer] attachment upload failed", { destPath, error: upErr.message });
      return;
    }
    const { error: insErr } = await admin.from("question_attachments").insert({
      thread_id: args.threadId,
      message_id: args.messageId,
      storage_path: destPath,
      file_name: args.att.file_name,
      mime_type: args.att.mime_type,
    });
    if (insErr) {
      console.error("[iqTransfer] question_attachments insert failed", { destPath, error: insErr.message });
    }
  } catch (e) {
    console.error("[iqTransfer] attachment clone error", { path: args.att.storage_path, error: e });
  }
}

async function transferOneQuestion(
  admin: SupabaseClient,
  q: ReleasedQuestionRow,
  args: { studentId: string; mentorId: string; roomId: string }
): Promise<"transferred" | "skipped" | "error"> {
  // 1) 새 thread 생성
  const threadId = await insertRoomThread(admin, {
    roomId: args.roomId,
    title: q.title || "개별 질문",
    subjectCode: normalizeSubjectCode(q.subject),
    answeredAt: q.answered_at,
    releasedAt: q.released_at,
  });
  if (!threadId) return "error";

  // 2) 원본 질문 본문을 학생 작성 첫 메시지로 보존(question_threads엔 본문 컬럼이 없음)
  const messageIdMap = new Map<string, string>();
  const questionMsgId = await insertRoomMessage(admin, {
    threadId,
    authorId: q.student_id,
    body: q.body || "(질문 내용 없음)",
    createdAt: q.created_at,
  });

  // 3) 개별질문 답변 메시지 복사(author_id/body/created_at 보존)
  const { data: msgData } = await admin
    .from("individual_question_messages")
    .select("id, author_id, body, created_at")
    .eq("question_id", q.id)
    .order("created_at", { ascending: true });
  for (const m of (msgData as IqMessageRow[] | null) ?? []) {
    const newId = await insertRoomMessage(admin, {
      threadId,
      authorId: m.author_id,
      body: m.body || "(내용 없음)",
      createdAt: m.created_at,
    });
    if (newId) messageIdMap.set(m.id, newId);
  }

  // 4) 첨부 storage 복제 — 원본 message_id → 새 message_id(없으면 첫 질문 메시지) 매핑
  const { data: attData } = await admin
    .from("individual_question_attachments")
    .select("id, message_id, storage_path, file_name, mime_type")
    .eq("question_id", q.id);
  for (const att of (attData as IqAttachmentRow[] | null) ?? []) {
    const targetMessageId = att.message_id ? messageIdMap.get(att.message_id) ?? questionMsgId : questionMsgId;
    await cloneAttachment(admin, { roomId: args.roomId, threadId, messageId: targetMessageId, att });
  }

  // 5) 멱등 매핑 기록
  const { error: mapErr } = await admin
    .from("individual_question_transfers")
    .insert({
      individual_question_id: q.id,
      student_id: args.studentId,
      mentor_id: args.mentorId,
      room_id: args.roomId,
      thread_id: threadId,
    });
  if (mapErr && !/duplicate|unique|23505/i.test(mapErr.message)) {
    console.error("[iqTransfer] transfer mapping insert failed", { questionId: q.id, error: mapErr.message });
  }
  return "transferred";
}

/**
 * 구독 전환 직후 호출(service_role). 같은 멘토에게 한 released 개별질문을 구독방으로 이전.
 * best-effort: 한 건 실패가 전체/구독을 막지 않음. 멱등(individual_question_transfers PK).
 */
export async function transferReleasedIndividualQuestionsToRoom(
  admin: SupabaseClient,
  args: { studentId: string; mentorId: string; roomId: string }
): Promise<TransferSummary> {
  const summary: TransferSummary = { scanned: 0, transferred: 0, skipped: 0, errors: [] };
  if (!args.studentId || !args.mentorId || !args.roomId) return summary;

  const { data, error } = await admin
    .from("individual_questions")
    .select("id, student_id, title, subject, body, created_at, answered_at, released_at")
    .eq("student_id", args.studentId)
    .eq("status", "released")
    .or(`designated_mentor_id.eq.${args.mentorId},claimed_mentor_id.eq.${args.mentorId}`)
    .order("created_at", { ascending: true });

  if (error) {
    summary.errors.push({ questionId: null, message: `query_failed: ${error.message}` });
    return summary;
  }

  const rows = (data as ReleasedQuestionRow[] | null) ?? [];
  summary.scanned = rows.length;
  if (rows.length === 0) return summary;

  // 멱등: 이미 이전된 질문 제외
  const { data: existing } = await admin
    .from("individual_question_transfers")
    .select("individual_question_id")
    .in(
      "individual_question_id",
      rows.map((r) => r.id)
    );
  const alreadyTransferred = new Set(
    ((existing as { individual_question_id: string }[] | null) ?? []).map((r) => r.individual_question_id)
  );

  for (const q of rows) {
    if (alreadyTransferred.has(q.id)) {
      summary.skipped += 1;
      continue;
    }
    try {
      const result = await transferOneQuestion(admin, q, args);
      if (result === "transferred") summary.transferred += 1;
      else if (result === "skipped") summary.skipped += 1;
      else summary.errors.push({ questionId: q.id, message: "transfer_failed" });
    } catch (e) {
      summary.errors.push({ questionId: q.id, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return summary;
}
