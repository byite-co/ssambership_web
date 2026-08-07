import type { SupabaseClient } from "@supabase/supabase-js";
import { API_WEB_V1_SCHEMA } from "@/lib/apiWebV1/rpc";

export type CashPackageRow = Record<string, unknown>;

/**
 * S2-2 전환 W4(C10): 충전 패키지 조회 — 정본 `public.cash_topup_packages` 단일 조회.
 * 구 테이블 프로빙(topup_packages/cash_packages — baseline 부재)은 제거했다.
 * 조회 오류는 error 로 반환한다(빈 결과로 은폐하지 않는다).
 */
export async function fetchCashTopupPackages(
  supabase: SupabaseClient
): Promise<{ rows: CashPackageRow[]; table: string | null; error: string | null }> {
  const { data, error } = await supabase.from("cash_topup_packages").select("*").limit(50);
  if (error) return { rows: [], table: "cash_topup_packages", error: error.message };
  return { rows: (data as CashPackageRow[]) ?? [], table: "cash_topup_packages", error: null };
}

/**
 * S2-2 전환 W1(C1): 자기 지갑 조회 — V4 `api_web_v1.my_wallet_v1` (계약 §6 V4).
 * invoker view — RLS(`user_id = auth.uid()`)가 본인 행만 남긴다. 세션 클라이언트 전제.
 * 구 테이블 프로빙(wallets/user_wallets/…)·FK 컬럼 프로빙은 제거했다(W1 §4 — fallback 금지).
 */
export async function fetchWalletBalanceByUserId(
  supabase: SupabaseClient,
  userId: string
): Promise<{ row: Record<string, unknown> | null; table: string | null; error: string | null }> {
  const { data, error } = await supabase
    .schema(API_WEB_V1_SCHEMA)
    .from("my_wallet_v1")
    .select("*")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) return { row: null, table: "api_web_v1.my_wallet_v1", error: error.message };
  return { row: (data as Record<string, unknown> | null) ?? null, table: "api_web_v1.my_wallet_v1", error: null };
}

export type LedgerLineRow = Record<string, unknown>;

/**
 * S2-2 전환 W1(C1): 자기 캐시 원장 조회 — V5 `api_web_v1.my_cash_ledger_v1` (계약 §6 V5).
 * invoker view — RLS 로 본인 행만. `order_ref` 는 topup 행에서만 Toss orderId(§6 V5 —
 * W3 가시화 지점), 그 외 NULL. 구 테이블·FK 프로빙과 재정렬 fallback 은 제거했다.
 */
export async function fetchCashLedgerForUser(
  supabase: SupabaseClient,
  userId: string,
  limit = 50
): Promise<{ rows: LedgerLineRow[]; table: string | null; error: string | null }> {
  void userId; // V5 는 invoker RLS 로 본인 행만 반환한다 — 명시 필터 불요(세션 클라이언트 전제)
  const { data, error } = await supabase
    .schema(API_WEB_V1_SCHEMA)
    .from("my_cash_ledger_v1")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], table: "api_web_v1.my_cash_ledger_v1", error: error.message };
  return { rows: (data as LedgerLineRow[]) ?? [], table: "api_web_v1.my_cash_ledger_v1", error: null };
}

const LEDGER_WINDOW_BATCH = 1000;
const LEDGER_WINDOW_MAX_DEFAULT = 3000;

/**
 * D-ST-13: 기간 필터(from/to)를 뷰 쿼리에 created_at gte/lte 로 내리고, 최근 N행(구 250행) 잘림
 * 대신 range 로 창(window) 전체를 순회해 받아온다. 종류(kind) 필터는 원장 행에서 파생되는 UI
 * 분류(ledgerUiKind)라 서버 컬럼 eq 로 정확히 표현되지 않으므로, 날짜로 좁혀진 완전한 집합 위에서
 * 클라이언트가 계속 분류·필터한다. 안전 상한(max)에 도달하면 truncated=true 로 표면화한다.
 */
