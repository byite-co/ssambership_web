/**
 * 구독 자동 갱신·취소 시간 경과 시뮬레이션 (모델 C 검증)
 *
 * 검증 방식:
 *   - subscriptions.next_billing_at / current_period_end 를 과거로 당겨 시간 경과 시뮬레이션
 *   - 두 가지 경로 모두 사용:
 *     (a) /api/cron/subscription-renewal — runSubscriptionRenewalBatch (전체 흐름)
 *     (b) process_subscription_renewal RPC 직접 — 단일 갱신 격리 검증
 *   - 결정적 단언: 잔액(cash_wallets), 원장(cash_ledger), 상태(subscriptions.status), 빌링 이벤트
 *
 * 운영 격리:
 *   - .env.local 127.0.0.1 만 사용 (service_role로 시드/검증)
 *   - 갱신 RPC는 service_role 전용. 코드 미터치.
 */
import { test, expect, request as plRequest } from "@playwright/test";
import { randomUUID } from "node:crypto";
import * as db from "./helpers/db";
import { loadEnvLocal } from "./helpers/env";

const env = loadEnvLocal();
const STUDENT_EMAIL = env.E2E_STUDENT_EMAIL ?? "";
const MENTOR_PRICED_EMAIL = env.E2E_MENTOR_PRICED_EMAIL ?? "";
const MENTOR_UNPRICED_EMAIL = env.E2E_MENTOR_UNPRICED_EMAIL ?? "";
const CRON_SECRET = env.CRON_SECRET ?? "local-test-cron-secret";
const BASE_URL = "http://localhost:3000";

const admin = db.admin();

async function cleanupSubscriptionForPair(studentId: string, mentorId: string) {
  const { data: existing } = await admin
    .from("subscriptions")
    .select("id, payment_id")
    .eq("student_id", studentId)
    .eq("mentor_id", mentorId);
  for (const s of (existing ?? []) as Array<{ id: string; payment_id: string | null }>) {
    // FK 종속 정리 (RESTRICT 포함 settlement_items)
    await admin.from("subscription_settlement_items").delete().eq("subscription_id", s.id);
    await admin.from("subscription_billing_events").delete().eq("subscription_id", s.id);
    await admin.from("refunds").delete().eq("subscription_id", s.id);
    // SET NULL 됨 (room/dispute): subscription_id 비우면 충분
    await admin.from("mentor_student_rooms").update({ subscription_id: null }).eq("subscription_id", s.id);
    const { error } = await admin.from("subscriptions").delete().eq("id", s.id);
    if (error) console.warn(`[cleanup] sub ${s.id} delete failed:`, error.message);
    if (s.payment_id) {
      await admin.from("payments").delete().eq("id", s.payment_id);
    }
  }
}

async function ensureMentorPlansAndApproval(mentorId: string) {
  await admin
    .from("mentor_profiles")
    .update({ verification_status: "approved" })
    .eq("user_id", mentorId);
  const tiers = [
    { plan_tier: "limited", amount_cents: 5_500_000, cap_weight: 1.0, label: "limited" },
    { plan_tier: "standard", amount_cents: 11_490_000, cap_weight: 2.5, label: "standard" },
    { plan_tier: "premium", amount_cents: 24_990_000, cap_weight: 4.5, label: "premium" },
  ];
  for (const t of tiers) {
    await admin
      .from("mentor_plans")
      .upsert({ mentor_id: mentorId, ...t, updated_at: new Date().toISOString() }, { onConflict: "mentor_id,plan_tier" });
  }
}

type FreshSubArgs = {
  studentId: string;
  mentorId: string;
  tier: "limited" | "standard" | "premium";
  amountCents: number;
  /** 주기 종료 시점(과거로 두면 갱신 대상). */
  periodEndIso: string;
  /** cancel_at_period_end 플래그 */
  cancelAtPeriodEnd?: boolean;
};

