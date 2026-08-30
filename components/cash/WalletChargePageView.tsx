import type { User } from "@supabase/supabase-js";
import { CashChargeWidget } from "@/components/cash/CashChargeWidget";
import { WalletChargeRecentSummary } from "@/components/cash/WalletChargeRecentSummary";
import { WalletChargeRightSidebar } from "@/components/cash/WalletChargeRightSidebar";
import { ResponsivePageColumns } from "@/components/shell/ResponsivePageColumns";
import type { WalletBalanceBreakdown } from "@/lib/cash/parseWalletBalanceKrw";
import type { WalletChargePageData } from "@/lib/cash/walletRouteData";
import type { UserRow } from "@/lib/types/user";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";

type Props = {
  user: User;
  profile: UserRow | null;
  data: WalletChargePageData;
  breakdown: WalletBalanceBreakdown;
  actionError?: string | null;
  /** 토스 심사 게이트 — 서버(page)에서 판정. false 면 카드 결제수단을 렌더하지 않는다. */
  tossEnabled: boolean;
  /** 본인인증 실명 기반 기본 입금자명(규칙 위반이면 빈 문자열). */
  defaultDepositorName: string;
  /** 진행 중 무통장 주문의 로컬 id. */
  pendingInvoiceId: string | null;
};

export function WalletChargePageView(props: Props) {
  const { user, profile, data, breakdown, actionError, tossEnabled, defaultDepositorName, pendingInvoiceId } = props;
  const displayName =
    profile?.full_name?.trim() || profile?.nickname?.trim() || user.email?.split("@")[0] || "회원";

  return (
    <div className="min-h-screen bg-white px-4 py-8 antialiased sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1120px]">
        <header>
          <span className="inline-block rounded-full bg-[#e9f0ff] px-3.5 py-1.5 text-[13px] font-extrabold text-[#2563EB]">
            캐시결제
          </span>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <h1 className="min-w-0 flex-1 text-[clamp(1.35rem,2.5vw,1.75rem)] font-extrabold leading-tight tracking-[-0.03em] text-[#0f172a]">
              캐시를 충전하고 결제 준비를 마무리하세요
            </h1>
          </div>
          <p className="mt-2 text-sm font-medium leading-relaxed text-[#3f4b5f]">
            <span className="md:hidden">충전 금액과 결제 수단을 확인하세요.</span>
            <span className="hidden md:inline">
              <span className="font-bold text-slate-700">{displayName}</span>님, 충전 금액과 결제 수단을 확인한 뒤 캐시를 충전할 수 있어요.
            </span>
          </p>
        </header>

        <div className="mt-5 grid overflow-hidden rounded-2xl border border-[#bfdbfe] bg-[#eef4ff] sm:grid-cols-2 lg:grid-cols-4">
          <div className="border-b border-[#dbeafe] px-4 py-3 sm:border-r lg:border-b-0">
            <span className="block text-[11px] font-bold tracking-[0.02em] text-[#2563EB]">현재 잔액</span>
            <span className="mt-1 block text-sm font-bold leading-snug text-[#0f172a]">{breakdown.totalCash.toLocaleString("ko-KR")}캐시</span>
          </div>
          <div className="border-b border-[#dbeafe] px-4 py-3 lg:border-b-0 lg:border-r">
            <span className="block text-[11px] font-bold tracking-[0.02em] text-[#2563EB]">사용 가능</span>
            <span className="mt-1 block text-sm font-bold leading-snug text-[#0f172a]">{breakdown.usableCash.toLocaleString("ko-KR")}캐시</span>
          </div>
          <div className="border-r border-[#dbeafe] px-4 py-3">
            <span className="block text-[11px] font-bold tracking-[0.02em] text-[#2563EB]">보너스</span>
            <span className="mt-1 block text-sm font-bold leading-snug text-[#0f172a]">{breakdown.bonusCash.toLocaleString("ko-KR")}캐시</span>
          </div>
          <div className="px-4 py-3">
            <span className="block text-[11px] font-bold tracking-[0.02em] text-[#2563EB]">소멸 예정</span>
            <span className="mt-1 block text-sm font-bold leading-snug text-[#0f172a]">{breakdown.expiringCash.toLocaleString("ko-KR")}캐시</span>
          </div>
        </div>
        {data.balance.error ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            잔액 일부를 불러오지 못했습니다. 충전은 가능하지만, 사용 내역을 함께 확인해 주세요.
          </p>
        ) : null}

        {/* lg+ 데스크탑은 기존 2단(본문 + 320px 우측 사이드바) 그대로, 모바일은 단일컬럼(본문→사이드바 아래로). */}
        <ResponsivePageColumns
          className="mt-6"
          gap="gap-6"
          desktopGrid="lg:grid-cols-[minmax(0,1fr)_320px]"
          main={
            <main className="min-w-0 space-y-6">
              {actionError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-950">
                  {mapDataErrorMessage(actionError)}
                </p>
              ) : null}

              <CashChargeWidget
                userId={user.id}
                currentBalance={breakdown.totalCash}
                isAuthenticated
                tossEnabled={tossEnabled}
                defaultDepositorName={defaultDepositorName}
                pendingInvoiceId={pendingInvoiceId}
              />

              <WalletChargeRecentSummary rows={data.ledgerPreview.rows} error={data.ledgerPreview.error} />
            </main>
          }
          aside={<WalletChargeRightSidebar ledgerRows={data.ledgerPreview.rows} />}
        />
      </div>
    </div>
  );
}
