import type { SupabaseClient } from "@supabase/supabase-js";
import { pickExistingColumn } from "@/lib/qna/safeSelect";
import { API_WEB_V1_SCHEMA } from "@/lib/apiWebV1/rpc";

type TableProbe = { table: string | null; error: string | null };

/** 테이블 존재/RLS read 가능할 때까지 후보만 시도(더미 row 생성 금지) */
async function firstReadableTable(
  supabase: SupabaseClient,
  candidates: readonly string[]
): Promise<TableProbe> {
  let last = "no candidates";
  for (const table of candidates) {
    const { error } = await supabase.from(table).select("*").limit(1);
    if (!error) return { table, error: null };
    last = error.message;
  }
  return { table: null, error: last };
}

export type CashPackageRow = Record<string, unknown>;

export async function fetchCashTopupPackages(
  supabase: SupabaseClient
): Promise<{ rows: CashPackageRow[]; table: string | null; error: string | null }> {
  const probe = await firstReadableTable(supabase, ["cash_topup_packages", "topup_packages", "cash_packages"] as const);
  if (!probe.table) {
    return { rows: [], table: null, error: probe.error };
  }
  const { data, error } = await supabase.from(probe.table).select("*").limit(50);
  if (error) return { rows: [], table: probe.table, error: error.message };
  return { rows: (data as CashPackageRow[]) ?? [], table: probe.table, error: null };
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

/** 캐시·지갑 화면 하단 안내(사용자용) */
export const CASH_DATA_MODEL = [
  "캐시 충전·결제 내역(맞춤의뢰와 별도)",
  "환불 처리",
  "멤버십 구독(캐시와 별도 흐름)",
  "결제·환불 알림",
  "잔액·사용 내역(원장)",
] as const;

const PAY_TABLES = ["payments", "payment_intents", "order_payments"] as const;
const PAY_USER_FK = ["user_id", "student_id", "subscriber_id", "owner_id", "recipient_id"] as const;

/**
 * 캐시·지갑 맥락의 최근 결제 row(맞춤의뢰 order_payments와 혼동 시 payload로 구분 예정)
 */
export async function fetchRecentPaymentsForUser(
  supabase: SupabaseClient,
  userId: string,
  limit = 5
): Promise<{ rows: Record<string, unknown>[]; table: string | null; error: string | null; probe: string }> {
  for (const table of PAY_TABLES) {
    const { error: pe } = await supabase.from(table).select("id").limit(1);
    if (pe) continue;
    const { column: sc } = await pickExistingColumn(supabase, table, PAY_USER_FK);
    if (!sc) continue;
    const { column: createdCol } = await pickExistingColumn(supabase, table, ["created_at", "inserted_at", "updated_at"]);
    let q = supabase.from(table).select("*").eq(sc, userId);
    if (createdCol) {
      q = q.order(createdCol, { ascending: false });
    }
    const o1 = await q.limit(limit);
    if (o1.error) {
      const o2 = await supabase.from(table).select("*").eq(sc, userId).limit(limit);
      if (o2.error) {
        return { table, rows: [], error: o2.error.message, probe: table };
      }
      return { table, rows: (o2.data as Record<string, unknown>[]) ?? [], error: null, probe: `${table} · order 생략` };
    }
    return { table, rows: (o1.data as Record<string, unknown>[]) ?? [], error: null, probe: `${table} · ${sc}` };
  }
  return { table: null, rows: [], error: null, probe: "payments 조회 경로 없음" };
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