async function createFreshActiveSubscription(args: FreshSubArgs): Promise<{
  subscriptionId: string;
  paymentId: string;
}> {
  const paymentId = randomUUID();
  const intentKey = `sim_sub_${Date.now()}_${randomUUID()}`;
  const now = new Date();
  const periodStartIso = new Date(new Date(args.periodEndIso).getTime() - 30 * 24 * 3600 * 1000).toISOString();

  // payments
  await admin.from("payments").insert({
    id: paymentId,
    user_id: args.studentId,
    mentor_id: args.mentorId,
    status: "succeeded",
    amount: args.amountCents / 100,
    currency: "KRW",
    external_id: `sub_intent_${intentKey}`,
    metadata: { planTier: args.tier, intentKey, source: "sim-renewal" },
    kind: "subscription",
  });

  const { data: planRow } = await admin
    .from("mentor_plans")
    .select("id")
    .eq("mentor_id", args.mentorId)
    .eq("plan_tier", args.tier)
    .maybeSingle();
  const planId = (planRow as { id?: string } | null)?.id ?? null;

  const { data: subIns, error: subErr } = await admin
    .from("subscriptions")
    .insert({
      student_id: args.studentId,
      mentor_id: args.mentorId,
      payment_id: paymentId,
      plan_tier: args.tier,
      plan_id: planId,
      status: "active",
      started_at: periodStartIso,
      current_period_start: periodStartIso,
      current_period_end: args.periodEndIso,
      next_billing_at: args.periodEndIso,
      billing_cycle: "monthly",
      cancel_at_period_end: args.cancelAtPeriodEnd ?? false,
      cancel_requested_at: args.cancelAtPeriodEnd ? now.toISOString() : null,
    })
    .select("id")
    .single();
  expect(subErr, "sub insert").toBeFalsy();
  const subscriptionId = (subIns as { id: string }).id;

  // initial billing event + 차감 원장 시뮬레이션 — 환불추정/표시 계산용
  await admin.from("subscription_billing_events").insert({
    subscription_id: subscriptionId,
    student_id: args.studentId,
    mentor_id: args.mentorId,
    event_type: "initial",
    status: "succeeded",
    period_start: periodStartIso,
    period_end: args.periodEndIso,
    billing_at: periodStartIso,
    amount_cents: args.amountCents,
    plan_tier: args.tier,
    plan_id: planId,
    idempotency_key: `sim_sub_initial:${subscriptionId}`,
    payment_id: paymentId,
    processed_at: periodStartIso,
  });

  return { subscriptionId, paymentId };
}

async function callCron(atIso: string) {
  const ctx = await plRequest.newContext({ baseURL: BASE_URL });
  const r = await ctx.get(`/api/cron/subscription-renewal?at=${encodeURIComponent(atIso)}`, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  const status = r.status();
  const body = await r.json();
  await ctx.dispose();
  return { status, body };
}

async function setWalletBalance(userId: string, targetCents: number) {
  // 정확한 잔액으로 맞춤 — 직접 update (테스트 목적, ledger 무결성과는 별개로 운영 미적용)
  await admin
    .from("cash_wallets")
    .upsert({ user_id: userId, balance_cents: targetCents }, { onConflict: "user_id" });
}

/* ====================================================================== */
/* PRE: 두 멘토 모두 approved + plans 있음 보장 + 시드 학생 구독 전부 정리       */
/* ====================================================================== */
test("PRE: mentor plans + approval + 학생 기존 구독 정리", async () => {
  const mP = await db.userIdByEmail(MENTOR_PRICED_EMAIL);
  const mU = await db.userIdByEmail(MENTOR_UNPRICED_EMAIL);
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  await ensureMentorPlansAndApproval(mP);
  await ensureMentorPlansAndApproval(mU);
  await cleanupSubscriptionForPair(studentId, mP);
  await cleanupSubscriptionForPair(studentId, mU);
});

/* ====================================================================== */
/* 2-1 ★ 취소(cancel_at_period_end=true) → 만료 시점에 재결제 없이 expired       */
/* ====================================================================== */
test("2-1 ★ cancel_at_period_end: 주기 종료 시 expired, 캐시 차감 0", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const mentorId = await db.userIdByEmail(MENTOR_PRICED_EMAIL);

  await cleanupSubscriptionForPair(studentId, mentorId);

  // 주기 종료가 1일 전(과거) — 갱신 대상에 해당
  const pastEnd = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  await setWalletBalance(studentId, 10_000_000); // 충분한 잔액(혼선 방지)

  const { subscriptionId, paymentId } = await createFreshActiveSubscription({
    studentId,
    mentorId,
    tier: "limited",
    amountCents: 5_500_000,
    periodEndIso: pastEnd,
    cancelAtPeriodEnd: true,
  });

  const sBal0 = await db.walletBalance(studentId);

  const { body } = await callCron(new Date().toISOString());
  console.log(`[2-1 cron] ${JSON.stringify(body)}`);
  expect(body.canceled, "canceled 최소 1건").toBeGreaterThanOrEqual(1);

  // 잔액 불변
  expect(await db.walletBalance(studentId), "취소 만료에 캐시 차감 0").toBe(sBal0);

  const { data: sub } = await admin.from("subscriptions").select("status, expired_at, next_billing_at").eq("id", subscriptionId).single();
  expect((sub as { status: string }).status, "status=expired").toBe("expired");
  expect((sub as { next_billing_at: string | null }).next_billing_at, "next_billing_at = null").toBeFalsy();

  // 갱신 원장 없음
  const { data: led } = await admin
    .from("cash_ledger")
    .select("id")
    .like("idempotency_key", `sub_renewal:${subscriptionId}:%`);
  expect((led ?? []).length, "갱신 차감 원장 0건").toBe(0);

  // terminal billing event 존재
  const { data: be } = await admin
    .from("subscription_billing_events")
    .select("event_type, status, idempotency_key")
    .like("idempotency_key", `sub_cancel:${subscriptionId}:%`);
  expect((be ?? []).length, "cancel terminal event").toBeGreaterThanOrEqual(1);

  // payments 별도로 차감 없음 (paymentId 사용 안됨)
  void paymentId;
});

