/**
 * 멘토별 화면 — [질문] 탭(§3): 제목 · 상태 · 질문일시 · 첫 답변까지(미답변은 경과 + 톤) · 왕복(메시지 수) · 확인(`confirmed_at`) · 오답노트·숙달 배지. Server Component.
 * 행의 제목 → 질문 상세(§4). 공용 `AdminDataTable.Pagination` 만 쓴다(상태 탭 없음).
 * PR-13 §2: 상단 `내보내기`(`QuestionExportButton`) — 이 방의 질문을 CSV 로(방 단위 · 같은 조건). 감사 로그 1건.
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { QuestionExportButton } from "@/components/admin/QuestionExportButton";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { EMPTY_ROOM_THREADS, buildQuestionThreadUrl, questionRoomPath, threadBadges } from "@/lib/admin/questionDrilldownConsole";
import type { RoomThreadList } from "@/lib/admin/questionDrilldownQueries";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  roomId: string;
  list: RoomThreadList;
  params: AdminListParams;
  /** 질문 상세의 `returnTo` — 이 화면(탭·returnTo 포함) */
  returnTo: string;
};

const ELAPSED_CLASS = {
  neutral: "text-slate-600",
  warning: "font-extrabold text-amber-700",
  danger: "font-extrabold text-red-700",
} as const;

export function QuestionRoomThreadList({ roomId, list, params, returnTo }: Props) {
  return (
    <section className="space-y-3" aria-label="질문 목록" data-question-room-threads={roomId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-600" aria-live="polite">
          전체 <span className="tabular-nums text-slate-900">{list.totalCount.toLocaleString("ko-KR")}</span>건
        </p>
        {/* PR-13 §2: 이 방의 질문(같은 조건)을 CSV 로 — 감사 로그 기록 */}
        {!list.error ? <QuestionExportButton scope={{ kind: "room_threads", id: roomId }} totalCount={list.totalCount} /> : null}
      </div>
      {list.error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">{list.error}</p>
        </div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={EMPTY_ROOM_THREADS} />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
                  <th scope="col" className="px-3 py-3">제목</th>
                  <th scope="col" className="px-3 py-3">상태</th>
                  <th scope="col" className="px-3 py-3">질문일시</th>
                  <th scope="col" className="px-3 py-3">첫 답변까지</th>
                  <th scope="col" className="px-3 py-3">왕복</th>
                  <th scope="col" className="px-3 py-3">확인</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {list.rows.map((row) => {
                  const badges = threadBadges({ is_wrong_answer: row.isWrongAnswer, mastery_status: row.masteryStatus });
                  return (
                    <tr key={row.id} className="transition-colors hover:bg-slate-50/60" data-thread-row={row.id}>
                      <td className="max-w-[360px] px-3 py-3 align-top">
                        <Link href={buildQuestionThreadUrl(row.id, { returnTo })} className="block truncate font-extrabold text-slate-900 hover:underline" prefetch={false} title="질문 상세">
                          {row.title}
                        </Link>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                          {row.subjectLabel ? <span>{row.subjectLabel}</span> : null}
                          {row.topic ? <span>· {row.topic}</span> : null}
                          {badges.map((b) => (
                            <StatusBadge key={b.label} label={b.label} tone={b.tone} size="sm" />
                          ))}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <AdminStatusPill table="question_threads" column="status" value={row.status} size="sm" />
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
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-700">{row.messageCount}회</td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-slate-700" title={row.confirmedAt ? formatKoDateTimeKst(row.confirmedAt) : undefined}>
                        {row.confirmedAt ? "확인함" : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <AdminDataTable.Pagination className="border-t border-slate-100 px-4 py-2" basePath={questionRoomPath(roomId)} params={params} totalCount={list.totalCount} rowsOnPage={list.rows.length} />
        </div>
      )}
    </section>
  );
}
