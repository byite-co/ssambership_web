/**
 * 멘토별 화면(§3) 헤더 — `이수민 × 수학하는하늘 [구독중]` + 과목 · 구독 시작 · 질문 N건 · 미답변 · 이번 주 사용량(RPC) · 최종 활동. Server Component.
 * 학생 **실명** · 멘토 **닉네임**. `←` 는 `returnTo`(계정 상세만 허용)로 돌아간다. 아래에 질문·연결노트 탭.
 */
import Link from "next/link";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import { QUESTION_ROOM_TABS, buildQuestionRoomUrl, formatWeeklyUsageShort, roomSubscriptionStatus, type QuestionRoomTab } from "@/lib/admin/questionDrilldownConsole";
import type { QuestionRoomOverview } from "@/lib/admin/questionDrilldownQueries";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  overview: QuestionRoomOverview;
  activeTab: QuestionRoomTab;
  /** 허용 목록을 통과한 돌아갈 경로 — 탭 링크에 그대로 실린다 */
  returnTo: string | null;
};

export function QuestionRoomHeader({ overview, activeTab, returnTo }: Props) {
  const { room, studentName, mentorName, subjectLabel, subscription, questionCount, unansweredCount, lastActivityAt, usage, usageError } = overview;
  const sub = roomSubscriptionStatus(subscription.status);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="멘토별 화면 헤더" data-question-room-header={room.id}>
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-black tracking-tight text-slate-900">
            <Link href={accountDetailPath(room.studentId)} className="hover:underline" prefetch={false} title="학생 계정 상세" data-party="student">
              {studentName}
            </Link>
            <span aria-hidden="true" className="text-slate-400">
              ×
            </span>
            <Link href={accountDetailPath(room.mentorId)} className="hover:underline" prefetch={false} title="멘토 계정 상세" data-party="mentor">
              {mentorName}
            </Link>
            <StatusBadge label={sub.label} tone={sub.tone} size="sm" />
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-slate-600">
            <span>{subjectLabel ?? "과목 미설정"}</span>
            <span aria-hidden="true">·</span>
            <span>구독 시작 {formatKoreanDate(subscription.startAt)}</span>
            <span aria-hidden="true">·</span>
            <span>
              질문 <span className="tabular-nums text-slate-900">{questionCount}</span>건
            </span>
            <span aria-hidden="true">·</span>
            <span className={cn(unansweredCount > 0 && "font-extrabold text-amber-700")}>
              미답변 <span className="tabular-nums">{unansweredCount}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span title={usageError ?? "RPC get_weekly_question_usage"} data-weekly-usage={usage ? `${usage.used}/${usage.limit}` : "unavailable"}>
              이번 주 {usageError ? <span className="font-bold text-amber-800">확인 불가</span> : `${formatWeeklyUsageShort(usage)} 사용`}
            </span>
            <span aria-hidden="true">·</span>
            <span>최종 활동 {formatKoDateTimeKst(lastActivityAt)}</span>
          </p>
        </div>
        <p className="shrink-0 font-mono text-[11px] text-slate-400" title="mentor_student_rooms.id">
          방 {room.id}
        </p>
      </div>
      <nav className="flex flex-wrap gap-1 border-t border-slate-100 px-4 py-2" aria-label="멘토별 화면 탭" data-question-room-tabs>
        {QUESTION_ROOM_TABS.map((t) => {
          const on = t.value === activeTab;
          return (
            <Link
              key={t.value}
              href={buildQuestionRoomUrl(room.id, { tab: t.value, returnTo })}
              aria-current={on ? "page" : undefined}
              prefetch={false}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-extrabold transition",
                on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
