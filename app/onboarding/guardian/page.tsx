import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { AppReturnNotice } from "@/components/onboarding/AppReturnNotice";
import { IdentityVerificationLauncher } from "@/components/onboarding/IdentityVerificationLauncher";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { completeProfilePath, getPostLoginPath } from "@/lib/auth/getPostLoginPath";
import { isProfileIncomplete } from "@/lib/auth/profileCompletion";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { getIdentityOnboardingState } from "@/lib/identity/service";

// S-C: 만 14세 미만 가입자의 보호자(법정대리인) 본인인증 의무 체인.
// NICE M 인증은 보호자의 성인 여부까지만 검증한다 — 관계(친권) 검증이 아님을 전제로
// "법정대리인 본인임을 확인하며 진행" 고지를 받는 표준 관행을 따른다.

export const metadata: Metadata = {
  title: "보호자 인증 | 쌤버십",
};

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function OnboardingGuardianPage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  // 웹 PR-2 §6: 앱 WebView 부트스트랩(target identity_verify · guardian_consent)이 `?src=app` 으로 연다 —
  // 완료 시 홈으로 보내지 않고 "앱으로 돌아가기" 안내를 보여준다(딥링크는 A-4c).
  const fromApp = firstParam(sp.src) === "app";
  const { user, profile } = await getServerUserWithProfile();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/onboarding/guardian")}`);
  }
  if (!profile) {
    redirect("/login?error=profile");
  }
  // DB-5(206): 프로필 완성 전엔 본인인증보다 완성이 먼저다(멘토 완성 → identity_verification 으로 돌아온다).
  if (isProfileIncomplete(profile)) {
    redirect(completeProfilePath({ next: "/onboarding/guardian" }));
  }
  if (profile.role === "admin") {
    redirect(getPostLoginPath("admin"));
  }

  const admin = createServiceRoleClient();
  const state = await getIdentityOnboardingState(admin, user.id);
  if (state.state === "verified" && !fromApp) {
    redirect(getPostLoginPath(profile.role));
  }
  if (state.state === "self_required") {
    redirect(fromApp ? "/onboarding/verify?src=app" : "/onboarding/verify");
  }
  const completedFromApp = state.state === "verified" && fromApp;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#F9FAFB]">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10 lg:py-12">
        <header className="mb-7 flex flex-col items-center text-center">
          <BrandLogo href="/" className="justify-center" />
        </header>
        {completedFromApp ? (
          <AppReturnNotice variant="done" title={"보호자 인증이 완료됐어요"} />
        ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {fromApp ? (
            <div className="mb-4">
              <AppReturnNotice variant="pending" />
            </div>
          ) : null}
          <h1 className="text-xl font-bold text-slate-900">보호자 인증이 필요해요</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            만 14세 미만 회원은 개인정보 보호법에 따라 보호자(법정대리인)의 동의가 필요해요. 보호자님의
            휴대폰 본인인증으로 동의를 확인해요.
          </p>
          <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
            <p className="font-semibold text-slate-700">법정대리인 동의 안내</p>
            <ul className="mt-2 space-y-1.5">
              <li>· 아래 인증은 반드시 보호자(법정대리인) 본인 명의 휴대폰으로 진행해 주세요.</li>
              <li>· 인증을 진행하면 가입자의 법정대리인 본인임을 확인하며, 만 14세 미만 아동의 개인정보
                수집·이용에 동의한 것으로 기록돼요.</li>
              <li>· 보호자는 만 19세 이상 성인이어야 하며, 가입자 본인 명의로는 진행할 수 없어요.</li>
            </ul>
            <p className="mt-2">
              <Link href="/legal/minor-consent" className="font-semibold text-[#1A56DB] underline-offset-2 hover:underline">
                만 14세 미만 회원 안내 전문 보기
              </Link>
            </p>
          </div>
          <div className="mt-6">
            <IdentityVerificationLauncher
              kind="guardian"
              startLabel="보호자 인증 시작 — 법정대리인 본인임을 확인하며 진행"
              initialStatus={firstParam(sp.status)}
              initialCode={firstParam(sp.code)}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
              인증 과정에서 보호자님의 개인정보(성명·생년월일·성별·내·외국인 정보·휴대폰번호·이동통신사·연계정보(CI)·중복가입확인정보(DI))가
              수집·이용돼요. 자세한 내용은{" "}
              <Link href="/legal/privacy" className="font-semibold text-[#1A56DB] underline-offset-2 hover:underline">
                개인정보처리방침
              </Link>
              을 확인해 주세요.
            </p>
          </div>
        </section>
        )}
        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-500">
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