export async function fetchCashLedgerWindow(
  supabase: SupabaseClient,
  args: { from?: string | null; to?: string | null; max?: number }
): Promise<{ rows: LedgerLineRow[]; table: string | null; error: string | null; truncated: boolean }> {
  const max = args.max && args.max > 0 ? args.max : LEDGER_WINDOW_MAX_DEFAULT;
  const fromTs = args.from ? `${args.from}T00:00:00` : null;
  const toTs = args.to ? `${args.to}T23:59:59.999` : null;

  const rows: LedgerLineRow[] = [];
  let truncated = false;
  for (let offset = 0; offset < max; offset += LEDGER_WINDOW_BATCH) {
    let query = supabase
      .schema(API_WEB_V1_SCHEMA)
      .from("my_cash_ledger_v1")
      .select("*")
      .order("created_at", { ascending: false });
    if (fromTs) query = query.gte("created_at", fromTs);
    if (toTs) query = query.lte("created_at", toTs);

    const end = Math.min(offset + LEDGER_WINDOW_BATCH, max) - 1;
    const { data, error } = await query.range(offset, end);
    if (error) return { rows: [], table: "api_web_v1.my_cash_ledger_v1", error: error.message, truncated: false };
    const batch = (data as LedgerLineRow[]) ?? [];
    rows.push(...batch);
    if (batch.length < end - offset + 1) break; // 더 없음
    if (offset + LEDGER_WINDOW_BATCH >= max) truncated = true; // 안전 상한 도달
  }
  return { rows, table: "api_web_v1.my_cash_ledger_v1", error: null, truncated };
}

/** 캐시·지갑 화면 하단 안내(사용자용) */
export const CASH_DATA_MODEL = [
  "캐시 충전·결제 내역(맞춤의뢰와 별도)",
  "환불 처리",
  "멤버십 구독(캐시와 별도 흐름)",
  "결제·환불 알림",
  "잔액·사용 내역(원장)",
] as const;

/**
 * S2-2 전환 W4(C10): 캐시·지갑 맥락의 최근 결제 조회 — 정본 `public.payments` 단일 조회.
 * 컬럼 정본: `user_id`(intent writer·RLS payments_select_own·idx_payments_user 실측 일치),
 * 정렬 `created_at desc`(동일 인덱스). 구 PAY_TABLES(payment_intents 부재)·FK/정렬 컬럼
 * 프로빙·order 생략 재시도는 제거했다. 조회 오류는 error 로 반환한다(빈 결과 은폐 금지).
 */
export async function fetchRecentPaymentsForUser(
  supabase: SupabaseClient,
  userId: string,
  limit = 5
): Promise<{ rows: Record<string, unknown>[]; table: string | null; error: string | null; probe: string }> {
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { table: "payments", rows: [], error: error.message, probe: "payments" };
  return { table: "payments", rows: (data as Record<string, unknown>[]) ?? [], error: null, probe: "payments · user_id" };
}

function formatCashUnitsFromMinorUnits(cents: number): string {
  const n = cents / 100;
  const abs = Math.abs(n);
  const body = abs.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
  return `현재 잔액 ${n < 0 ? "-" : ""}${body}캐시`;
}

export function formatWalletRowDisplay(row: Record<string, unknown> | null): string {
  if (!row) return "";
  if (typeof row.balance_cents === "number" && Number.isFinite(row.balance_cents)) {
    return formatCashUnitsFromMinorUnits(row.balance_cents);
  }
  if (typeof row.amount_cents === "number" && Number.isFinite(row.amount_cents)) {
    return formatCashUnitsFromMinorUnits(row.amount_cents);
  }
  if (typeof row.balance === "number" && Number.isFinite(row.balance)) {
    return `현재 잔액 ${row.balance.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}캐시`;
  }
  if (typeof row.balance === "string" && row.balance.trim()) {
    return `현재 잔액 ${row.balance.trim()}`;
  }
  return "잔액 정보를 확인했습니다.";
}
