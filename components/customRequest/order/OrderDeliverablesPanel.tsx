import { pickDisplayField } from "@/lib/customRequest/customRequestQueries";
import { downloadCustomOrderDeliverableAction } from "@/lib/customRequest/orderDeliverableDownloadActions";
import { getStringField } from "@/lib/qna/safeSelect";
import { submitMentorOrderDeliverableAction } from "@/lib/customRequest/orderMentorActions";
import {
  deliverableVersionLabelKorean,
  formatOrderRoomDateTime,
  orderStatusLabelForUi,
  studentCanDownloadDeliverable,
} from "@/lib/customRequest/orderLifecycleConstants";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { EmptyState } from "@/components/design-system";
import { File } from "lucide-react";
import type { AppRole } from "@/lib/types/user";
import type { OrderDetailPageData } from "@/lib/customRequest/orderDetailQueries";

type Row = Record<string, unknown>;

function pickStoragePathFromDeliverableRow(r: Row): string | null {
  return getStringField(r, ["storage_path", "file_path", "file_storage_path", "object_path", "file_url"]);
}
type Props = {
  detail: OrderDetailPageData;
  orderId: string;
  view: "student" | "mentor";
  actorRole: AppRole;
  /** null = 멘토 납품 등록 폼 사용 가능(상태·역할·접근 충족) */
  mentorDeliverableBlockReason: string | null;
  /** 종료 주문: 멘토 납품 등록 블록 전체 비표시(목록·다운로드는 유지) */
  orderTerminal?: boolean;
  embedded?: boolean;
};

function formatBytes(n: unknown): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    return "—";
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function displayFileName(r: Row): string {
  const fromMeta = pickDisplayField(r, ["original_filename", "file_name", "filename", "original_name"]);
  if (fromMeta && fromMeta !== "—") {
    return fromMeta;
  }
  return "—";
}

function pickSize(r: Row): number | null {
  for (const k of ["file_size", "file_size_bytes", "size_bytes", "size"] as const) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
  }
  return null;
}

function hasDownloadableFile(r: Row): boolean {
  const p = pickStoragePathFromDeliverableRow(r);
  return Boolean(p && p.length > 0 && !p.startsWith("http://") && !p.startsWith("https://"));
}

function submittedAt(r: Row): string {
  const v = (() => {
    for (const k of ["submitted_at", "created_at", "updated_at"] as const) {
      const x = r[k];
      if (x != null) {
        return x;
      }
    }
    return null;
  })();
  return formatOrderRoomDateTime(v);
}