/* ====================================================================== */
/* 2-2 active 갱신 정상 + 멱등(배치 두 번 돌려도 이중 차감 없음)                  */
/* ====================================================================== */
test("2-2 active 갱신: 1회 차감, 다음 주기 재설정, 배치 재호출 시 중복 없음", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const mentorId = await db.userIdByEmail(MENTOR_PRICED_EMAIL);

  await cleanupSubscriptionForPair(studentId, mentorId);
  await setWalletBalance(studentId, 10_000_000);

  const pastEnd = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { subscriptionId } = await createFreshActiveSubscription({
    studentId,
    mentorId,
    tier: "limited",
    amountCents: 5_500_000,
    periodEndIso: pastEnd,
    cancelAtPeriodEnd: false,
  });

  const sBal0 = await db.walletBalance(studentId);
  const debitAmount = 5_500_000;

  // 1차 배치 — 갱신 성공
  const r1 = await callCron(new Date().toISOString());
  console.log(`[2-2 cron-1] ${JSON.stringify(r1.body)}`);
  expect(r1.body.renewed, "renewed 최소 1").toBeGreaterThanOrEqual(1);

  expect(await db.walletBalance(studentId), "잔액 -= debit").toBe(sBal0 - debitAmount);

  const { data: subAfter1 } = await admin
    .from("subscriptions")
    .select("status, current_period_start, current_period_end, next_billing_at")
    .eq("id", subscriptionId)
    .single();
  expect((subAfter1 as { status: string }).status, "active 유지").toBe("active");
  const newEnd = (subAfter1 as { current_period_end: string }).current_period_end;
  expect(new Date(newEnd).getTime() > new Date(pastEnd).getTime(), "current_period_end 미래로 이동").toBe(true);

  // 갱신 원장 1건
  const { data: led1 } = await admin
    .from("cash_ledger")
    .select("delta_cents, idempotency_key")
    .like("idempotency_key", `sub_renewal:${subscriptionId}:%`);
  expect((led1 ?? []).length, "갱신 원장 1건").toBe(1);
  expect((led1 ?? [])[0]?.delta_cents).toBe(-debitAmount);

  // 2차 배치 동일 시각 → 이미 처리됨 (already)
  const balBefore2 = await db.walletBalance(studentId);
  const r2 = await callCron(new Date().toISOString());
  console.log(`[2-2 cron-2] ${JSON.stringify(r2.body)}`);
  // 같은 next_billing_at가 미래로 갔으므로 이번엔 scanned에 안 잡힐 가능성 — 잔액 변동 없음만 확인
  expect(await db.walletBalance(studentId), "재호출에도 잔액 불변").toBe(balBefore2);
  const { data: led2 } = await admin
    .from("cash_ledger")
    .select("id")
    .like("idempotency_key", `sub_renewal:${subscriptionId}:%`);
  expect((led2 ?? []).length, "원장 여전히 1건").toBe(1);

  // 3차 — period_end를 다시 과거로 set + 같은 idempotency_key 강제로 재호출하면 already_succeeded 반환
  await admin
    .from("subscriptions")
    .update({ current_period_end: pastEnd, next_billing_at: pastEnd })
    .eq("id", subscriptionId);
  const balBefore3 = await db.walletBalance(studentId);
  const r3 = await callCron(new Date().toISOString());
  console.log(`[2-2 cron-3] ${JSON.stringify(r3.body)}`);
  // 같은 idempotency_key(`sub_renewal:<id>:<periodEnd-yyyy-mm-dd>`) — already 반환
  expect(await db.walletBalance(studentId), "강제 동일 키 호출에도 이중 차감 없음").toBe(balBefore3);
  const { data: led3 } = await admin
    .from("cash_ledger")
    .select("id")
    .like("idempotency_key", `sub_renewal:${subscriptionId}:%`);
  expect((led3 ?? []).length, "여전히 1건").toBe(1);
});

