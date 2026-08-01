"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireQnaActor } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import {
  buildQuestionRoomRedirectUrl,
  questionRoomRoomPath,
  questionRoomThreadPath,
  type QuestionRoomRedirectParams,
} from "@/lib/qna/questionRoomRedirect";
import { QUESTION_THREADS_ROOM_FK, threadRowBelongsToMentorStudentRoom } from "@/lib/qna/questionThreadRoomRef";
import { userMatchesMentorInRoomRow, userMatchesStudentInRoomRow } from "@/lib/qna/questionRoomQueries";
import { isQuestionThreadLockedForMessages } from "@/lib/qna/questionRoomUiLabels";
import { assertThreadCreationSubscriptionAllowed } from "@/lib/qna/questionThreadSubscriptionGuard";
import { assertConnectionNoteWriteAllowed } from "@/lib/qna/connectionNoteSubscriptionGuard";
import { assertMentorApprovedForAction } from "@/lib/mentor/mentorVerificationGate";
import { assertAccountActive } from "@/lib/auth/accountStatus";
import {
  formatActionError,
  readMessageFromForm,
  readNoteFromForm,
  readThreadTitleFromForm,
  saveConnectionNote,
} from "@/lib/qna/questionRoomMutations";
import {
  appendQuestionMessageViaRpc,
  createQuestionThreadViaRpc,
  registerQuestionAttachmentViaRpc,
} from "@/lib/qna/questionRoomRpc";

/**
 * formatActionError 결과에도 Postgrest/HTTP/긴 raw가 남을 수 있으므로, URL 쿼리(사용자 노출)엔 이 함수를 쓴다.
 */
function userFacingActionError(action: "thread" | "message" | "note", err: string): string {
  const s = String(err);
  if (
    /PGRST|postgrest|pg[_\d]|https?:\/\/|\"(hint|code|details)\"|permission denied|violates|relation|schema cache|does not exist|Could not find|42703|42P01|22P02|23503/i.test(
      s
    ) ||
    s.length > 400
  ) {
    if (action === "thread") {
      return "질문 주제를 추가하지 못했습니다. 잠시 후 다시 시도해 주세요.";
    }
    if (action === "message") {
      return "메시지를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.";
    }
    return "메모를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return formatActionError(action, s);
}

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function listPathForActor(actor: "student" | "mentor"): string {
  return actor === "mentor" ? "/mentor/question-room" : "/question-room";
}

function detailBasePath(roomId: string, actor: "student" | "mentor"): string {
  return questionRoomRoomPath(roomId, actor);
}

/**
 * D-27: 경로 선택·쿼리 조립은 순수 함수(`lib/qna/questionRoomRedirect.ts`)로 분리 —
 * 멘토 메시지/첨부(kind=message)+thread 는 정본 thread 상세 경로, 그 외 기존 계약 유지.
 */
function buildRedirectUrl(
  roomId: string,
  actor: "student" | "mentor",
  p: QuestionRoomRedirectParams
): string {
  return buildQuestionRoomRedirectUrl(roomId, actor, p);
}

/**
 * `auth.uid()`가 해당 room의 student_id / mentor_id 중 하나와 일치하는지,
 * 그리고 `actor`(DB 프로필)와 같은 당사자 열인지 검증. connection_notes 포함 모든 QnA 쓰기에 공통.
 */
