import { notFound, redirect } from "next/navigation";
import "@/app/(public)/custom-request/landing.css";
import { IndividualQuestionDetailView } from "@/components/individualQuestion/IndividualQuestionViews";
import { requireRole } from "@/lib/auth/routeGuard";
import { fetchIndividualQuestionDetail } from "@/lib/individualQuestion/individualQuestionQueries";
import { assertMentorApprovedForAction } from "@/lib/mentor/mentorVerificationGate";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ questionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function MentorIndividualQuestionDetailPage(props: PageProps) {
  const { user } = await requireRole("mentor");
  const { questionId } = await props.params;
  const sp = (await props.searchParams) ?? {};
  const supabase = await createClient();
  const approval = await assertMentorApprovedForAction(supabase, user.id);
  if (!approval.ok) redirect("/mentor/individual-questions");

  const { detail, error } = await fetchIndividualQuestionDetail(supabase, questionId);
  if (error || !detail) notFound();
  const ownsDirect = detail.question_type === "direct" && detail.designated_mentor_id === user.id;
  const ownsOpen = detail.question_type === "open" && detail.claimed_mentor_id === user.id;
  if (!ownsDirect && !ownsOpen) {
    redirect("/mentor/individual-questions");
  }

  const answered = firstParam(sp.answered);
  const claimed = firstParam(sp.claimed);
  const sent = firstParam(sp.sent);

  return (
    <IndividualQuestionDetailView
      detail={detail}
      actor="mentor"
      backHref="/mentor/individual-questions"
      backLabel="개별 질문 목록"
      flash={
        answered
          ? "답변을 확정했어요. 학생이 [해결 완료]를 누르면 안전 보관 중인 캐시가 정산돼요."
          : sent
            ? "메시지를 보냈어요."
            : claimed
              ? "공개 질문 답변을 맡았어요. 이제 답변을 작성할 수 있습니다."
              : null
      }
      justSent={Boolean(sent)}
    />
  );
}
