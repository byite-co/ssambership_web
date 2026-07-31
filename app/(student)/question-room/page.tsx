import { redirect } from "next/navigation";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { QuestionRoomWorkspace } from "@/components/qna/QuestionRoomWorkspace";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { ensureFreeQuestionRoomForStudent } from "@/lib/qna/freeQuestionRoom";
import { loadQuestionRoomListBundle } from "@/lib/qna/questionRoomQueries";
import { loadMentorDisplaysForQuestionRooms } from "@/lib/qna/questionRoomStudentDisplay";

type Props = { searchParams?: Promise<{ mentorId?: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function roomMentorId(row: Record<string, unknown>): string | null {
  const m = row.mentor_id ?? row.mentor_user_id ?? row.mentor_uid ?? null;
  return typeof m === "string" && m.length > 0 ? m : null;
}

export default async function StudentQuestionRoomListPage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  const mentorIdParam = typeof sp.mentorId === "string" && UUID_RE.test(sp.mentorId.trim()) ? sp.mentorId.trim() : null;

  const { user } = await requireRole("student");
  const supabase = await createClient();
  const bundle = await loadQuestionRoomListBundle(supabase, "student", user.id);

  // 멘토 상세의 "무료 질문권 사용하기" 진입: 해당 멘토와의 방으로 이동하고,
  // 방이 없으면 무료 질문권 검증 후 구독 없이 방을 만들어 진입시킨다.
  let freeQuestionNotice: string | null = null;
  if (mentorIdParam) {
    const existing = bundle.rooms.rows.find((r) => roomMentorId(r as Record<string, unknown>) === mentorIdParam);
    if (existing?.id != null && String(existing.id).length > 0) {
      redirect(`/question-room/${encodeURIComponent(String(existing.id))}`);
    }
    const ensured = await ensureFreeQuestionRoomForStudent(supabase, mentorIdParam);
    if (ensured.ok) {
      redirect(`/question-room/${encodeURIComponent(ensured.roomId)}`);
    }
    freeQuestionNotice = ensured.userMessage;
  }

  if (!mentorIdParam) {
    const firstRoomId = bundle.rooms.rows[0]?.id;
    if (firstRoomId != null && String(firstRoomId).length > 0) {
      redirect(`/question-room/${encodeURIComponent(String(firstRoomId))}`);
    }
  }

  const mentorDisplays = await loadMentorDisplaysForQuestionRooms(supabase, bundle.rooms.rows);

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
      {freeQuestionNotice ? (
        <p
          className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900"
          role="status"
        >
          {freeQuestionNotice}
        </p>
      ) : null}
      <QuestionRoomWorkspace
        variant="student"
        surface="list"
        title="구독 질문방"
        subtitle="멘토를 구독하면 질문방이 열립니다."
        rooms={bundle.rooms}
        threads={bundle.threads}
        messages={bundle.messages}
        notes={bundle.notes}
        listPreviewsByRoomId={bundle.listPreviewsByRoomId}
        mentorDisplays={mentorDisplays}
        listStartQuestion={{ href: "/mentors", label: "질문방 구독하기" }}
        listSecondaryCta={{ href: "/subscriptions", label: "구독·멤버십" }}
        roomHrefBase="/question-room"
      />
    </PageScaffold>
  );
}
