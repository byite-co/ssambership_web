import Link from "next/link";
import type { DisputeBundle, DisputeActorSummary } from "@/lib/disputes/disputeQueries";
import { pickText, statusBadgeText, w22EntityLine } from "@/lib/disputes/disputeQueries";
import { DisputeKeyValueList } from "@/components/disputes/DisputeKeyValueList";
import {
  dismissDisputeAction,
  resolveDisputeAction,
  setDisputeUnderReviewAction,
} from "@/lib/admin/adminDisputeActions";
import { adminDisputeStatusLabel } from "@/lib/admin/disputeLabels";
import type { AdminDisputeEscrowSplitPanelState } from "@/lib/admin/adminDisputeEscrowSplitTypes";
import { DisputeEscrowSplitPanel } from "@/components/disputes/DisputeEscrowSplitPanel";
import { AdminCaseNotesPanel } from "@/components/admin/AdminCaseNotesPanel";
import type { AdminCaseNotesResult } from "@/lib/admin/adminCaseNotes";

type Row = Record<string, unknown>;

function pickFirstString(row: Row | null, keys: string[]): string | null {
  if (!row) return null;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) {
      return v;
    }
  }
  return null;
}

function relationLine(label: string, table: string | null, row: Row | null, err: string | null): string {
  if (err) return `${label}: 연계 정보를 불러오지 못했습니다.`;
  if (!row) return `${label}: 연계 없음`;
  return w22EntityLine(label, table, row, null);
}

function ActorLine(props: { label: string; a: DisputeActorSummary }) {
  return (
    <li className="text-sm">
      <span className="text-slate-500">{props.label}:</span>{" "}
      <span className="font-bold text-slate-900">{props.a.display}</span>{" "}
      <code className="text-[10px] text-slate-400">{props.a.id ?? "—"}</code>
    </li>
  );
}

