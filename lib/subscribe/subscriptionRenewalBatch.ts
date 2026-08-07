import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPlansForMentor } from "@/lib/mentor/publicMentorBundle";
import { mentorPlanDebitAmountCents } from "@/lib/subscribe/mentorPlanPricing";
import { assignPlansByTier, isSubscribePlanTier, type SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { SUBSCRIPTIONS_SELECT, SUBSCRIPTIONS_TABLE } from "@/lib/subscribe/subscriptionsTable";

type Row = Record<string, unknown>;

const RENEWABLE_STATUSES = ["active", "past_due"] as const;
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

function periodKeyFromRow(row: Row): string {
  return (
    isoFromUnknown(row.current_period_end) ??
    isoFromUnknown(row.next_billing_at) ??
    isoFromUnknown(row.updated_at) ??
    new Date().toISOString()
  ).slice(0, 10);
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

function getUserId(row: Row, key: "student_id" | "mentor_id"): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function getTier(row: Row): SubscribePlanTier | null {
  return isSubscribePlanTier(row.plan_tier) ? row.plan_tier : null;
}

function addDaysUtc(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function isDuplicateKeyError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null;
  const message = maybe?.message ?? "";
  return maybe?.code === "23505" || /duplicate key|unique constraint/i.test(message);
}

async function upsertTerminalBillingEvent(
  supabase: SupabaseClient,
  args: {
    row: Row;
    eventType: "canceled" | "expired";
    idempotencyKey: string;
    atIso: string;
  }
): Promise<string | null> {
  const subscriptionId = getSubscriptionId(args.row);
  const studentId = getUserId(args.row, "student_id");
  const mentorId = getUserId(args.row, "mentor_id");
  if (!subscriptionId || !studentId || !mentorId) return null;

  const payload: Row = {
    subscription_id: subscriptionId,
    student_id: studentId,
    mentor_id: mentorId,
    event_type: args.eventType,
    status: "succeeded",
    period_start: isoFromUnknown(args.row.current_period_start),
    period_end: isoFromUnknown(args.row.current_period_end),
    billing_at: args.atIso,
    amount_cents: null,
    plan_tier: typeof args.row.plan_tier === "string" ? args.row.plan_tier : null,
    plan_id: typeof args.row.plan_id === "string" ? args.row.plan_id : null,
    idempotency_key: args.idempotencyKey,
    created_at: args.atIso,
    processed_at: args.atIso,
  };

  const { data, error } = await supabase
    .from("subscription_billing_events")
    .upsert(payload, { onConflict: "idempotency_key" })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[subscriptionRenewal] terminal event upsert failed", {
      subscriptionId,
      eventType: args.eventType,
      error: error.message,
    });
    return null;
  }

  const id = (data as Row | null)?.id;
  return typeof id === "string" ? id : null;
}

async function markCanceledAtPeriodEnd(
  supabase: SupabaseClient,
  row: Row,
  atIso: string
): Promise<boolean> {
  const subscriptionId = getSubscriptionId(row);
  if (!subscriptionId) return false;
  // D-ST-16: 사용자 자발 해지(예약 만료)는 'canceled' 로 기록한다. 미납 만료(markExpired)의
  // 'expired' 와 event_type 으로 구분되어야 환불·정산·CS 분석에서 오분류되지 않는다.
  // ('canceled' 는 064 event_type CHECK 에 포함된 허용값이다.)
  const eventId = await upsertTerminalBillingEvent(supabase, {
    row,
    eventType: "canceled",
    idempotencyKey: `sub_cancel:${subscriptionId}:${periodKeyFromRow(row)}`,
    atIso,
  });

  const patch: Row = {
    status: "expired",
    canceled_at: atIso,
    expired_at: atIso,
    next_billing_at: null,
    updated_at: atIso,
  };
  if (eventId) patch.last_billing_event_id = eventId;

  // 만료 알림은 157 트리거(subscriptions status→expired 전이)가 도메인 write 와 원자적으로 발행한다.
  const { error } = await supabase.from(SUBSCRIPTIONS_TABLE).update(patch).eq("id", subscriptionId);
  if (error) {
    console.error("[subscriptionRenewal] cancel transition failed", { subscriptionId, error: error.message });
    return false;
  }
  return true;
}

async function markExpired(
  supabase: SupabaseClient,
  row: Row,
  atIso: string
): Promise<boolean> {
  const subscriptionId = getSubscriptionId(row);
  if (!subscriptionId) return false;
  const eventId = await upsertTerminalBillingEvent(supabase, {
    row,
    eventType: "expired",
    idempotencyKey: `sub_expired:${subscriptionId}:${periodKeyFromRow(row)}`,
    atIso,
  });

  const patch: Row = {
    status: "expired",
    expired_at: atIso,
    next_billing_at: null,
    updated_at: atIso,
  };
  if (eventId) patch.last_billing_event_id = eventId;

  // 만료 알림은 157 트리거(subscriptions status→expired 전이)가 도메인 write 와 원자적으로 발행한다.
  const { error } = await supabase.from(SUBSCRIPTIONS_TABLE).update(patch).eq("id", subscriptionId);
  if (error) {
    console.error("[subscriptionRenewal] expire transition failed", { subscriptionId, error: error.message });
    return false;
  }
  return true;
}

