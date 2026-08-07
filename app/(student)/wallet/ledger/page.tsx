import { redirect } from "next/navigation";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { createClient } from "@/lib/supabase/server";
import { parseWalletBalanceKrw } from "@/lib/cash/parseWalletBalanceKrw";
import { loadWalletLedgerPageData } from "@/lib/cash/walletRouteData";
import { StudentDashboardShell } from "@/components/mypage/StudentDashboardShell";
import { Suspense } from "react";
import { WalletLedgerPageBody } from "@/components/cash/WalletLedgerPageBody";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function WalletLedgerPage(props: Props) {
  const { user, profile, error: profileLoadError } = await getServerUserWithProfile();
  if (profile?.role === "mentor") {
    redirect("/wallet/charge");
  }
  if (!user) {
    redirect(`/login/student?next=${encodeURIComponent("/wallet/ledger")}`);
  }

  const supabase = await createClient();
  const sp = (await props.searchParams) ?? {};
  const from = (Array.isArray(sp.from) ? sp.from[0] : sp.from) ?? null;
  const to = (Array.isArray(sp.to) ? sp.to[0] : sp.to) ?? null;
  const kind = (Array.isArray(sp.kind) ? sp.kind[0] : sp.kind) ?? null;

  // D-ST-6: 잔액은 로더가 한 번만 조회한다(구: 페이지·로더 이중 조회로 시점차 발생).
  const data = await loadWalletLedgerPageData(supabase, user.id, {
    from: from ?? undefined,
    to: to ?? undefined,
    kind: kind ?? undefined,
  });
  const cashBalanceKrw = parseWalletBalanceKrw(data.balance.row);

  return (
    <StudentDashboardShell
      activeTab="wallet"
      user={user}
      profile={profile}
      profileLoadError={profileLoadError?.message ?? null}
      cashBalanceKrw={cashBalanceKrw}
      hideRightRail
    >
      {/* w-full로 본문 폭을 콘텐츠 의존(fit-content)이 아닌 고정 폭으로 — 내역 유무와 무관하게
          동일 폭(표 폭 ≈ 640px)·동일 정렬 유지(빈 상태가 좁아져 우측으로 쏠리던 버그 픽스). */}
      <div className="mx-auto w-full max-w-[640px] space-y-6">
        <header>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">캐시 사용내역</h1>
          <p className="mt-1 text-sm text-slate-500">충전·구독·맞춤의뢰 등 캐시 흐름을 확인합니다.</p>
        </header>

        <Suspense fallback={<p className="text-sm text-slate-500">불러오는 중…</p>}>
          <WalletLedgerPageBody data={data} />
        </Suspense>
      </div>
    </StudentDashboardShell>
  );
}
