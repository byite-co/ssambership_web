/**
 * 시스템 설정 · 관리자 계정(읽기 전용) — PR-10 §3-2. 조치 없음: e2e 계정에 경고 배지만(처리는 오너). 이름 → 계정 상세. Server Component.
 */
import Link from "next/link";
import { SETTINGS_ADMIN_ACCOUNTS_NOTE, SETTINGS_TEST_ACCOUNT_WARNING, adminAccountDisplayName, adminAccountReviewLabel, isTestAdminAccount, type AdminAccountRow } from "@/lib/admin/settingsConsole";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";

type Props = {
  rows: AdminAccountRow[];
  error: string | null;
};

export function SettingsAdminAccountList({ rows, error }: Props) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-settings-section="admin-accounts">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
        관리자 계정
        <span className="ml-2 rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-extrabold text-slate-600">읽기 전용</span>
      </h2>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-red-800">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-slate-500">관리자 계정이 없습니다.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {rows.map((r) => {
            const test = isTestAdminAccount(r.email);
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm" data-settings-admin={r.id} data-test-account={test ? "1" : "0"}>
                <div className="min-w-0">
                  <Link href={`/admin/users/${encodeURIComponent(r.id)}`} className="font-extrabold text-slate-900 hover:underline" prefetch={false}>
                    {r.email ?? adminAccountDisplayName(r)}
                  </Link>
                  <span className="ml-2 text-xs text-slate-600">{adminAccountDisplayName(r)}</span>
                  {test ? (
                    <span className="ml-2 rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-900" data-settings-test-badge>
                      ⚠️ {SETTINGS_TEST_ACCOUNT_WARNING}
                    </span>
                  ) : null}
                </div>
                <div className="text-right text-xs text-slate-500">
                  <span className="tabular-nums">{adminAccountReviewLabel(r.logCount)}</span>
                  <span className="ml-2">가입 {formatKoreanDate(r.createdAt)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-slate-500">ⓘ {SETTINGS_ADMIN_ACCOUNTS_NOTE}</p>
    </section>
  );
}