async function assertMentorStudentRoomParty(
  supabase: SupabaseClient,
  roomId: string,
  userId: string,
  actor: "student" | "mentor"
): Promise<string | null> {
  const { data, error } = await supabase.from("mentor_student_rooms").select("*").eq("id", roomId).maybeSingle();
  if (error) {
    console.error("[assertMentorStudentRoomParty] mentor_student_rooms select", { roomId, code: error.code, message: error.message });
    return "room 정보를 확인하는 중 오류가 났습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (!data) return "이 room을 찾을 수 없습니다.";
  const row = data as Record<string, unknown>;
  const isStudent = userMatchesStudentInRoomRow(row, userId);
  const isMentor = userMatchesMentorInRoomRow(row, userId);
  if (!isStudent && !isMentor) {
    return "이 room의 학생·멘토 당사자가 아닙니다.";
  }
  if (actor === "student" && !isStudent) {
    return "이 room의 학생(의뢰자)만 이 작업을 할 수 있습니다.";
  }
  if (actor === "mentor" && !isMentor) {
    return "이 room의 멘토만 이 작업을 할 수 있습니다.";
  }
  return null;
}

/** thread가 해당 mentor_student_room(=roomId)에 속하는지 */
async function assertThreadBelongsToRoom(
  supabase: SupabaseClient,
  roomId: string,
  threadId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("question_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();
  if (error) {
    console.error("[assertThreadBelongsToRoom] question_threads select", { roomId, threadId, code: error.code, message: error.message });
    return "thread를 확인하는 중 오류가 났습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (!data) return "thread를 찾을 수 없습니다.";
  const row = data as Record<string, unknown>;
  if (!threadRowBelongsToMentorStudentRoom(row, roomId)) {
    console.error("[assertThreadBelongsToRoom] mismatch", {
      roomId,
      threadId,
      roomFk: QUESTION_THREADS_ROOM_FK,
      roomFkValue: row[QUESTION_THREADS_ROOM_FK] ?? null,
    });
    return "이 thread는 현재 room에 속하지 않습니다.";
  }
  return null;
}

/**
 * 완료(confirmed)·종료(closed/archived) 스레드에는 메시지 전송을 거절.
 * W4(C9 계열 정합): 조회 실패·행 부재 시에도 통과시키지 않는다(fail-closed —
 * 잠금 여부를 확인할 수 없으면 전송을 막는다. 구 fail-open 제거).
 */
async function assertThreadNotLockedForMessages(
  supabase: SupabaseClient,
  threadId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("question_threads")
    .select("id, status")
    .eq("id", threadId)
    .maybeSingle();
  if (error) {
    console.error("[assertThreadNotLockedForMessages] question_threads select", { threadId, code: error.code });
    return "질문 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (!data) {
    return "질문을 찾을 수 없습니다.";
  }
  if (isQuestionThreadLockedForMessages(data as Record<string, unknown>)) {
    return "완료된 질문에는 더 이상 메시지를 보낼 수 없어요. 새 질문을 작성해 주세요.";
  }
  return null;
}

export async function createQuestionThreadAction(formData: FormData) {
  const { user, actor } = await requireQnaActor();
  const roomId = textFromForm(formData.get("roomId"));
  const contextThreadId = textFromForm(formData.get("contextThreadId")) || null;
  if (!roomId) {
    redirect(listPathForActor(actor) + "?error=" + encodeURIComponent("room 정보가 없습니다."));
  }

  // 계정 정지/차단 가드 — 정지된 계정은 질문 작성 불가.
  {
    const supabaseAcct = await createClient();
    const acctGate = await assertAccountActive(supabaseAcct, user.id);
    if (!acctGate.ok) {
      redirect(listPathForActor(actor) + "?error=" + encodeURIComponent(acctGate.userMessage));
    }
  }

  if (actor === "mentor") {
    const supabaseEarly = await createClient();
    const roomErrEarly = await assertMentorStudentRoomParty(supabaseEarly, roomId, user.id, actor);
    if (roomErrEarly) {
      redirect(listPathForActor(actor) + "?error=" + encodeURIComponent(roomErrEarly));
    }
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: contextThreadId,
        kind: "thread",
        error: "질문 주제(스레드)는 학생만 새로 만들 수 있습니다. 학생이 주제를 만든 뒤 해당 스레드에 답변해 주세요.",
        draftThread: readThreadTitleFromForm(formData),
      })
    );
  }

  const supabase = await createClient();
  const roomErr = await assertMentorStudentRoomParty(supabase, roomId, user.id, actor);
  if (roomErr) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: contextThreadId,
        kind: "thread",
        error: userFacingActionError("thread", roomErr),
        draftThread: readThreadTitleFromForm(formData),
      })
    );
  }

  // P1-8A: 원자 RPC 로 생성 — 무료/활성구독 자격을 서버에서 분기하고, 무료면 free_question_usage 에
  //  thread_id 를 정본 링크로 기록(비원자·시각근접 오짝 제거). 계정상태·차단·멘토승인·자격은 RPC 재검사.
  const title = readThreadTitleFromForm(formData);
  const rpc = await createQuestionThreadViaRpc(supabase, { roomId, title });
  if (!rpc.ok) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: contextThreadId,
        kind: "thread",
        error: rpc.userMessage,
        draftThread: title,
      })
    );
  }

  const nextThreadId = rpc.threadId ?? contextThreadId;
  revalidatePath(detailBasePath(roomId, actor));
  redirect(
    buildRedirectUrl(roomId, actor, {
      thread: nextThreadId ?? null,
      kind: "thread",
      ok: "thread가 생성되어 자동 선택되었습니다.",
    })
  );
}

