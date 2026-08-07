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
import { loadMentorDisplaysForQuestionRooms, roomSubjectChips } from "@/lib/qna/questionRoomStudentDisplay";
import {
  loadInitialWeeklyUsageSnapshots,
  loadMessageStatsByThreadId,
  loadQuestionRoomSubscriptionContext,
  loadUnreadCountsByRoomId,
} from "@/lib/qna/questionRoomStudentContext";
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

export default async function StudentQuestionThreadDetailPage(props: Props) {
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

  const { user } = await requireRole("student");
  const supabase = await createClient();
  const allowed = await userCanAccessMentorStudentRoom(supabase, user.id, "student", roomId);
  if (!allowed) {
    notFound();
  }

  const [listBundle, detail] = await Promise.all([
    loadQuestionRoomListBundle(supabase, "student", user.id),
    loadQuestionRoomDetailBundle(supabase, user.id, "student", roomId, threadId),
  ]);
  const { resolvedThreadId, ...bundle } = detail;
  if (!resolvedThreadId) {
    notFound();
  }

  const mentorDisplays = await loadMentorDisplaysForQuestionRooms(supabase, listBundle.rooms.rows);
  const currentRoom = listBundle.rooms.rows.find((r) => r && String(r.id) === String(roomId)) ?? null;

  const threadIds = bundle.threads.rows
    .map((t) => (t?.id != null ? String(t.id) : ""))
    .filter((id) => id.length > 0);
  const roomIds = listBundle.rooms.rows
    .map((r) => (r?.id != null ? String(r.id) : ""))
    .filter((id) => id.length > 0);

  const [
    subscriptionContext,
    initialUsageByMentorId,
    messageStats,
    unreadCountsByRoomId,
    attachments,
    lastAttachmentByThreadId,
  ] = await Promise.all([
    loadQuestionRoomSubscriptionContext(supabase, user.id, currentRoom),
    loadInitialWeeklyUsageSnapshots(supabase, user.id, listBundle.rooms.rows),
    loadMessageStatsByThreadId(supabase, threadIds),
    loadUnreadCountsByRoomId(supabase, roomIds),
    loadThreadAttachmentsWithUrls(supabase, resolvedThreadId),
    loadLastAttachmentByThreadId(supabase, threadIds),
  ]);
  const messageCountsByThreadId = messageStats.counts;
  const lastMessageByThreadId = messageStats.last;

  const subjectOptions = currentRoom ? roomSubjectChips(currentRoom, mentorDisplays, 8) : [];
  const initialNoteText = extractNoteText(bundle.notes.rows[0]);

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
        variant="student"
        surface="detail"
        currentUserId={user.id}
        actionFeedback={{ kind: feedbackKind, ok: okMessage, error: errorMessageUi }}
        title="질문방"
        subtitle=""
        rooms={listBundle.rooms}
        threads={bundle.threads}
        messages={bundle.messages}
        attachments={attachments}
        lastAttachmentByThreadId={lastAttachmentByThreadId}
        notes={bundle.notes}
        roomId={roomId}
        threadId={resolvedThreadId}
        listPreviewsByRoomId={listBundle.listPreviewsByRoomId}
        mentorDisplays={mentorDisplays}
        initialUsageByMentorId={initialUsageByMentorId}
        messageCountsByThreadId={messageCountsByThreadId}
        lastMessageByThreadId={lastMessageByThreadId}
        unreadCountsByRoomId={unreadCountsByRoomId}
        subscriptionContext={subscriptionContext}
        subjectOptions={subjectOptions}
        roomHrefBase="/question-room"
        initialNoteText={initialNoteText}
        draftMessageBody={draftMessageBody}
        draftNoteBody={draftNoteBody}
        formRevision={formRevision}
        showChatPanel
        threadDetailMode
        backHref={roomDetailPath("/question-room", roomId)}
      />
    </PageScaffold>
  );
}
