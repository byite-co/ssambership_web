import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { LoginSingleRoleCard } from "@/components/auth/LoginDualRolePanel";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { resolvePostLoginPath } from "@/lib/auth/getPostLoginPath";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginMentorPage(props: Props) {
  const sp = (await props.searchParams) ?? {};
  const n = sp.next;
  const initialNext = (typeof n === "string" ? n : Array.isArray(n) ? n[0] : null) ?? null;

  // D-AU-12: 이미 로그인한 사용자는 로그인 폼을 다시 보지 않는다(/admin/login 과 대칭).
  const { user, profile } = await getServerUserWithProfile();
  if (user && profile) {
    redirect(resolvePostLoginPath(initialNext, profile.role));
  }

  const backToRolePicker = initialNext ? `/login?next=${encodeURIComponent(initialNext)}` : "/login";

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[#F9FAFB]">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-8 sm:px-6 sm:py-10 lg:py-12">
        <div className="mb-4">
          <Link
            href={backToRolePicker}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 transition hover:text-slate-900"
          >
            <span aria-hidden>←</span> 유형 선택으로
          </Link>
        </div>
        <header className="mb-7 flex flex-col items-center text-center">
          <BrandLogo href="/" className="justify-center" />
        </header>
        <Suspense
          fallback={
            <div className="grid min-h-[420px] place-items-center rounded-2xl border border-gray-200 bg-white text-sm text-gray-500">
              로그인 화면을 불러오는 중…
            </div>
          }
        >
          <LoginSingleRoleCard role="mentor" initialNext={initialNext} />
        </Suspense>
      </main>
    </div>
  );
}
