import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callApiWebV1Rpc } from "@/lib/apiWebV1/rpc";
import { getMentorUserPublic } from "@/lib/auth/mentorPublicRead";
import { transferReleasedIndividualQuestionsToRoom } from "@/lib/individualQuestion/transferIndividualQuestionsToRoom";
import { fetchPlansForMentor } from "@/lib/mentor/publicMentorBundle";
import { pickExistingColumn, rowsFromSupabaseData } from "@/lib/qna/safeSelect";
import { assignPlansByTier, type SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { SUBSCRIBE_PLAN_CATALOG } from "@/lib/subscribe/subscribePlanCatalog";
import { recommendedAmountCentsForSubscribeTier } from "@/lib/subscribe/mentorPlanPricing";
import {
  SUBSCRIPTIONS_ORDER_COLUMN,
  SUBSCRIPTIONS_SELECT,
  SUBSCRIPTIONS_TABLE,
  addMonthsClampedUtc,
} from "@/lib/subscribe/subscriptionsTable";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadMentorCapUsage, wouldExceedCap } from "@/lib/subscribe/mentorCapService";
import { assertMentorApprovedForAction } from "@/lib/mentor/mentorVerificationGate";
import { loadMentorActivityForGate } from "@/lib/mentor/mentorActivityService";
import { mentorAcceptsNewSubscriptions, mentorActivityState } from "@/lib/mentor/mentorActivity";
import { loadMentorSubscribeOpen } from "@/lib/mentor/mentorSubscribeOpen";

type Row = Record<string, unknown>;

// SUB_TABLES/STU_FK/MEN_FK 는 findActiveSubscriptionForPair(레거시 프로빙 helper) 전용이다.
// S2-2 W3(C8): checkout 확정 경로에서는 사용하지 않는다 — 남은 사용처(intent 사전 dup 게이트 ·
// qna 구독 게이트 3곳 · subscribe/success 표시)는 C10 전역 프로빙 제거 대상으로 이월.
const SUB_TABLES = ["subscriptions", "mentor_subscriptions", "user_subscriptions"] as const;
const STU_FK = ["student_id", "user_id", "student_user_id", "subscriber_id"] as const;
const MEN_FK = ["mentor_id", "mentor_user_id", "creator_id", "host_id"] as const;

function isRowSubscriptionActive(row: Row): boolean {
  const st = String(
    row.status ?? row.state ?? row.subscription_status ?? ""
  )
    .toLowerCase()
    .trim();
  return st === "active";
}

/**
 * 멘토·학생 쌍에 대해 "활성"으로 보이는 구독이 이미 있으면 해당 행(첫 개)
 */
export async function findActiveSubscriptionForPair(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<{ table: string; row: Row } | null> {
  for (const table of SUB_TABLES) {
    const { error: pe } = await supabase.from(table).select("id").limit(1);
    if (pe) continue;
    if (table === SUBSCRIPTIONS_TABLE) {
      const { data, error } = await supabase
        .from(SUBSCRIPTIONS_TABLE)
        .select(SUBSCRIPTIONS_SELECT)
        .eq("student_id", studentId)
        .eq("mentor_id", mentorId)
        .order(SUBSCRIPTIONS_ORDER_COLUMN, { ascending: false })
        .limit(20);
      if (error) continue;
      const rows = rowsFromSupabaseData(data) as Row[];
      for (const r of rows) {
        if (isRowSubscriptionActive(r)) {
          return { table: SUBSCRIPTIONS_TABLE, row: r };
        }
      }
      continue;
    }

    const { column: sc } = await pickExistingColumn(supabase, table, STU_FK);
    const { column: mc } = await pickExistingColumn(supabase, table, MEN_FK);
    if (!sc || !mc) continue;
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq(sc, studentId)
      .eq(mc, mentorId)
      .limit(20);
    if (error) continue;
    const rows = (data as Row[] | null) ?? [];
    for (const r of rows) {
      if (isRowSubscriptionActive(r)) {
        return { table, row: r };
      }
    }
  }
  return null;
}

/** DB `record_subscription_cash_debit`: idempotency_key = 'sub_debit_' || payment_id */
function subscriptionCashDebitIdempotencyKey(paymentId: string): string {
  return `sub_debit_${paymentId}`;
}

function isSchemaNotReadyError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null | undefined;
  const code = String(e?.code ?? "");
  const message = String(e?.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("could not find") ||
    message.includes("does not exist")
  );
}

