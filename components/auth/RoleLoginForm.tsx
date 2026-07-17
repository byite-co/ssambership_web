"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { resolvePostLoginPath, safeInternalNextPath } from "@/lib/auth/getPostLoginPath";
import { mapSupabaseAuthError } from "@/lib/utils/mapSupabaseAuthError";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";
import type { AuthLoginRole } from "./loginRoleContent";
import type { UserRow } from "@/lib/types/user";


const inputBase =
  "w-full min-h-12 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 sm:min-h-[3.1rem] sm:px-5";

const inputByRole: Record<AuthLoginRole, string> = {
  student: `${inputBase} focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20`,
  mentor: `${inputBase} focus:border-[#059669] focus:ring-2 focus:ring-[#059669]/20`,
};

const labelByRole: Record<AuthLoginRole, string> = {
  student: "text-sm font-bold text-slate-800 sm:text-base",
  mentor: "text-sm font-bold text-slate-800 sm:text-base",
};

const ctaByRole: Record<AuthLoginRole, string> = {
  student:
    "w-full min-h-14 rounded-2xl bg-[#2563EB] text-base font-extrabold text-white transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[3.5rem] sm:text-lg",
  mentor:
    "w-full min-h-14 rounded-2xl bg-[#059669] text-base font-extrabold text-white transition hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#059669] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[3.5rem] sm:text-lg",
};

type RoleLoginFormProps = {
  role: AuthLoginRole;
  emailId: string;
  passwordId: string;
  submitLabel: string;
  /** /login?next=... → /login/student?next=... 으로 전달 */
  initialNext?: string | null;
  /** «유형 선택» 링크: `next` 유지하려면 `/login?next=...` */
  rolePickerHref?: string;
  hideRolePickerLink?: boolean;
  /** 듀얼 패널에서 비활성 카드 입력 차단(브라우저 autofill 공유 방지) */
  disabled?: boolean;
  /** 제어형 입력(듀얼 패널에서 카드별 state 분리용). 미전달 시 내부 state 사용 */
  email?: string;
  password?: string;
  onEmailChange?: (value: string) => void;
  onPasswordChange?: (value: string) => void;
};