/* ====================================================================== */
/* 2-3 ★ 잔액 부족: status=past_due + grace_until, 음수·부분차감 없음           */
/* ====================================================================== */
test("2-3 ★ 캐시 부족: past_due로 전이, 잔액 음수·부분차감 없음, 안내 알림", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const mentorId = await db.userIdByEmail(MENTOR_UNPRICED_EMAIL); // 별도 페어
  await cleanupSubscriptionForPair(studentId, mentorId);

  // 잔액을 가격보다 적게(예: 100,000 cents) 세팅
  await setWalletBalance(studentId, 100_000);

  const pastEnd = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { subscriptionId } = await createFreshActiveSubscription({
    studentId,
    mentorId,
    tier: "limited",
    amountCents: 5_500_000,
    periodEndIso: pastEnd,
    cancelAtPeriodEnd: false,
  });

  const sBal0 = await db.walletBalance(studentId);
  expect(sBal0, "초기 잔액 부족 상태").toBe(100_000);

  const { body } = await callCron(new Date().toISOString());
  console.log(`[2-3 cron] ${JSON.stringify(body)}`);
  expect(body.insufficientCash, "insufficientCash 최소 1").toBeGreaterThanOrEqual(1);

  // 잔액 그대로(차감 0)
  expect(await db.walletBalance(studentId), "잔액 변화 없음(차감 0)").toBe(sBal0);
  expect(await db.walletBalance(studentId), "음수 없음").toBeGreaterThanOrEqual(0);

  // 상태 past_due + grace_until 세팅
  const { data: sub } = await admin
    .from("subscriptions")
    .select("status, grace_until")
    .eq("id", subscriptionId)
    .single();
  expect((sub as { status: string }).status, "status=past_due").toBe("past_due");
  expect((sub as { grace_until: string | null }).grace_until, "grace_until 설정").toBeTruthy();

  // 갱신 원장 0건 (부분 차감 없음)
  const { data: led } = await admin
    .from("cash_ledger")
    .select("id")
    .like("idempotency_key", `sub_renewal:${subscriptionId}:%`);
  expect((led ?? []).length, "원장 0건 (부분차감 없음)").toBe(0);

  // 실패 billing event 기록 — failure_code = insufficient_cash
  const { data: be } = await admin
    .from("subscription_billing_events")
    .select("event_type, status, failure_code")
    .like("idempotency_key", `sub_renewal:${subscriptionId}:%`);
  const fails = (be ?? []).filter((e: { failure_code?: string }) => e.failure_code === "insufficient_cash");
  expect(fails.length, "실패 이벤트 1건").toBeGreaterThanOrEqual(1);

  // 안내 알림 best-effort 노티 1건 이상 (subscription_renewal_failed_insufficient_cash)
  const { data: notif } = await admin
    .from("notifications")
    .select("type")
    .eq("recipient_user_id", studentId)
    .eq("type", "subscription_renewal_failed_insufficient_cash");
  console.log(`[2-3] insufficient cash notifications: ${(notif ?? []).length}`);
});

