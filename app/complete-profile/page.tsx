import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { CompleteProfileForm } from "@/components/auth/CompleteProfileForm";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { parseProfileRoleHint, safeInternalNextPath } from "@/lib/auth/getPostLoginPath";
import { completeProfilePageDecision } from "@/lib/auth/profileCompletion";

// DB-5(206) 소셜 가입 후 프로필 완성 화면 — 루트 전용 라우트(그룹 레이아웃 게이트 비대상).
// 서버가 분기한다: 비로그인 → 로그인 / 완성된 사용자 → post-login 경로(next 존중) / 미완성 → 폼.
// 저장은 클라이언트가 `api_app_v1.complete_profile` 을 세션(authenticated)으로 호출한다.

export const metadata: Metadata = {
  title: "프로필 완성 | 쌤버십",
  robots: { index: false, follow: false },
};

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function CompleteProfilePage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  const nextPath = safeInternalNextPath(firstParam(sp.next));
  const roleHint = parseProfileRoleHint(firstParam(sp.role_hint));
  const { user, profile } = await getServerUserWithProfile();

  const decision = completeProfilePageDecision({ loggedIn: Boolean(user), profile, next: nextPath, roleHint });
  if (decision.kind !== "render") {
    redirect(decision.redirectTo);
  }

  const initialDisplayName = (profile?.nickname ?? profile?.full_name ?? "").trim();
  const hasEmail = Boolean((profile?.email ?? user?.email ?? "").trim());

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#F9FAFB]">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10 lg:py-12">
        <header className="mb-7 flex flex-col items-center text-center">
          <BrandLogo href="/" className="justify-center" />
        </header>
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-bold text-slate-900">프로필을 완성해 주세요</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            소셜 계정으로 처음 오셨네요. 이용 유형과 기본 정보를 채우면 바로 시작할 수 있어요.
          </p>
          <div className="mt-6">
            <CompleteProfileForm
              roleHint={decision.roleHint}
              nextPath={nextPath}
              initialDisplayName={initialDisplayName}
              hasEmail={hasEmail}
            />
          </div>
        </section>
        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-500">
          <form action="/logout" method="post">
            <button type="submit" className="underline-offset-2 hover:underline">
              다른 계정으로 로그인
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
