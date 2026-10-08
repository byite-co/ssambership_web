import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { SUBSCRIPTIONS_SELECT, SUBSCRIPTIONS_TABLE } from "@/lib/subscribe/subscriptionsTable";

type Row = Record<string, unknown>;

const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 100;
const DEFAULT_RENEWAL_NOTICE_DAYS = 3;

type RpcRenewalResult = {
  ok: boolean;
  code: string;
  message: string | null;
  billing_event_id: string | null;
  ledger_id: string | null;
  next_period_start: string | null;
  next_period_end: string | null;
  wallet_balance_cents: number | null;
  attempt_count: number | null;
};

export type SubscriptionRenewalBatchSummary = {
  at: string;
  upcomingScanned: number;
  preRenewalNotices: number;
  scanned: number;
  renewed: number;
  alreadyProcessed: number;
  insufficientCash: number;
  canceled: number;
  expired: number;
  skipped: number;
  errors: Array<{ subscriptionId: string | null; code: string; message: string }>;
};

function isoFromUnknown(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function boolFromUnknown(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function batchLimitFromEnv(): number {
  const raw = Number.parseInt(process.env.SUBSCRIPTION_RENEWAL_BATCH_LIMIT ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BATCH_LIMIT;
  return Math.min(raw, MAX_BATCH_LIMIT);
}

function renewalNoticeDaysFromEnv(): number {
  const raw = Number.parseInt(process.env.SUBSCRIPTION_RENEWAL_NOTICE_DAYS ?? "", 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RENEWAL_NOTICE_DAYS;
  return Math.min(raw, 14);
}

function getSubscriptionId(row: Row): string | null {
  return typeof row.id === "string" && row.id.trim() ? row.id : null;
}

function addDaysUtc(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

async function finalizeTerminalTransition(
  supabase: SupabaseClient,
  row: Row,
  transition: "cancel_at_period_end" | "grace_expired",
  atIso: string
): Promise<boolean> {
  const subscriptionId = getSubscriptionId(row);
  const periodEnd = isoFromUnknown(row.current_period_end);
  if (!subscriptionId || !periodEnd) return false;
  const prefix = transition === "cancel_at_period_end" ? "sub_cancel" : "sub_expired";
  const { data, error } = await supabase.rpc("finalize_subscription_terminal_transition", {
    p_subscription_id: subscriptionId,
    p_transition: transition,
    p_at: atIso,
    p_idempotency_key: `${prefix}:${subscriptionId}:${periodEnd.slice(0, 10)}`,
  });
  if (error || !data || data.ok !== true) {
    console.error("[subscriptionRenewal] terminal transition failed", {
      subscriptionId, code: error?.message ?? data?.code ?? "empty_rpc_result",
    });
    return false;
  }
  return true;
}

async function sendPreRenewalNotice(
  supabase: SupabaseClient,
  row: Row,
  atIso: string
): Promise<{ code: "sent" | "already" | "skipped"; message?: string }> {
  const subscriptionId = getSubscriptionId(row);
  const periodEnd = isoFromUnknown(row.current_period_end);
  if (!subscriptionId || !periodEnd) return { code: "skipped", message: "missing_subscription_period" };
  // The DB resolves the bound plan and writes the marker under the same lock/transaction.
  const { data, error } = await supabase.rpc("record_subscription_renewal_notice", {
    p_subscription_id: subscriptionId, p_period_end: periodEnd, p_at: atIso,
  });
  if (error || !data || data.ok !== true) {
    return { code: "skipped", message: error?.message ?? data?.code ?? "empty_rpc_result" };
  }
  return { code: data.code === "sent" ? "sent" : "already" };
}

async function processRenewal(
  supabase: SupabaseClient,
  row: Row,
  atIso: string
): Promise<{ code: "renewed" | "already" | "insufficient" | "skipped" | "error"; message?: string }> {
  const subscriptionId = getSubscriptionId(row);
  if (!subscriptionId) return { code: "skipped", message: "missing_subscription_id" };

  const periodEnd = isoFromUnknown(row.current_period_end);
  if (!periodEnd) return { code: "skipped", message: "missing_subscription_period" };
  const idempotencyKey = `sub_renewal:${subscriptionId}:${periodEnd.slice(0, 10)}`;

  const { data, error } = await supabase.rpc("process_subscription_renewal_v2", {
    p_subscription_id: subscriptionId,
    p_period_end: periodEnd,
    p_idempotency_key: idempotencyKey,
    p_processed_at: atIso,
  });

  if (error) {
    console.error("[subscriptionRenewal] renewal rpc failed", { subscriptionId, error: error.message });
    return { code: "error", message: error.message };
  }

  const result = (((data as RpcRenewalResult[] | null) ?? [])[0] ?? null) as RpcRenewalResult | null;
  if (!result) return { code: "error", message: "empty_rpc_result" };

  // 성공·실패(캐시 부족) 알림은 157 트리거(billing event 전이)가 RPC 트랜잭션과 원자적으로 발행한다.
  if (result.ok && result.code === "succeeded") {
    return { code: "renewed" };
  }
  if (result.ok && result.code === "already_succeeded") {
    return { code: "already" };
  }
  if (!result.ok && result.code === "insufficient_cash") {
    return { code: "insufficient" };
  }
  return { code: "skipped", message: `${result.code}: ${result.message ?? ""}`.trim() };
}

export async function runSubscriptionRenewalBatch(
  supabase: SupabaseClient,
  at: Date
): Promise<SubscriptionRenewalBatchSummary> {
  const atIso = at.toISOString();
  const summary: SubscriptionRenewalBatchSummary = {
    at: atIso,
    upcomingScanned: 0,
    preRenewalNotices: 0,
    scanned: 0,
    renewed: 0,
    alreadyProcessed: 0,
    insufficientCash: 0,
    canceled: 0,
    expired: 0,
    skipped: 0,
    errors: [],
  };

  const noticeUntilIso = addDaysUtc(at, renewalNoticeDaysFromEnv()).toISOString();
  const { data: upcomingData, error: upcomingError } = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .select(SUBSCRIPTIONS_SELECT)
    .gt("next_billing_at", atIso)
    .lte("next_billing_at", noticeUntilIso)
    .eq("status", "active")
    .eq("cancel_at_period_end", false)
    .order("next_billing_at", { ascending: true })
    .limit(batchLimitFromEnv());

  if (upcomingError) {
    summary.errors.push({ subscriptionId: null, code: "upcoming_query_failed", message: upcomingError.message });
  } else {
    const upcomingRows = ((upcomingData as unknown as Row[] | null) ?? []) as Row[];
    summary.upcomingScanned = upcomingRows.length;
    for (const row of upcomingRows) {
      const subscriptionId = getSubscriptionId(row);
      const result = await sendPreRenewalNotice(supabase, row, atIso);
      if (result.code === "sent") summary.preRenewalNotices += 1;
      else if (result.code === "skipped" && result.message) {
        summary.errors.push({ subscriptionId, code: "pre_renewal_notice_skipped", message: result.message });
      }
    }
  }

  // DB selection rotates past previously attempted rows, even if a later RPC fails.
  const { data, error } = await supabase.rpc("claim_subscription_renewal_batch", {
    p_at: atIso,
    p_limit: batchLimitFromEnv(),
  });

  if (error) {
    summary.errors.push({ subscriptionId: null, code: "query_failed", message: error.message });
    return summary;
  }

  const rows = ((data as unknown as Row[] | null) ?? []) as Row[];
  summary.scanned = rows.length;

  for (const row of rows) {
    const subscriptionId = getSubscriptionId(row);
    const status = normalizeStatus(row.status);
    const graceUntil = isoFromUnknown(row.grace_until);

    if (boolFromUnknown(row.cancel_at_period_end)) {
      if (await finalizeTerminalTransition(supabase, row, "cancel_at_period_end", atIso)) summary.canceled += 1;
      else {
        summary.skipped += 1;
        summary.errors.push({ subscriptionId, code: "cancel_failed", message: "cancel transition failed" });
      }
      continue;
    }

    if (status === "past_due" && graceUntil && new Date(graceUntil).getTime() <= at.getTime()) {
      if (await finalizeTerminalTransition(supabase, row, "grace_expired", atIso)) summary.expired += 1;
      else {
        summary.skipped += 1;
        summary.errors.push({ subscriptionId, code: "expire_failed", message: "expire transition failed" });
      }
      continue;
    }

    const result = await processRenewal(supabase, row, atIso);
    if (result.code === "renewed") summary.renewed += 1;
    else if (result.code === "already") summary.alreadyProcessed += 1;
    else if (result.code === "insufficient") summary.insufficientCash += 1;
    else if (result.code === "error") {
      summary.skipped += 1;
      summary.errors.push({
        subscriptionId,
        code: "renewal_rpc_failed",
        message: result.message ?? "renewal failed",
      });
    } else {
      summary.skipped += 1;
      if (result.message) {
        summary.errors.push({ subscriptionId, code: "skipped", message: result.message });
      }
    }
  }

  return summary;
}

/**
 * P1 ① — 캐시 충전 직후 past_due 구독 즉시 복구.
 * 충전 성공 후 그 학생의 past_due 구독을 찾아 한 번씩 갱신 RPC 를 호출한다.
 * (검증된 process_subscription_renewal_v2 멱등 로직 그대로 사용. 잔액이 부족하면 past_due 유지)
 */
export async function recoverPastDueSubscriptionsForStudent(
  supabase: SupabaseClient,
  studentId: string,
  at: Date = new Date()
): Promise<{ recovered: number; insufficient: number; scanned: number }> {
  const atIso = at.toISOString();
  const out = { recovered: 0, insufficient: 0, scanned: 0 };
  if (!studentId) return out;

  const { data, error } = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .select(SUBSCRIPTIONS_SELECT)
    .eq("student_id", studentId)
    .eq("status", "past_due")
    .limit(MAX_BATCH_LIMIT);
  if (error) {
    console.error("[recoverPastDueSubscriptionsForStudent] query", error.message);
    return out;
  }
  const rows = ((data as unknown as Row[] | null) ?? []) as Row[];
  out.scanned = rows.length;
  for (const row of rows) {
    // 해지 예약/유예 만료는 일반 배치가 처리하도록 건너뜀(복구 대상 아님)
    if (boolFromUnknown(row.cancel_at_period_end)) continue;
    const result = await processRenewal(supabase, row, atIso);
    if (result.code === "renewed") out.recovered += 1;
    else if (result.code === "insufficient") out.insufficient += 1;
  }
  return out;
}