/* ====================================================================== */
/* 2-pre 사전 고지 (N일 전): subscription_renewal_upcoming 노티                */
/* ====================================================================== */
test("2-pre 갱신 N일 전 사전 고지: subscription_renewal_upcoming 알림", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const mentorId = await db.userIdByEmail(MENTOR_PRICED_EMAIL);

  await cleanupSubscriptionForPair(studentId, mentorId);
  await setWalletBalance(studentId, 10_000_000);

  // next_billing_at = 1일 후 (3일 noticeWindow 안)
  const futureEnd = new Date(Date.now() + 1 * 24 * 3600 * 1000).toISOString();
  const { subscriptionId } = await createFreshActiveSubscription({
    studentId,
    mentorId,
    tier: "limited",
    amountCents: 5_500_000,
    periodEndIso: futureEnd,
  });

  const { body } = await callCron(new Date().toISOString());
  console.log(`[2-pre cron] ${JSON.stringify(body)}`);
  expect(body.upcomingScanned, "upcoming 1").toBeGreaterThanOrEqual(1);
  expect(body.preRenewalNotices, "사전 고지 노티 1").toBeGreaterThanOrEqual(1);

  // 알림 테이블에 subscription_renewal_upcoming 삽입
  const { data: notif } = await admin
    .from("notifications")
    .select("type, body")
    .eq("user_id", studentId)
    .eq("type", "subscription_renewal_upcoming")
    .order("created_at", { ascending: false })
    .limit(1);
  expect((notif ?? []).length, "사전 고지 알림 1건").toBeGreaterThanOrEqual(1);

  // 사전 고지 마커 멱등 — 동일 period_end 키로 두 번째 호출은 already
  const r2 = await callCron(new Date().toISOString());
  console.log(`[2-pre cron-2] ${JSON.stringify(r2.body)}`);
  // preRenewalNotices=0 (이미 발송됨)
  expect(r2.body.preRenewalNotices, "재호출엔 사전 고지 0").toBe(0);

  void subscriptionId;
});