async function resolveRenewalAmountCents(
  supabase: SupabaseClient,
  row: Row
): Promise<{ ok: true; amountCents: number } | { ok: false; error: string }> {
  const tier = getTier(row);
  const mentorId = getUserId(row, "mentor_id");
  if (!tier) return { ok: false, error: "invalid_plan_tier" };
  if (!mentorId) return { ok: false, error: "missing_mentor_id" };

  const plans = await fetchPlansForMentor(supabase, mentorId);
  if (plans.error) {
    console.warn("[subscriptionRenewal] plan fetch failed; using tier fallback if possible", {
      mentorId,
      tier,
      error: plans.error,
    });
  }
  const { byTier } = assignPlansByTier(plans.rows);
  const amountCents = mentorPlanDebitAmountCents(byTier[tier], tier);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, error: "invalid_amount" };
  }
  return { ok: true, amountCents };
}

async function insertPreRenewalNoticeMarker(
  supabase: SupabaseClient,
  args: {
    row: Row;
    amountCents: number;
    idempotencyKey: string;
    atIso: string;
  }
): Promise<"inserted" | "duplicate" | "failed"> {
  const subscriptionId = getSubscriptionId(args.row);
  const studentId = getUserId(args.row, "student_id");
  const mentorId = getUserId(args.row, "mentor_id");
  if (!subscriptionId || !studentId || !mentorId) return "failed";

  const payload: Row = {
    subscription_id: subscriptionId,
    student_id: studentId,
    mentor_id: mentorId,
    event_type: "renewal",
    status: "skipped",
    period_start: isoFromUnknown(args.row.current_period_start),
    period_end: isoFromUnknown(args.row.current_period_end),
    billing_at: isoFromUnknown(args.row.next_billing_at) ?? args.atIso,
    amount_cents: args.amountCents,
    plan_tier: typeof args.row.plan_tier === "string" ? args.row.plan_tier : null,
    plan_id: typeof args.row.plan_id === "string" ? args.row.plan_id : null,
    idempotency_key: args.idempotencyKey,
    failure_code: "pre_renewal_notice_sent",
    failure_message: "pre-renewal notice marker",
    attempt_count: 0,
    created_at: args.atIso,
    processed_at: args.atIso,
  };

  const { error } = await supabase.from("subscription_billing_events").insert(payload);
  if (!error) return "inserted";
  if (isDuplicateKeyError(error)) return "duplicate";
  console.error("[subscriptionRenewal] pre-renewal notice marker failed", {
    subscriptionId,
    error: error.message,
  });
  return "failed";
}

async function sendPreRenewalNotice(
  supabase: SupabaseClient,
  row: Row,
  atIso: string
): Promise<{ code: "sent" | "already" | "skipped"; message?: string }> {
  const subscriptionId = getSubscriptionId(row);
  if (!subscriptionId) return { code: "skipped", message: "missing_subscription_id" };

  const price = await resolveRenewalAmountCents(supabase, row);
  if (!price.ok) return { code: "skipped", message: price.error };

  const nextBillingAt = isoFromUnknown(row.next_billing_at);
  const periodEnd = isoFromUnknown(row.current_period_end) ?? nextBillingAt;
  if (!nextBillingAt || !periodEnd) {
    return { code: "skipped", message: "missing_billing_date" };
  }

  // 예고 알림은 157 트리거(마커 INSERT)가 도메인 write 와 원자적으로 발행한다.
  const marker = await insertPreRenewalNoticeMarker(supabase, {
    row,
    amountCents: price.amountCents,
    idempotencyKey: `sub_renewal_notice:${subscriptionId}:${periodEnd.slice(0, 10)}`,
    atIso,
  });
  if (marker === "duplicate") return { code: "already" };
  if (marker === "failed") return { code: "skipped", message: "notice_marker_failed" };
  return { code: "sent" };
}

async function processRenewal(
  supabase: SupabaseClient,
  row: Row,
  atIso: string
): Promise<{ code: "renewed" | "already" | "insufficient" | "skipped" | "error"; message?: string }> {
  const subscriptionId = getSubscriptionId(row);
  if (!subscriptionId) return { code: "skipped", message: "missing_subscription_id" };

  const price = await resolveRenewalAmountCents(supabase, row);
  if (!price.ok) return { code: "skipped", message: price.error };

  const periodEnd = isoFromUnknown(row.current_period_end) ?? isoFromUnknown(row.next_billing_at) ?? atIso;
  const idempotencyKey = `sub_renewal:${subscriptionId}:${periodEnd.slice(0, 10)}`;

  const { data, error } = await supabase.rpc("process_subscription_renewal", {
    p_subscription_id: subscriptionId,
    p_period_end: periodEnd,
    p_amount_cents: price.amountCents,
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

  const { data, error } = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .select(SUBSCRIPTIONS_SELECT)
    .lte("next_billing_at", atIso)
    .in("status", RENEWABLE_STATUSES)
    .order("next_billing_at", { ascending: true })
    .limit(batchLimitFromEnv());

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
      if (await markCanceledAtPeriodEnd(supabase, row, atIso)) summary.canceled += 1;
      else {
        summary.skipped += 1;
        summary.errors.push({ subscriptionId, code: "cancel_failed", message: "cancel transition failed" });
      }
      continue;
    }

    if (status === "past_due" && graceUntil && new Date(graceUntil).getTime() <= at.getTime()) {
      if (await markExpired(supabase, row, atIso)) summary.expired += 1;
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
 * (검증된 process_subscription_renewal 멱등 로직 그대로 사용. 잔액이 부족하면 past_due 유지)
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
