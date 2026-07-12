import type { SupabaseClient } from "@supabase/supabase-js";
import { getMentorUserPublic, loadMentorProfilesForDirectory } from "@/lib/auth/mentorPublicRead";
import { buildMentorProfileDisplay, type MentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import { mentorSubjectChips } from "@/lib/mentor/mentorPublicProfileDisplay";
import { partyUserIdFromRoomRow } from "@/lib/qna/questionRoomUiLabels";
import { attachmentPreviewLabel } from "@/lib/qna/questionRoomAttachmentView";
import { readQuestionThreadWorkflowStatus } from "@/lib/qna/questionThreadStatus";
import type { QuestionRoomListPreview } from "@/lib/qna/questionRoomQueries";
import { questionSubjectLabelFromCode } from "@/lib/qna/questionSubjects";

export const QNA_PRIMARY_BLUE = "#2563EB";

type Row = Record<string, unknown>;

export type MentorDisplayById = Record<string, MentorProfileDisplay>;

export async function loadMentorDisplaysForQuestionRooms(
  supabase: SupabaseClient,
  roomRows: Row[]
): Promise<MentorDisplayById> {
  const ids = new Set<string>();
  for (const r of roomRows) {
    const mid = partyUserIdFromRoomRow(r, "mentor");
    if (mid) ids.add(mid);
  }
  const mentorIds = [...ids];
  if (mentorIds.length === 0) return {};

  const profPack = await loadMentorProfilesForDirectory(supabase, mentorIds);
  const out: MentorDisplayById = {};

  await Promise.all(
    mentorIds.map(async (id) => {
      const userQ = await getMentorUserPublic(supabase, id);
      const profileRow = profPack.byUser.get(id) ?? null;
      out[id] = buildMentorProfileDisplay(profileRow, userQ.data);
    })
  );

  return out;
}

export function mentorDisplayForRoom(
  room: Row | null | undefined,
  mentorDisplays: MentorDisplayById
): MentorProfileDisplay | null {
  if (!room) return null;
  const mid = partyUserIdFromRoomRow(room, "mentor");
  if (!mid) return null;
  return mentorDisplays[mid] ?? null;
}

export function roomMentorLabel(
  room: Row,
  mentorDisplays: MentorDisplayById
): string {
  const d = mentorDisplayForRoom(room, mentorDisplays);
  if (d?.displayName) return d.displayName;
  for (const k of ["mentor_name", "mentor_display_name", "title", "name"] as const) {
    const v = room[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "멘토";
}

export function roomSubjectChips(room: Row, mentorDisplays: MentorDisplayById, max = 2): string[] {
  const d = mentorDisplayForRoom(room, mentorDisplays);
  const fromProfile = d ? mentorSubjectChips(d.subjects || d.tags, max) : [];
  if (fromProfile.length > 0) return fromProfile;
  for (const k of ["subject", "subjects", "topic", "major"] as const) {
    const v = room[k];
    if (typeof v === "string" && v.trim()) {
      return mentorSubjectChips(v, max);
    }
  }
  return [];
}

export function threadSubjectChip(thread: Row | null | undefined, fallback: string[]): string[] {
  if (!thread) return fallback.slice(0, 1);
  const subjectLabel = questionSubjectLabelFromCode(thread.subject);
  const topic = typeof thread.topic === "string" ? thread.topic.trim() : "";
  if (subjectLabel && topic && topic !== subjectLabel) return [subjectLabel, topic].slice(0, 2);
  if (subjectLabel) return [subjectLabel];
  for (const k of ["topic", "category", "subject_tag", "subject"] as const) {
    const v = thread[k];
    if (typeof v === "string" && v.trim()) {
      const chips = mentorSubjectChips(v, 2);
      if (chips.length) return chips;
    }
  }
  return fallback.slice(0, 1);
}

export function threadViewCount(thread: Row): number {
  for (const k of ["view_count", "views", "read_count"] as const) {
    const v = thread[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

export function unreadCountForRoomPreview(preview: QuestionRoomListPreview | undefined): number {
  if (!preview?.latestThread) return 0;
  const w = readQuestionThreadWorkflowStatus(preview.latestThread);
  return w === "answered" ? 1 : 0;
}

export function threadStatusListLabel(thread: Row): {
  label: string;
  tone: "amber" | "emerald" | "blue";
} {
  // v4 라벨: pending=답변 대기 / answered=진행 중 / confirmed=답변 완료
  const w = readQuestionThreadWorkflowStatus(thread);
  if (w === "confirmed") return { label: "답변 완료", tone: "emerald" };
  if (w === "answered") return { label: "진행 중", tone: "blue" };
  return { label: "답변 대기", tone: "amber" };
}

export function threadStatusBadgeClass(tone: "amber" | "emerald" | "blue"): string {
  if (tone === "emerald") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  if (tone === "blue") return "bg-blue-50 text-blue-900 border-blue-200";
  return "bg-amber-50 text-amber-900 border-amber-200";
}

export function pickRowString(r: Row | undefined, keys: string[]): string | null {
  if (!r) return null;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function threadTitleFromRow(t: Row): string {
  return pickRowString(t, ["title", "label"]) ?? "새 질문";
}

export function roomSubjectLine(room: Row, mentorDisplays: MentorDisplayById): string {
  const chips = roomSubjectChips(room, mentorDisplays, 3);
  return chips.length > 0 ? chips.join(" · ") : "과목 정보 없음";
}

export function threadPreviewText(
  t: Row,
  lastMessage: Row | null,
  lastAttachment?: { isImage: boolean; fileName: string; createdAt: string } | null
): string {
  // 첨부 v2 계약 §2-7: 마지막 활동이 첨부이면 첨부 라벨을 우선한다.
  const msgAt = lastMessage ? Date.parse(String(lastMessage.created_at ?? "")) : NaN;
  const attAt = lastAttachment ? Date.parse(lastAttachment.createdAt) : NaN;
  const attachmentIsLatest =
    Number.isFinite(attAt) && (!Number.isFinite(msgAt) || attAt >= msgAt);
  if (lastAttachment && attachmentIsLatest) {
    return attachmentPreviewLabel(lastAttachment);
  }
  const fromThread = pickRowString(t, ["preview", "snippet", "last_message_body", "body", "content"]);
  if (fromThread) return fromThread;
  if (lastMessage) {
    const body =
      pickRowString(lastMessage, ["body", "content", "text", "message"]) ?? "";
    if (body) return body;
  }
  if (lastAttachment) return attachmentPreviewLabel(lastAttachment);
  return "질문 내용이 아직 없습니다.";
}