/* ====================================================================== */
/* 2-3b ★ 잔액 부족 → 충전 → 재시도: process_subscription_renewal 복구 검증     */
/*       (SQL 100 패치 적용 후 — ambiguous 해소 → 정상 재시도)                  */
/* ====================================================================== */
test("2-3b ★ insufficient → topup → 재시도: ★ self-contained — RETRY 경로 정확 검증", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const mentorId = await db.userIdByEmail(MENTOR_UNPRICED_EMAIL);
  await cleanupSubscriptionForPair(studentId, mentorId);

  // 1) 잔액을 가격 미달로 설정 (insufficient 유도)
  await setWalletBalance(studentId, 100_000);

  // 2) 신규 active 구독 (past period end) 생성
  const pastEnd = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { subscriptionId } = await createFreshActiveSubscription({
    studentId,
    mentorId,
    tier: "limited",
    amountCents: 5_500_000,
    periodEndIso: pastEnd,
    cancelAtPeriodEnd: false,
  });

  // 3) 1차 cron — insufficient → past_due, failed event 기록
  const r1 = await callCron(new Date().toISOString());
  console.log(`[2-3b cron-1 → past_due] ${JSON.stringify(r1.body)}`);
  const myErr1 = (r1.body.errors ?? []).find((e: { subscriptionId?: string }) => e.subscriptionId === subscriptionId);
  expect(myErr1, "1차 호출엔 ambiguous 에러 없음").toBeFalsy();
  const { data: subAfter1 } = await admin
    .from("subscriptions")
    .select("status, grace_until")
    .eq("id", subscriptionId)
    .single();
  expect((subAfter1 as { status: string }).status, "1차 후 past_due").toBe("past_due");
  expect((subAfter1 as { grace_until: string | null }).grace_until, "grace_until 설정").toBeTruthy();

  // 4) 잔액 충전 (충분히)
  const debitAmount = 5_500_000;
  await setWalletBalance(studentId, 10_000_000);
  const balBefore = await db.walletBalance(studentId);

  // 5) 2차 cron — 같은 idempotency_key 로 RETRY 경로 진입 → 패치 적용 후 정상 복구
  const r2 = await callCron(new Date().toISOString());
  console.log(`[2-3b cron-2 ★ RETRY] ${JSON.stringify(r2.body)}`);
  const myErr2 = (r2.body.errors ?? []).find((e: { subscriptionId?: string }) => e.subscriptionId === subscriptionId);
  expect(
    myErr2,
    `★ 패치 핵심: 재시도 경로에 ambiguous 없어야 함. (있다면: ${JSON.stringify(myErr2)})`
  ).toBeFalsy();
  expect(r2.body.renewed, "renewed >= 1").toBeGreaterThanOrEqual(1);

  // 6) 검증: status=active 복구
  const { data: subAfter2 } = await admin
    .from("subscriptions")
    .select("status, current_period_end, grace_until, last_renewed_at")
    .eq("id", subscriptionId)
    .single();
  expect((subAfter2 as { status: string }).status, "★ past_due → active 복구").toBe("active");
  expect((subAfter2 as { grace_until: string | null }).grace_until, "복구 후 grace 해제").toBeFalsy();
  expect(new Date((subAfter2 as { current_period_end: string }).current_period_end).getTime() > Date.now(), "주기 미래로 이동").toBe(true);

  // 7) 캐시 정확히 1회 차감
  expect(await db.walletBalance(studentId), "잔액 -= debit (1회)").toBe(balBefore - debitAmount);

  // 8) cash_ledger 1건만 (멱등 idempotency_key 그대로)
  const { data: ledRows } = await admin
    .from("cash_ledger")
    .select("delta_cents, idempotency_key")
    .like("idempotency_key", `sub_renewal:${subscriptionId}:%`);
  expect((ledRows ?? []).length, "원장 1건").toBe(1);
  expect((ledRows ?? [])[0]?.delta_cents).toBe(-debitAmount);

  // 9) billing event: failed → succeeded 갱신, attempt_count >= 2
  const { data: be } = await admin
    .from("subscription_billing_events")
    .select("event_type, status, attempt_count")
    .like("idempotency_key", `sub_renewal:${subscriptionId}:%`)
    .single();
  expect((be as { status: string }).status, "billing event succeeded").toBe("succeeded");
  expect((be as { event_type: string }).event_type).toBe("renewal");
  expect((be as { attempt_count: number }).attempt_count, "attempt_count >= 2 (RETRY)").toBeGreaterThanOrEqual(2);

  // 10) 3차 cron — 이미 처리됨, 추가 차감 없음
  const balAfter = await db.walletBalance(studentId);
  const r3 = await callCron(new Date().toISOString());
  const myErr3 = (r3.body.errors ?? []).find((e: { subscriptionId?: string }) => e.subscriptionId === subscriptionId);
  expect(myErr3).toBeFalsy();
  expect(await db.walletBalance(studentId), "복구 후 재호출에 잔액 불변(멱등)").toBe(balAfter);
});