export async function createQuestionMessageAction(formData: FormData) {
  const { user, actor } = await requireQnaActor();
  const roomId = textFromForm(formData.get("roomId"));
  if (!roomId) {
    redirect(listPathForActor(actor) + "?error=" + encodeURIComponent("room 정보가 없습니다."));
  }

  const supabase = await createClient();
  const acctGateMsg = await assertAccountActive(supabase, user.id);
  if (!acctGateMsg.ok) {
    redirect(buildRedirectUrl(roomId, actor, { kind: "message", error: acctGateMsg.userMessage }));
  }
  /* question_messages.author_id = user.id (서버) — 폼/히든에서 user id 수신 없음 */
  const { threadId, content } = readMessageFromForm(formData);
  const fallbackThread = threadId || textFromForm(formData.get("contextThreadId")) || null;
  const roomErr = await assertMentorStudentRoomParty(supabase, roomId, user.id, actor);

  if (roomErr) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: fallbackThread,
        kind: "message",
        error: userFacingActionError("message", roomErr),
        draftMessage: content,
      })
    );
  }

  if (actor === "mentor") {
    const mentorGate = await assertMentorApprovedForAction(supabase, user.id);
    if (!mentorGate.ok) {
      redirect(
        buildRedirectUrl(roomId, actor, {
          thread: fallbackThread,
          kind: "message",
          error: mentorGate.error,
          draftMessage: content,
        })
      );
    }
  }

  const subGate = await assertThreadCreationSubscriptionAllowed(supabase, roomId, actor, {
    isNewThread: false,
    threadId: threadId || fallbackThread,
  });
  if (!subGate.ok) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: fallbackThread,
        kind: "message",
        error: subGate.userMessage,
        draftMessage: content,
      })
    );
  }

  if (threadId) {
    const tErr = await assertThreadBelongsToRoom(supabase, roomId, threadId);
    if (tErr) {
      redirect(
        buildRedirectUrl(roomId, actor, {
          thread: fallbackThread,
          kind: "message",
          error: userFacingActionError("message", tErr),
          draftMessage: content,
        })
      );
    }
    const lockErr = await assertThreadNotLockedForMessages(supabase, threadId);
    if (lockErr) {
      redirect(
        buildRedirectUrl(roomId, actor, {
          thread: fallbackThread,
          kind: "message",
          error: lockErr,
          draftMessage: content,
        })
      );
    }
  }

  // P1-8A: append RPC — 메시지 저장 + 멘토 첫 답변만 answered 전이 + record_domain_notification
  //  exactly-once 알림을 한 트랜잭션으로 처리(웹 best-effort 중복 알림 제거).
  const targetThread = threadId || fallbackThread || "";
  const appended = await appendQuestionMessageViaRpc(supabase, { threadId: targetThread, body: content });
  if (!appended.ok) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: threadId || fallbackThread,
        kind: "message",
        error: appended.userMessage,
        draftMessage: content,
      })
    );
  }

  revalidatePath(detailBasePath(roomId, actor));
  // D-27: 멘토는 정본 thread 상세 경로로 복귀하므로 그 경로도 함께 최신화한다.
  if (actor === "mentor" && targetThread) {
    revalidatePath(questionRoomThreadPath(roomId, targetThread, actor));
  }
  redirect(
    buildRedirectUrl(roomId, actor, {
      thread: threadId || fallbackThread,
      kind: "message",
      ok: actor === "mentor" ? "답변이 저장되었습니다. 입력창을 초기화했습니다." : "질문이 저장되었습니다. 입력창을 초기화했습니다.",
    })
  );
}

