"use client";

/**
 * 환불 목록 표 + 일괄 처리 바(PR-3 §1·§3). 클라이언트 컴포넌트인 이유는 행 선택 상태 하나다 — 데이터·검색·탭·페이지는 전부 서버(URL)다.
 *
 * - 체크박스는 **대기 건에만** 있다. 선택하면 하단 바가 나타나 `선택 N건 · 총 …원` 과 [일괄 승인] [일괄 반려] 를 보인다.
 * - 일괄 승인은 `ConfirmSubmitButton level="critical"`, 일괄 반려는 `stateChange` + 프리셋. 두 다이얼로그 모두 `body` 슬롯에
 *   **대상 전부를 체크 목록으로** 보인다. 모달 안에서 해제하면 건수·총액·hidden `ids` 가 함께 갱신된다(표 선택과 같은 상태).
 * - 일괄 액션(`bulkRefundDecisionAction`)은 redirect 없이 건별 결과를 돌려준다(`useActionState`). 부분 실패 시
 *   `N건 성공 · M건 실패(이유)` 를 표시하고 **실패 건만 선택된 상태로** 남겨 재시도한다. 성공 건은 되돌리지 않는다.
 * - 금액은 서버가 `refunds.amount_cents` 에서 만든 `amountWon` 만 쓴다(모달 표시 = 실지급).
 */
import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { ConfirmSubmitButton } from "@/components/admin/ConfirmSubmitButton";
import { RefundDecisionButtons } from "@/components/admin/RefundDecisionButtons";
import { bulkRefundDecisionAction } from "@/lib/admin/refundActions";
import {
  REFUND_BULK_DECISION_FIELD,
  REFUND_BULK_IDS_FIELD,
  REFUND_CUSTOM_REASON_LABEL,
  REFUND_KIND_SHORT_LABELS,
  REFUND_REASON_FIELD,
  REFUND_REJECT_REASON_PRESETS,
  buildRefundBulkSummary,
  bulkSelectionSummary,
  failedRefundIds,
  formatRefundBulkResultLine,
  formatRefundWon,
  refundBulkConfirmLabel,
  refundDetailPath,
  summarizeRefundReason,
  type RefundBulkDecision,
  type RefundBulkResultState,
  type RefundQueueItem,
} from "@/lib/admin/refundConsole";
import { refundSlaToneClass } from "@/lib/admin/refundSla";
import { cn } from "@/lib/utils/cn";

type Props = {
  items: RefundQueueItem[];
  /** 단건 승인·반려 액션이 돌아갈 경로(목록) */
  returnTo: string;
};