export function RoleLoginForm({
  role,
  emailId,
  passwordId,
  submitLabel,
  initialNext,
  rolePickerHref = "/login",
  hideRolePickerLink = false,
  disabled = false,
  email: emailProp,
  password: passwordProp,
  onEmailChange,
  onPasswordChange,
}: RoleLoginFormProps) {
  const searchParams = useSearchParams();
  const signupMessage = searchParams.get("message");
  const signupFollowUp = signupMessage === "signup-check-email" || signupMessage === "signup-check-email-doc";
  // 이메일 인증 가입 경로에서는 가입 화면의 학생증 파일이 저장되지 않는다 — 재제출 안내.
  const signupDocFollowUp = signupMessage === "signup-check-email-doc";
  const [emailState, setEmailState] = useState("");
  const [passwordState, setPasswordState] = useState("");
  const email = emailProp ?? emailState;
  const password = passwordProp ?? passwordState;
  const setEmail = (value: string) => (onEmailChange ? onEmailChange(value) : setEmailState(value));
  const setPassword = (value: string) =>
    onPasswordChange ? onPasswordChange(value) : setPasswordState(value);
  const [error, setError] = useState<string | null>(null);
  // 안내(중립) 톤 — 실제 에러(빨강)와 구분. 예: 다른 역할 계정으로 로그인 시도.
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSuccess(null);
    setLoading(true);

    const supabase = createClient();
    let userId: string | null = null;

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setLoading(false);
        setError(mapSupabaseAuthError(signInError.message));
        return;
      }
      if (!data.user) {
        setError("로그인 정보를 가져오지 못했습니다. 다시 시도해 주세요.");
        setLoading(false);
        return;
      }
      userId = data.user.id;
      if (!data.user.email_confirmed_at) {
        try {
          await supabase.auth.signOut();
        } catch {
          /* */
        }
        setLoading(false);
        setError(
          "이메일 인증이 아직 완료되지 않았습니다. 메일함(스팸 함 포함)의 링크로 인증한 뒤 다시 시도해 주세요."
        );
        return;
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(mapSupabaseAuthError(m));
      setLoading(false);
      return;
    }

    let profile: UserRow | null = null;
    let profErr: string | null = null;
    try {
      if (!userId) {
        throw new Error("user id");
      }
      const { data, error: pe } = await getUserProfileById(supabase, userId);
      if (pe) {
        profErr = pe.message;
      } else {
        profile = data;
      }
    } catch (e) {
      profErr = e instanceof Error ? e.message : String(e);
    }
    if (profErr) {
      try {
        await supabase.auth.signOut();
      } catch {
        /* */
      }
      setError(`프로필을 불러오는 중 오류: ${mapDataErrorMessage(profErr)}`);
      setLoading(false);
      return;
    }
    if (!profile) {
      try {
        await supabase.auth.signOut();
      } catch {
        /* */
      }
      setError(
        "로그인에 문제가 생겼어요. 잠시 후 다시 시도하거나, 계속되면 고객센터에 문의해 주세요."
      );
      setLoading(false);
      return;
    }

    if (role === "mentor" && profile.role !== "mentor") {
      try {
        await supabase.auth.signOut();
      } catch {
        /* */
      }
      setNotice("이 화면은 멘토 계정 전용이에요. 학생 계정이면 학생 로그인을 이용해 주세요.");
      setLoading(false);
      return;
    }
    if (role === "student" && profile.role !== "student") {
      try {
        await supabase.auth.signOut();
      } catch {
        /* */
      }
      setNotice("이 화면은 학생 계정 전용이에요. 멘토 계정이면 멘토 로그인을 이용해 주세요.");
      setLoading(false);
      return;
    }

    const fromQuery = safeInternalNextPath(initialNext);
    const nextPath = resolvePostLoginPath(fromQuery ?? null, profile.role);

    setSuccess("로그인에 성공했습니다. 이동합니다.");
    setLoading(false);
    /**
     * `router.push`만 쓰면 브라우저에 방금 쓴 세션 쿠키가 다음 RSC 요청에 아직 안 실릴 수 있어
     * `(mentor)` 레이아웃의 `requireRole`이 비로그인으로 판단하는 레이스가 난다.
     * 전체 문서 네비게이션으로 확실히 같은 쿠키 저장소를 쓰는 요청을 보낸다.
     */
    window.setTimeout(() => {
      window.location.assign(nextPath);
    }, 150);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
      <fieldset disabled={disabled || loading} className="space-y-4 sm:space-y-5 disabled:opacity-60">
      {signupFollowUp && !error ? (
        <p
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 sm:text-base"
          role="status"
        >
          회원가입이 접수됐어요. 이메일을 열고 인증 링크를 눌러 주시면, 이어서 아래에서 로그인하실 수 있어요. 메일이 안
          보이면 스팸함을 확인해 주세요.
          {signupDocFollowUp ? (
            <>
              {" "}
              가입 화면에서 선택한 학생증 파일은 이메일 인증 전에는 저장되지 않아요. 로그인 후{" "}
              <span className="font-bold">인증 상태(멘토 → 인증)</span> 화면에서 학생증 서류를 다시 제출해 주세요.
            </>
          ) : null}
        </p>
      ) : null}
      {error ? (
        <p
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:text-base"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice && !error ? (
        <p
          className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:text-base"
          role="status"
        >
          {notice}
        </p>
      ) : null}
      {success ? (
        <p
          className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 sm:text-base"
          role="status"
        >
          {success}
        </p>
      ) : null}

      <div>
        <label htmlFor={emailId} className={labelByRole[role]}>
          이메일
        </label>
        <input
          id={emailId}
          type="email"
          name={`${role}-email`}
          autoComplete={`section-${role} email`}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputByRole[role] + " mt-2 block"}
          placeholder="name@example.com"
        />
      </div>
      <div>
        <label htmlFor={passwordId} className={labelByRole[role]}>
          비밀번호
        </label>
        <input
          id={passwordId}
          type="password"
          name={`${role}-password`}
          autoComplete={`section-${role} current-password`}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputByRole[role] + " mt-2 block"}
        />
        <p className="mt-1.5 text-right text-sm text-slate-500">
          <Link href="/forgot-password" className="font-semibold text-blue-600 underline decoration-blue-200 underline-offset-4 hover:text-blue-800">
            비밀번호를 잊으셨나요?
          </Link>
        </p>
      </div>

      <button type="submit" disabled={loading} className={ctaByRole[role]}>
        {loading ? "처리 중…" : submitLabel}
      </button>

      {!hideRolePickerLink ? (
        <p className="text-center text-sm text-slate-600 sm:text-base">
          <Link
            href={rolePickerHref}
            className="font-semibold text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-slate-800"
          >
            ← 로그인 유형 다시 선택
          </Link>
        </p>
      ) : null}
      </fieldset>
    </form>
  );
}