/**
 * P0: 질문/답변 메시지 전송. `createQuestionMessageAction`과 동일하며 room·thread·역할을 서버에서 다시 검증한다.
 * (폼의 `actor`·hidden id만으로는 권한을 판단하지 않음.)
 */
export const sendQuestionMessageAction = createQuestionMessageAction;

/**
 * STEP 5(첨부 v2): 질문방 채팅 파일/사진 첨부 전송.
 * 파일을 private 버킷에 업로드 → `question_attachments` 행 insert(필수, standalone).
 * 본문 마커·서명 URL 저장은 폐지(XV-ATTACH) — URL 은 표시 시점에 재발급된다.
 * room/thread/역할은 서버에서 재검증한다.
 */
export async function sendQuestionAttachmentAction(formData: FormData) {
  const { uploadQuestionRoomAttachment, removeQuestionRoomAttachmentObjectBestEffort } =
    await import("@/lib/qna/questionRoomAttachmentStorage");
  const { user, actor } = await requireQnaActor();
  const roomId = textFromForm(formData.get("roomId"));
  const threadId = textFromForm(formData.get("threadId"));
  if (!roomId) {
    redirect(listPathForActor(actor) + "?error=" + encodeURIComponent("room 정보가 없습니다."));
  }
  const fallbackThread = threadId || textFromForm(formData.get("contextThreadId")) || null;

  const file = formData.get("attachment");
  if (!(file instanceof File) || file.size === 0) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: fallbackThread,
        kind: "message",
        error: "첨부할 파일을 선택해 주세요.",
      })
    );
  }
  if (!threadId) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: fallbackThread,
        kind: "message",
        error: "질문을 먼저 선택한 뒤 파일을 첨부해 주세요.",
      })
    );
  }

  const supabase = await createClient();
  const roomErr = await assertMentorStudentRoomParty(supabase, roomId, user.id, actor);
  if (roomErr) {
    redirect(
      buildRedirectUrl(roomId, actor, { thread: fallbackThread, kind: "message", error: userFacingActionError("message", roomErr) })
    );
  }
  if (actor === "mentor") {
    const mentorGate = await assertMentorApprovedForAction(supabase, user.id);
    if (!mentorGate.ok) {
      redirect(
        buildRedirectUrl(roomId, actor, {
          thread: fallbackThread,
          kind: "message",
          error: mentorGate.error,
        })
      );
    }
  }
  const tErr = await assertThreadBelongsToRoom(supabase, roomId, threadId);
  if (tErr) {
    redirect(
      buildRedirectUrl(roomId, actor, { thread: fallbackThread, kind: "message", error: userFacingActionError("message", tErr) })
    );
  }
  const lockErr = await assertThreadNotLockedForMessages(supabase, threadId);
  if (lockErr) {
    redirect(
      buildRedirectUrl(roomId, actor, { thread: fallbackThread, kind: "message", error: lockErr })
    );
  }

  const subGate = await assertThreadCreationSubscriptionAllowed(supabase, roomId, actor, {
    isNewThread: false,
    threadId,
  });
  if (!subGate.ok) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: threadId,
        kind: "message",
        error: subGate.userMessage,
      })
    );
  }

  const typedFile = file as File;
  const buffer = Buffer.from(await typedFile.arrayBuffer());
  const uploaded = await uploadQuestionRoomAttachment(supabase, {
    roomId,
    threadId,
    buffer,
    mime: typedFile.type || "application/octet-stream",
    name: typedFile.name || "attachment",
  });
  if (uploaded.error || !uploaded.storagePath) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: threadId,
        kind: "message",
        error: uploaded.error ?? "첨부 업로드에 실패했습니다.",
      })
    );
  }

  // P1-8A: register RPC — 첨부 메타 등록(경로 thread-id 검증) + 멘토 첫 첨부 answered 전이 +
  //  record_domain_notification exactly-once 를 원자적으로. 첨부 행이 유일한 정본(§2-1).
  //  실패 시 방금 올린 미등록 Storage 객체만 보상 삭제(구조화 결과 — 조용히 은폐하지 않음).
  const registered = await registerQuestionAttachmentViaRpc(supabase, {
    threadId,
    storagePath: uploaded.storagePath,
    fileName: uploaded.filename,
    mimeType: uploaded.mime,
    messageId: null,
  });
  if (!registered.ok) {
    await removeQuestionRoomAttachmentObjectBestEffort(supabase, uploaded.storagePath);
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: threadId,
        kind: "message",
        error: registered.userMessage,
      })
    );
  }

  revalidatePath(detailBasePath(roomId, actor));
  // D-27: 멘토는 정본 thread 상세 경로로 복귀하므로 그 경로도 함께 최신화한다.
  if (actor === "mentor" && threadId) {
    revalidatePath(questionRoomThreadPath(roomId, threadId, actor));
  }
  redirect(
    buildRedirectUrl(roomId, actor, { thread: threadId, kind: "message", ok: "첨부를 전송했습니다." })
  );
}

