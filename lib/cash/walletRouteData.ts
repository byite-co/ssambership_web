import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CASH_DATA_MODEL,
  fetchCashLedgerForUser,
  fetchCashLedgerWindow,
  fetchRecentPaymentsForUser,
  fetchWalletBalanceByUserId,
} from "@/lib/cash/cashQueries";

export const WALLET_CHARGE_DATA_MODEL = [
  "지갑 잔액",
  "충전 상품 안내",
  "최근 캐시 사용 요약(맞춤의뢰와 별도)",
  "최근 결제 요약",
] as const;

export const WALLET_LEDGER_DATA_MODEL = [
  "캐시 사용 내역(원장)",
  "맞춤의뢰 결제와 구분되는 캐시 흐름",
  "상단 잔액",
] as const;

export type WalletChargePageData = {
  balance: Awaited<ReturnType<typeof fetchWalletBalanceByUserId>>;
  ledgerPreview: Awaited<ReturnType<typeof fetchCashLedgerForUser>>;
  payments: Awaited<ReturnType<typeof fetchRecentPaymentsForUser>>;
};

export type WalletLedgerPageData = {
  balance: Awaited<ReturnType<typeof fetchWalletBalanceByUserId>>;
  ledger: Awaited<ReturnType<typeof fetchCashLedgerWindow>>;
  /** 적용된 URL 필터 + 안전 상한 도달 여부 */
  filter: { from: string | null; to: string | null; kind: string | null; truncated: boolean };
};

/**
 * D-ST-15: `cash_topup_packages` 조회 제거 — 어떤 컴포넌트도 data.packages 를 소비하지 않았고
 * (충전 금액 정본은 `CASH_CHARGE_PACKAGES` 상수), 매 렌더 무의미한 왕복이었다. 관리자 설정
 * 화면은 해당 패키지 테이블을 직접(표시 전용) 조회한다.
 */
export async function loadWalletChargePageData(
  supabase: SupabaseClient,
  userId: string
): Promise<WalletChargePageData> {
  const [balance, ledgerPreview, payments] = await Promise.all([
    fetchWalletBalanceByUserId(supabase, userId),
    fetchCashLedgerForUser(supabase, userId, 80),
    fetchRecentPaymentsForUser(supabase, userId, 5),
  ]);
  return { balance, ledgerPreview, payments };
}

export type MypageWalletPreview = {
  ledgerPreview: Awaited<ReturnType<typeof fetchCashLedgerForUser>>;
};

/**
 * D-ST-6: 마이페이지 전용 경량 로더. 잔액은 페이지가 한 번만 조회해 주입하므로 여기서 다시
 * 조회하지 않고, 원장 preview 5행만 받는다(구 loadWalletChargePageData 재사용 시 잔액 중복 조회 +
 * 원장 80행 + 미사용 패키지/결제 왕복이 발생했다).
 */
export async function loadMypageWalletPreview(
  supabase: SupabaseClient,
  userId: string
): Promise<MypageWalletPreview> {
  const ledgerPreview = await fetchCashLedgerForUser(supabase, userId, 5);
  return { ledgerPreview };
}

/**
 * D-ST-6/D-ST-13: 잔액은 한 번만 조회(페이지가 별도 조회하지 않도록 여기서 반환), 원장은
 * from/to 를 뷰 쿼리에 gte/lte 로 내려 창 전체를 순회한다(최근 250행 잘림 폐기).
 */
export async function loadWalletLedgerPageData(
  supabase: SupabaseClient,
  userId: string,
  sp: { from?: string; to?: string; kind?: string }
): Promise<WalletLedgerPageData> {
  const [balance, ledger] = await Promise.all([
    fetchWalletBalanceByUserId(supabase, userId),
    fetchCashLedgerWindow(supabase, { from: sp.from ?? null, to: sp.to ?? null }),
  ]);
  return {
    balance,
    ledger,
    filter: {
      from: sp.from ?? null,
      to: sp.to ?? null,
      kind: sp.kind ?? null,
      truncated: ledger.truncated,
    },
  };
}

export { CASH_DATA_MODEL };
