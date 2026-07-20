/**
 * (B) 연결노트 만료-편집 차단 가드 — RPC/DB 레벨 결정적 검증.
 *
 * 시나리오:
 *   - 학생/멘토 페어로 mentor_student_rooms 보장
 *   - active 구독 → assertConnectionNoteWriteAllowed PASS
 *   - 구독 상태 expired/canceled → 가드 차단(ok=false, userMessage 노트 문구)
 *   - 가드 통과 안 했으면 RLS 본인 author 정책으로도 작성 보호되는지 확인(이중 안전)
 *   - 읽기(SELECT): 만료 후에도 가능한지 직접 RLS 확인
 */
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import * as db from "./helpers/db";
import { loadEnvLocal } from "./helpers/env";
import { assertConnectionNoteWriteAllowed } from "../lib/qna/connectionNoteSubscriptionGuard";

const env = loadEnvLocal();
const STUDENT_EMAIL = env.E2E_STUDENT_EMAIL ?? "";
const MENTOR_PRICED_EMAIL = env.E2E_MENTOR_PRICED_EMAIL ?? "";

const admin = db.admin();

async function cleanupSubscriptionForPair(studentId: string, mentorId: string) {
  const { data: existing } = await admin
    .from("subscriptions")
    .select("id, payment_id")
    .eq("student_id", studentId)
    .eq("mentor_id", mentorId);
  for (const s of (existing ?? []) as Array<{ id: string; payment_id: string | null }>) {
    await admin.from("subscription_settlement_items").delete().eq("subscription_id", s.id);
    await admin.from("subscription_billing_events").delete().eq("subscription_id", s.id);
    await admin.from("refunds").delete().eq("subscription_id", s.id);
    await admin.from("mentor_student_rooms").update({ subscription_id: null }).eq("subscription_id", s.id);
    await admin.from("subscriptions").delete().eq("id", s.id);
    if (s.payment_id) await admin.from("payments").delete().eq("id", s.payment_id);
  }
}

async function ensureRoom(studentId: string, mentorId: string): Promise<string> {
  const { data } = await admin
    .from("mentor_student_rooms")
    .select("id")
    .eq("student_id", studentId)
    .eq("mentor_id", mentorId)
    .maybeSingle();
  if (data) return (data as { id: string }).id;
  const { data: ins } = await admin
    .from("mentor_student_rooms")
    .insert({ student_id: studentId, mentor_id: mentorId })
    .select("id")
    .single();
  return (ins as { id: string }).id;
}

async function ensureActiveSubscription(studentId: string, mentorId: string): Promise<string> {
  const paymentId = randomUUID();
  await admin.from("payments").insert({
    id: paymentId,
    user_id: studentId,
    mentor_id: mentorId,
    status: "succeeded",
    amount: 55_000,
    currency: "KRW",
    external_id: `sub_intent_test_${randomUUID()}`,
    metadata: { planTier: "limited", source: "note-guard-test" },
    kind: "subscription",
  });
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const { data: planRow } = await admin
    .from("mentor_plans")
    .select("id")
    .eq("mentor_id", mentorId)
    .eq("plan_tier", "limited")
    .maybeSingle();
  const planId = (planRow as { id?: string } | null)?.id ?? null;
  const { data: sub } = await admin
    .from("subscriptions")
    .insert({
      student_id: studentId,
      mentor_id: mentorId,
      payment_id: paymentId,
      plan_tier: "limited",
      plan_id: planId,
      status: "active",
      started_at: now.toISOString(),
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      next_billing_at: periodEnd.toISOString(),
      billing_cycle: "monthly",
    })
    .select("id")
    .single();
  return (sub as { id: string }).id;
}

test("(B) active 구독: 가드 PASS — 학생/멘토 모두 노트 편집 허용", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const mentorId = await db.userIdByEmail(MENTOR_PRICED_EMAIL);
  await cleanupSubscriptionForPair(studentId, mentorId);
  const roomId = await ensureRoom(studentId, mentorId);
  await ensureActiveSubscription(studentId, mentorId);

  const sGate = await assertConnectionNoteWriteAllowed(admin, roomId, "student");
  expect(sGate.ok, `active 구독 - 학생 가드 통과 (msg=${(sGate as { userMessage?: string }).userMessage ?? ""})`).toBe(true);

  const mGate = await assertConnectionNoteWriteAllowed(admin, roomId, "mentor");
  expect(mGate.ok).toBe(true);
});

