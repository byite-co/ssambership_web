/**
 * 계정 상세 — [구독 멘토] 탭(학생 §2) / [담당 학생] 탭(멘토 §5). 같은 표, 방향만 반대. Server Component.
 *
 * - `mentor_student_rooms` 기준 — 해지된 방도 남긴다(분쟁·이력). 구독 상태는 `subscriptions.status` 사전, 구독 행이 없으면 `해지됨`.
 * - 질문 수·미답변은 `question_threads` 집계(미답변 = pending 또는 first_answered_at 없음) · 최종 활동은 마지막 메시지. 미답변이 있으면 강조.
 * - 행 → 멘토별 화면(§3, 라우트 하나 `/admin/question-rooms/<roomId>`). `returnTo` 로 이 탭에 돌아온다. 공용 `AdminDataTable.Pagination` 만 쓴다.
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { EMPTY_MENTOR_ROOMS, EMPTY_STUDENT_ROOMS, buildAccountDrilldownReturnPath, buildQuestionRoomUrl, roomSubscriptionStatus } from "@/lib/admin/questionDrilldownConsole";
import type { RoomList } from "@/lib/admin/questionDrilldownQueries";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  /** student = 학생의 구독 멘토(상대 = 멘토 닉네임) · mentor = 멘토의 담당 학생(상대 = 학생 실명) */
  variant: "student" | "mentor";
  userId: string;
  list: RoomList;
  params: AdminListParams;
};

export function AccountRoomsTab({ variant, userId, list, params }: Props) {
  const returnTo = buildAccountDrilldownReturnPath(userId, variant === "student" ? "mentors" : "students");
  const counterpartHeading = variant === "student" ? "멘토 닉네임" : "학생";

  return (
    <section className="space-y-3" aria-label={variant === "student" ? "구독 멘토" : "담당 학생"} data-account-rooms-tab={variant}>
      <p className="text-xs font-bold text-slate-600" aria-live="polite">
        전체 <span className="tabular-nums text-slate-900">{list.totalCount.toLocaleString("ko-KR")}</span>건
        <span className="ml-2 font-medium text-slate-500">현재 + 과거(해지된 방 포함) · 행을 누르면 질문·연결노트</span>
      </p>

      {list.error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">{list.error}</p>
        </div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={variant === "student" ? EMPTY_STUDENT_ROOMS : EMPTY_MENTOR_ROOMS} />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
                  <th scope="col" className="px-3 py-3">{counterpartHeading}</th>
                  {variant === "student" ? <th scope="col" className="px-3 py-3">과목</th> : null}
                  <th scope="col" className="px-3 py-3">구독 시작</th>
                  <th scope="col" className="px-3 py-3">구독 상태</th>
                  <th scope="col" className="px-3 py-3">질문 수</th>
                  <th scope="col" className="px-3 py-3">미답변</th>
                  <th scope="col" className="px-3 py-3">최종 활동</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.rows.map((row) => {
                  const sub = roomSubscriptionStatus(row.subscriptionStatus);
                  const unanswered = row.unansweredCount > 0;
                  return (
                    <tr key={row.roomId} className={cn("transition-colors hover:bg-slate-50/60", unanswered && "bg-amber-50/40")} data-room-row={row.roomId} data-unanswered={unanswered ? "1" : "0"}>
                      <td className="max-w-[260px] px-3 py-3 align-top">
                        <Link href={buildQuestionRoomUrl(row.roomId, { returnTo })} className="block truncate font-extrabold text-slate-900 hover:underline" prefetch={false} title="멘토별 화면(질문 · 연결노트)">
                          {row.counterpartName}
                        </Link>
                        <Link href={accountDetailPath(row.counterpartId)} className="text-[11px] font-bold text-blue-700 hover:underline" prefetch={false}>
                          계정 상세
                        </Link>
                      </td>
                      {variant === "student" ? <td className="max-w-[200px] truncate px-3 py-3 align-top text-xs font-bold text-slate-700">{row.subjectLabel ?? "—"}</td> : null}
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600">{formatKoreanDate(row.subscriptionStartAt)}</td>
                      <td className="px-3 py-3 align-top">
                        <StatusBadge label={sub.label} tone={sub.tone} size="sm" />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-700">{row.questionCount}건</td>
                      <td className={cn("whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums", unanswered ? "font-extrabold text-amber-700" : "text-slate-500")}>{row.unansweredCount}</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600">{formatKoDateTimeKst(row.lastActivityAt)}</td>
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
