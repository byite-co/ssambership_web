import { redirect } from "next/navigation";
import { AdminLoginCodeStep } from "@/components/admin/AdminLoginCodeStep";
import { AdminLoginPasswordStep } from "@/components/admin/AdminLoginPasswordStep";
import { BrandSymbol } from "@/components/brand/BrandLogo";
import {
  ADMIN_LOGIN_ERROR_PARAM,
  ADMIN_LOGIN_NEXT_PARAM,
  ADMIN_LOGIN_STEP_LABELS,
  ADMIN_LOGIN_STEP_VALUES,
  adminLoginDestination,
  adminLoginErrorMessage,
  adminLoginRequiresSecondFactor,
  resolveAdminLoginReturnPath,
  type AdminLoginStep,
} from "@/lib/auth/adminLoginConsole";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils/cn";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * 관리자 로그인(PR-12 §3) — 서비스 로그인(학생 파랑 · 멘토 초록)과 구분되는 관리자 콘솔 색 규격(slate + 운영 배지).
 *
 * 두 단계 구조: 1단계 비밀번호 → 2단계 인증 코드. 2단계는 로그인된 관리자의 `getAuthenticatorAssuranceLevel()` 이
 * `nextLevel === 'aal2'` 일 때만 렌더하고, 등록된 인증 수단이 없으면(관리자 3명 전원 미등록) 건너뛰어 바로 목적지로 보낸다.
 * 코드 입력·검증·등록·강제는 PR-12b. 복귀 경로(`next`)는 허용 목록으로만 해석한다. (admin)/layout.tsx 가드 제외 라우트.
 */
export default async function AdminLoginPage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  const errorMessage = adminLoginErrorMessage(sp[ADMIN_LOGIN_ERROR_PARAM]);
  const returnPath = resolveAdminLoginReturnPath(sp[ADMIN_LOGIN_NEXT_PARAM]);

  const { user, profile } = await getServerUserWithProfile();
  let secondFactor = false;
  if (user && profile?.role === "admin") {
    const supabase = await createClient();
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    secondFactor = adminLoginRequiresSecondFactor(aal);
    if (!secondFactor) redirect(adminLoginDestination(returnPath));
  }
  const step: AdminLoginStep = secondFactor ? "code" : "password";

  return (
    <div className="flex min-h-svh flex-col bg-slate-100 px-4 py-10 text-slate-900">
      <main className="mx-auto w-full max-w-md">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg">
          <header className="bg-slate-900 px-7 py-6 text-white">
            <div className="flex items-center gap-3">
              <BrandSymbol className="h-8 w-8" />
              <p className="text-lg font-black tracking-tight">쌤버십 Admin</p>
              <span className="rounded-full border border-amber-300/60 bg-amber-400/15 px-2 py-0.5 text-[10px] font-extrabold text-amber-200">운영</span>
            </div>
            <h1 className="mt-4 text-2xl font-extrabold tracking-tight">관리자 로그인</h1>
            <p className="mt-1 text-sm text-slate-300">쌤버십 운영자 전용 콘솔입니다. 관리자 계정으로 로그인해 주세요.</p>
          </header>

          <ol className="flex items-center gap-2 border-b border-slate-100 px-7 py-3 text-[11px] font-bold" aria-label="로그인 단계">
            {ADMIN_LOGIN_STEP_VALUES.map((value, idx) => {
              const active = value === step;
              return (
                <li key={value} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
                  <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[10px]", active ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600")}>{idx + 1}</span>
                  <span className={active ? "text-slate-900" : "text-slate-400"}>{ADMIN_LOGIN_STEP_LABELS[value]}</span>
                  {idx < ADMIN_LOGIN_STEP_VALUES.length - 1 ? <span aria-hidden className="text-slate-300">→</span> : null}
                </li>
              );
            })}
          </ol>

          <div className="px-7 py-6">{secondFactor ? <AdminLoginCodeStep /> : <AdminLoginPasswordStep returnPath={returnPath} errorMessage={errorMessage} />}</div>
        </div>
      </main>
    </div>
  );
}
