"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SUBSCRIPTIONS_SELECT, SUBSCRIPTIONS_TABLE } from "@/lib/subscribe/subscriptionsTable";
import {
  REFUND_REQUEST_CREATE_RPC,
  REFUND_RPC_SCHEMA,
  parseRefundRequestCreateResponse,
} from "@/lib/subscribe/subscriptionRefundRpc";

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
  // P1 ⑥ — 환불 신청 사유 필수(서버 RPC 도 REASON_TOO_SHORT 로 같은 규칙을 강제한다)
  if (reason.length < 5) {
    redirect(withMessage(REFUNDS_PATH, "error", "환불 신청 사유를 5자 이상 입력해 주세요."));
  }

  // 웹 PR-2 §5-3: 환불 행 생성은 `api_app_v1.refund_request_create`(DB-4 200 · 앱 A-4b 와 같은 함수 · 같은 숫자).
  // 소유·현재 구독·중복 신청·학원법 별표4 금액 산정을 RPC 가 한 트랜잭션에서 판정한다 — 웹은 service_role 로
  // refunds 를 직접 쓰지 않는다. 세션 클라이언트(authenticated)로 호출.
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema(REFUND_RPC_SCHEMA)
    .rpc(REFUND_REQUEST_CREATE_RPC, { p_subscription_id: subscriptionId, p_reason: reason });
  if (error) {
    console.error("[requestSubscriptionProratedRefundAction] refund_request_create", { userId: user.id, subscriptionId, message: error.message });
  }
  const outcome = parseRefundRequestCreateResponse(data, error);
  if (!outcome.ok) {
    redirect(withMessage(REFUNDS_PATH, "error", outcome.message));
  }

  revalidatePath(REFUNDS_PATH);
  revalidatePath("/admin/refunds");
  redirect(withMessage(REFUNDS_PATH, "ok", "환불 신청이 접수되었습니다. 관리자가 검토한 뒤 승인 또는 거절합니다."));
}