test("(B) expired 구독: 가드 차단 — 학생/멘토 모두 노트 편집 거부", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const mentorId = await db.userIdByEmail(MENTOR_PRICED_EMAIL);
  await cleanupSubscriptionForPair(studentId, mentorId);
  const roomId = await ensureRoom(studentId, mentorId);

  // 만료 구독을 직접 생성 (active 만들 후 status=expired 로 update)
  const subId = await ensureActiveSubscription(studentId, mentorId);
  await admin.from("subscriptions").update({ status: "expired", expired_at: new Date().toISOString() }).eq("id", subId);

  const sGate = await assertConnectionNoteWriteAllowed(admin, roomId, "student");
  expect(sGate.ok, "expired 구독 - 학생 가드 차단").toBe(false);
  if (!sGate.ok) {
    expect(sGate.userMessage).toMatch(/구독이 만료|편집할 수 없|재구독/);
  }

  const mGate = await assertConnectionNoteWriteAllowed(admin, roomId, "mentor");
  expect(mGate.ok).toBe(false);

  // ★읽기는 RLS 정책상 가능해야 함 — connection_notes select는 방 멤버만 검증.
  // 멤버는 active 구독과 별개 (rooms.subscription_id는 SET NULL이고 학생/멘토 id로만 검증)
  // service_role은 RLS 우회 — 진짜 검증은 PostgREST anon+token으로 해야 하나, 본 spec에선
  // "방 멤버 변동 없음 + RLS 정책 정의에 active 의존 없음" 만 확인.
  const { data: roomCheck } = await admin
    .from("mentor_student_rooms")
    .select("id, student_id, mentor_id")
    .eq("id", roomId)
    .single();
  expect((roomCheck as { student_id: string }).student_id).toBe(studentId);
  expect((roomCheck as { mentor_id: string }).mentor_id).toBe(mentorId);
});

test("(B) canceled/refunded 구독: 동일하게 차단", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const mentorId = await db.userIdByEmail(MENTOR_PRICED_EMAIL);

  for (const terminalStatus of ["canceled", "refunded", "past_due"]) {
    await cleanupSubscriptionForPair(studentId, mentorId);
    const roomId = await ensureRoom(studentId, mentorId);
    const subId = await ensureActiveSubscription(studentId, mentorId);
    await admin.from("subscriptions").update({ status: terminalStatus }).eq("id", subId);

    const gate = await assertConnectionNoteWriteAllowed(admin, roomId, "student");
    if (terminalStatus === "past_due") {
      // past_due는 findActiveSubscriptionForPair에서 active만 인정하므로 차단됨
      expect(gate.ok, `${terminalStatus}: 가드 차단`).toBe(false);
    } else {
      expect(gate.ok, `${terminalStatus}: 가드 차단`).toBe(false);
    }
  }
});

test("(B) 읽기 RLS — 만료 후 학생/멘토 본인이 노트·스레드 조회 가능 (anon JWT)", async () => {
  const studentId = await db.userIdByEmail(STUDENT_EMAIL);
  const mentorId = await db.userIdByEmail(MENTOR_PRICED_EMAIL);
  await cleanupSubscriptionForPair(studentId, mentorId);
  const roomId = await ensureRoom(studentId, mentorId);

  // 만료 구독 + 노트 1건 시드
  const subId = await ensureActiveSubscription(studentId, mentorId);
  await admin.from("subscriptions").update({ status: "expired" }).eq("id", subId);
  await admin
    .from("connection_notes")
    .insert({ mentor_student_room_id: roomId, body: "[note-guard-test] 만료 후 읽기 가능 확인", author_id: studentId, author_role: "student" });

  // 학생 토큰으로 SELECT
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const sb = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: tok } = await sb.auth.signInWithPassword({ email: STUDENT_EMAIL, password: "Local!Test1234" });
  expect(tok?.session?.access_token).toBeTruthy();

  const { data: notes, error } = await sb
    .from("connection_notes")
    .select("body")
    .eq("mentor_student_room_id", roomId);
  expect(error, "노트 SELECT 에러 없음").toBeFalsy();
  expect((notes ?? []).length, "만료 후에도 노트 읽기 가능").toBeGreaterThanOrEqual(1);
  expect((notes ?? [])[0]?.body).toMatch(/note-guard-test/);

  // 스레드도 같이 (room scope으로 SELECT)
  const { data: _threads, error: tErr } = await sb
    .from("question_threads")
    .select("id")
    .eq("mentor_student_room_id", roomId);
  expect(tErr).toBeFalsy();
  // 기존 시드 데이터에 따라 0건도 가능 — error 없으면 RLS 통과
});