export function OrderDeliverablesPanel(props: Props) {
  if (props.view === "mentor") {
    return <OrderDeliverablesPanelMentor {...props} />;
  }
  const {
    detail,
    orderId,
    actorRole,
    embedded = false,
  } = props;
  const d = detail.bundle.deliverables;
  const err = d.error;
  const rows = (d.rows ?? []) as Row[];
  const canDownload = (actorRole === "student" || actorRole === "mentor" || actorRole === "admin") && orderId.trim().length > 0;
  const studentDownloadAllowed = actorRole !== "student" || studentCanDownloadDeliverable(detail.bundle.order.row as Row);
  const sectionClass = embedded
    ? "space-y-3"
    : "rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm hover:border-blue-200 hover:shadow-md transition-all duration-300 relative overflow-hidden";

  return (
    <section className={sectionClass}>
      <div className="space-y-3">
        {!embedded ? (
        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
          <h3 className="text-sm font-black uppercase tracking-wider text-slate-400">납품 완료물</h3>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-black text-blue-600">파일 보관함</span>
        </div>
        ) : null}
      {err ? <p className="text-sm font-bold text-amber-800">정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p> : null}
      {d.table && rows.length > 0 ? (
        <ul className="space-y-2.5">
          {rows.map((r, i) => {
            const id = String(r.id ?? i);
            const statusRaw = pickDisplayField(r, ["state", "status", "label"]);
            const status =
              statusRaw === "—" || !String(statusRaw).trim() ? "—" : orderStatusLabelForUi(String(statusRaw));
            const fileName = displayFileName(r);
            const dl = hasDownloadableFile(r);
            const studentDownloadBlocked = actorRole === "student" && !studentDownloadAllowed;
            const hasNamedFile = fileName !== "—" && String(fileName).trim().length > 0;
            return (
              <li
                key={id}
                className="group/item rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-sm text-slate-800 hover:bg-slate-50 hover:border-blue-100 transition-all duration-200"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md">
                    {deliverableVersionLabelKorean((r as Row).version, i)}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">{submittedAt(r)}</span>
                </div>
                <div className="mt-2.5">
                  <p className="text-xs font-bold text-slate-800">상태: <span className="font-extrabold text-slate-900">{status}</span></p>
                </div>
                {dl && canDownload && !studentDownloadBlocked ? (
                  <div className="mt-3 border-t border-slate-100/50 pt-2.5">
                    {hasNamedFile || pickSize(r) != null ? (
                      <p className="mb-2 break-all text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                        <svg className="h-4 w-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="truncate">{hasNamedFile ? fileName : "첨부 파일"}</span>
                        {pickSize(r) != null ? (
                          <span className="shrink-0 text-[10px] font-bold text-slate-400">({formatBytes(pickSize(r))})</span>
                        ) : null}
                      </p>
                    ) : null}
                    <form action={downloadCustomOrderDeliverableAction} className="inline">
                      <input type="hidden" name="orderId" value={orderId} />
                      <input type="hidden" name="deliverableId" value={id} />
                      <button
                        type="submit"
                        className="inline-flex min-h-[32px] w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-700 shadow-sm hover:border-blue-300 hover:text-blue-600 transition"
                      >
                        다운로드 받기
                      </button>
                    </form>
                  </div>
                ) : dl && canDownload && studentDownloadBlocked ? (
                  <div className="mt-3 border-t border-slate-100/50 pt-2.5">
                    {hasNamedFile || pickSize(r) != null ? (
                      <p className="mb-2 break-all text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                        <svg className="h-4 w-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span className="truncate">{hasNamedFile ? fileName : "첨부 파일"}</span>
                        {pickSize(r) != null ? (
                          <span className="shrink-0 text-[10px] font-bold text-slate-400">({formatBytes(pickSize(r))})</span>
                        ) : null}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled
                      className="inline-flex min-h-[32px] w-full cursor-not-allowed items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-[11px] font-bold text-slate-400 shadow-sm"
                    >
                      다운로드
                    </button>
                    <p className="mt-2 text-[11px] font-semibold text-slate-500">수락(완료) 후 다운로드할 수 있어요.</p>
                  </div>
                ) : hasNamedFile || pickSize(r) != null ? (
                  <p className="mt-2.5 break-all text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <span className="truncate">{hasNamedFile ? fileName : "첨부"}</span>
                    {pickSize(r) != null ? (
                      <span className="shrink-0 text-[10px] font-bold text-slate-400">({formatBytes(pickSize(r))})</span>
                    ) : null}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-400 font-semibold">첨부 파일이 없습니다</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : d.table ? (
        <p className="text-xs font-bold text-slate-400 text-center py-4 bg-slate-50/50 rounded-xl">아직 등록된 납품물이 없습니다.</p>
      ) : (
        <p className="text-xs font-bold text-slate-400 text-center py-4 bg-slate-50/50 rounded-xl">정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
      )}

      </div>
    </section>
  );
}

/**
 * ========================================================
 * MENTOR ONLY VISUAL UPGRADES (SAFETY ENCAPSULATED)
 * ========================================================
 */

function OrderDeliverablesPanelMentor({
  detail,
  orderId,
  actorRole,
  mentorDeliverableBlockReason,
  orderTerminal = false,
}: Props) {
  const d = detail.bundle.deliverables;
  const err = d.error;
  const showMentorForm =
    actorRole === "mentor" && !orderTerminal && !mentorDeliverableBlockReason;
  const rows = (d.rows ?? []) as Row[];
  const canDownload = (actorRole === "student" || actorRole === "mentor" || actorRole === "admin") && orderId.trim().length > 0;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold text-slate-900">납품 파일</h3>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">총 {rows.length}건</span>
      </div>
      {err ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-900">정보를 불러오지 못했습니다.</p> : null}
      {d.table && rows.length > 0 ? (
        <ul className="space-y-4">
          {rows.map((r, i) => {
            const id = String(r.id ?? i);
            const fileName = displayFileName(r);
            const dl = hasDownloadableFile(r);
            const hasNamedFile = fileName !== "—" && String(fileName).trim().length > 0;
            return (
              <li
                key={id}
                className="rounded-2xl border border-ds-border-subtle p-5"
              >
                <div className="flex items-center justify-between gap-2 pb-3">
                  <span className="text-sm font-semibold text-slate-900">
                    {deliverableVersionLabelKorean((r as Row).version, i)}
                  </span>
                  <span className="text-xs font-medium tabular-nums text-slate-400">{submittedAt(r)}</span>
                </div>

                {dl && canDownload ? (
                  <div className="mt-3">
                    <div className="mb-3 flex items-center gap-2">
                      <File className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2} aria-hidden />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900" title={fileName}>
                        {hasNamedFile ? fileName : "첨부 파일"}
                      </p>
                    </div>
                    <form action={downloadCustomOrderDeliverableAction} className="w-full">
                      <input type="hidden" name="orderId" value={orderId} />
                      <input type="hidden" name="deliverableId" value={id} />
                      <button
                        type="submit"
                        className="flex w-full items-center justify-center rounded-xl border border-ds-border-subtle bg-white py-2 text-xs font-semibold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                      >
                        다운로드
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2">
                    <File className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={2} aria-hidden />
                    <p className="truncate text-sm text-slate-400">
                      {hasNamedFile ? fileName : "(파일 정보 없음)"}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : d.table ? (
        <EmptyState title="아직 납품물이 없습니다." className="py-8" />
      ) : null}

      {!orderTerminal && actorRole === "mentor" ? (
        <div className="border-t border-dashed border-ds-border-subtle pt-6">
          <div className="rounded-2xl border border-ds-border-subtle p-5">
            <p className="text-sm font-bold text-slate-900">신규 납품 등록</p>
            <p className="mt-1 text-xs font-medium leading-relaxed text-slate-600">
              PDF, ZIP, DOCX 등 (최대 20MB).
            </p>

            {mentorDeliverableBlockReason ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs font-medium text-amber-900">
                {mentorDeliverableBlockReason}
              </p>
            ) : showMentorForm && orderId ? (
              <form
                action={submitMentorOrderDeliverableAction}
                encType="multipart/form-data"
                className="mt-3 space-y-2"
              >
                <input type="hidden" name="orderId" value={orderId} />
                <input
                  type="file"
                  name="deliverableFile"
                  className="block w-full cursor-pointer text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-emerald-700"
                  required
                />
                <textarea
                  name="deliverableBody"
                  rows={2}
                  className="w-full rounded-xl border border-ds-border-subtle bg-white px-3 py-2 text-xs font-medium text-slate-900 placeholder:text-slate-500 outline-none focus:border-emerald-400"
                  placeholder="납품 설명 (옵션)"
                />
                <FormSubmitButton
                  idleLabel="제출하기"
                  pendingLabel="제출 중"
                  className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-700"
                />
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
