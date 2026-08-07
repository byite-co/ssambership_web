import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { API_WEB_V1_SCHEMA } from "@/lib/apiWebV1/rpc";

export const SUBSCRIPTION_SETTLEMENT_ITEMS_TABLE = "subscription_settlement_items" as const;

/**
 * 구독 정산 항목 상태. DB CHECK 는 ('accruing','pending','paid','hold','canceled') 5종이다.
 *
 * ★ accruing = 구독 사이클이 아직 안 끝나 **지급 불가**한 적립 상태다. 종전 매핑은
 *   미지값을 전부 pending 으로 접어서 적립중 금액이 "지급 대기"로 표시되고 지급 예정
 *   합계에도 들어갔다 — 아직 받을 수 없는 돈이 받을 수 있는 돈으로 보였다(QA-A2).
 *   오너 판단 2026-08-06: **적립중과 지급 예정을 구분해 보여준다.**
 */
export type SubscriptionSettlementItemStatus =
  | "accruing"
  | "pending"
  | "paid"
  | "hold"
  | "canceled";
export type SubscriptionSettlementItemRow = Record<string, unknown>;

const SELECT_COLUMNS = [
  "id",
  "billing_event_id",
  "subscription_id",
  "mentor_id",
  "student_id",
  "payment_id",
  "ledger_id",
  "event_type",
  "billing_at",
  "period_start",
  "period_end",
  "gross_cents",
  "platform_fee_cents",
  "mentor_amount_cents",
  "fee_rate",
  "status",
  "hold_reason",
  "paid_at",
  "created_at",
  "updated_at",
].join(", ");

// W4(C10): isSchemaNotReadyError(42P01/42883/42703/PGRST204/205 로그 억제 신호) 제거 —
// public.refresh_subscription_settlement_items() 는 187 baseline 실존이라 스키마 부재 분기는
// 도달 불가 레거시였다. 모든 실패를 로그·error 로 남긴다.

export function minorCentsToCash(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? Math.floor(Math.abs(n) / 100) : 0;
}

export function subscriptionSettlementStatus(value: unknown): SubscriptionSettlementItemStatus {
  const status = String(value ?? "pending").trim().toLowerCase();
  if (status === "accruing") return "accruing";
  if (status === "paid") return "paid";
  if (status === "hold" || status === "on_hold") return "hold";
  if (status === "canceled" || status === "cancelled") return "canceled";
  return "pending";
}

export function subscriptionSettlementStatusLabel(value: unknown): string {
  switch (subscriptionSettlementStatus(value)) {
    case "accruing":
      return "\uC801\uB9BD\uC911";
    case "paid":
      return "\uC9C0\uAE09 \uC644\uB8CC";
    case "hold":
      return "\uBCF4\uB958";
    case "canceled":
      return "\uCDE8\uC18C";
    default:
      return "\uC9C0\uAE09 \uB300\uAE30";
  }
}

export function formatSubscriptionSettlementPeriod(row: SubscriptionSettlementItemRow): string | null {
  const start = typeof row.period_start === "string" && row.period_start ? row.period_start.slice(0, 10) : "";
  const end = typeof row.period_end === "string" && row.period_end ? row.period_end.slice(0, 10) : "";
  if (start && end) return `${start}~${end}`;
  return start || end || null;
}

export async function refreshSubscriptionSettlementItemsBestEffort(): Promise<{ ok: boolean; error: string | null }> {
  let admin: SupabaseClient;
  try {
    admin = createServiceRoleClient();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const { error } = await admin.rpc("refresh_subscription_settlement_items", {});
  if (error) {
    console.error("[refreshSubscriptionSettlementItemsBestEffort]", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, error: null };
}

/**
 * S2-2 전환 W1(C1): 멘토 본인 구독 정산 조회 — V7 RPC
 * `api_web_v1.mentor_settlement_self()` (계약 §6 V7 · §17 #16).
 * 자기 정산 판정(`mentor_id = auth.uid()`)은 함수 내부가 수행한다 — 멘토 세션
 * 클라이언트 전제이며 mentorId 인자로 타인 정산을 조회할 수 없다. 구 직접 SELECT 와
 * service_role 무음 fallback 은 제거했다(W1 §4 — fallback·dual-read 금지).
 * V7 행(item_id)을 기존 소비 형상(id 키)으로 정규화하고, V7 이 노출하지 않는 내부
 * 참조(payment_id·ledger_id·billing_event_id·mentor_id·student_id·updated_at)는
 * 더 이상 반환하지 않는다(§6 V7 — 의도된 비노출).
 */
export async function loadSubscriptionSettlementRowsForMentor(
  supabase: SupabaseClient,
  mentorId: string,
  limit = 300
): Promise<SubscriptionSettlementItemRow[]> {
  void mentorId; // V7 이 auth.uid() 로 본인 행만 반환한다
  const { data, error } = await supabase.schema(API_WEB_V1_SCHEMA).rpc("mentor_settlement_self");
  if (error) {
    // W4(C10): isSchemaNotReadyError 로그 억제 분기 제거 — V7 RPC 는 187 baseline 에
    // 실존(pg_proc 실측)하므로 스키마 부재 분기는 사문이었고 실제 오류 로그만 삼켰다.
    // 오류 시 빈 배열 반환은 정산 페이지 표시 전용 degrade(성공 아님)로 유지하되 항상 로깅한다.
    console.error("[loadSubscriptionSettlementRowsForMentor] mentor_settlement_self", error.message);
    return [];
  }
  const rows = (Array.isArray(data) ? (data as SubscriptionSettlementItemRow[]) : [])
    .map((r): SubscriptionSettlementItemRow => ({ ...r, id: r.item_id }))
    .sort((a, b) => String(b.billing_at ?? "").localeCompare(String(a.billing_at ?? "")));
  return rows.slice(0, limit);
}

export async function loadSubscriptionSettlementRowsForAdmin(limit = 100): Promise<{
  rows: SubscriptionSettlementItemRow[];
  error: string | null;
}> {
  let admin: SupabaseClient;
  try {
    admin = createServiceRoleClient();
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  }

  const { data, error } = await admin
    .from(SUBSCRIPTION_SETTLEMENT_ITEMS_TABLE)
    .select(SELECT_COLUMNS)
    .order("billing_at", { ascending: false })
    .limit(limit);

  // W4(C10): 스키마 부재 오류를 빈 목록 성공으로 바꾸던 분기 제거 —
  // subscription_settlement_items 는 187 baseline 에 실존(실측)하므로 사문이었고,
  // 실오류를 관리자 콘솔에서 숨겼다. 이제 모든 오류를 error 필드로 표면화한다.
  if (!error && data) return { rows: data as unknown as SubscriptionSettlementItemRow[], error: null };
  return { rows: [], error: error?.message ?? null };
}