function isoFromUnknown(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function fallbackPeriodEndIso(periodStartIso: string): string {
  return addMonthsClampedUtc(new Date(periodStartIso), 1).toISOString();
}

function positiveIntegerFromUnknown(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

async function recordInitialSubscriptionBillingEvent(args: {
  subscriptionId: string | null;
  studentId: string;
  mentorId: string;
  paymentId: string;
  planTier: SubscribePlanTier;
  amountCents?: number | null;
}): Promise<void> {
  const subscriptionId = args.subscriptionId?.trim();
  if (!subscriptionId) return;

  const admin = createServiceRoleClient();
  const { data: subscriptionRow, error: subError } = await admin
    .from(SUBSCRIPTIONS_TABLE)
    .select(
      "id, student_id, mentor_id, payment_id, plan_tier, plan_id, created_at, started_at, current_period_start, current_period_end"
    )
    .eq("id", subscriptionId)
    .maybeSingle();

  if (subError || !subscriptionRow) {
    if (!isSchemaNotReadyError(subError)) {
      console.error("[recordInitialSubscriptionBillingEvent] subscription select failed", {
        subscriptionId,
        error: subError,
      });
    }
    return;
  }

  const s = subscriptionRow as Row;
  const ledgerKey = subscriptionCashDebitIdempotencyKey(args.paymentId);
  const { data: ledgerRow, error: ledgerError } = await admin
    .from("cash_ledger")
    .select("id, delta_cents, created_at")
    .eq("idempotency_key", ledgerKey)
    .maybeSingle();
  if (ledgerError && !isSchemaNotReadyError(ledgerError)) {
    console.warn("[recordInitialSubscriptionBillingEvent] ledger lookup failed", {
      subscriptionId,
      ledgerKey,
      error: ledgerError,
    });
  }

  const ledger = (ledgerRow as Row | null) ?? null;
  const periodStart =
    isoFromUnknown(s.current_period_start) ??
    isoFromUnknown(s.started_at) ??
    isoFromUnknown(s.created_at) ??
    new Date().toISOString();
  const periodEnd = isoFromUnknown(s.current_period_end) ?? fallbackPeriodEndIso(periodStart);
  const ledgerAmount =
    typeof ledger?.delta_cents === "number" && Number.isFinite(ledger.delta_cents)
      ? Math.abs(Math.trunc(ledger.delta_cents))
      : null;
  const amountCents = positiveIntegerFromUnknown(args.amountCents) ?? ledgerAmount;

  const payload: Row = {
    subscription_id: subscriptionId,
    student_id: String(s.student_id ?? args.studentId),
    mentor_id: String(s.mentor_id ?? args.mentorId),
    event_type: "initial",
    status: "succeeded",
    period_start: periodStart,
    period_end: periodEnd,
    billing_at: isoFromUnknown(ledger?.created_at) ?? isoFromUnknown(s.created_at) ?? new Date().toISOString(),
    amount_cents: amountCents,
    plan_tier: String(s.plan_tier ?? args.planTier),
    plan_id: typeof s.plan_id === "string" && s.plan_id.trim() ? s.plan_id : null,
    idempotency_key: `sub_initial:${subscriptionId}`,
    ledger_id: typeof ledger?.id === "string" ? ledger.id : null,
    payment_id: String(s.payment_id ?? args.paymentId),
    processed_at: isoFromUnknown(ledger?.created_at) ?? new Date().toISOString(),
  };

  const { data: eventRow, error: eventError } = await admin
    .from("subscription_billing_events")
    .upsert(payload, { onConflict: "idempotency_key" })
    .select("id")
    .maybeSingle();

  if (eventError || !eventRow) {
    if (!isSchemaNotReadyError(eventError)) {
      console.error("[recordInitialSubscriptionBillingEvent] event upsert failed", {
        subscriptionId,
        error: eventError,
      });
    }
    return;
  }

  const eventId = String((eventRow as Row).id ?? "");
  if (!eventId) return;

  const { error: linkError } = await admin
    .from(SUBSCRIPTIONS_TABLE)
    .update({
      last_billing_event_id: eventId,
      last_payment_id: args.paymentId,
    })
    .eq("id", subscriptionId);
  if (linkError && !isSchemaNotReadyError(linkError)) {
    console.error("[recordInitialSubscriptionBillingEvent] subscription link update failed", {
      subscriptionId,
      eventId,
      error: linkError,
    });
  }
}

// (removed dead helpers: insertSubscriptionRow / markPaymentSucceeded / tryDeleteSubscriptionById /
//  tryReversalSubscriptionCashDebit — P1-13 3단계 비원자 경로가 confirm_subscription_checkout RPC 로 대체됨.)
// (S2-2 W3(C8): JS 쪽 구독 원장 보정 3종(누락 원장 사전 조회·보정 오케스트레이션·직접 차감
//  RPC 래퍼) 제거 — succeeded 재생의 원장 정합 판정·보정은 F12 Phase 1 이 정본이고,
//  JS 쪽 보상성 자금 기록·NULL/stale 참조 복구 구현은 금지다(W3 §7.2·§8).)
type IntentResult =
  | {
      ok: true;
      paymentId: string;
      intentKey: string;
      paymentTable: string;
      planProbe: string;
      message: string;
    }
  | { ok: false; error: string; code: "mentor" | "plan" | "dup" | "db" | "auth" };

/**
 * PG 전: pending 결제 1행 + client가 complete 호출(또는 이후 웹훅이 동일 서비스 함수 호출)
 *
 * S2-2 W3(C8): `expectedAmountCents` 는 학생이 결제 화면에서 실제로 본 금액(cents)이다.
 * intent 는 이 동의 금액을 `payments.amount`(KRW)와 `payments.metadata.expected_amount_cents`
 * (불변 동의 사본 — 계약 §17 C8 주의: "intent 생성 시점의 금액을 payments 행에 보존해 전달")
 * 두 곳에 보존한다. 확정(F12)의 3자 일치(payments.amount×100 = p_expected = 잠근 plan)가
 * 이 사본들로 독립 검증된다. payments INSERT 는 정본 `payments` 테이블 고정 컬럼으로만
 * 수행한다(구 PAY_TABLES/컬럼 후보 프로빙 제거 — W3 §8).
 */
export async function createSubscriptionPaymentIntent(
  supabase: SupabaseClient,
  args: { studentId: string; mentorId: string; planTier: SubscribePlanTier; expectedAmountCents: number }
): Promise<IntentResult> {
  const { studentId, mentorId, planTier, expectedAmountCents } = args;
  // 단위 고정: cents(= 표시 KRW × 100). KRW 원값을 그대로 넣는 실수를 조기 차단한다.
  if (
    !Number.isInteger(expectedAmountCents) ||
    expectedAmountCents <= 0 ||
    expectedAmountCents % 100 !== 0
  ) {
    return { ok: false, error: "결제 금액 정보가 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.", code: "plan" };
  }
  const mUser = await getMentorUserPublic(supabase, mentorId);
  if (mUser.error || !mUser.data || mUser.data.role !== "mentor") {
    return { ok: false, error: "멘토를 확인할 수 없습니다.", code: "mentor" };
  }
  const mentorGate = await assertMentorApprovedForAction(supabase, mentorId);
  if (!mentorGate.ok) {
    return { ok: false, error: mentorGate.error, code: "mentor" };
  }
  // 멘토 활동 중단 게이트 — 종료/일시중단 중인 멘토는 신규 구독 불가.
  const mentorActivity = await loadMentorActivityForGate(supabase, mentorId);
  if (mentorActivity && !mentorAcceptsNewSubscriptions(mentorActivity)) {
    const state = mentorActivityState(mentorActivity);
    return {
      ok: false,
      error:
        state === "paused"
          ? "이 멘토는 현재 일시 휴식 중입니다. 복귀 후 다시 구독해 주세요."
          : "이 멘토는 활동을 종료하여 신규 구독을 받지 않습니다.",
      code: "mentor",
    };
  }
  // 멘토 self "신규 구독 그만 받기" 게이트 — flag=false 면 신규 구독 거부(기존 구독·갱신엔 무관, cap 계산 불변).
  if (!(await loadMentorSubscribeOpen(supabase, mentorId))) {
    return { ok: false, error: "이 멘토는 현재 신규 구독을 받지 않고 있어요.", code: "mentor" };
  }
  const dup = await findActiveSubscriptionForPair(supabase, studentId, mentorId);
  if (dup) {
    return {
      ok: false,
      error: "이미 해당 멘토에 활성 구독이 있습니다. 중복 구독을 막았습니다.",
      code: "dup",
    };
  }
  const capUsage = await loadMentorCapUsage(mentorId);
  if (wouldExceedCap(capUsage, planTier)) {
    return {
      ok: false,
      error: "이 멘토는 현재 구독이 마감되었습니다. 다른 멘토를 찾아보거나 잠시 후 다시 시도해 주세요.",
      code: "mentor",
    };
  }
  const ensuredPlans = await ensureMentorCatalogPlanRows(supabase, mentorId);
  if (!ensuredPlans.ok) {
    return { ok: false, error: ensuredPlans.error, code: "db" };
  }

  const plans = await fetchPlansForMentor(supabase, mentorId);
  if (plans.error) {
    return { ok: false, error: `플랜 조회 실패: ${plans.error}`, code: "plan" };
  }
  const { byTier, fillProbe } = assignPlansByTier(plans.rows);
  const planRow = byTier[planTier];
  if (!planRow) {
    return { ok: false, error: `선택한 티어(${planTier})에 맞는 플랜 행이 없습니다. ${fillProbe}`, code: "plan" };
  }
  const intentKey = `sub_${randomUUID()}`;
  const planIdStr = String(
    (planRow as Row).id ?? (planRow as Row).plan_id ?? (planRow as Row).uuid ?? ""
  );

  // 정본 payments 고정 컬럼 INSERT. amount 는 학생 동의 금액(KRW = cents ÷ 100)이고,
  // metadata.expected_amount_cents 는 F12 p_expected 로 전달할 불변 동의 사본이다.
  const { data, error } = await supabase
    .from("payments")
    .insert({
      user_id: studentId,
      mentor_id: mentorId,
      status: "pending",
      amount: expectedAmountCents / 100,
      currency: "KRW",
      kind: "subscription",
      plan_id: planIdStr || null,
      external_id: `sub_intent_${intentKey}`,
      metadata: {
        planTier,
        intentKey,
        planId: planIdStr || undefined,
        source: "subscribe_checkout",
        expected_amount_cents: expectedAmountCents,
      },
    })
    .select("id")
    .maybeSingle();
  if (error || !data || typeof (data as Row).id === "undefined") {
    return {
      ok: false,
      error: error?.message ?? "payments insert 실패(필수 컬럼·RLS·NOT NULL)",
      code: "db",
    };
  }
  const paymentId = String((data as Row).id);
  return {
    ok: true,
    paymentId,
    intentKey,
    paymentTable: "payments",
    planProbe: plans.probe,
    message: "intent 생성. PG 붙이면 ext/intentKey로 매칭, 완료는 /api/subscribe/complete",
  };
}

type CompleteResult =
  | { ok: true; subscriptionId: string | null; roomId: string | null; paymentId: string; message: string }
  | { ok: false; error: string; code: "not_found" | "dup" | "db" | "idempotent" | "forbidden" };

/**
 * 결제 행이 성공 상태(succeeded/paid 등)일 때만 subscriptions + rooms 활성화.
 * pending 등 비확정 상태는 SUBSCRIBE_CHECKOUT_ALLOW_PENDING=true 일 때만 허용(로컬·스테이징 전용).
 * PG·웹훅에서 결제 확정 후 동일 함수를 호출하는 것이 출시 기준 흐름.
 */
export function isSubscribeCheckoutPendingBypassAllowed(): boolean {
  const on =
    process.env.SUBSCRIBE_CHECKOUT_ALLOW_PENDING === "true" ||
    process.env.SUBSCRIBE_CHECKOUT_ALLOW_PENDING === "1";
  if (process.env.NODE_ENV === "production" && on) {
    throw new Error("SUBSCRIBE_CHECKOUT_ALLOW_PENDING: 프로덕션에서는 허용되지 않습니다");
  }
  if (on) {
    console.warn(
      "[subscribeCheckout] SUBSCRIBE_CHECKOUT_ALLOW_PENDING=true — 미결제 구독 완료 우회가 허용됩니다(개발·스테이징 전용)."
    );
  }
  return on;
}

const PLAN_TABLE_CANDIDATES = ["plans", "mentor_plans", "subscription_plans", "mentor_subscription_plans"] as const;
const PLAN_FK_CANDIDATES = ["mentor_id", "mentor_user_id", "user_id", "owner_id"] as const;

/**
 * 구독 카탈로그 티어 행이 DB에 없으면 service role로 생성(캐시 구독 전용).
 */
export async function ensureMentorCatalogPlanRows(
  supabase: SupabaseClient,
  mentorId: string
): Promise<{ ok: true; table: string | null } | { ok: false; error: string }> {
  const plans = await fetchPlansForMentor(supabase, mentorId);
  const { byTier } = assignPlansByTier(plans.rows);
  const missing = SUBSCRIBE_PLAN_CATALOG.filter((p) => !byTier[p.tier]);
  if (missing.length === 0) {
    return { ok: true, table: plans.table };
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `서비스 설정 오류: ${m}` };
  }

  let table = plans.table;
  if (!table) {
    for (const t of PLAN_TABLE_CANDIDATES) {
      const { error } = await admin.from(t).select("id").limit(1);
      if (!error) {
        table = t;
        break;
      }
    }
  }
  if (!table) {
    return { ok: false, error: "플랜 테이블을 찾을 수 없습니다. 스키마를 확인해 주세요." };
  }

  const { column: fk } = await pickExistingColumn(admin, table, PLAN_FK_CANDIDATES);
  if (!fk) {
    return { ok: false, error: `${table}: 멘토 FK 컬럼이 없습니다.` };
  }
  const tierCol = (await pickExistingColumn(admin, table, ["plan_tier", "tier", "slug", "code"])).column;
  const amtCol = (await pickExistingColumn(admin, table, ["amount_cents", "price_cents", "amount", "price"])).column;
  const labelCol = (await pickExistingColumn(admin, table, ["label", "title", "name"])).column;
  const updatedAtCol = (await pickExistingColumn(admin, table, ["updated_at"])).column;
  const priceUpdatedAtCol = (await pickExistingColumn(admin, table, ["price_updated_at"])).column;

  for (const item of missing) {
    const row: Record<string, unknown> = { [fk]: mentorId };
    const now = new Date().toISOString();
    if (tierCol) row[tierCol] = item.tier;
    if (amtCol) row[amtCol] = recommendedAmountCentsForSubscribeTier(item.tier);
    if (labelCol) row[labelCol] = item.label;
    if (updatedAtCol) row[updatedAtCol] = now;
    if (priceUpdatedAtCol) row[priceUpdatedAtCol] = now;
    const { error } = await admin.from(table).insert(row);
    if (error) {
      return { ok: false, error: `${table} 플랜(${item.tier}) 생성 실패: ${error.message}` };
    }
  }
  return { ok: true, table };
}

/**
 * 캐시 지갑 즉시 차감 구독: intent 생성 → F12 확정.
 * `expectedAmountCents` 는 학생이 결제 화면에서 본 금액(cents) — intent 와 F12 로 그대로 흐른다.
 */
export async function finalizeSubscriptionCashWalletCheckout(
  supabase: SupabaseClient,
  args: { studentId: string; mentorId: string; planTier: SubscribePlanTier; expectedAmountCents: number }
): Promise<CompleteResult> {
  const intent = await createSubscriptionPaymentIntent(supabase, args);
  if (!intent.ok) {
    const code =
      intent.code === "dup" ? ("dup" as const) : intent.code === "mentor" ? ("not_found" as const) : ("db" as const);
    return { ok: false, error: intent.error, code };
  }

  return finalizeSubscriptionCheckout(supabase, {
    studentId: args.studentId,
    paymentId: intent.paymentId,
    mentorId: args.mentorId,
    planTier: args.planTier,
    expectedAmountCents: args.expectedAmountCents,
    cashWallet: true,
  });
}

/**
 * 구독 checkout 확정 — S2-2 W3(C8): F12 `api_web_v1.subscription_checkout_confirm_v2`
 * (service_role 전용) 단일 호출로 전환(계약 §7 F12 · §17 #15).
 *
 * - `expectedAmountCents` 는 **학생이 결제 화면에서 실제로 본 금액**(cents)이다. 확정 직전
 *   mentor_plans 재조회값·현재 가격 재계산·payments.amount×100 재사용으로 채우지 않는다.
 *   재생(succeeded 재호출)에서는 intent 가 payments.metadata 에 보존한 동의 사본을
 *   우선 사용한다(재시도 때 현재 가격으로 교체 금지 — W3 §6·§7.2).
 * - 멱등키는 기존 안정 키 `sub_checkout_<paymentId>` 를 유지한다(재시도마다 새 키 금지).
 * - succeeded 재호출은 선거부 없이 F12 에 그대로 전달한다 — 현재 플랜 가격 재조회·레거시
 *   `confirm_subscription_checkout` 재호출·JS 원장 보정·JS room 참조 복구 전부 금지(§7.2).
 * - 방 확보·참조 복구는 F12 가 정본이다. 성공 응답의 `room_id` 를 후속 흐름의 정본으로
 *   쓰고, 별도 직접 room INSERT 는 하지 않는다. `ROOM_ENSURE_FAILED` 는 전체 실패다
 *   (checkout 일부 성공 처리 금지 — 최초 실행은 자금 변경까지 전부 롤백됨).
 * - 승인·활동·cap·잔액·플랜 결속 판정은 DB(F12/정본 confirm)가 정본이다 — envelope
 *   안정 코드를 사용자 문구로 매핑만 한다. 예상 밖 전송·SQL 오류는 성공으로 바꾸지 않고
 *   실패로 전파하며, timeout 을 실패 확정으로 간주한 보상성 자금 처리를 하지 않는다.
 */
export async function finalizeSubscriptionCheckout(
  supabase: SupabaseClient,
  args: {
    studentId: string;
    paymentId: string;
    mentorId: string;
    planTier: SubscribePlanTier;
    /** 학생이 결제 화면에서 본 금액(cents = 표시 KRW × 100). */
    expectedAmountCents: number;
    cashWallet?: boolean;
  }
): Promise<CompleteResult> {
  const { studentId, paymentId, mentorId, planTier, expectedAmountCents, cashWallet } = args;

  // 결제 행은 정본 payments 테이블에서 세션 클라이언트(RLS)로 읽는다 — 소유권 경계는 웹 책임.
  const { data: payRow, error: pe } = await supabase
    .from("payments")
    .select("id, user_id, mentor_id, status, plan_id, metadata")
    .eq("id", paymentId)
    .maybeSingle();
  if (pe || !payRow) {
    return { ok: false, error: "결제 행을 찾을 수 없습니다.", code: "not_found" };
  }
  const p = payRow as Row;
  if (String(p.user_id ?? "") !== studentId) {
    return { ok: false, error: "본인 결제만 완료 처리할 수 있습니다.", code: "forbidden" };
  }
  if (p.mentor_id != null && String(p.mentor_id) !== mentorId) {
    return { ok: false, error: "멘토 정보가 결제와 일치하지 않습니다.", code: "forbidden" };
  }

  const meta = (p.metadata && typeof p.metadata === "object" ? p.metadata : {}) as Row;
  const status = String(p.status ?? "").toLowerCase();
  const succeededLike =
    status === "succeeded" || status === "paid" || status === "success" || status === "complete" || status === "captured";

  // pending 결제의 확정은 캐시 지갑 경로(동일 요청 내 intent→확정) 또는 로컬 전용
  // 우회 플래그에서만 허용한다(출시 기준: PG·웹훅이 성공 반영 후 호출). 기존 계약 유지.
  if (!succeededLike && cashWallet !== true && !isSubscribeCheckoutPendingBypassAllowed()) {
    return {
      ok: false,
      error:
        "결제가 아직 확정되지 않았습니다. PG·웹훅에서 결제 성공 상태로 반영된 뒤에만 구독을 활성화할 수 있습니다. 로컬 개발만 SUBSCRIBE_CHECKOUT_ALLOW_PENDING=true 로 예외 허용.",
      code: "forbidden",
    };
  }

  // p_expected: 재생은 intent 가 보존한 동의 사본 우선(§6 — 재시도 때 현재 가격 교체 금지).
  const preserved =
    typeof meta.expected_amount_cents === "number" && Number.isInteger(meta.expected_amount_cents)
      ? meta.expected_amount_cents
      : null;
  const expected = succeededLike ? preserved ?? expectedAmountCents : expectedAmountCents;
  if (!Number.isInteger(expected) || expected <= 0) {
    return { ok: false, error: "결제 금액 정보가 올바르지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.", code: "db" };
  }

  // p_plan_id: 확정 대상의 정본 plan ID — payments.plan_id(정본 confirm 이 성공 시 기록)
  // → intent metadata.planId 순. 가격이 아니라 ID 참조만 사용한다.
  const planId =
    (typeof p.plan_id === "string" && p.plan_id) ||
    (typeof meta.planId === "string" && meta.planId) ||
    "";
  if (!planId) {
    return { ok: false, error: "요금제 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.", code: "db" };
  }

  const admin = createServiceRoleClient();
  const res = await callApiWebV1Rpc(admin, "subscription_checkout_confirm_v2", {
    p_payment_id: paymentId,
    p_plan_id: planId,
    p_expected_amount_cents: expected,
    p_idempotency_key: `sub_checkout_${paymentId}`,
  });

  if (!res.ok) {
    if (res.message !== null) {
      // 전송·전파 오류(timeout 포함): 실패 확정이 아니다 — 보상성 처리 없이 재시도 안내만.
      console.error("[finalizeSubscriptionCheckout] subscription_checkout_confirm_v2 transport", {
        code: res.code,
        paymentId,
      });
      return {
        ok: false,
        error: "구독 확정 결과를 확인하지 못했습니다. 잠시 후 같은 결제로 다시 시도해 주세요.",
        code: "db",
      };
    }
    // envelope 확정 거부 — anomaly_id 는 운영 진단용으로 로그에만 보존(사용자 미노출).
    const anomalyId = res.detail && typeof res.detail.anomaly_id === "string" ? res.detail.anomaly_id : null;
    console.error("[finalizeSubscriptionCheckout] subscription_checkout_confirm_v2 rejected", {
      code: res.code,
      anomalyId,
      paymentId,
    });
    return {
      ok: false,
      error: mapConfirmSubscriptionError(res.code),
      code: F12_FORBIDDEN_CODES.has(res.code) ? "forbidden" : "db",
    };
  }

  const subId = typeof res.row.subscription_id === "string" ? res.row.subscription_id : null;
  const roomId = typeof res.row.room_id === "string" ? res.row.room_id : null;
  const idempotent = res.row.idempotent === true;
  if (!subId) {
    return { ok: false, error: "구독 확정 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", code: "db" };
  }

  if (!idempotent) {
    // 신규 확정에만 초기 billing event 를 기록한다(재생에서 last_payment_id 를 P 로
    // 되돌리는 stale 갱신 금지 — 최신 결제 정본은 subscriptions.last_payment_id).
    await recordInitialSubscriptionBillingEvent({
      subscriptionId: subId,
      studentId,
      paymentId,
      mentorId,
      planTier,
      amountCents: expected,
    });
  }

  // 부가(best-effort): released 개별질문을 F12 정본 room 으로 이전. 실패해도 확정은 유지.
  if (roomId) {
    try {
      await transferReleasedIndividualQuestionsToRoom(admin, { studentId, mentorId, roomId });
    } catch (e) {
      console.error("[finalizeSubscriptionCheckout] individual-question transfer failed (non-fatal)", e);
    }
  }

  return {
    ok: true,
    paymentId,
    subscriptionId: subId,
    roomId,
    message: idempotent
      ? "이미 완료된 결제입니다. 구독·질문방 정보를 다시 확인했습니다."
      : "구독·질문방·결제 완료 처리를 마쳤습니다.",
  };
}

/** F12 envelope 코드 중 권한·계정·정책 거부로 분류할 코드(CompleteResult.code=forbidden). */
const F12_FORBIDDEN_CODES = new Set([
  "ACCOUNT_BANNED",
  "ACCOUNT_SUSPENDED",
  "MENTOR_NOT_APPROVED",
  "MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS",
  "MENTOR_CAP_EXCEEDED",
]);

/** F12/정본 confirm envelope 코드 → 사용자 문구 매핑(안정 코드 임의 통합 금지 — W3 §7.3). */
function mapConfirmSubscriptionError(code: string): string {
  switch (code) {
    case "PAYMENT_NOT_FOUND":
      return "결제 정보를 찾을 수 없어요. 잠시 후 다시 시도해 주세요.";
    case "PAYMENT_PROCESSING":
      return "결제가 아직 처리 중이에요. 잠시 후 다시 시도해 주세요.";
    case "PAYMENT_NOT_PENDING":
    case "PAYMENT_STATE_UNEXPECTED":
    case "PAYMENT_KIND_INVALID":
      return "이미 처리되었거나 진행할 수 없는 결제예요. 결제 내역을 확인해 주세요.";
    case "PAYMENT_STALE":
      return "결제 확정 시간이 지났어요. 다시 결제해 주세요.";
    case "ACCOUNT_BANNED":
    case "ACCOUNT_SUSPENDED":
      return "현재 계정 상태에서는 구독을 진행할 수 없어요.";
    case "MENTOR_NOT_APPROVED":
      return "이 멘토는 아직 승인 전이라 구독할 수 없어요.";
    case "MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS":
      return "이 멘토는 현재 신규 구독을 받지 않고 있어요.";
    case "MENTOR_CAP_EXCEEDED":
      return "이 멘토는 현재 구독이 마감되었습니다. 다른 멘토를 찾아보거나 잠시 후 다시 시도해 주세요.";
    case "PLAN_NOT_FOUND":
    case "PLAN_MENTOR_MISMATCH":
    case "PLAN_INACTIVE":
    case "PLAN_AMOUNT_INVALID":
      return "요금제 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.";
    case "PLAN_AMOUNT_CHANGED":
      // 차감·구독·원장·결제 변경 0 — 학생이 본 금액과 현재 요금제가 달라 확정을 중단했다.
      return "결제 화면의 금액과 현재 요금제 금액이 달라 결제를 진행하지 않았어요. 캐시는 차감되지 않았습니다. 새로고침 후 금액을 확인하고 다시 시도해 주세요.";
    case "CASH_INSUFFICIENT":
      return "캐시 잔액이 부족해요. 충전 후 다시 시도해 주세요.";
    case "ROOM_ENSURE_FAILED":
      return "질문방 연결에 실패해 결제를 확정하지 않았어요. 캐시는 차감되지 않았습니다. 잠시 후 다시 시도해 주세요.";
    case "ROOM_REF_MISMATCH":
    case "SUBSCRIPTION_REF_INVALID":
    case "PLAN_BINDING_MISMATCH":
    case "PARTY_BINDING_MISMATCH":
    case "LEDGER_BINDING_MISMATCH":
    case "LEDGER_AMOUNT_MISMATCH":
    case "LEDGER_FIELD_MISMATCH":
    case "SUCCEEDED_NO_SUBSCRIPTION":
    case "SUCCEEDED_NO_LEDGER":
    case "FINANCIAL_WRITE_ERROR":
      return "결제 원장 정합성 확인이 필요해요. 고객센터로 문의해 주세요.";
    default:
      return "구독 확정에 실패했어요. 잠시 후 다시 시도해 주세요.";
  }
}


// (removed dead helper insertSubscriptionRow — P1-13 3단계 경로가 confirm_subscription_checkout RPC 로 대체됨)
// (removed dead helper markPaymentSucceeded — P1-13 3단계 경로가 confirm_subscription_checkout RPC 로 대체됨)
// (removed dead helper tryDeleteSubscriptionById — P1-13 3단계 경로가 confirm_subscription_checkout RPC 로 대체됨)
// (S2-2 W3(C8): JS 방 확보 helper 2종과 room 오류 문구 helper 제거 — 방 확보·참조 보정은
//  F12(서버 F10 경유)가 정본이다. JS 직접 room INSERT · unique 충돌 재조회 수렴 · 컬럼 후보
//  프로빙 경로는 checkout 에서 소멸했다(W3 §8). 무료 질문방은 W1 의 F2/F10 경로가 담당.)
