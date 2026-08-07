import { notFound } from "next/navigation";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { QuestionRoomWorkspace } from "@/components/qna/QuestionRoomWorkspace";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import {
  loadQuestionRoomDetailBundle,
  loadQuestionRoomListBundle,
  userCanAccessMentorStudentRoom,
} from "@/lib/qna/questionRoomQueries";
import {
  loadMentorUnreadCountsByRoomId,
  loadStudentDisplaysForQuestionRooms,
} from "@/lib/qna/questionRoomMentorContext";
import {
  loadMessageStatsByThreadId,
  loadQuestionRoomSubscriptionContext,
} from "@/lib/qna/questionRoomStudentContext";
import { fetchWeeklyQuestionUsagePairParty } from "@/lib/qna/weeklyQuestionUsage";
import { partyUserIdFromRoomRow } from "@/lib/qna/questionRoomUiLabels";
import { loadFreeTrialThreadIdsForMentorRoom, sortThreadsFreeTrialFirst } from "@/lib/qna/freeTrialPriority";
import {
  loadLastAttachmentByThreadId,
  loadThreadAttachmentsWithUrls,
} from "@/lib/qna/questionRoomAttachmentsQueries";
import { extractNoteText } from "@/lib/qna/questionRoomMutations";
import { paramToDraft } from "@/lib/qna/draftQuery";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";
import { roomDetailPath } from "@/lib/qna/formatQuestionRoomDisplay";

type Props = {
  params: Promise<{ roomId: string; threadId: string }>;
  searchParams?: Promise<{
    ok?: string;
    error?: string;
    kind?: "thread" | "message" | "note";
    t?: string;
    dMessage?: string;
    dNote?: string;
  }>;
};

/**
 * 멘토 질문방 → 특정 스레드 상세.
 * 학생 동등 라우트(`/(student)/question-room/[roomId]/thread/[threadId]`)와 같은 형태로
 * `threadInRoomPath("/mentor/question-room", ...)`이 생성하는 멘토 URL을 받아준다.
 * 누락 시 mentor 측 thread 링크가 404로 떨어졌음.
 */
export default async function MentorQuestionThreadDetailPage(props: Props) {
  const { roomId, threadId } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const okMessage = typeof sp.ok === "string" && sp.ok.length ? sp.ok : null;
  const rawActionError = typeof sp.error === "string" && sp.error.length ? sp.error : null;
  const errorMessageUi = rawActionError ? mapDataErrorMessage(rawActionError) : null;
  const feedbackKind = sp.kind === "thread" || sp.kind === "message" || sp.kind === "note" ? sp.kind : undefined;
  const dMessageQ = paramToDraft(typeof sp.dMessage === "string" ? sp.dMessage : undefined);
  const dNoteQ = paramToDraft(typeof sp.dNote === "string" ? sp.dNote : undefined);
  const draftMessageBody = feedbackKind === "message" && rawActionError ? (dMessageQ ?? "") : undefined;
  const draftNoteBody = feedbackKind === "note" && rawActionError ? (dNoteQ ?? "") : undefined;
  const formRevision = typeof sp.t === "string" && sp.t.length ? sp.t : "0";

  const { user } = await requireRole("mentor");
  const supabase = await createClient();
  const allowed = await userCanAccessMentorStudentRoom(supabase, user.id, "mentor", roomId);
  if (!allowed) {
    notFound();
  }

  const [listBundle, detail] = await Promise.all([
    loadQuestionRoomListBundle(supabase, "mentor", user.id),
    loadQuestionRoomDetailBundle(supabase, user.id, "mentor", roomId, threadId),
  ]);
  const { resolvedThreadId, ...bundle } = detail;
  if (!resolvedThreadId) {
    notFound();
  }

  const threadIds = bundle.threads.rows
    .map((t) => (t?.id != null ? String(t.id) : ""))
    .filter((id) => id.length > 0);
  const roomIds = listBundle.rooms.rows
    .map((r) => (r?.id != null ? String(r.id) : ""))
    .filter((id) => id.length > 0);

  const [
    studentDisplays,
    messageStats,
    unreadCountsByRoomId,
    attachments,
    lastAttachmentByThreadId,
  ] = await Promise.all([
    loadStudentDisplaysForQuestionRooms(supabase, listBundle.rooms.rows),
    loadMessageStatsByThreadId(supabase, threadIds),
    loadMentorUnreadCountsByRoomId(supabase, roomIds),
    loadThreadAttachmentsWithUrls(supabase, resolvedThreadId),
    loadLastAttachmentByThreadId(supabase, threadIds),
  ]);
  const messageCountsByThreadId = messageStats.counts;
  const lastMessageByThreadId = messageStats.last;

  const initialNoteText = extractNoteText(bundle.notes.rows[0]);

  const currentRoom = listBundle.rooms.rows.find((r) => r && String(r.id) === String(roomId)) ?? null;
  const studentId = currentRoom ? partyUserIdFromRoomRow(currentRoom, "student") : null;

  // D-QR-9: 방 상세와 동일하게 무료 체험 스레드를 최상단 고정 + 배지용 id 를 주입한다.
  // (스레드 상세에서만 정렬·배지가 사라져 우선 처리 대상을 놓치던 문제 제거.)
  const freeTrialThreadIds = await loadFreeTrialThreadIdsForMentorRoom(supabase, user.id, studentId, roomId);
  const sortedThreadRows = sortThreadsFreeTrialFirst(bundle.threads.rows, freeTrialThreadIds);
  const threads = { ...bundle.threads, rows: sortedThreadRows };

  const [subscriptionContext, weeklyUsageResult] = studentId
    ? await Promise.all([
        loadQuestionRoomSubscriptionContext(supabase, studentId, currentRoom),
        fetchWeeklyQuestionUsagePairParty(supabase, studentId, user.id),
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
        messages={bundle.messages}
        attachments={attachments}
        lastAttachmentByThreadId={lastAttachmentByThreadId}
        notes={bundle.notes}
        roomId={roomId}
        threadId={resolvedThreadId}
        freeTrialThreadIds={freeTrialThreadIds}
        listPreviewsByRoomId={listBundle.listPreviewsByRoomId}
        studentDisplays={studentDisplays}
        messageCountsByThreadId={messageCountsByThreadId}
        lastMessageByThreadId={lastMessageByThreadId}
        unreadCountsByRoomId={unreadCountsByRoomId}
        roomHrefBase="/mentor/question-room"
        initialNoteText={initialNoteText}
        draftMessageBody={draftMessageBody}
        draftNoteBody={draftNoteBody}
        formRevision={formRevision}
        subscriptionContext={subscriptionContext}
        studentWeeklyUsage={studentWeeklyUsage}
        showChatPanel
        threadDetailMode
        backHref={roomDetailPath("/mentor/question-room", roomId)}
      />
    </PageScaffold>
  );
}
