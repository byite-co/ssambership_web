/**
 * 질문 상세 화면 틀(§4) — 두 라우트(`/admin/question-threads/[id]` · `/admin/individual-questions/[id]`)가 같은 틀을 쓴다. Server Component.
 *
 * 순서: service_role 조회 → 있으면 **열람 기록 1건**(`admin_action_logs.question_body_viewed`, 원칙 3 — 화면에는 아무것도 뜨지 않는다) → 공통 컴포넌트 렌더.
 * `←` 는 `returnTo`(계정 상세 · 멘토별 화면만 허용)로, 없으면 조회 모듈이 정한 기본 경로로.
 */
import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { QuestionConversationView } from "@/components/admin/QuestionConversationView";
import { EmptyState } from "@/components/common/EmptyState";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { buildQuestionBodyViewedLog, resolveQuestionDetailReturnPath, returnLinkLabel, type QuestionDetailKind } from "@/lib/admin/questionDrilldownConsole";
import { refreshQuestionAttachmentDocumentAction } from "@/lib/admin/questionDrilldownDocumentActions";
import { QUESTION_READ_UNAVAILABLE_MESSAGE, loadIndividualQuestionConversation, loadQuestionThreadConversation, serviceRoleOrNull } from "@/lib/admin/questionDrilldownQueries";

type Props = {
  kind: QuestionDetailKind;
  id: string;
  /** 페이지가 넘긴 `returnTo` 원문(검증 전) */
  returnToRaw: string;
  /** 열람 기록의 admin_id — `requireRole("admin")` 의 user.id */
  adminId: string;
};

const BACK_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";
const TITLE_BY_KIND: Record<QuestionDetailKind, string> = { thread: "질문 상세 — 구독 질문", individual: "질문 상세 — 개별질문" };

export async function QuestionDetailScreen({ kind, id, returnToRaw, adminId }: Props) {
  const allowedReturn = resolveQuestionDetailReturnPath(returnToRaw);
  const db = serviceRoleOrNull();
  if (!db) {
    return (
      <AdminPageLayout title={TITLE_BY_KIND[kind]} actions={<Link href={allowedReturn ?? "/admin/users"} className={BACK_LINK} prefetch={false}>{allowedReturn ? returnLinkLabel(allowedReturn) : "← 계정 목록"}</Link>}>
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          {QUESTION_READ_UNAVAILABLE_MESSAGE}
        </p>
      </AdminPageLayout>
    );
  }

  const { conversation, error } = kind === "thread" ? await loadQuestionThreadConversation(db, id) : await loadIndividualQuestionConversation(db, id);
  const backHref = allowedReturn ?? conversation?.defaultReturnPath ?? "/admin/users";
  const backLink = (
    <Link href={backHref} className={BACK_LINK} prefetch={false}>
      {allowedReturn ? returnLinkLabel(allowedReturn) : conversation?.kind === "thread" ? "← 멘토별 화면" : "← 계정 상세"}
    </Link>
  );

  if (!conversation) {
    return (
      <AdminPageLayout title={TITLE_BY_KIND[kind]} actions={backLink}>
        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
            {error}
          </p>
        ) : (
          <EmptyState title="해당 질문을 찾을 수 없습니다" description="삭제됐거나 주소가 잘못되었을 수 있습니다. 목록에서 다시 선택해 주세요." />
        )}
      </AdminPageLayout>
    );
  }

  // 원칙 3 — 본문을 렌더할 때 열람 기록 한 줄(서버 기록일 뿐, 화면에는 아무것도 뜨지 않고 관리자가 누르는 것도 없다).
  await logAdminAction(db, {
    adminId,
    ...buildQuestionBodyViewedLog({
      kind,
      id: conversation.id,
      roomId: conversation.roomId,
      studentId: conversation.party.studentId,
      mentorId: conversation.party.mentorId,
      messageCount: conversation.messages.length,
      attachmentCount: conversation.attachments.length,
    }),
  });

  return (
    <AdminPageLayout
      title={conversation.title}
      description={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{TITLE_BY_KIND[kind]}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-xs text-slate-500" title={conversation.id}>
            {conversation.id}
          </span>
        </span>
      }
      actions={backLink}
    >
      <QuestionConversationView conversation={conversation} refreshSource={refreshQuestionAttachmentDocumentAction} />
    </AdminPageLayout>
  );
}
