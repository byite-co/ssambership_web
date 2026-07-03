import {
  readQuestionThreadWorkflowStatus,
  workflowStatusLabel,
  workflowStatusTone,
} from "@/lib/qna/questionThreadStatus";

/**
 * 질문방 UI 라벨·탭 분류 — pending/answered/confirmed 우선, 레거시 open/closed/archived 호환.
 */

export type QuestionRoomListFilterTab = "all" | "waiting" | "needReview" | "done";

type Row = Record<string, unknown>;

const MENTOR_ID_KEYS = ["mentor_id", "mentor_user_id", "mentor_uid"] as const;
const STUDENT_ID_KEYS = ["student_id", "student_user_id", "student_uid"] as const;

export function partyUserIdFromRoomRow(row: Row | null | undefined, party: "mentor" | "student"): string | null {
  if (!row) return null;
  const keys = party === "mentor" ? MENTOR_ID_KEYS : STUDENT_ID_KEYS;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function messageAuthorId(m: Row | null | undefined): string | null {
  if (!m) return null;
  for (const k of ["author_id", "user_id", "sender_id"] as const) {
    const v = m[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** CHECK 제약과 동일한 세 값만 인정하고, 그 외·누락은 open 취급(표시만). */
export function readThreadLifecycleStatus(thread: Row | null | undefined): "open" | "closed" | "archived" {
  if (!thread) return "open";
  const s = thread.status;
  if (s === "closed" || s === "archived") return s;
  return "open";
}

/** 완료(학생 확인=confirmed) 또는 종료(closed/archived) 스레드는 더 이상 메시지를 보낼 수 없다. */
export function isQuestionThreadLockedForMessages(thread: Row | null | undefined): boolean {
  if (!thread) return false;
  const workflow = readQuestionThreadWorkflowStatus(thread);
  if (workflow === "confirmed") return true; // 학생 확인 완료 = 종료
  const life = readThreadLifecycleStatus(thread);
  return life === "closed" || life === "archived";
}

export function listFilterTabAndChip(
  variant: "student" | "mentor",
  room: Row,
  latestThread: Row | null,
  lastMessage: Row | null
): {
  tab: QuestionRoomListFilterTab;
  label: string;
  tone: "slate" | "amber" | "blue" | "emerald";
} {
  const workflow = readQuestionThreadWorkflowStatus(latestThread);
  if (workflow === "confirmed") {
    return { tab: "done", label: workflowStatusLabel("confirmed"), tone: workflowStatusTone("confirmed") };
  }
  if (workflow === "answered") {
    return {
      tab: "needReview",
      label: variant === "student" ? workflowStatusLabel("answered") : "학생 확인 대기",
      tone: workflowStatusTone("answered"),
    };
  }
  if (workflow === "pending" && latestThread) {
    return {
      tab: "waiting",
      label: variant === "student" ? "멘토 답변 대기" : "답변하기",
      tone: workflowStatusTone("pending"),
    };
  }

  const life = readThreadLifecycleStatus(latestThread);
  if (life === "closed" || life === "archived") {
    return { tab: "done", label: "완료", tone: "emerald" };
  }

  const mentorId = partyUserIdFromRoomRow(room, "mentor");
  const studentId = partyUserIdFromRoomRow(room, "student");
  const author = messageAuthorId(lastMessage);

  if (!lastMessage || !author) {
    return { tab: "waiting", label: "답변 대기", tone: "slate" };
  }

  if (mentorId && author === mentorId) {
    if (variant === "student") {
      return { tab: "needReview", label: "답변 도착 · 확인 필요", tone: "amber" };
    }
    return { tab: "needReview", label: "학생 확인 대기", tone: "blue" };
  }

  if (studentId && author === studentId) {
    if (variant === "student") {
      return { tab: "waiting", label: "멘토 답변 대기", tone: "slate" };
    }
    return { tab: "waiting", label: "답변하기", tone: "slate" };
  }

  return { tab: "waiting", label: "답변 대기", tone: "slate" };
}

export function listTabMatchesFilter(
  filter: QuestionRoomListFilterTab,
  chipTab: QuestionRoomListFilterTab
): boolean {
  if (filter === "all") return true;
  return filter === chipTab;
}

export function messageBodyPreview(m: Row | null | undefined, maxLen: number): string {
  if (!m) return "";
  const raw =
    (typeof m.body === "string" && m.body) ||
    (typeof m.content === "string" && m.content) ||
    (typeof m.text === "string" && m.text) ||
    "";
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

/** 스레드 상세 상단·배너용 — 학생이 멘토 답변 확인 전 단계 (메시지는 시간 오름차순이라 마지막 행이 최신) */
export function studentNeedsAckBanner(room: Row, thread: Row | null, messages: Row[]): boolean {
  const workflow = readQuestionThreadWorkflowStatus(thread);
  if (workflow === "answered") return true;
  if (workflow === "confirmed") return false;
  if (readThreadLifecycleStatus(thread) !== "open") return false;
  const last = messages[messages.length - 1];
  if (!last) return false;
  const mentorId = partyUserIdFromRoomRow(room, "mentor");
  if (!mentorId) return false;
  return messageAuthorId(last) === mentorId;
}

export function mentorAwaitingStudentBanner(
  room: Row,
  thread: Row | null,
  messages: Row[],
  mentorUserId: string | null | undefined
): boolean {
  if (!mentorUserId) return false;
  if (readThreadLifecycleStatus(thread) !== "open") return false;
  const last = messages[messages.length - 1];
  if (!last) return false;
  const mentorId = partyUserIdFromRoomRow(room, "mentor");
  if (!mentorId || mentorUserId !== mentorId) return false;
  return messageAuthorId(last) === mentorId;
}

/** URL `ok` 쿼리 표시용 — redirect 문자열·서버 액션 시그니처는 변경하지 않고 화면 문구만 완화 */
export function softenActionOkMessage(ok: string | null | undefined, variant: "student" | "mentor"): string | null {
  if (ok == null || !String(ok).trim()) return null;
  const s = String(ok).trim();
  if (variant === "mentor" && s.includes("답변이 저장되었습니다")) {
    return "답변이 전달되었습니다. 학생이 확인할 때까지 잠시 기다려 주세요.";
  }
  if (variant === "student" && s.includes("질문이 저장되었습니다")) {
    return "메시지가 전달되었습니다. 멘토 답변을 기다려 주세요.";
  }
  return s;
}
