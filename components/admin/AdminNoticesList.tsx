import type { NoticeListRow } from "@/lib/admin/adminNoticesQueries";
import { ADMIN_LIST_ERROR_TITLE, adminNoticesSectionDescription } from "@/lib/admin/adminDisplayError";
import { toggleAdminNoticeActiveAction } from "@/lib/admin/adminNoticesActions";

const badge = (on: boolean) =>
  on ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-slate-50 text-slate-600 border-slate-100";

export function AdminNoticesList(props: { label: string; table: string; rows: NoticeListRow[]; error: string | null }) {
  const { label, table: _table, rows, error } = props;
  void _table;
  if (error && !rows.length) {
    const kind = label === "프로모션" ? "promotion" : "notice";
    return (
      <div className="rounded-xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
        <p className="font-bold">{ADMIN_LIST_ERROR_TITLE}</p>
        <p className="mt-1 text-xs text-red-900/95">{adminNoticesSectionDescription(kind)}</p>
      </div>
    );
  }
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-8 text-center text-sm text-slate-500 font-semibold">
        {label === "프로모션" ? "등록된 프로모션이 없습니다." : "등록된 공지가 없습니다."}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3.5 flex items-center justify-between">
        <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">{label} 데이터</h2>
        <span className="text-xs bg-blue-50 text-blue-600 font-semibold px-2.5 py-1 rounded">
          {rows.length}건
        </span>
      </div>
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200/60 bg-slate-50/40">
            <th className="px-5 py-3 text-xs font-bold text-slate-600">제목</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">유형</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">노출 위치</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">노출 상태</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">노출 기간</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">생성일</th>
            <th className="px-5 py-3 text-xs font-bold text-slate-600">조치</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => {
            const key = r.id || `row-${i}`;
            const resource = label === "프로모션" ? "promotion" : "notice";
            return (
              <tr key={key} className="hover:bg-slate-50/30 transition-colors">
                <td className="max-w-[220px] truncate px-5 py-4 font-bold text-slate-900">{r.title}</td>
                <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-700">{r.typeLabel}</td>
                <td className="max-w-[140px] truncate px-5 py-4 text-xs font-medium text-slate-600 leading-relaxed">{r.target}</td>
                <td className="px-5 py-4 whitespace-nowrap">
                  <span className={`inline-block border rounded-lg px-2.5 py-1 text-xs font-bold ${badge(r.exposure.isOn)}`}>
                    {r.exposure.label}
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-500">{r.periodLabel}</td>
                <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-500">{r.createdLabel}</td>
                <td className="whitespace-nowrap px-5 py-4">
                  {r.id ? (
                    <form action={toggleAdminNoticeActiveAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="resource" value={resource} />
                      <input type="hidden" name="nextActive" value={r.exposure.isOn ? "false" : "true"} />
                      <button
                        type="submit"
                        className={
                          r.exposure.isOn
                            ? "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            : "rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                        }
                      >
                        {r.exposure.isOn ? "비활성화" : "활성화"}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
