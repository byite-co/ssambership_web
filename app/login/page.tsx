import { Suspense } from "react";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { LoginDualRolePanel } from "@/components/auth/LoginDualRolePanel";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { resolvePostLoginPath } from "@/lib/auth/getPostLoginPath";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const initialNext = params.next?.trim() || null;

  // D-AU-12: 이미 로그인한 사용자는 유형 선택 화면을 다시 보지 않는다(/admin/login 과 대칭).
  const { user, profile } = await getServerUserWithProfile();
  if (user && profile) {
    redirect(resolvePostLoginPath(initialNext, profile.role));
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#F9FAFB]">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        <header className="mb-8 flex flex-col items-center text-center sm:mb-10">
          <BrandLogo href="/" className="justify-center" />
          <h1 className="mt-6 text-2xl font-black tracking-tight text-[#111827] sm:text-3xl">로그인</h1>
          <p className="mt-2 max-w-xl text-sm text-[#6B7280] sm:text-base">
            학생·멘토 계정을 선택하고 이메일로 들어가세요.
          </p>
        </header>

        <Suspense
          fallback={
            <div className="grid min-h-[420px] place-items-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
              로그인 화면을 불러오는 중…
            </div>
          }
        >
          <LoginDualRolePanel initialNext={initialNext} />
        </Suspense>
      </main>
    </div>
  );
}
