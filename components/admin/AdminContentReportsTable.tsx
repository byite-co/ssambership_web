import { updateContentReportModerationAction, updateContentReportStatusAction } from "@/lib/admin/adminReportActions";
import { bulkUpdateContentReportsAction } from "@/lib/admin/bulkActions";
import { adminContentTargetDisplay } from "@/lib/admin/adminOperationalLabels";
import { contentReportRowIsActionable, contentReportStatusLabel } from "@/lib/admin/contentReportLabels";
import type { AdminListResult } from "@/lib/admin/adminQueries";
import { adminListFetchFailedCopy } from "@/lib/admin/adminDisplayError";

type Row = Record<string, unknown>;

const ID_PREVIEW_LEN = 10;

function previewId(raw: unknown, maxLen = ID_PREVIEW_LEN): { display: string; title: string | undefined } {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return { display: "—", title: undefined };
  if (s.length <= maxLen) return { display: s, title: s };
  return { display: `${s.slice(0, maxLen)}…`, title: s };
}

function pickStr(row: Row, keys: readonly string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function formatTs(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = String(v).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function targetLine(row: Row): { display: string; title: string | undefined } {
  const tt = pickStr(row, ["target_type", "subject_type", "resource_type"]);
  const tid = row.target_id ?? row.target_uuid;
  const idPrev = previewId(tid);
  const { label, tooltip } = adminContentTargetDisplay(tt);
  if (!tt && idPrev.display === "—") return { display: "—", title: undefined };
  const display = tid ? `${label} · ${idPrev.display}` : label;
  const titleParts = [tooltip, idPrev.title].filter(Boolean) as string[];
  const title = titleParts.length ? titleParts.join(" · ") : undefined;
  return { display, title };
}

function reasonLine(row: Row): string {
  const r = pickStr(row, ["reason", "title", "summary"]);
  const d = pickStr(row, ["description", "body", "details"]);
  const line = r || d;
  if (!line) return "—";
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

export function AdminContentReportsTable(props: {
  list: AdminListResult;
  userById: Map<string, { nickname: string | null; full_name: string | null }>;
}) {
  const { list, userById } = props;

  if (list.error && !list.rows.length) {
    const { title, description } = adminListFetchFailedCopy("reports");
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-950">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-xs text-amber-900/90">{description}</p>
      </div>
    );
  }

  if (!list.rows.length) {
    return <p className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">접수된 신고가 없습니다.</p>;
  }

  const statusKey = list.keyHints.status ?? "status";

  return (
    <div className="space-y-3">
      {/* P1 ③ 일괄 처리 — 체크박스는 form 속성으로 이 폼에 연결 */}
      <form
        id="reportBulkForm"
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5"
      >
        <span className="text-[11px] font-bold text-slate-500">선택 항목 일괄</span>
        <button
          type="submit"
          name="bulkStatus"
          value="reviewing"
          formAction={bulkUpdateContentReportsAction}
          className="rounded-lg border border-indigo-300 bg-white px-3 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
        >
          검토 중으로
        </button>
        <button
          type="submit"
          name="bulkStatus"
          value="resolved"
          formAction={bulkUpdateContentReportsAction}
          className="rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
        >
          처리 완료로
        </button>
        <button
          type="submit"
          name="bulkStatus"
          value="dismissed"
          formAction={bulkUpdateContentReportsAction}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          종결로
        </button>
      </form>
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            <th className="px-3 py-2 font-extrabold text-slate-800">선택</th>
            <th className="px-3 py-2 font-extrabold text-slate-800">신고 ID</th>
            <th className="px-3 py-2 font-extrabold text-slate-800">신고자</th>
            <th className="px-3 py-2 font-extrabold text-slate-800">대상</th>
            <th className="px-3 py-2 font-extrabold text-slate-800">사유</th>
            <th className="px-3 py-2 font-extrabold text-slate-800">상태</th>
            <th className="px-3 py-2 font-extrabold text-slate-800">접수일</th>
            <th className="px-3 py-2 font-extrabold text-slate-800">처리</th>
          </tr>
        </thead>
        <tbody>
          {(list.rows as Row[]).map((row, i) => {
            const idPrev = previewId(row.id);
            const ridRaw = row.reporter_id ?? row.user_id ?? row.author_id;
            const rid = ridRaw != null ? String(ridRaw).trim() : "";
            const u = rid ? userById.get(rid) : undefined;
            const who = u?.full_name?.trim() || u?.nickname?.trim() || rid;
            const whoPrev = previewId(who || undefined);
            const tgt = targetLine(row);
            const statusRaw = typeof row[statusKey] === "string" ? String(row[statusKey]) : "";
            const label = contentReportStatusLabel(statusRaw);
            const actionable = contentReportRowIsActionable(statusRaw);
            return (
              <tr key={idPrev.title ?? String(i)} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2">
                  {actionable ? (
                    <input
                      type="checkbox"
                      name="ids"
                      value={String(row.id ?? "")}
                      form="reportBulkForm"
                      aria-label="신고 선택"
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  ) : null}
                </td>
                <td className="max-w-[120px] truncate px-3 py-2 font-mono text-xs" title={idPrev.title}>
                  <a
                    href={`/admin/reports/${encodeURIComponent(String(row.id ?? ""))}`}
                    className="font-extrabold text-indigo-800 underline"
                    title="신고 상세·증거 보기"
                  >
                    {idPrev.display}
                  </a>
                </td>
                <td className="max-w-[120px] truncate px-3 py-2 text-slate-800" title={whoPrev.title}>
                  {whoPrev.display}
                </td>
                <td className="max-w-[200px] truncate px-3 py-2 text-slate-800" title={tgt.title}>
                  {tgt.display}
                </td>
                <td className="max-w-[220px] truncate px-3 py-2 text-slate-700" title={reasonLine(row)}>
                  {reasonLine(row)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-800" title={statusRaw || undefined}>
                  {label}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{formatTs(row.created_at)}</td>
                <td className="min-w-[240px] px-3 py-2 align-top">
                  {actionable ? (
                    <>
                    <form className="space-y-2" action={updateContentReportStatusAction}>
                      <input type="hidden" name="reportId" value={String(row.id ?? "")} />
                      <textarea
                        name="note"
                        rows={2}
                        placeholder="메모(선택)"
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 placeholder:text-slate-400"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          name="nextStatus"
                          value="reviewing"
                          className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
                        >
                          검토 중
                        </button>
                        <button
                          type="submit"
                          name="nextStatus"
                          value="resolved"
                          className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                        >
                          처리 완료
                        </button>
                        <button
                          type="submit"
                          name="nextStatus"
                          value="dismissed"
                          className="rounded-lg bg-slate-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-slate-700"
                        >
                          종결
                        </button>
                      </div>
                    </form>
                    <form action={updateContentReportModerationAction} className="flex flex-wrap gap-1 border-t border-slate-100 pt-2">
                      <input type="hidden" name="reportId" value={String(row.id ?? "")} />
                      <button type="submit" name="intent" value="hidden" className="rounded-lg border px-2 py-1 text-[11px] font-bold">
                        숨김
                      </button>
                      <button type="submit" name="intent" value="deleted" className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-800">
                        삭제
                      </button>
                      <button type="submit" name="intent" value="restored" className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800">
                        정상
                      </button>
                    </form>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}