import { requireWalletChargeAccess } from "@/lib/auth/routeGuard";
import { isTossAllowedUser } from "@/lib/payments/tossGate";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { parseWalletBalanceBreakdown } from "@/lib/cash/parseWalletBalanceKrw";
import { loadWalletChargePageData } from "@/lib/cash/walletRouteData";
import { defaultDepositorNameFrom } from "@/lib/paysync/depositorName";
import { findOwnPendingInvoice } from "@/lib/paysync/paysyncInvoiceService";
import { loadVerifiedSelfName } from "@/lib/paysync/verifiedName";
import { WalletChargePageView } from "@/components/cash/WalletChargePageView";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WalletChargePage({ searchParams }: Props) {
  const { user, profile } = await requireWalletChargeAccess();

  const supabase = await createClient();
  const data = await loadWalletChargePageData(supabase, user.id);
  const breakdown = parseWalletBalanceBreakdown(data.balance.row);
  const sp = (await searchParams) ?? {};
  const actionError = typeof sp.error === "string" && sp.error.length > 0 ? sp.error : null;
  // 토스 심사 게이트 — 서버에서 판정한 boolean 만 내려보낸다(env 는 서버 전용).
  const tossEnabled = isTossAllowedUser(user.id);

  // 무통장입금 — 기본 입금자명(본인인증 실명)과 진행 중 주문 여부.
  // service_role 로 읽는다: paysync_invoices 는 본인 row SELECT 만 열려 있어 anon 키로도
  // 되지만, identity_verifications 는 클라이언트에 열려 있지 않다.
  const admin = createServiceRoleClient();
  const [verifiedName, pending] = await Promise.all([
    loadVerifiedSelfName(admin, user.id),
    findOwnPendingInvoice(admin, user.id),
  ]);

  return (
    <WalletChargePageView
      user={user}
      profile={profile}
      data={data}
      breakdown={breakdown}
      actionError={actionError}
      tossEnabled={tossEnabled}
      defaultDepositorName={defaultDepositorNameFrom(verifiedName)}
      pendingInvoiceId={pending?.id ?? null}
    />
  );
}
