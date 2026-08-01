import { draftToParam } from "./draftQuery.ts";
import { roomDetailPath, threadDetailPath } from "./formatQuestionRoomDisplay.ts";

/**
 * QnA 서버 액션 redirect 경로 선택 — 순수 함수 (D-27).
 *
 * 멘토가 정본 스레드 상세(`/mentor/question-room/{roomId}/thread/{threadId}`)에서
 * 메시지·첨부를 전송하면 성공/실패 모두 같은 정본 thread 상세 경로로 돌아가야 한다.
 * 그 외(kind=thread/note, 학생, thread 미지정)는 기존 room 경로 + `?thread=` 계약 유지.
 *
 * 경로 세그먼트는 전부 encodeURIComponent 로 인코딩되고 base 는 항상
 * `/question-room` 또는 `/mentor/question-room` 리터럴에서 시작하므로
 * 폼 입력(roomId/threadId)으로 외부 origin·상대 상위 경로로는 나갈 수 없다.
 */

export type QuestionRoomActor = "student" | "mentor";

export type QuestionRoomRedirectParams = {
  thread?: string | null;
  ok?: string | null;
  error?: string | null;
  kind?: "thread" | "message" | "note";
  draftThread?: string;
  draftMessage?: string;
  draftNote?: string;
};

export function questionRoomBasePath(actor: QuestionRoomActor): string {
  return actor === "mentor" ? "/mentor/question-room" : "/question-room";
}

export function questionRoomRoomPath(roomId: string, actor: QuestionRoomActor): string {
  return roomDetailPath(questionRoomBasePath(actor), roomId);
}

export function questionRoomThreadPath(roomId: string, threadId: string, actor: QuestionRoomActor): string {
  return threadDetailPath(questionRoomBasePath(actor), roomId, threadId);
}

function normalizedThread(p: QuestionRoomRedirectParams): string {
  return typeof p.thread === "string" ? p.thread.trim() : "";
}

/** 멘토 메시지/첨부(kind=message) + thread 확정 시에만 정본 thread 상세 경로. */
export function usesCanonicalThreadDetailBase(
  actor: QuestionRoomActor,
  p: QuestionRoomRedirectParams
): boolean {
  return actor === "mentor" && p.kind === "message" && normalizedThread(p).length > 0;
}

export function questionRoomRedirectBasePath(
  roomId: string,
  actor: QuestionRoomActor,
  p: QuestionRoomRedirectParams
): string {
  if (usesCanonicalThreadDetailBase(actor, p)) {
    return questionRoomThreadPath(roomId, normalizedThread(p), actor);
  }
  return questionRoomRoomPath(roomId, actor);
}

export function buildQuestionRoomRedirectUrl(
  roomId: string,
  actor: QuestionRoomActor,
  p: QuestionRoomRedirectParams,
  nowMs?: number
): string {
  const canonicalThreadBase = usesCanonicalThreadDetailBase(actor, p);
  const basePath = questionRoomRedirectBasePath(roomId, actor, p);
  const qs = new URLSearchParams();
  // 정본 thread 상세 경로에서는 thread 가 path segment 이므로 `?thread=` 중복을 붙이지 않는다.
  // (thread 쿼리 소비자는 room 페이지뿐 — thread 상세 페이지는 읽지 않음.)
  if (p.thread && !canonicalThreadBase) qs.set("thread", p.thread);
  if (p.ok) qs.set("ok", p.ok);
  if (p.error) qs.set("error", p.error);
  if (p.kind) qs.set("kind", p.kind);
  if (p.draftThread !== undefined) qs.set("dThread", draftToParam(p.draftThread));
  if (p.draftMessage !== undefined) qs.set("dMessage", draftToParam(p.draftMessage));
  if (p.draftNote !== undefined) qs.set("dNote", draftToParam(p.draftNote));
  qs.set("t", String(nowMs ?? Date.now()));
  const query = qs.toString();
  return query ? `${basePath}?${query}` : basePath;
}
