/**
 * 관리자 로그인 1단계 — 이메일·비밀번호(PR-12 §3). Server Component(서버 액션 form).
 * 복귀 경로(`next`)는 허용 목록을 통과한 값만 hidden 으로 싣는다.
 */
import Link from "next/link";
import { ADMIN_LOGIN_NEXT_PARAM, ADMIN_LOGIN_RETURN_NOTICE, ADMIN_LOGIN_SERVICE_LOGIN_HREF } from "@/lib/auth/adminLoginConsole";
import { adminEmailLoginAction } from "@/lib/auth/adminLoginActions";

type Props = {
  /** 허용 목록을 통과한 복귀 경로(없으면 null) */
  returnPath: string | null;
  errorMessage: string | null;
};

const INPUT = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/15";

export function AdminLoginPasswordStep({ returnPath, errorMessage }: Props) {
  return (
    <div data-admin-login-step="password">
      {errorMessage ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          {errorMessage}
        </p>
      ) : returnPath ? (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          {ADMIN_LOGIN_RETURN_NOTICE}
        </p>
      ) : null}

      <form action={adminEmailLoginAction} className="mt-5 space-y-5">
        {returnPath ? <input type="hidden" name={ADMIN_LOGIN_NEXT_PARAM} value={returnPath} /> : null}
        <div>
          <label htmlFor="admin-login-email" className="block text-sm font-bold text-slate-800">
            이메일
          </label>
          <input id="admin-login-email" name="email" type="email" autoComplete="username" required className={INPUT} placeholder="name@example.com" />
        </div>
        <div>
          <label htmlFor="admin-login-password" className="block text-sm font-bold text-slate-800">
            비밀번호
          </label>
          <input id="admin-login-password" name="password" type="password" autoComplete="current-password" required className={INPUT} />
        </div>
        <button type="submit" className="w-full rounded-xl bg-slate-900 py-3 text-base font-extrabold text-white shadow-sm transition hover:bg-slate-800">
          관리자 로그인
        </button>
      </form>

      <p className="mt-6 text-center text-xs text-slate-500">
        학생·멘토 계정은{" "}
        <Link href={ADMIN_LOGIN_SERVICE_LOGIN_HREF} className="font-bold text-slate-700 underline underline-offset-2 hover:text-slate-900" prefetch={false}>
          서비스 로그인
        </Link>
        을 이용해 주세요.
      </p>
    </div>
  );
}
