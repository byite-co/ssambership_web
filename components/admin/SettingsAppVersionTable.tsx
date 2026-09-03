/**
 * 시스템 설정 · 앱 버전 정책(읽기 전용 + 경고) — PR-10 §3-2. `mobile_app_version_policies` 는 정책 0개 `service_role` 전용이고 쓰기 경로가 없다.
 * 채우는 건 앱 연결노트 배치(191) — 여기서는 `store_url` NULL 경고만 띄워 오너가 App Store ID 를 준비해야 함을 상기시킨다. Server Component.
 */
import { SETTINGS_APP_VERSION_NOTE, SETTINGS_EMPTY_LABEL, appPlatformLabel, appVersionPolicyWarnings, type AppVersionPolicyRow } from "@/lib/admin/settingsConsole";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type Props = {
  rows: AppVersionPolicyRow[];
  error: string | null;
};

const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";

function EmptyCell({ warn }: { warn: boolean }) {
  return (
    <span className={warn ? "font-bold text-amber-800" : "text-slate-400"} data-settings-empty={warn ? "warn" : "plain"}>
      {warn ? "⚠️ " : ""}
      {SETTINGS_EMPTY_LABEL}
    </span>
  );
}

export function SettingsAppVersionTable({ rows, error }: Props) {
  const warnings = error ? [] : appVersionPolicyWarnings(rows);
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-settings-section="app-version">
      <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
          앱 버전 정책
          <span className="ml-2 rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-extrabold text-slate-600">읽기 전용</span>
        </h2>
      </div>
      {error ? (
        <p role="alert" className="px-5 py-6 text-sm font-semibold text-red-800">
          {error}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50/40">
              <tr>
                <th className={TH}>플랫폼</th>
                <th className={`${TH} text-right`}>최소 지원 빌드</th>
                <th className={`${TH} text-right`}>최신 빌드</th>
                <th className={TH}>최소 버전명</th>
                <th className={TH}>스토어 URL</th>
                <th className={TH}>안내 메시지</th>
                <th className={TH}>갱신</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td className={TD} colSpan={7}>
                    <span className="font-semibold text-slate-500">정책 행이 없습니다.</span>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.platform} className="border-t border-slate-100" data-settings-platform={r.platform} data-store-url={r.storeUrl ? "set" : "empty"}>
                    <td className={`${TD} font-bold text-slate-900`}>{appPlatformLabel(r.platform)}</td>
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{r.minSupportedBuild ?? "—"}</td>
                    <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{r.latestBuild ?? "—"}</td>
                    <td className={`${TD} whitespace-nowrap`}>{r.minimumVersionName ?? "—"}</td>
                    <td className={`${TD} max-w-[240px] break-all`}>{r.storeUrl ? r.storeUrl : <EmptyCell warn />}</td>
                    <td className={`${TD} max-w-[240px]`}>{r.message ? r.message : <EmptyCell warn={false} />}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums text-slate-500`}>{formatKoDateTimeKst(r.updatedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {warnings.length ? (
        <ul className="space-y-1 border-t border-slate-100 px-5 py-3" data-settings-app-version-warnings>
          {warnings.map((w) => (
            <li key={w} role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
              ⚠️ {w}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="px-5 pb-4 pt-2 text-[11px] text-slate-500">ⓘ {SETTINGS_APP_VERSION_NOTE}</p>
    </section>
  );
}
