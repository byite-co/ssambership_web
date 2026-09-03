/**
 * 계정 상세 — 처리 이력(PR-7 §2-3·§2-4·§2-5). `admin_action_logs` 에서 이 사용자가 대상인 것(멘토·학생) 또는 이 관리자가 실행한 것(관리자 계정).
 * 액션 · 실행자 · 사유 · 일시. 최근 20건, 더 보기(=100건). Server Component.
 */
import Link from "next/link";
import { accountActionLogLabel, accountDetailPath } from "@/lib/admin/accountDetailConsole";
import type { AccountActionLogs } from "@/lib/admin/accountDetailQueries";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type Props = {
  logs: AccountActionLogs;
  /** target = 이 사용자가 대상 · admin = 이 관리자가 실행 */
  mode: "target" | "admin";
  /** 더 보기 링크(이미 전부 보였으면 null) */
  moreHref: string | null;
};

export function AccountActionLogList({ logs, mode, moreHref }: Props) {
  if (logs.error) {
    return <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{logs.error}</p>;
  }
  if (!logs.rows.length) {
    return <p className="text-xs text-slate-600">{mode === "admin" ? "이 관리자가 실행한 조치가 없습니다." : "이 계정을 대상으로 한 관리자 조치가 없습니다."}</p>;
  }
  return (
    <div data-account-action-logs={mode}>
      <ul className="divide-y divide-slate-100">
        {logs.rows.map((log) => (
          <li key={log.id} className="grid gap-x-3 gap-y-0.5 py-2 text-xs sm:grid-cols-[150px_1fr_auto]">
            <span className="tabular-nums text-slate-500">{formatKoDateTimeKst(log.createdAt)}</span>
            <span className="min-w-0">
              <span className="font-extrabold text-slate-900">{accountActionLogLabel(log.actionType)}</span>
              {log.reason ? (
                <span className="ml-1 truncate text-slate-600" title={log.reason}>
                  · {log.reason}
                </span>
              ) : null}
              {mode === "admin" && log.targetId ? (
                <Link href={accountDetailPath(log.targetId)} className="ml-1 font-mono text-[11px] text-blue-700 hover:underline" prefetch={false} title={log.targetType ?? undefined}>
                  대상 {log.targetId.slice(0, 8)}…
                </Link>
              ) : null}
            </span>
            <span className="text-right text-[11px] font-semibold text-slate-500">
              {mode === "admin" ? (log.targetType ?? "—") : log.adminId ? (
                <Link href={accountDetailPath(log.adminId)} className="hover:underline" prefetch={false} title="실행한 관리자">
                  {log.adminName ?? `${log.adminId.slice(0, 8)}…`}
                </Link>
              ) : (
                "시스템"
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {logs.rows.length}건 표시{logs.totalCount != null ? ` / 전체 ${logs.totalCount}건` : ""}
        </span>
        {moreHref ? (
          <Link href={moreHref} className="font-bold text-blue-700 hover:underline" prefetch={false}>
            더 보기
          </Link>
        ) : null}
      </div>
    </div>
  );
}
