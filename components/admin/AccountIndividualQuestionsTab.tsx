/**
 * 계정 상세 — [개별질문] 탭(학생 §1 · 구매한 건) / [개별질문 답변] 탭(멘토 §6 · 지정·수락한 건). 같은 표, 상대 열만 다르다. Server Component.
 *
 * - 학생 화면의 멘토 열은 **닉네임**(지정형 `designated_mentor_id` · 공개형 `claimed_mentor_id`, 없으면 `—`), 멘토 화면의 학생 열은 **실명**.
 * - 상태는 사전(`individual_questions.status`) · 지정/공개 배지 · 미답변 경과(24h 주의 · 48h 위험) · 첫 답변까지. 만료·환불 건도 남는다.
 * - 행의 제목 → 질문 상세(§4). `returnTo` 로 이 탭에 돌아온다. 상태 탭이 없는 단순 목록이라 공용 `AdminDataTable.Pagination` 만 쓴다.
 * - PR-13 §2: 상단 `내보내기`(`QuestionExportButton`) — 이 탭과 같은 조건(계정 단위)의 질문을 CSV 로. 감사 로그 1건.
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { QuestionExportButton } from "@/components/admin/QuestionExportButton";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import {
  EMPTY_MENTOR_INDIVIDUAL,
  EMPTY_STUDENT_INDIVIDUAL,
  buildAccountDrilldownReturnPath,
  buildIndividualQuestionUrl,
  formatIndividualPriceKrw,
  individualTypeLabel,
} from "@/lib/admin/questionDrilldownConsole";
import type { IndividualQuestionList } from "@/lib/admin/questionDrilldownQueries";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  /** student = 학생의 구매 건 · mentor = 멘토가 답변(지정·수락)한 건 */
  variant: "student" | "mentor";
  userId: string;
  list: IndividualQuestionList;
  params: AdminListParams;
};

const ELAPSED_CLASS = {
  neutral: "text-slate-600",
  warning: "font-extrabold text-amber-700",
  danger: "font-extrabold text-red-700",
} as const;

export function AccountIndividualQuestionsTab({ variant, userId, list, params }: Props) {
  const returnTo = buildAccountDrilldownReturnPath(userId, variant === "student" ? "individual" : "answers");
  const counterpartHeading = variant === "student" ? "답변 멘토" : "학생";

  return (
    <section className="space-y-3" aria-label={variant === "student" ? "개별질문" : "개별질문 답변"} data-account-individual-tab={variant}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-600" aria-live="polite">
          전체 <span className="tabular-nums text-slate-900">{list.totalCount.toLocaleString("ko-KR")}</span>건
          <span className="ml-2 font-medium text-slate-500">{variant === "student" ? "건별 구매 질문 — 만료·환불 건 포함" : "지정받았거나 수락한 개별질문 — 만료·환불 건 포함"}</span>
        </p>
        {/* PR-13 §2: 현재 목록(계정 단위 · 같은 조건)을 CSV 로 — 감사 로그 기록 */}
        {!list.error ? <QuestionExportButton scope={{ kind: variant === "student" ? "student_individual" : "mentor_individual", id: userId }} totalCount={list.totalCount} /> : null}
      </div>

      {list.error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">{list.error}</p>
        </div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={variant === "student" ? EMPTY_STUDENT_INDIVIDUAL : EMPTY_MENTOR_INDIVIDUAL} />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
                  <th scope="col" className="px-3 py-3">과목</th>
                  <th scope="col" className="px-3 py-3">제목</th>
                  <th scope="col" className="px-3 py-3">{counterpartHeading}</th>
                  <th scope="col" className="px-3 py-3">가격</th>
                  <th scope="col" className="px-3 py-3">상태</th>
                  <th scope="col" className="px-3 py-3">질문일시</th>
                  <th scope="col" className="px-3 py-3">첫 답변까지</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.rows.map((row) => {
                  const counterpartId = variant === "student" ? row.mentorId : row.studentId;
                  const counterpartName = variant === "student" ? row.mentorName : row.studentName;
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-slate-50/60" data-individual-question-row={row.id}>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs font-bold text-slate-700">{row.subjectLabel ?? "—"}</td>
                      <td className="max-w-[320px] px-3 py-3 align-top">
                        <Link href={buildIndividualQuestionUrl(row.id, { returnTo })} className="block truncate font-extrabold text-slate-900 hover:underline" prefetch={false} title="질문 상세">
                          {row.title}
                        </Link>
                        <StatusBadge label={individualTypeLabel(row.questionType)} tone={row.questionType === "open" ? "info" : "neutral"} size="sm" className="mt-1" />
                      </td>
                      <td className="max-w-[200px] px-3 py-3 align-top text-xs">
                        {counterpartId && counterpartName ? (
                          <Link href={accountDetailPath(counterpartId)} className="block truncate font-bold text-blue-700 hover:underline" prefetch={false}>
                            {counterpartName}
                          </Link>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs font-extrabold tabular-nums text-slate-900">{formatIndividualPriceKrw(row.priceCents)}</td>
                      <td className="px-3 py-3 align-top">
                        <AdminStatusPill table="individual_questions" column="status" value={row.status} size="sm" />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600">{formatKoDateTimeKst(row.createdAt)}</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums" data-first-answer={row.firstAnswer.kind}>
                        {row.firstAnswer.kind === "elapsed" ? (
                          <span className={cn(ELAPSED_CLASS[row.firstAnswer.tone])}>
                            {row.firstAnswer.label}
                            {row.firstAnswer.tone !== "neutral" ? <span aria-label="주의"> ⚠</span> : null}
                          </span>
                        ) : (
                          <span className="text-slate-700">{row.firstAnswer.label}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <AdminDataTable.Pagination className="border-t border-slate-100 px-4 py-2" basePath={accountDetailPath(userId)} params={params} totalCount={list.totalCount} rowsOnPage={list.rows.length} />
        </div>
      )}
    </section>
  );
}