export function DisputeAdminPageBody(props: {
  bundle: DisputeBundle;
  actors: { reporter: DisputeActorSummary; student: DisputeActorSummary; mentor: DisputeActorSummary } | null;
  disputeId: string;
  adminNotes: AdminCaseNotesResult;
  escrowSplitPanelState: AdminDisputeEscrowSplitPanelState;
}) {
  const d = props.bundle.dispute.row;
  const stRaw = statusBadgeText(d, ["status", "state", "phase", "resolution", "outcome"]);
  const stKo = adminDisputeStatusLabel(stRaw);
  const b = props.bundle;
  const isDisputesTable = b.dispute.table === "disputes";
  const statusLower = String(d?.status ?? d?.state ?? "").toLowerCase();
  const canReview = isDisputesTable && (statusLower === "open" || statusLower === "escalated");
  const canResolveOrDismiss =
    isDisputesTable && ["open", "under_review", "escalated"].includes(statusLower);
  const noteDefault = pickFirstString(d, ["admin_note", "internal_note", "operator_note"]) ?? "";

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-amber-50/40 p-4">
        <h2 className="text-sm font-extrabold text-slate-500">사건 요약</h2>
        <p className="mt-1 text-slate-900">
          {pickText(d, ["title", "name", "summary", "id"])} · {pickText(d, ["type", "kind", "category", "source"])}
        </p>
        <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">{pickText(d, ["body", "reason", "description"])}</p>
        <p className="mt-1 text-xs text-slate-600">우선순위·심각도: {pickText(d, ["priority", "severity", "impact", "urgency"])}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">처리 상태</span>
          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-xs font-extrabold text-amber-950">{stKo}</span>
          <span className="text-[10px] text-slate-400">({stRaw})</span>
        </div>
      </section>

      <DisputeEscrowSplitPanel panelState={props.escrowSplitPanelState} />

      <section className="rounded-2xl border border-amber-800/30 bg-amber-950/5 p-4">
        <h2 className="text-sm font-extrabold text-amber-950">금전·환불·정산 안내</h2>
        <p className="mt-1 text-xs text-amber-950/90">
          맞춤의뢰 <strong>예치 분배</strong>는 위 섹션에서 실행합니다. 구독·기타 환불은{" "}
          <Link className="font-extrabold underline" href="/admin/refunds" prefetch={false}>
            환불 관리
          </Link>
          에서 진행하세요. 아래 <strong>해결·종결</strong> 버튼은 분쟁 상태만 바꾸며, 예치 분배와 별개입니다.
        </p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
        <h2 className="text-sm font-extrabold text-slate-900">관련 주문·결제·구독</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-slate-800">
          <li>{relationLine("환불", b.refund.table, b.refund.row, b.refund.error)}</li>
          <li>{relationLine("결제", b.payment.table, b.payment.row, b.payment.error)}</li>
          <li>{relationLine("구독", b.subscription.table, b.subscription.row, b.subscription.error)}</li>
          <li>{relationLine("맞춤의뢰", b.customOrder.table, b.customOrder.row, b.customOrder.error)}</li>
        </ul>
        {(() => {
          const refId = pickFirstString(b.refund.row, ["id", "refund_id", "refundId"]);
          if (!refId) {
            return null;
          }
          return (
            <p className="mt-2 text-sm text-slate-800">
              <Link
                className="font-extrabold text-indigo-800 underline"
                href={`/admin/refunds?refundId=${encodeURIComponent(refId)}`}
                prefetch={false}
              >
                환불 관리에서 이 건 검색
              </Link>
            </p>
          );
        })()}
      </section>

      {props.actors ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-extrabold text-slate-900">관련 사용자</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-slate-800">
            <ActorLine label="접수자(제출)" a={props.actors.reporter} />
            <ActorLine label="학생·의뢰" a={props.actors.student} />
            <ActorLine label="멘토" a={props.actors.mentor} />
          </ul>
        </section>
      ) : null}

      {isDisputesTable ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-extrabold text-slate-900">운영 조치</h2>
          <p className="mt-1 text-xs text-slate-600">
            상태 변경은 이 분쟁 기록에만 적용됩니다. 접수·검토 중·운영 검토 중·해결·종결 단계로 구분해 관리합니다.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {canReview ? (
              <form action={setDisputeUnderReviewAction}>
                <input type="hidden" name="disputeId" value={props.disputeId} />
                <button
                  type="submit"
                  title="접수 또는 운영 검토 중인 건을 검토 중으로 바꿉니다."
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-indigo-700"
                >
                  검토 중으로
                </button>
              </form>
            ) : null}
            {canResolveOrDismiss ? (
              <>
                <form action={resolveDisputeAction} className="inline">
                  <input type="hidden" name="disputeId" value={props.disputeId} />
                  <button
                    type="submit"
                    title="분쟁을 해결됨으로 표시합니다. 환불은 자동 실행되지 않습니다."
                    className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-800"
                  >
                    해결 처리
                  </button>
                </form>
                <form action={dismissDisputeAction} className="inline">
                  <input type="hidden" name="disputeId" value={props.disputeId} />
                  <button
                    type="submit"
                    title="분쟁을 종결됨으로 표시합니다. 환불·정산은 별도 확인이 필요합니다."
                    className="rounded-lg bg-slate-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-slate-700"
                  >
                    종결 처리
                  </button>
                </form>
              </>
            ) : null}
            {!canResolveOrDismiss && !canReview ? (
              <p className="text-xs text-slate-600">이미 종료된 분쟁이거나, 상태를 더 바꿀 수 없습니다.</p>
            ) : null}
          </div>
        </section>
      ) : (
        <p className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          상태·메모 조치는 표준 분쟁 기록에만 사용할 수 있습니다. 현재 건은 다른 형식으로 연결되어 있어 이 화면에서 조치할 수 없습니다.
        </p>
      )}

      {isDisputesTable ? (
        <AdminCaseNotesPanel targetKind="dispute" targetId={props.disputeId} notes={props.adminNotes} legacyNote={noteDefault} />
      ) : null}

      <div className="grid gap-2 md:grid-cols-2">
        <DisputeKeyValueList title="분쟁 기록(핵심 필드)" row={d} maxKeys={16} />
        <div className="space-y-2">
          <DisputeKeyValueList title="환불" row={props.bundle.refund.row} maxKeys={8} />
          <DisputeKeyValueList title="결제" row={props.bundle.payment.row} maxKeys={8} />
        </div>
        <DisputeKeyValueList title="구독" row={props.bundle.subscription.row} maxKeys={8} />
        <DisputeKeyValueList title="맞춤의뢰 주문" row={props.bundle.customOrder.row} maxKeys={8} />
      </div>

      <div>
        <h3 className="text-sm font-extrabold text-slate-800">처리 이력(로그)</h3>
        <p className="text-xs text-slate-500">처리 이력 {b.modLogs.rows.length}건</p>
        {b.modLogs.rows.length ? (
          <ul className="mt-1 max-h-48 list-disc space-y-1 overflow-auto pl-5 text-xs text-slate-700">
            {b.modLogs.rows.map((r, i) => {
              const row = r as Row;
              return (
                <li key={i}>
                  {String(row.id ?? i)}: {String(row.event_type ?? row.type ?? row.action ?? row.verb ?? "이벤트")}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">표시할 이력이 없습니다.</p>
        )}
      </div>
    </div>
  );
}
