/**
 * 관리자 로그인 2단계 — 인증 코드(PR-12 §3-2). **자리만 있다.**
 *
 * PR-12b에서 활성화: 코드 입력·`supabase.auth.mfa.challenge()`/`verify()` 검증·MFA 등록(설정 > 내 계정)·강제(두 관리자 모두 등록 후)·
 * 복구 경로(Supabase 대시보드에서 factor 해제)는 PR-12b 가 넣는다. 이 컴포넌트는 `adminLoginRequiresSecondFactor()` 가 true 일 때만
 * 렌더되며(등록된 인증 수단이 있는 계정), 지금은 관리자 전원 미등록이라 보이지 않는다.
 * Server Component — 입력은 비활성이고 제출 경로가 없다. 로그아웃(다른 계정으로)은 정본 `LogoutButton`(POST /logout).
 */
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ADMIN_LOGIN_CODE_STEP_NOTICE } from "@/lib/auth/adminLoginConsole";

export function AdminLoginCodeStep() {
  return (
    <div data-admin-login-step="code">
      <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
        {ADMIN_LOGIN_CODE_STEP_NOTICE}
      </p>
      <div className="mt-5 space-y-5">
        <div>
          <label htmlFor="admin-login-code" className="block text-sm font-bold text-slate-800">
            인증 코드
          </label>
          {/* PR-12b에서 활성화 — 6자리 코드 입력 + 검증 */}
          <input
            id="admin-login-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            disabled
            aria-disabled="true"
            placeholder="PR-12b에서 활성화"
            className="mt-2 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-slate-400"
          />
        </div>
        <button type="button" disabled className="w-full cursor-not-allowed rounded-xl bg-slate-300 py-3 text-base font-extrabold text-white">
          코드 확인
        </button>
      </div>
      <div className="mt-6 text-center">
        <LogoutButton className="text-xs font-bold text-slate-600 underline underline-offset-2 hover:text-slate-900">다른 계정으로 로그인</LogoutButton>
      </div>
    </div>
  );
}
