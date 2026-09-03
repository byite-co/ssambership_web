import { QuestionDetailScreen } from "@/components/admin/QuestionDetailScreen";
import { requireRole } from "@/lib/auth/routeGuard";
import { QUESTION_DRILLDOWN_RETURN_TO_PARAM } from "@/lib/admin/questionDrilldownConsole";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * 관리자 · 구독 질문 상세(PR-8 §4) — `question_threads` 한 건의 대화 전문. 개별질문 상세와 **같은 컴포넌트**(`QuestionDetailScreen` → `QuestionConversationView`).
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다. 읽기 전용 · 렌더 시 열람 기록 1건.
 */
export default async function AdminQuestionThreadPage(props: Props) {
  const { user } = await requireRole("admin");
  const { id } = await props.params;
  const sp = (await props.searchParams) ?? {};
  return <QuestionDetailScreen kind="thread" id={id} returnToRaw={pick(sp[QUESTION_DRILLDOWN_RETURN_TO_PARAM])} adminId={user.id} />;
}
