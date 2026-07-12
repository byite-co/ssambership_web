/** 보고서 잠금 충전 패키지. 결제 금액(KRW) · 지급 캐시(1캐시=1원). */
export type CashChargePackage = {
  payKrw: number;
  cashKrw: number;
  bonusKrw: number;
  /** 표시용, 예: "10%" */
  bonusPercentLabel: string | null;
};

export const CASH_CHARGE_PACKAGES: readonly CashChargePackage[] = [
  { payKrw: 30_000, cashKrw: 30_000, bonusKrw: 0, bonusPercentLabel: null },
  { payKrw: 60_000, cashKrw: 60_000, bonusKrw: 0, bonusPercentLabel: null },
  { payKrw: 120_000, cashKrw: 120_000, bonusKrw: 0, bonusPercentLabel: null },
  { payKrw: 200_000, cashKrw: 206_000, bonusKrw: 6_000, bonusPercentLabel: "3%" },
  { payKrw: 300_000, cashKrw: 315_000, bonusKrw: 15_000, bonusPercentLabel: "5%" },
] as const;

export function findChargePackageByPayKrw(payKrw: number): CashChargePackage | null {
  return CASH_CHARGE_PACKAGES.find((p) => p.payKrw === payKrw) ?? null;
}

export function cashKrwForPayKrw(payKrw: number): number | null {
  return findChargePackageByPayKrw(payKrw)?.cashKrw ?? null;
}

export function isAllowedChargePayKrw(payKrw: number): boolean {
  return CASH_CHARGE_PACKAGES.some((p) => p.payKrw === payKrw);
}
