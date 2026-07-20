import { CheckCircle2 } from "lucide-react";
import type { QuestionThreadWorkflowStatus } from "@/lib/qna/questionThreadStatus";

/**
 * P1-8A: 스레드 상태 표시(비상호작용).
 *
 * `answered` 전이는 오직 멘토의 첫 메시지(`qna_append_message`)/첫 첨부(`qna_register_attachment`)
 * 등록 시에만 서버(RPC)에서 발생한다. 본문·첨부 없이 status 만 바꾸는 "답변 완료" 직접 write 경로는
 * 폐지됐다(별도 status-only RPC 도 만들지 않음). 따라서 pending 상태에서는 안내만 노출한다.
 */
export function QuestionThreadAnswerCompleteButton(props: {
  roomId: string;
  threadId: string;
  workflowStatus?: QuestionThreadWorkflowStatus;
  disabled?: boolean;
}) {
  const workflowStatus = props.workflowStatus ?? "pending";

  if (workflowStatus === "pending") {
    return (
      <span className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-[12px] font-bold text-slate-500">
        답변을 작성하면 자동으로 완료돼요
      </span>
    );
  }

  const confirmed = workflowStatus === "confirmed";
  return (
    <span
      aria-disabled="true"
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2 text-[12px] font-black shadow-sm ${
        confirmed ? "border-slate-200 bg-slate-50 text-slate-600" : "border-blue-100 bg-blue-50 text-blue-700"
      }`}
    >
      <CheckCircle2 className="h-4 w-4" />
      {confirmed ? "학생 확인 완료" : "답변 완료됨 · 학생 확인 대기"}
    </span>
  );
}