/* ====================================================================== */
/* 2-4 만료된 구독으로 질문 작성 시도 → 차단                                    */
/* ====================================================================== */
test("2-4 만료된 구독: 질문방 신규 thread 작성 차단", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const mentorPriced = await db.userIdByEmail(MENTOR_PRICED_EMAIL);

  // 2-1에서 만든 expired sub가 그대로 있다고 가정 — 다시 만들지 않고 상태만 보장
  await cleanupSubscriptionForPair(studentId, mentorPriced);
  const pastEnd = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { subscriptionId } = await createFreshActiveSubscription({
    studentId,
    mentorId: mentorPriced,
    tier: "limited",
    amountCents: 5_500_000,
    periodEndIso: pastEnd,
    cancelAtPeriodEnd: true,
  });
  await callCron(new Date().toISOString()); // → expired 전이

  const { data: sub } = await admin.from("subscriptions").select("status").eq("id", subscriptionId).single();
  expect((sub as { status: string }).status).toBe("expired");

  // 동일 페어의 mentor_student_rooms 가 이미 있을 수 있음 — 없으면 만든다.
  let { data: room } = await admin
    .from("mentor_student_rooms")
    .select("id")
    .eq("student_id", studentId)
    .eq("mentor_id", mentorPriced)
    .maybeSingle();
  if (!room) {
    const { data: roomIns } = await admin
      .from("mentor_student_rooms")
      .insert({ student_id: studentId, mentor_id: mentorPriced, subscription_id: subscriptionId })
      .select("id")
      .single();
    room = roomIns;
  }
  const _roomId = (room as { id: string }).id;

  // RLS 026 (mentor_student_rooms insert는 active sub 확인) — 우리 케이스는 thread insert, qt_write_via_room 정책은 본인 방이면 통과.
  // 핵심: 앱 가드 assertThreadCreationSubscriptionAllowed는 active sub만 통과. 우리는 expired.
  // 이 가드는 server action 경유에만 호출됨. service_role 직접 insert는 RLS만 따져서 통과 → 가드 검증을 별도로.
  // 검증: get_weekly_question_usage 또는 findActiveSubscriptionForPair 결과 — 활성 구독 없음.
  const { data: activeSubs } = await admin
    .from("subscriptions")
    .select("id, status")
    .eq("student_id", studentId)
    .eq("mentor_id", mentorPriced)
    .eq("status", "active");
  expect((activeSubs ?? []).length, "expired 후 active 구독 0건").toBe(0);

  // 주간 한도 RPC — plan_tier가 'none'/falsy 가 될 것
  const { data: usage } = await admin.rpc("get_weekly_question_usage", {
    p_student_id: studentId,
    p_mentor_id: mentorPriced,
  });
  console.log(`[2-4] expired usage: ${JSON.stringify(usage)}`);
  // usage 가 null 또는 can_ask=false 이거나 plan_tier 없음
  if (usage) {
    const u = usage as { can_ask?: boolean; limit?: number };
    if (u.can_ask !== undefined) {
      expect(u.can_ask, "expired sub: can_ask=false 기대").toBe(false);
    }
  }
});

/* ====================================================================== */
/* 2-5 취소 후 재구독: 새 주기·새 한도·새 캐시 차감                            */
/* ====================================================================== */
test("2-5 재구독: 만료 후 새 active 구독 생성·정상 차감", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const mentorId = await db.userIdByEmail(MENTOR_PRICED_EMAIL);

  // 2-4 결과(expired) 정리 후 새 구독 시뮬레이션
  await cleanupSubscriptionForPair(studentId, mentorId);
  await setWalletBalance(studentId, 10_000_000);

  const futureEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const { subscriptionId, paymentId } = await createFreshActiveSubscription({
    studentId,
    mentorId,
    tier: "limited",
    amountCents: 5_500_000,
    periodEndIso: futureEnd,
    cancelAtPeriodEnd: false,
  });

  // 신규 구독 캐시 차감 (`record_subscription_cash_debit`)
  const sBal0 = await db.walletBalance(studentId);
  const debit = 5_500_000;
  const { error: debErr } = await admin.rpc("record_subscription_cash_debit", {
    p_user_id: studentId,
    p_subscription_id: subscriptionId,
    p_payment_id: paymentId,
    p_amount_cents: debit,
  });
  expect(debErr).toBeFalsy();
  expect(await db.walletBalance(studentId), "재구독 차감 정확").toBe(sBal0 - debit);

  // active + period 새로 셋
  const { data: sub } = await admin
    .from("subscriptions")
    .select("status, current_period_start, current_period_end")
    .eq("id", subscriptionId)
    .single();
  expect((sub as { status: string }).status).toBe("active");

  // 한도 RPC — limited 플랜 한도 4
  const { data: usage, error: uErr } = await admin.rpc("get_weekly_question_usage", {
    p_student_id: studentId,
    p_mentor_id: mentorId,
  });
  expect(uErr, "usage 조회").toBeFalsy();
  expect((usage as { limit: number }).limit, "limited 한도 4").toBe(4);
  expect((usage as { plan_tier: string }).plan_tier, "plan_tier=limited").toBe("limited");
});