const BULK_BLOCKED_MESSAGE = "선택된 건이 없습니다. 목록에서 한 건 이상 선택해 주세요.";
const BULK_BUTTON =
  "inline-flex h-9 items-center justify-center rounded-xl px-4 text-xs font-extrabold transition disabled:cursor-not-allowed disabled:opacity-60";

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function RefundQueueTable({ items, returnTo }: Props) {
  const pendingItems = items.filter((i) => i.pending);
  const pendingIds = new Set(pendingItems.map((i) => i.id));

  // 표 선택(hidden ids · 총액의 정본). 모달 체크 목록도 이 상태를 바꾼다.
  const [selected, setSelected] = useState<string[]>([]);
  // 모달 체크 목록에 보일 대상 — 표에서 선택이 바뀔 때 스냅샷. 모달 안에서 해제한 건도 목록에 남아 다시 켤 수 있다.
  const [candidates, setCandidates] = useState<string[]>([]);
  // 일괄 결과 안내에서 이름을 보이기 위한 캐시 — 성공 건은 재검증 후 대기 목록에서 사라지므로 이름을 미리 남긴다.
  const [nameCache, setNameCache] = useState<Record<string, string>>({});
  const [dismissedResultAt, setDismissedResultAt] = useState<string | null>(null);

  const [bulkState, bulkAction, bulkPending] = useActionState<RefundBulkResultState, FormData>(bulkRefundDecisionAction, null);

  // 렌더 중 상태 조정(effect 아님): 새 일괄 결과가 오면 실패 건만 선택된 상태로 남긴다 — 성공 건은 되돌리지 않는다.
  const [seenResultAt, setSeenResultAt] = useState<string | null>(null);
  if (bulkState && bulkState.at !== seenResultAt) {
    setSeenResultAt(bulkState.at);
    const failed = failedRefundIds(bulkState);
    setSelected(failed);
    setCandidates(failed);
  }
  const staleNames = items.filter((i) => nameCache[i.id] !== i.requesterName);
  if (staleNames.length) {
    setNameCache((prev) => ({ ...prev, ...Object.fromEntries(staleNames.map((i) => [i.id, i.requesterName])) }));
  }

  const selectedPending = selected.filter((id) => pendingIds.has(id));
  const candidateItems = candidates.map((id) => pendingItems.find((i) => i.id === id)).filter((i): i is RefundQueueItem => Boolean(i));
  const allPendingSelected = pendingItems.length > 0 && pendingItems.every((i) => selectedPending.includes(i.id));

  const toggleRow = (id: string) => {
    const next = selectedPending.includes(id) ? selectedPending.filter((x) => x !== id) : [...selectedPending, id];
    setSelected(next);
    setCandidates(next);
  };
  const toggleAll = () => {
    const next = allPendingSelected ? [] : pendingItems.map((i) => i.id);
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

  const { count: bulkCount, totalWon: bulkTotalWon } = bulkSelectionSummary(candidateItems, selectedPending);
  const showResult = bulkState && bulkState.at !== dismissedResultAt;

  return (
    <div className="space-y-3" data-refund-queue>
      {showResult && bulkState ? (
        <section
          role="status"
          aria-live="polite"
          className={cn(
            "rounded-2xl border px-4 py-3 text-sm",
            bulkState.error || bulkState.failed > 0 ? "border-amber-200 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-extrabold">{formatRefundBulkResultLine(bulkState)}</p>
            <button
              type="button"
              onClick={() => setDismissedResultAt(bulkState.at)}
              className="shrink-0 rounded-lg border border-current/30 bg-white/60 px-2 py-0.5 text-[11px] font-bold"
            >
              닫기
            </button>
          </div>
          {bulkState.results.length ? (
            <ul className="mt-2 space-y-1 text-xs" aria-label="건별 결과">
              {bulkState.results.map((r) => (
                <li key={r.refundId} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-bold">{nameCache[r.refundId] ?? shortId(r.refundId)}</span>
                  {r.ok ? (
                    <span className={r.noop ? "text-slate-600" : "text-emerald-800"}>{r.noop ? `이미 처리됨(변경 없음) — ${r.message ?? ""}` : "성공"}</span>
                  ) : (
                    <span className="text-red-800">실패 — {r.message ?? "처리에 실패했습니다."}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {bulkState.failed > 0 ? (
            <p className="mt-2 text-xs font-semibold">
              실패 건만 선택된 상태로 남겨 두었습니다. 원인을 확인한 뒤 같은 버튼으로 다시 시도해 주세요. 성공한 건은 이미 캐시가 이동해 되돌리지 않습니다.
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
              <th scope="col" className="w-10 px-3 py-3">
                {pendingItems.length ? (
                  <input
                    type="checkbox"
                    aria-label="이 페이지의 대기 건 전체 선택"
                    checked={allPendingSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                ) : (
                  <span className="sr-only">선택</span>
                )}
              </th>
              <th scope="col" className="px-3 py-3">요청자</th>
              <th scope="col" className="px-3 py-3">종류</th>
              <th scope="col" className="px-3 py-3 text-right">금액</th>
              <th scope="col" className="px-3 py-3">사유(요약)</th>
              <th scope="col" className="px-3 py-3">요청일</th>
              <th scope="col" className="px-3 py-3">상태</th>
              <th scope="col" className="px-3 py-3">처리자·일시</th>
              <th scope="col" className="px-3 py-3">
                <span className="sr-only">처리</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              const checked = selectedPending.includes(item.id);
              return (
                <tr key={item.id} className={cn("transition-colors hover:bg-slate-50/40", checked && "bg-blue-50/40")} data-refund-row={item.id}>
                  <td className="px-3 py-3 align-top">
                    {item.pending ? (
                      <input
                        type="checkbox"
                        aria-label={`${item.requesterName} 환불 선택`}
                        checked={checked}
                        onChange={() => toggleRow(item.id)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300"
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <Link href={refundDetailPath(item.id)} className="block font-extrabold text-slate-900 hover:underline" prefetch={false}>
                      {item.requesterName}
                    </Link>
                    <p className="truncate text-[11px] text-slate-500" title={item.requesterEmail ?? undefined}>
                      {item.requesterEmail ?? "이메일 없음"}
                    </p>
                  </td>
                  <td className="px-3 py-3 align-top text-xs">
                    <p className="font-bold text-slate-800">{REFUND_KIND_SHORT_LABELS[item.kind]}</p>
                    {item.planLabel ? <p className="text-slate-500">{item.planLabel}</p> : null}
                  </td>
                  <td className="px-3 py-3 align-top text-right text-sm font-black tabular-nums text-slate-900">
                    {formatRefundWon(item.amountWon)}
                    {item.pending && item.basis ? <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{item.basisLabel}</p> : null}
                  </td>
                  <td className="max-w-[240px] px-3 py-3 align-top text-xs text-slate-700">
                    <p className="break-words" title={item.reason ?? undefined}>
                      {summarizeRefundReason(item.reason)}
                    </p>
                    {item.adminNote ? (
                      <p className="mt-0.5 truncate text-[11px] text-slate-500" title={item.adminNote}>
                        처리 사유: {item.adminNote}
                      </p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-slate-600 tabular-nums">
                    {item.createdAtLabel}
                    {item.sla ? (
                      <span
                        className={cn("ml-1.5 inline-block rounded-md border px-1.5 py-0.5 text-[10px] font-bold", refundSlaToneClass(item.sla.tone))}
                        title="멘토 중단 환불 — 5일 처리 목표"
                      >
                        ⏱ {item.sla.label}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 align-top">
                    <AdminStatusPill table="refunds" column="status" value={item.status} size="sm" />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-slate-600" data-refund-processed>
                    {item.processedAt || item.processorName ? (
                      <>
                        <p className="font-bold text-slate-800">{item.processorName ?? "처리자 미상"}</p>
                        <p className="tabular-nums text-slate-500">{item.processedAtLabel}</p>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 align-top">
                    {item.pending ? (
                      <RefundDecisionButtons target={item} returnTo={returnTo} size="sm" />
                    ) : (
                      <Link href={refundDetailPath(item.id)} className="text-xs font-bold text-blue-700 hover:underline" prefetch={false}>
                        상세
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedPending.length > 0 ? (
        <div
          role="region"
          aria-label="일괄 처리"
          className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur"
          data-refund-bulk-bar
        >
          <p className="text-sm font-extrabold text-slate-900" aria-live="polite">
            선택 <span className="tabular-nums">{bulkCount}</span>건 · 총 <span className="tabular-nums">{formatRefundWon(bulkTotalWon)}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <RefundBulkForm
              decision="approve"
              action={bulkAction}
              pending={bulkPending}
              candidates={candidateItems}
              selectedIds={selectedPending}
              onToggle={toggleInDialog}
            />
            <RefundBulkForm
              decision="reject"
              action={bulkAction}
              pending={bulkPending}
              candidates={candidateItems}
              selectedIds={selectedPending}
              onToggle={toggleInDialog}
            />
            <button
              type="button"
              onClick={clearSelection}
              disabled={bulkPending}
              className={`${BULK_BUTTON} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
            >
              선택 해제
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type BulkFormProps = {
  decision: RefundBulkDecision;
  action: (formData: FormData) => void;
  pending: boolean;
  candidates: RefundQueueItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
};

/**
 * 일괄 승인/반려 한 폼 — hidden `ids` 는 현재 선택만 싣는다(모달에서 해제하면 빠진다).
 * 승인·반려가 각자 폼을 가지는 이유: `ConfirmSubmitButton` 의 사유 hidden input 이름이 같아 한 폼에 두 개가 있으면 첫 값만 읽힌다.
 */
function RefundBulkForm({ decision, action, pending, candidates, selectedIds, onToggle }: BulkFormProps) {
  const { count, totalWon, selected } = bulkSelectionSummary(candidates, selectedIds);
  const summary = buildRefundBulkSummary(decision, count, totalWon);
  const blocked = count === 0 ? BULK_BLOCKED_MESSAGE : null;
  const body = <RefundBulkChecklist candidates={candidates} selectedIds={selectedIds} onToggle={onToggle} disabled={pending} />;

  return (
    <form action={action} data-refund-bulk-form={decision}>
      {selected.map((c) => (
        <input key={c.id} type="hidden" name={REFUND_BULK_IDS_FIELD} value={c.id} />
      ))}
      {decision === "approve" ? (
        <ConfirmSubmitButton
          level="critical"
          name={REFUND_BULK_DECISION_FIELD}
          value="approve"
          summary={summary}
          details={[
            { label: "총 환불 금액(저장값 합)", value: formatRefundWon(totalWon) },
            { label: "건수", value: `${count}건` },
          ]}
          body={body}
          confirmBlockedMessage={blocked}
          dialogTitle="일괄 승인 — 실행 전 확인"
          confirmLabel={refundBulkConfirmLabel("approve", count)}
          pendingLabel="승인 중…"
          reasonFieldName={REFUND_REASON_FIELD}
          reasonLabel="사유 (전체 적용)"
          reasonPlaceholder="선택한 모든 건에 같은 사유가 기록됩니다."
          className={`${BULK_BUTTON} bg-[#1A56DB] text-white hover:bg-[#1747B8]`}
        >
          일괄 승인
        </ConfirmSubmitButton>
      ) : (
        <ConfirmSubmitButton
          level="stateChange"
          name={REFUND_BULK_DECISION_FIELD}
          value="reject"
          summary={summary}
          body={body}
          confirmBlockedMessage={blocked}
          dialogTitle="일괄 반려 사유"
          confirmLabel={refundBulkConfirmLabel("reject", count)}
          pendingLabel="반려 중…"
          reasonRequired
          reasonFieldName={REFUND_REASON_FIELD}
          reasonLabel="반려 사유 (전체 적용)"
          reasonPresets={REFUND_REJECT_REASON_PRESETS}
          customReasonLabel={REFUND_CUSTOM_REASON_LABEL}
          className={`${BULK_BUTTON} border-2 border-red-500 bg-white text-red-700 hover:bg-red-50`}
        >
          일괄 반려
        </ConfirmSubmitButton>
      )}
    </form>
  );
}

function RefundBulkChecklist(props: { candidates: RefundQueueItem[]; selectedIds: string[]; onToggle: (id: string) => void; disabled: boolean }): ReactNode {
  const { candidates, selectedIds, onToggle, disabled } = props;
  if (!candidates.length) return null;
  return (
    <ul className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2" aria-label="일괄 처리 대상">
      {candidates.map((c) => {
        const checked = selectedIds.includes(c.id);
        return (
          <li key={c.id}>
            <label className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50", !checked && "opacity-50")}>
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => onToggle(c.id)}
                className="h-4 w-4 shrink-0 rounded border-slate-300"
                aria-label={`${c.requesterName} 포함`}
              />
              <span className="min-w-0 flex-1 truncate font-bold text-slate-900">{c.requesterName}</span>
              <span className="shrink-0 text-xs text-slate-600">{c.planLabel ?? REFUND_KIND_SHORT_LABELS[c.kind]}</span>
              <span className="shrink-0 font-extrabold tabular-nums text-slate-900">{formatRefundWon(c.amountWon)}</span>
              <span className="shrink-0 text-[11px] text-slate-500">{c.basisLabel}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}
