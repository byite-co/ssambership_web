"use client";

/**
 * 분쟁 목록 표 + 일괄 상태 변경 바(PR-6 §2-2). 클라이언트 컴포넌트인 이유는 행 선택 상태 하나다 — 데이터·검색·탭·페이지는 전부 서버(URL)다.
 *
 * - 컬럼: 주문 · 학생 · 멘토 · 유형 · 접수일 · 경과 · 상태. 주문 칸의 링크가 분쟁 상세로 간다.
 * - 체크박스는 일괄 게이트 안(open·검토 중·에스컬레이션·기간 제재) 행에만 있다. 선택하면 하단 바가 나타난다.
 * - 일괄 액션은 기존 `bulkUpdateDisputesAction`(상태 변경만 — 자금 이동 없음)이다. **`critical` + 대상 목록 모달**(환불 일괄과 같은 형태)로 감싸고,
 *   사유(`reason`, 전체 적용)는 액션이 읽어 `admin_action_logs.detail.reason` 에 남긴다(PR-6 2번째 커밋).
 *   자금이 걸린 일괄 처리는 없다(지시서 §2-2 — 자금 분배는 상세에서 건별로만).
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import { bulkUpdateDisputesAction } from "@/lib/admin/bulkActions";
import {
  DISPUTE_ACTIONS,
  DISPUTE_BULK_BLOCKED_MESSAGE,
  DISPUTE_BULK_IDS_FIELD,
  DISPUTE_BULK_STATUSES,
  DISPUTE_BULK_STATUS_FIELD,
  DISPUTE_BULK_STATUS_LABELS,
  DISPUTE_REASON_FIELD,
  buildDisputeBulkSummary,
  disputeBulkConfirmLabel,
  disputeDetailPath,
  disputeElapsedToneClass,
  type DisputeBulkStatus,
} from "@/lib/admin/disputeConsole";
import type { DisputeQueueItem } from "@/lib/admin/disputeConsoleQueries";
import { cn } from "@/lib/utils/cn";

type Props = { items: DisputeQueueItem[] };

const BULK_BUTTON =
  "inline-flex h-9 items-center justify-center rounded-xl px-4 text-xs font-extrabold transition disabled:cursor-not-allowed disabled:opacity-60";

const BULK_BUTTON_TONE: Record<DisputeBulkStatus, string> = {
  under_review: "bg-indigo-600 text-white hover:bg-indigo-700",
  resolved: "bg-emerald-700 text-white hover:bg-emerald-800",
};

export function DisputeQueueTable({ items }: Props) {
  const eligible = items.filter((i) => i.bulkEligible);
  const eligibleIds = new Set(eligible.map((i) => i.id));

  // 표 선택(hidden ids 의 정본). 모달 체크 목록도 이 상태를 바꾼다.
  const [selected, setSelected] = useState<string[]>([]);
  // 모달 체크 목록에 보일 대상 — 표에서 선택이 바뀔 때 스냅샷. 모달 안에서 해제한 건도 목록에 남아 다시 켤 수 있다.
  const [candidates, setCandidates] = useState<string[]>([]);

  const selectedEligible = selected.filter((id) => eligibleIds.has(id));
  const candidateItems = candidates.map((id) => eligible.find((i) => i.id === id)).filter((i): i is DisputeQueueItem => Boolean(i));
  const allSelected = eligible.length > 0 && eligible.every((i) => selectedEligible.includes(i.id));

  const toggleRow = (id: string) => {
    const next = selectedEligible.includes(id) ? selectedEligible.filter((x) => x !== id) : [...selectedEligible, id];
    setSelected(next);
    setCandidates(next);
  };
  const toggleAll = () => {
    const next = allSelected ? [] : eligible.map((i) => i.id);
    setSelected(next);
    setCandidates(next);
  };
  const toggleInDialog = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const clearSelection = () => {
    setSelected([]);
    setCandidates([]);
  };

  const selectedItems = candidateItems.filter((c) => selectedEligible.includes(c.id));
  const checklist = <DisputeBulkChecklist candidates={candidateItems} selectedIds={selectedEligible} onToggle={toggleInDialog} />;

  return (
    <div className="space-y-3" data-dispute-table>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
              <th scope="col" className="w-10 px-3 py-3">
                {eligible.length ? (
                  <input type="checkbox" aria-label="이 페이지의 처리 가능 건 전체 선택" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300" />
                ) : (
                  <span className="sr-only">선택</span>
                )}
              </th>
              <th scope="col" className="px-3 py-3">주문</th>
              <th scope="col" className="px-3 py-3">학생</th>
              <th scope="col" className="px-3 py-3">멘토</th>
              <th scope="col" className="px-3 py-3">유형</th>
              <th scope="col" className="px-3 py-3">접수일</th>
              <th scope="col" className="px-3 py-3">경과</th>
              <th scope="col" className="px-3 py-3">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              const checked = selectedEligible.includes(item.id);
              return (
                <tr key={item.id} className={cn("transition-colors hover:bg-slate-50/60", checked && "bg-blue-50/40")} data-dispute-row={item.id}>
                  <td className="px-3 py-3 align-top">
                    {item.bulkEligible ? (
                      <input
                        type="checkbox"
                        aria-label={`${item.orderRef || item.disputeRef} 분쟁 선택`}
                        checked={checked}
                        onChange={() => toggleRow(item.id)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300"
                      />
                    ) : null}
                  </td>
                  <td className="max-w-[320px] px-3 py-3 align-top">
                    <Link href={disputeDetailPath(item.id)} className="block font-extrabold text-slate-900 hover:underline" prefetch={false} title="분쟁 상세 보기">
                      {item.orderRef ? `주문 ${item.orderRef}` : `분쟁 ${item.disputeRef}`}
                    </Link>
                    {item.bodySummary ? (
                      <p className="mt-0.5 truncate text-xs text-slate-600" title={item.bodySummary}>
                        {item.bodySummary}
                      </p>
                    ) : null}
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400" title={item.id}>
                      분쟁 {item.disputeRef}
                    </p>
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-3 align-top font-bold text-slate-800" title={item.studentId ?? undefined}>
                    {item.studentId ? (
                      <Link href={accountDetailPath(item.studentId)} className="hover:underline" prefetch={false}>
                        {item.studentName}
                      </Link>
                    ) : (
                      item.studentName
                    )}
                  </td>
                  <td className="max-w-[160px] truncate px-3 py-3 align-top font-bold text-slate-800" title={item.mentorId ?? undefined}>
                    {item.mentorId ? (
                      <Link href={accountDetailPath(item.mentorId)} className="hover:underline" prefetch={false}>
                        {item.mentorName}
                      </Link>
                    ) : (
                      item.mentorName
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-top text-xs font-bold text-slate-700">{item.kindLabel}</td>
                  <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600">{item.createdAtLabel}</td>
                  <td className="whitespace-nowrap px-3 py-3 align-top">
                    <span
                      className={cn("inline-block rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums", disputeElapsedToneClass(item.elapsed.tone))}
                      data-elapsed-tone={item.elapsed.tone}
                    >
                      {item.elapsed.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <AdminStatusPill table="disputes" column="status" value={item.status} size="sm" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedEligible.length > 0 ? (
        <div
          role="region"
          aria-label="일괄 상태 변경"
          className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur"
          data-dispute-bulk-bar
        >
          <p className="text-sm font-extrabold text-slate-900" aria-live="polite">
            선택 <span className="tabular-nums">{selectedItems.length}</span>건 · 상태만 바꿉니다(예치금 이동 없음)
          </p>
          <form action={bulkUpdateDisputesAction} className="flex flex-wrap items-center gap-2" data-dispute-bulk-form>
            {selectedItems.map((c) => (
              <input key={c.id} type="hidden" name={DISPUTE_BULK_IDS_FIELD} value={c.id} />
            ))}
            {DISPUTE_BULK_STATUSES.map((next) => (
              <ConfirmSubmitButton
                key={next}
                level="critical"
                reasonFieldName={DISPUTE_REASON_FIELD}
                reasonLabel="사유 (전체 적용)"
                reasonPlaceholder="선택한 모든 건의 감사 로그에 같은 사유가 남습니다."
                name={DISPUTE_BULK_STATUS_FIELD}
                value={next}
                summary={buildDisputeBulkSummary(next, selectedItems.length)}
                details={[
                  { label: "건수", value: `${selectedItems.length}건` },
                  { label: "바꿀 상태", value: DISPUTE_BULK_STATUS_LABELS[next] },
                ]}
                body={checklist}
                confirmBlockedMessage={selectedItems.length === 0 ? DISPUTE_BULK_BLOCKED_MESSAGE : null}
                dialogTitle={`일괄 ${DISPUTE_BULK_STATUS_LABELS[next]} — 실행 전 확인`}
                confirmLabel={disputeBulkConfirmLabel(next, selectedItems.length)}
                pendingLabel={DISPUTE_ACTIONS.review.pendingLabel}
                className={`${BULK_BUTTON} ${BULK_BUTTON_TONE[next]}`}
              >
                일괄 {DISPUTE_BULK_STATUS_LABELS[next]}
              </ConfirmSubmitButton>
            ))}
            <button type="button" onClick={clearSelection} className={`${BULK_BUTTON} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
              선택 해제
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function DisputeBulkChecklist(props: { candidates: DisputeQueueItem[]; selectedIds: string[]; onToggle: (id: string) => void }): ReactNode {
  const { candidates, selectedIds, onToggle } = props;
  if (!candidates.length) return null;
  return (
    <ul className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2" aria-label="일괄 처리 대상">
      {candidates.map((c) => {
        const checked = selectedIds.includes(c.id);
        return (
          <li key={c.id}>
            <label className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50", !checked && "opacity-50")}>
              <input type="checkbox" checked={checked} onChange={() => onToggle(c.id)} className="h-4 w-4 shrink-0 rounded border-slate-300" aria-label={`${c.orderRef || c.disputeRef} 포함`} />
              <span className="shrink-0 font-extrabold text-slate-900">{c.orderRef ? `주문 ${c.orderRef}` : `분쟁 ${c.disputeRef}`}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-600">
                {c.studentName} ↔ {c.mentorName}
              </span>
              <AdminStatusPill table="disputes" column="status" value={c.status} size="sm" className="shrink-0" />
            </label>
          </li>
        );
      })}
    </ul>
  );
}
