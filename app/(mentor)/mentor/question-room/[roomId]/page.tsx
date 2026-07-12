import { notFound } from "next/navigation";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { QuestionRoomWorkspace } from "@/components/qna/QuestionRoomWorkspace";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { fetchMessagesForThread, loadQuestionRoomDetailBundle, loadQuestionRoomListBundle, userCanAccessMentorStudentRoom } from "@/lib/qna/questionRoomQueries";
import {
  loadMentorUnreadCountsByRoomId,
  loadStudentDisplaysForQuestionRooms,
} from "@/lib/qna/questionRoomMentorContext";
import {
  loadLastMessageByThreadId,
  loadMessageCountsByThreadId,
  loadQuestionRoomSubscriptionContext,
} from "@/lib/qna/questionRoomStudentContext";
import { fetchWeeklyQuestionUsageWithFallback } from "@/lib/qna/weeklyQuestionUsage";
import { partyUserIdFromRoomRow } from "@/lib/qna/questionRoomUiLabels";
import { loadFreeTrialThreadIdsForMentorRoom, sortThreadsFreeTrialFirst } from "@/lib/qna/freeTrialPriority";
import {
  loadLastAttachmentByThreadId,
  loadThreadAttachmentsWithUrls,
} from "@/lib/qna/questionRoomAttachmentsQueries";
import { extractNoteText } from "@/lib/qna/questionRoomMutations";
import { paramToDraft } from "@/lib/qna/draftQuery";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";

type Props = {
  params: Promise<{ roomId: string }>;
  searchParams?: Promise<{
    thread?: string;
    ok?: string;
    error?: string;
    kind?: "thread" | "message" | "note";
    t?: string;
    dThread?: string;
    dMessage?: string;
    dNote?: string;
  }>;
};

export default async function MentorQuestionRoomDetailPage(props: Props) {
  const { roomId } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const threadFromQuery = typeof sp.thread === "string" && sp.thread.length ? sp.thread : null;
  const okMessage = typeof sp.ok === "string" && sp.ok.length ? sp.ok : null;
  const rawActionError = typeof sp.error === "string" && sp.error.length ? sp.error : null;
  const errorMessageUi = rawActionError ? mapDataErrorMessage(rawActionError) : null;
  const feedbackKind = sp.kind === "thread" || sp.kind === "message" || sp.kind === "note" ? sp.kind : undefined;
  const dMessageQ = paramToDraft(typeof sp.dMessage === "string" ? sp.dMessage : undefined);
  const draftMessageBody = feedbackKind === "message" && rawActionError ? (dMessageQ ?? "") : undefined;
  const formRevision = typeof sp.t === "string" && sp.t.length ? sp.t : "0";

  const { user } = await requireRole("mentor");
  const supabase = await createClient();
  const allowed = await userCanAccessMentorStudentRoom(supabase, user.id, "mentor", roomId);
  if (!allowed) {
    notFound();
  }

  const [listBundle, detail] = await Promise.all([
    loadQuestionRoomListBundle(supabase, "mentor", user.id),
    loadQuestionRoomDetailBundle(supabase, user.id, "mentor", roomId, threadFromQuery),
  ]);
  const { resolvedThreadId, ...bundle } = detail;

  const threadIds = bundle.threads.rows
    .map((t) => (t?.id != null ? String(t.id) : ""))
    .filter((id) => id.length > 0);
  const roomIds = listBundle.rooms.rows
    .map((r) => (r?.id != null ? String(r.id) : ""))
    .filter((id) => id.length > 0);

  const [
    studentDisplays,
    messageCountsByThreadId,
    lastMessageByThreadId,
    unreadCountsByRoomId,
    lastAttachmentByThreadId,
  ] = await Promise.all([
    loadStudentDisplaysForQuestionRooms(supabase, listBundle.rooms.rows),
    loadMessageCountsByThreadId(supabase, threadIds),
    loadLastMessageByThreadId(supabase, threadIds),
    loadMentorUnreadCountsByRoomId(supabase, roomIds),
    loadLastAttachmentByThreadId(supabase, threadIds),
  ]);

  const initialNoteText = extractNoteText(bundle.notes.rows[0]);

  // 이 학생의 구독 요금제·이번 주 잔여 질문(읽기 전용 표시용). 기존 학생 로직 재사용.
  const currentRoom = listBundle.rooms.rows.find((r) => r && String(r.id) === String(roomId)) ?? null;
  const studentId = currentRoom ? partyUserIdFromRoomRow(currentRoom, "student") : null;

  // 무료 체험(무료 질문권) 스레드 우선 노출: 목록 최상단 고정 + 명시 선택이 없으면 자동 선택
  const freeTrialThreadIds = await loadFreeTrialThreadIdsForMentorRoom(supabase, user.id, studentId, roomId);
  const sortedThreadRows = sortThreadsFreeTrialFirst(bundle.threads.rows, freeTrialThreadIds);
  const threads = { ...bundle.threads, rows: sortedThreadRows };
  const effectiveThreadId =
    !threadFromQuery && sortedThreadRows[0]?.id != null ? String(sortedThreadRows[0].id) : resolvedThreadId;
  // 자동 선택 스레드가 바뀌었으면(무료 체험 우선) 메시지도 해당 스레드 기준으로 재조회
  const messages =
    effectiveThreadId && effectiveThreadId !== resolvedThreadId
      ? { ...(await fetchMessagesForThread(supabase, effectiveThreadId)), loading: false }
      : bundle.messages;
  const attachments = await loadThreadAttachmentsWithUrls(supabase, effectiveThreadId);

  const [subscriptionContext, weeklyUsageResult] = studentId
    ? await Promise.all([
        loadQuestionRoomSubscriptionContext(supabase, studentId, currentRoom),
        fetchWeeklyQuestionUsageWithFallback(supabase, studentId, user.id),
      ])
    : [null, null];
  const studentWeeklyUsage = weeklyUsageResult?.usage ?? null;

  return (
    <PageScaffold
      hideHero
      eyebrow="질문방"
      title=""
      description=""
      ctas={[]}
      sections={[]}
      dataPoints={[]}
      hideFooterPlaceholderCards
    >
      <QuestionRoomWorkspace
        variant="mentor"
        surface="detail"
        currentUserId={user.id}
        actionFeedback={{ kind: feedbackKind, ok: okMessage, error: errorMessageUi }}
        title="질문방"
        subtitle=""
        rooms={listBundle.rooms}
        threads={threads}
        messages={messages}
        attachments={attachments}
        lastAttachmentByThreadId={lastAttachmentByThreadId}
        notes={bundle.notes}
        roomId={roomId}
        threadId={effectiveThreadId}
        freeTrialThreadIds={freeTrialThreadIds}
        listPreviewsByRoomId={listBundle.listPreviewsByRoomId}
        studentDisplays={studentDisplays}
        messageCountsByThreadId={messageCountsByThreadId}
        lastMessageByThreadId={lastMessageByThreadId}
        unreadCountsByRoomId={unreadCountsByRoomId}
        roomHrefBase="/mentor/question-room"
        initialNoteText={initialNoteText}
        draftMessageBody={draftMessageBody}
        formRevision={formRevision}
        subscriptionContext={subscriptionContext}
        studentWeeklyUsage={studentWeeklyUsage}
      />
    </PageScaffold>
  );
}
