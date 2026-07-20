import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { computeProratedRefundEstimate } from "@/lib/subscribe/subscriptionRefundProration";
import { insertNotificationBestEffort } from "@/lib/notifications/notificationInsert";
import { refreshSubscriptionSettlementItemsBestEffort } from "@/lib/mentor/subscriptionSettlementItems";
import {
  MENTOR_TERMINATION_NOTICE_DAYS,
  addDaysIso,
  canRequestNormalRest,
  clampPauseDays,
  mentorActivityState,
} from "@/lib/mentor/mentorActivity";

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof createServiceRoleClient>;

export type MentorActivityResult = {
  ok: boolean;
  error?: string;
  summary?: Record<string, unknown>;
};

const ACTIVE_SUB_STATUSES = ["active", "past_due"] as const;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}

async function loadMentorProfile(admin: Admin, mentorId: string): Promise<Row | null> {
  const { data } = await admin
    .from("mentor_profiles")
    .select(
      "user_id, activity_status, termination_requested_at, termination_effective_at, pause_started_at, pause_until, pause_reason, last_pause_at, abandonment_flagged_at"
    )
    .eq("user_id", mentorId)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

async function activeSubscriptionsForMentor(admin: Admin, mentorId: string): Promise<Row[]> {
  const { data } = await admin
    .from("subscriptions")
    .select(
      "id, student_id, mentor_id, payment_id, status, current_period_start, current_period_end, next_billing_at"
    )
    .eq("mentor_id", mentorId)
    .in("status", ACTIVE_SUB_STATUSES as unknown as string[]);
  return (data as Row[] | null) ?? [];
}

async function latestSucceededBillingEvent(admin: Admin, subscriptionId: string): Promise<Row | null> {
  const { data } = await admin
    .from("subscription_billing_events")
    .select("id, amount_cents, payment_id, period_start, period_end, billing_at, status, event_type")
    .eq("subscription_id", subscriptionId)
    .eq("status", "succeeded")
    .in("event_type", ["initial", "renewal"])
    .order("billing_at", { ascending: false })
    .limit(1);
  const rows = (data as Row[] | null) ?? [];
  return rows[0] ?? null;
}

async function logEvent(
  admin: Admin,
  mentorId: string,
  eventType: string,
  reason: string | null,
  detail: Record<string, unknown>,
  status: "logged" | "pending_review" = "logged"
): Promise<void> {
  await admin.from("mentor_activity_events").insert({
    mentor_id: mentorId,
    event_type: eventType,
    reason,
    detail,
    status,
  });
}

async function deactivateMentorPlans(admin: Admin, mentorId: string): Promise<void> {
  await admin.from("mentor_plans").update({ is_active: false }).eq("mentor_id", mentorId);
}

async function reactivateMentorPlans(admin: Admin, mentorId: string): Promise<void> {
  await admin.from("mentor_plans").update({ is_active: true }).eq("mentor_id", mentorId);
}

/** 완전 종료 시작 — 즉시 신규 구독 차단 + 2주 공지 + 구독자 알림. */
export async function startMentorTermination(
  admin: Admin,
  mentorId: string,
  now: Date = new Date()
): Promise<MentorActivityResult> {
  const profile = await loadMentorProfile(admin, mentorId);
  if (!profile) return { ok: false, error: "멘토 프로필을 찾을 수 없습니다." };
  const state = mentorActivityState(profile, now);
  if (state === "terminating" || state === "terminated") {
    return { ok: false, error: "이미 활동 종료 절차가 진행 중입니다." };
  }

  const effectiveAt = addDaysIso(now.toISOString(), MENTOR_TERMINATION_NOTICE_DAYS, now);
  const { error } = await admin
    .from("mentor_profiles")
    .update({
      activity_status: "terminating",
      termination_requested_at: now.toISOString(),
      termination_effective_at: effectiveAt,
    })
    .eq("user_id", mentorId);
  if (error) return { ok: false, error: error.message };

  await deactivateMentorPlans(admin, mentorId);

  const subs = await activeSubscriptionsForMentor(admin, mentorId);
  for (const sub of subs) {
    const studentId = str(sub.student_id);
    if (!studentId) continue;
    await insertNotificationBestEffort({
      recipientUserId: studentId,
      type: "mentor_termination_notice",
      title: "멘토 활동 종료 예정",
      body: `구독 중인 멘토가 활동을 종료합니다. 2주 후(${effectiveAt.slice(0, 10)}) 구독이 정리되며 남은 기간은 환불됩니다. 그때까지는 정상 이용할 수 있어요.`,
      link: "/subscriptions",
      metadata: { mentor_id: mentorId, effective_at: effectiveAt },
    });
  }

  await logEvent(admin, mentorId, "termination_requested", null, {
    effective_at: effectiveAt,
    notified_subscribers: subs.length,
  });

  return { ok: true, summary: { effectiveAt, notifiedSubscribers: subs.length } };
}

/**
 * 완전 종료 확정 — 유예(2주) 종료 후 호출. 잔여 100% 환불 생성 + 구독 정리.
 * (배치/관리자 트리거. now 를 주입해 검증 시 backdate 가능)
 */
export async function finalizeMentorTermination(
  admin: Admin,
  mentorId: string,
  now: Date = new Date()
): Promise<MentorActivityResult> {
  const profile = await loadMentorProfile(admin, mentorId);
  if (!profile) return { ok: false, error: "멘토 프로필을 찾을 수 없습니다." };
  const effectiveAt = str(profile.termination_effective_at);
  if (!effectiveAt) return { ok: false, error: "종료 예정 시각이 없습니다. 먼저 활동 종료를 신청해야 합니다." };
  if (new Date(effectiveAt).getTime() > now.getTime()) {
    return { ok: false, error: "아직 2주 유예 기간이 끝나지 않았습니다." };
  }

  const subs = await activeSubscriptionsForMentor(admin, mentorId);
  let refundsCreated = 0;
  for (const sub of subs) {
    const subscriptionId = str(sub.id);
    const studentId = str(sub.student_id);
    if (!subscriptionId || !studentId) continue;

    // 중복 방지: 이미 pending 환불 있으면 건너뜀
    const { data: existing } = await admin
      .from("refunds")
      .select("id")
      .eq("subscription_id", subscriptionId)
      .eq("status", "pending")
      .limit(1);
    if ((existing as Row[] | null)?.length) {
      // 그래도 구독 정리는 진행
      await admin
        .from("subscriptions")
        .update({ cancel_at_period_end: true, status: "canceled", canceled_at: now.toISOString() })
        .eq("id", subscriptionId);
      continue;
    }

    const billing = await latestSucceededBillingEvent(admin, subscriptionId);
    const periodStart = str(sub.current_period_start) ?? str(billing?.period_start);
    const periodEnd = str(sub.current_period_end) ?? str(billing?.period_end);
    const amountCents = num(billing?.amount_cents);

    // 멘토 사유 종료 → 잔여 일할 100%(학원법과 무관, 학생 무귀책).
    const estimate = computeProratedRefundEstimate({
      amountCents,
      periodStartIso: periodStart,
      periodEndIso: periodEnd,
      now,
      mode: "mentor_suspended",
    });

    const paymentId = str(billing?.payment_id) ?? str(sub.payment_id);
    // 정본 연결: 이 환불이 대응하는 current billing event(id)를 기록한다(150 FK).
    const billingEventId = str(billing?.id) ?? str(sub.last_billing_event_id);
    if (estimate.amountCents > 0) {
      const { error: insErr } = await admin.from("refunds").insert({
        user_id: studentId,
        amount_cents: estimate.amountCents,
        status: "pending",
        payment_id: paymentId,
        subscription_id: subscriptionId,
        billing_event_id: billingEventId,
        request_type: "subscription_mentor_suspended",
        reason: "멘토 활동 종료에 따른 잔여기간 환불(잔여 100%)",
      });
      if (!insErr) {
        refundsCreated += 1;
        await insertNotificationBestEffort({
          recipientUserId: studentId,
          type: "mentor_termination_refund",
          title: "멘토 활동 종료 — 환불 접수",
          body: `멘토 활동 종료로 남은 기간 환불(${estimate.amountCents.toLocaleString("ko-KR")}캐시)이 접수되었습니다. 관리자 검토 후 처리됩니다.`,
          link: "/support/refunds",
          metadata: { mentor_id: mentorId, subscription_id: subscriptionId },
        });
      }
    }

    await admin
      .from("subscriptions")
      .update({ cancel_at_period_end: true, status: "canceled", canceled_at: now.toISOString() })
      .eq("id", subscriptionId);
  }

  await admin.from("mentor_profiles").update({ activity_status: "terminated" }).eq("user_id", mentorId);
  await deactivateMentorPlans(admin, mentorId);
  await logEvent(admin, mentorId, "termination_finalized", null, {
    refunds_created: refundsCreated,
    subscriptions: subs.length,
  });

  // 환불 pending → 정산 보류 동기화
  await refreshSubscriptionSettlementItemsBestEffort();

  return { ok: true, summary: { refundsCreated, subscriptions: subs.length } };
}

/** 일시 중단 시작 — 최대 1주, 쉰 일수만큼 구독 기간 연장, 학생 알림. */
export async function startMentorPause(
  admin: Admin,
  mentorId: string,
  daysRaw: number,
  reason: "rest" | "illness",
  now: Date = new Date()
): Promise<MentorActivityResult> {
  const profile = await loadMentorProfile(admin, mentorId);
  if (!profile) return { ok: false, error: "멘토 프로필을 찾을 수 없습니다." };
  const state = mentorActivityState(profile, now);
  if (state !== "active") {
    return { ok: false, error: "이미 일시 중단 또는 활동 종료 상태입니다." };
  }

  if (reason === "rest" && !canRequestNormalRest(str(profile.last_pause_at), now)) {
    return {
      ok: false,
      error:
        "일반 휴식은 6개월에 1회만 가능합니다. 질병 등 불가피한 사유라면 '질병' 사유로 신청해 주세요(관리자 확인).",
    };
  }

  const days = clampPauseDays(daysRaw);
  const pauseUntil = addDaysIso(now.toISOString(), days, now);

  const patch: Record<string, unknown> = {
    activity_status: "paused",
    pause_started_at: now.toISOString(),
    pause_until: pauseUntil,
    pause_reason: reason,
  };
  if (reason === "rest") patch.last_pause_at = now.toISOString();

  const { error } = await admin.from("mentor_profiles").update(patch).eq("user_id", mentorId);
  if (error) return { ok: false, error: error.message };

  // 쉰 일수만큼 구독 기간 연장(과금 보호)
  const subs = await activeSubscriptionsForMentor(admin, mentorId);
  for (const sub of subs) {
    const subscriptionId = str(sub.id);
    const studentId = str(sub.student_id);
    if (!subscriptionId) continue;
    const newPeriodEnd = addDaysIso(str(sub.current_period_end), days, now);
    const newNextBilling = sub.next_billing_at ? addDaysIso(str(sub.next_billing_at), days, now) : newPeriodEnd;
    await admin
      .from("subscriptions")
      .update({ current_period_end: newPeriodEnd, next_billing_at: newNextBilling })
      .eq("id", subscriptionId);
    if (studentId) {
      await insertNotificationBestEffort({
        recipientUserId: studentId,
        type: "mentor_pause_notice",
        title: "멘토 일시 휴식 안내",
        body: `구독 중인 멘토가 ${pauseUntil.slice(0, 10)}까지 일시 휴식합니다. 쉰 기간만큼 구독 기간이 자동 연장됩니다.`,
        link: "/subscriptions",
        metadata: { mentor_id: mentorId, pause_until: pauseUntil, extended_days: days },
      });
    }
  }

  await logEvent(
    admin,
    mentorId,
    "pause_started",
    reason,
    { pause_until: pauseUntil, days, subscriptions_extended: subs.length },
    reason === "illness" ? "pending_review" : "logged"
  );

  return { ok: true, summary: { pauseUntil, days, subscriptionsExtended: subs.length } };
}

/** 멘토 조기 복귀(또는 자동 복귀 확정). */
export async function resumeMentorActivity(
  admin: Admin,
  mentorId: string,
  now: Date = new Date()
): Promise<MentorActivityResult> {
  const profile = await loadMentorProfile(admin, mentorId);
  if (!profile) return { ok: false, error: "멘토 프로필을 찾을 수 없습니다." };
  if (String(profile.activity_status ?? "") !== "paused") {
    return { ok: false, error: "일시 중단 상태가 아닙니다." };
  }
  const { error } = await admin
    .from("mentor_profiles")
    .update({ activity_status: "active", pause_until: null })
    .eq("user_id", mentorId);
  if (error) return { ok: false, error: error.message };
  await reactivateMentorPlans(admin, mentorId);
  await logEvent(admin, mentorId, "pause_resumed", null, {});
  return { ok: true };
}

/**
 * 무단 이탈 처리 — 즉시 떠남/즉시 종료 요청.
 * ★자동 0 처리 금지: 정산을 "보류(hold)"로 잠그고 관리자 검토 큐에 올린다.
 */
export async function flagMentorAbandonment(
  admin: Admin,
  mentorId: string,
  reason: string,
  now: Date = new Date()
): Promise<MentorActivityResult> {
  const profile = await loadMentorProfile(admin, mentorId);
  if (!profile) return { ok: false, error: "멘토 프로필을 찾을 수 없습니다." };

  await admin
    .from("mentor_profiles")
    .update({ activity_status: "terminated", abandonment_flagged_at: now.toISOString() })
    .eq("user_id", mentorId);
  await deactivateMentorPlans(admin, mentorId);

  // 정산 보류 — 자동 0 처리 금지. 먼저 최신화한 뒤 pending 항목을 hold 로 잠근다.
  await refreshSubscriptionSettlementItemsBestEffort();
  const { data: held, error: holdErr } = await admin
    .from("subscription_settlement_items")
    .update({ status: "hold", hold_reason: "mentor_abandonment_suspected" })
    .eq("mentor_id", mentorId)
    .eq("status", "pending")
    .select("id");

  await logEvent(
    admin,
    mentorId,
    "abandonment_suspected",
    reason,
    { settlement_items_held: (held as Row[] | null)?.length ?? 0, hold_error: holdErr?.message ?? null },
    "pending_review"
  );

  return {
    ok: true,
    summary: { settlementItemsHeld: (held as Row[] | null)?.length ?? 0 },
  };
}

/** 신규 구독 게이트에 쓰는 멘토 활동 상태 조회(유저 클라이언트 read). */
export async function loadMentorActivityForGate(
  supabase: SupabaseClient,
  mentorId: string
): Promise<{ activity_status?: string | null; pause_until?: string | null } | null> {
  const { data, error } = await supabase
    .from("mentor_profiles")
    .select("activity_status, pause_until")
    .eq("user_id", mentorId)
    .maybeSingle();
  if (error) return null;
  return (data as { activity_status?: string | null; pause_until?: string | null } | null) ?? null;
}