export async function saveConnectionNoteAction(formData: FormData) {
  const { user, actor } = await requireQnaActor();
  const roomId = textFromForm(formData.get("roomId"));
  const contextThreadId = textFromForm(formData.get("contextThreadId")) || null;
  if (!roomId) {
    redirect(listPathForActor(actor) + "?error=" + encodeURIComponent("room 정보가 없습니다."));
  }

  const supabase = await createClient();
  const acctGateNote = await assertAccountActive(supabase, user.id);
  if (!acctGateNote.ok) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: acctGateNote.userMessage }));
  }
  const roomErr = await assertMentorStudentRoomParty(supabase, roomId, user.id, actor);
  const content = readNoteFromForm(formData);

  if (roomErr) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: contextThreadId,
        kind: "note",
        error: userFacingActionError("note", roomErr),
        draftNote: content,
      })
    );
  }

  // 만료된 구독에서 노트 편집 차단(읽기는 별도 RLS로 허용 유지).
  const noteGate = await assertConnectionNoteWriteAllowed(supabase, roomId, actor);
  if (!noteGate.ok) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: contextThreadId,
        kind: "note",
        error: noteGate.userMessage,
        draftNote: content,
      })
    );
  }

  const result = await saveConnectionNote({
    supabase,
    role: actor,
    userId: user.id,
    roomId,
    content,
  });

  if (!result.ok) {
    redirect(
      buildRedirectUrl(roomId, actor, {
        thread: contextThreadId,
        kind: "note",
        error: userFacingActionError("note", result.error),
        draftNote: content,
      })
    );
  }

  revalidatePath(detailBasePath(roomId, actor));
  redirect(
    buildRedirectUrl(roomId, actor, {
      thread: contextThreadId,
      kind: "note",
      ok: "connection note를 저장했습니다.",
    })
  );
}

