import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { IdentityVerificationLauncher } from "@/components/onboarding/IdentityVerificationLauncher";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { getPostLoginPath } from "@/lib/auth/getPostLoginPath";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { getIdentityOnboardingState } from "@/lib/identity/service";

// S-C: 가입 강제 본인인증 온보딩 (루트 전용 라우트 — 그룹 레이아웃 게이트 비대상).
// 서버가 상태를 판정한다: verified → 홈 / 14세 미만 self 완료 → 보호자 페이지.

export const metadata: Metadata = {
  title: "본인인증 | 쌤버십",
};

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function OnboardingVerifyPage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  const { user, profile } = await getServerUserWithProfile();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/onboarding/verify")}`);
  }
  if (!profile) {
    redirect("/login?error=profile");
  }
  if (profile.role === "admin") {
    redirect(getPostLoginPath("admin"));
  }

  const admin = createServiceRoleClient();
  const state = await getIdentityOnboardingState(admin, user.id);
  if (state.state === "verified") {
    redirect(getPostLoginPath(profile.role));
  }
  if (state.state === "guardian_required") {
    redirect("/onboarding/guardian");
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#F9FAFB]">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10 lg:py-12">
        <header className="mb-7 flex flex-col items-center text-center">
          <BrandLogo href="/" className="justify-center" />
        </header>
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-bold text-slate-900">본인인증이 필요해요</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            안전한 멘토링을 위해 모든 회원은 휴대폰 본인인증을 완료해야 서비스를 이용할 수 있어요. 인증은
            NICE평가정보를 통해 진행되며, 본인 명의 휴대폰이 필요해요.
          </p>
          <ul className="mt-4 space-y-2 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
            <li>· 인증 결과(이름·생년월일)는 계정 정보에 반영돼요.</li>
            <li>· 만 14세 미만은 보호자(법정대리인) 인증까지 완료해야 해요.</li>
            <li>· 이미 같은 명의로 가입된 계정이 있으면 새 가입은 진행할 수 없어요.</li>
          </ul>
          <div className="mt-6">
            <IdentityVerificationLauncher
              kind="self"
              startLabel="휴대폰 본인인증 시작하기"
              initialStatus={firstParam(sp.status)}
              initialCode={firstParam(sp.code)}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              인증 과정에서 본인 확인을 위한 개인정보(성명·생년월일·성별·내·외국인 정보·휴대폰번호·이동통신사·연계정보(CI)·중복가입확인정보(DI))가
              수집·이용돼요. 자세한 내용은{" "}
              <Link href="/legal/privacy" className="font-semibold text-[#1A56DB] underline-offset-2 hover:underline">
                개인정보처리방침
              </Link>
              을 확인해 주세요.
            </p>
          </div>
        </section>
        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-500">
          <Link href="/legal/terms" className="underline-offset-2 hover:underline">
            이용약관
          </Link>
          <Link href="/legal/privacy" className="underline-offset-2 hover:underline">
            개인정보처리방침
          </Link>
          <form action="/logout" method="post">
            <button type="submit" className="underline-offset-2 hover:underline">
              로그아웃
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
