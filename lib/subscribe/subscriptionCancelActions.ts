"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { rowsFromSupabaseData } from "@/lib/qna/safeSelect";
import { SUBSCRIPTIONS_SELECT, SUBSCRIPTIONS_TABLE } from "@/lib/subscribe/subscriptionsTable";
import { computeProratedRefundEstimate } from "@/lib/subscribe/subscriptionRefundProration";
import { hasSubscriptionUsageStartedForPair } from "@/lib/subscribe/subscriptionUsageStarted";

type Row = Record<string, unknown>;

const SUBSCRIPTIONS_PATH = "/subscriptions";
const REFUNDS_PATH = "/support/refunds";

function textFromForm(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function withMessage(path: string, key: "ok" | "error", message: string): string {
  const params = new URLSearchParams();
  params.set(key, message);
  return `${path}?${params.toString()}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function boolValue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isCurrentSubscriptionStatus(status: string): boolean {
  return status === "active" || status === "past_due";
}

async function loadOwnedSubscription(admin: ReturnType<typeof createServiceRoleClient>, subscriptionId: string, studentId: string) {
  const { data, error } = await admin
    .from(SUBSCRIPTIONS_TABLE)
    .select(SUBSCRIPTIONS_SELECT)
    .eq("id", subscriptionId)
    .maybeSingle();

  if (error) {
    return { row: null as Row | null, error: error.message };
  }

  const row = (data as Row | null) ?? null;
  if (!row) return { row: null, error: "구독을 찾을 수 없습니다." };
  if (stringValue(row.student_id) !== studentId) {
    return { row: null, error: "본인 구독만 처리할 수 있습니다." };
  }
  return { row, error: null as string | null };
}

async function latestSucceededBillingEvent(admin: ReturnType<typeof createServiceRoleClient>, subscriptionId: string): Promise<Row | null> {
  const { data, error } = await admin
    .from("subscription_billing_events")
    .select("id, subscription_id, amount_cents, payment_id, period_start, period_end, billing_at, event_type, status")
    .eq("subscription_id", subscriptionId)
    .eq("status", "succeeded")
    .in("event_type", ["initial", "renewal"])
    .order("billing_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("[latestSucceededBillingEvent]", error.message);
    return null;
  }
  return (rowsFromSupabaseData(data)[0] as Row | undefined) ?? null;
}

export async function requestSubscriptionCancelAtPeriodEndAction(formData: FormData) {
  const { user } = await requireRole("student");
  const subscriptionId = textFromForm(formData.get("subscriptionId"));
  if (!subscriptionId) {
    redirect(withMessage(SUBSCRIPTIONS_PATH, "error", "구독을 식별할 수 없습니다."));
  }

  const admin = createServiceRoleClient();
  const loaded = await loadOwnedSubscription(admin, subscriptionId, user.id);
  if (!loaded.row) {
    redirect(withMessage(SUBSCRIPTIONS_PATH, "error", loaded.error ?? "구독을 찾을 수 없습니다."));
  }

  const status = normalizeStatus(loaded.row.status);
  if (!isCurrentSubscriptionStatus(status)) {
    redirect(withMessage(SUBSCRIPTIONS_PATH, "error", "이미 종료되었거나 해지할 수 없는 구독입니다."));
  }

  if (!boolValue(loaded.row.cancel_at_period_end)) {
    const now = new Date().toISOString();
    const { error } = await admin
      .from(SUBSCRIPTIONS_TABLE)
      .update({
        cancel_at_period_end: true,
        cancel_requested_at: now,
        updated_at: now,
      })
      .eq("id", subscriptionId)
      .eq("student_id", user.id);
    if (error) {
      redirect(withMessage(SUBSCRIPTIONS_PATH, "error", "다음 결제 중단 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    }
  }

  revalidatePath(SUBSCRIPTIONS_PATH);
  revalidatePath("/mypage");
  redirect(withMessage(SUBSCRIPTIONS_PATH, "ok", "다음 갱신이 중단되었습니다. 현재 기간 끝까지는 이용할 수 있어요."));
}

export async function undoSubscriptionCancelAtPeriodEndAction(formData: FormData) {
  const { user } = await requireRole("student");
  const subscriptionId = textFromForm(formData.get("subscriptionId"));
  if (!subscriptionId) {
    redirect(withMessage(SUBSCRIPTIONS_PATH, "error", "구독을 식별할 수 없습니다."));
  }

  const admin = createServiceRoleClient();
  const loaded = await loadOwnedSubscription(admin, subscriptionId, user.id);
  if (!loaded.row) {
    redirect(withMessage(SUBSCRIPTIONS_PATH, "error", loaded.error ?? "구독을 찾을 수 없습니다."));
  }

  const status = normalizeStatus(loaded.row.status);
  if (!isCurrentSubscriptionStatus(status)) {
    redirect(withMessage(SUBSCRIPTIONS_PATH, "error", "이미 종료된 구독은 되돌릴 수 없습니다."));
  }

  const { error } = await admin
    .from(SUBSCRIPTIONS_TABLE)
    .update({
      cancel_at_period_end: false,
      cancel_requested_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscriptionId)
    .eq("student_id", user.id);
  if (error) {
    redirect(withMessage(SUBSCRIPTIONS_PATH, "error", "구독 계속하기 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."));
  }

  revalidatePath(SUBSCRIPTIONS_PATH);
  revalidatePath("/mypage");
  redirect(withMessage(SUBSCRIPTIONS_PATH, "ok", "구독을 계속 이용합니다. 다음 갱신일에 정상 갱신됩니다."));
}

export async function requestSubscriptionProratedRefundAction(formData: FormData) {
  const { user } = await requireRole("student");
  const subscriptionId = textFromForm(formData.get("subscriptionId"));
  const reason = textFromForm(formData.get("reason"));
  if (!subscriptionId) {
    redirect(withMessage(REFUNDS_PATH, "error", "구독을 선택해 주세요."));
  }
  // P1 ⑥ — 환불 신청 사유 필수
  if (reason.length < 5) {
    redirect(withMessage(REFUNDS_PATH, "error", "환불 신청 사유를 5자 이상 입력해 주세요."));
  }

  const admin = createServiceRoleClient();
  const loaded = await loadOwnedSubscription(admin, subscriptionId, user.id);
  if (!loaded.row) {
    redirect(withMessage(REFUNDS_PATH, "error", loaded.error ?? "구독을 찾을 수 없습니다."));
  }

  const status = normalizeStatus(loaded.row.status);
  if (!isCurrentSubscriptionStatus(status)) {
    redirect(withMessage(REFUNDS_PATH, "error", "이미 종료되었거나 환불 신청할 수 없는 구독입니다."));
  }

  const { data: pending, error: pendingError } = await admin
    .from("refunds")
    .select("id")
    .eq("user_id", user.id)
    .eq("subscription_id", subscriptionId)
    .eq("status", "pending")
    .limit(1);
  if (pendingError) {
    redirect(withMessage(REFUNDS_PATH, "error", "환불 요청 스키마가 준비되지 않았습니다. SQL 069 적용을 확인해 주세요."));
  }
  if ((pending ?? []).length > 0) {
    redirect(withMessage(REFUNDS_PATH, "error", "이미 검토 중인 환불 신청이 있습니다."));
  }

  const billingEvent = await latestSucceededBillingEvent(admin, subscriptionId);
  const periodStart = stringValue(loaded.row.current_period_start) ?? stringValue(billingEvent?.period_start);
  const periodEnd = stringValue(loaded.row.current_period_end) ?? stringValue(billingEvent?.period_end);
  const mentorId = stringValue(loaded.row.mentor_id);
  // 학원법 별표4 — 이용 개시 여부(첫 질문 작성) 판정.
  // 멘토 ID 미상 시(이상 데이터)는 보수적으로 usageStarted=true 처리.
  const usageStarted = mentorId
    ? await hasSubscriptionUsageStartedForPair(admin, {
        studentId: user.id,
        mentorId,
        periodStartIso: periodStart,
      })
    : true;
  const estimate = computeProratedRefundEstimate({
    amountCents: numberValue(billingEvent?.amount_cents),
    periodStartIso: periodStart,
    periodEndIso: periodEnd,
    usageStarted,
    mode: "student_voluntary",
  });

  if (estimate.amountCents <= 0) {
    const userMsg =
      estimate.bracketReason === "ge_1_2"
        ? "학원법 기준으로 기간 1/2를 경과하여 환불 가능 금액이 없습니다."
        : "남은 이용 기간이 없거나 환불 예상액을 계산할 수 없습니다.";
    redirect(withMessage(REFUNDS_PATH, "error", userMsg));
  }

  const paymentId = stringValue(billingEvent?.payment_id) ?? stringValue(loaded.row.payment_id);
  // 정본 연결: 이 환불이 대응하는 current billing event(id)를 기록한다(150 FK).
  const billingEventId = stringValue(billingEvent?.id) ?? stringValue(loaded.row.last_billing_event_id);
  const { error: insertError } = await admin.from("refunds").insert({
    user_id: user.id,
    amount_cents: estimate.amountCents,
    status: "pending",
    payment_id: paymentId,
    subscription_id: subscriptionId,
    billing_event_id: billingEventId,
    request_type: "subscription_prorated",
    reason: reason || "학생 구독 잔여기간 환불 신청",
  });

  if (insertError) {
    redirect(withMessage(REFUNDS_PATH, "error", "환불 신청을 저장하지 못했습니다. SQL 069 적용 상태를 확인해 주세요."));
  }

  revalidatePath(REFUNDS_PATH);
  revalidatePath("/admin/refunds");
  redirect(withMessage(REFUNDS_PATH, "ok", "환불 신청이 접수되었습니다. 관리자가 검토한 뒤 승인 또는 거절합니다."));
}