// 연결 노트 수정 — 본인 author 만(RLS cn_update + 앱 author 검증 이중).
export async function updateConnectionNoteAction(formData: FormData) {
  const { user, actor } = await requireQnaActor();
  const noteId = textFromForm(formData.get("noteId"));
  const roomId = textFromForm(formData.get("roomId"));
  const contextThreadId = textFromForm(formData.get("contextThreadId")) || null;
  const content = readNoteFromForm(formData);
  if (!roomId || !noteId) {
    redirect(listPathForActor(actor) + "?error=" + encodeURIComponent("노트 정보가 없습니다."));
  }

  const supabase = await createClient();
  const acctGateNoteEdit = await assertAccountActive(supabase, user.id);
  if (!acctGateNoteEdit.ok) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: acctGateNoteEdit.userMessage }));
  }
  const roomErr = await assertMentorStudentRoomParty(supabase, roomId, user.id, actor);
  if (roomErr) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: userFacingActionError("note", roomErr) }));
  }
  if (!content.trim()) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: "노트 내용을 입력해 주세요." }));
  }

  // 만료된 구독에서 노트 수정 차단.
  const noteGate = await assertConnectionNoteWriteAllowed(supabase, roomId, actor);
  if (!noteGate.ok) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: noteGate.userMessage }));
  }

  // 작성자 본인 확인(앱 1차). RLS cn_update 가 author_id = auth.uid() 로 최종 보장.
  const { data: noteRow } = await supabase
    .from("connection_notes")
    .select("author_id")
    .eq("id", noteId)
    .maybeSingle();
  const authorId = typeof (noteRow as Record<string, unknown> | null)?.author_id === "string"
    ? String((noteRow as Record<string, unknown>).author_id)
    : null;
  if (!authorId || authorId !== user.id) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: "본인이 작성한 노트만 수정할 수 있습니다." }));
  }

  const { error } = await supabase.from("connection_notes").update({ body: content.trim() }).eq("id", noteId);
  if (error) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: userFacingActionError("note", error.message) }));
  }

  revalidatePath(detailBasePath(roomId, actor));
  redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", ok: "노트를 수정했습니다." }));
}

// 연결 노트 삭제 — 본인 author 만(RLS cn_delete + 앱 author 검증 이중).
export async function deleteConnectionNoteAction(formData: FormData) {
  const { user, actor } = await requireQnaActor();
  const noteId = textFromForm(formData.get("noteId"));
  const roomId = textFromForm(formData.get("roomId"));
  const contextThreadId = textFromForm(formData.get("contextThreadId")) || null;
  if (!roomId || !noteId) {
    redirect(listPathForActor(actor) + "?error=" + encodeURIComponent("노트 정보가 없습니다."));
  }

  const supabase = await createClient();
  const acctGateNoteDel = await assertAccountActive(supabase, user.id);
  if (!acctGateNoteDel.ok) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: acctGateNoteDel.userMessage }));
  }
  const roomErr = await assertMentorStudentRoomParty(supabase, roomId, user.id, actor);
  if (roomErr) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: userFacingActionError("note", roomErr) }));
  }

  // 만료된 구독에서 노트 삭제 차단.
  const noteGate = await assertConnectionNoteWriteAllowed(supabase, roomId, actor);
  if (!noteGate.ok) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: noteGate.userMessage }));
  }

  const { data: noteRow } = await supabase
    .from("connection_notes")
    .select("author_id")
    .eq("id", noteId)
    .maybeSingle();
  const authorId = typeof (noteRow as Record<string, unknown> | null)?.author_id === "string"
    ? String((noteRow as Record<string, unknown>).author_id)
    : null;
  if (!authorId || authorId !== user.id) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: "본인이 작성한 노트만 삭제할 수 있습니다." }));
  }

  const { error } = await supabase.from("connection_notes").delete().eq("id", noteId);
  if (error) {
    redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", error: userFacingActionError("note", error.message) }));
  }

  revalidatePath(detailBasePath(roomId, actor));
  redirect(buildRedirectUrl(roomId, actor, { thread: contextThreadId, kind: "note", ok: "노트를 삭제했습니다." }));
}
