import Link from "next/link";
import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { LoginPageFooter } from "@/components/auth/LoginPageFooter";
import { requestPasswordResetAction } from "@/lib/auth/passwordResetActions";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function ForgotPasswordPage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  const err = typeof sp.error === "string" ? sp.error : null;
  const sent = sp.sent === "1";
  const termsUrl = process.env.NEXT_PUBLIC_LEGAL_TERMS_URL ?? "/legal/terms";
  const privacyUrl = process.env.NEXT_PUBLIC_LEGAL_PRIVACY_URL ?? "/legal/privacy";
  const supportUrl = process.env.NEXT_PUBLIC_SUPPORT_URL;

  // 화이트리스트 매핑 — Supabase 원문은 절대 화면에 싣지 않는다(오라클/설정 반사 방지, D-AU-2).
  const errUi =
    err === "empty_email"
      ? "이메일을 입력해 주세요."
      : err === "missing_site_url"
        ? "비밀번호 재설정 링크를 만들 사이트 주소(NEXT_PUBLIC_SITE_URL)가 설정되어 있지 않습니다. 운영 환경 변수를 확인해 주세요."
        : err
          ? "재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요."
          : null;

  return (
    <AuthPageLayout
      noCard
      loginLayout
      title="비밀번호 재설정"
      description={
        <p>
          <span className="md:hidden">가입 이메일로 재설정 링크를 보내드려요.</span>
          <span className="hidden md:inline">가입에 사용한 이메일을 입력하면 재설정 링크를 보내 드립니다.</span>
        </p>
      }
      headerPrefix={
        <Link href="/login" className="text-sm font-semibold text-slate-600 hover:text-slate-900">
          ← 로그인 유형 선택
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-md space-y-6">
        {sent ? (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950" role="status">
            요청을 접수했습니다. 메일함(스팸 포함)에서 링크를 확인한 뒤, 안내에 따라 새 비밀번호를 설정해 주세요.
          </p>
        ) : null}
        {errUi && !sent ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900" role="status">
            {errUi}
          </p>
        ) : null}

        <form action={requestPasswordResetAction} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="fp-email" className="text-sm font-bold text-slate-800">
              이메일
            </label>
            <input
              id="fp-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-2 block w-full min-h-12 rounded-2xl border border-slate-200 px-4 py-3 text-sm"
              placeholder="name@example.com"
            />
          </div>
          <button
            type="submit"
            className="w-full min-h-12 rounded-2xl bg-blue-600 text-sm font-extrabold text-white hover:bg-blue-700"
          >
            재설정 메일 보내기
          </button>
        </form>

        <p className="text-center text-sm text-slate-600">
          <Link href="/login/student" className="font-bold text-blue-600 underline">
            학생 로그인
          </Link>
          <span className="mx-2 text-slate-300">|</span>
          <Link href="/login/mentor" className="font-bold text-emerald-800 underline">
            멘토 로그인
          </Link>
        </p>
      </div>
      <div className="mt-10">
        <LoginPageFooter termsUrl={termsUrl} privacyUrl={privacyUrl} supportUrl={supportUrl} />
      </div>
    </AuthPageLayout>
  );
}
