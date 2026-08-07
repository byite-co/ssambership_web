"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

/**
 * 수신자 본인 알림 1건 읽음 처리 — canonical mark RPC(수렴 §14.3).
 * direct UPDATE 대신 mark_notification_read 가 수신자 판정·멱등·미러 수렴을 서버에서
 * 수행한다. NOTIFICATION_NOT_FOUND/NOT_RECIPIENT 는 not_found 로 수렴(기존 호출부 계약 유지).
 */
async function markNotificationRead(notificationId: string): Promise<{ ok: boolean; reason: string | null }> {
  const { user } = await getServerUserWithProfile();
  if (!user) return { ok: false, reason: "not_authenticated" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_notification_read", {
    p_notification_id: notificationId,
  });
  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("NOTIFICATION_NOT_FOUND") || msg.includes("NOT_RECIPIENT")) {
      return { ok: false, reason: "not_found" };
    }
    return { ok: false, reason: msg };
  }
  const envelope = (data ?? {}) as Row;
  if (envelope.ok !== true) return { ok: false, reason: "contract_mismatch" };

  revalidatePath("/notifications");
  return { ok: true, reason: null };
}

/** 폼(progressive-enhancement)에서 읽음 처리 — 실패는 로그로 표면화(무음 no-op 금지). */
export async function markNotificationReadFormAction(formData: FormData): Promise<void> {
  const notificationId = String(formData.get("notificationId") ?? "").trim();
  if (!notificationId) {
    return;
  }
  const res = await markNotificationRead(notificationId);
  if (!res.ok && res.reason && res.reason !== "not_authenticated" && res.reason !== "not_found") {
    console.error("[markNotificationReadFormAction]", res.reason);
  }
}

/** 클라이언트(드롭다운)에서 읽음 처리 */
export async function markNotificationReadByIdAction(notificationId: string): Promise<{ ok: boolean }> {
  const id = String(notificationId ?? "").trim();
  if (!id) return { ok: false };
  const res = await markNotificationRead(id);
  if (!res.ok && res.reason && res.reason !== "not_authenticated" && res.reason !== "not_found") {
    console.error("[markNotificationReadByIdAction]", res.reason);
  }
  return { ok: res.ok };
}

/**
 * P2-15: 로드한 ID 가 아니라 **본인 전체 미읽음 알림**을 서버 RPC(mark_all_notifications_read)로
 * 읽음 처리한다. 소유권은 서버(auth.uid())가 판정하고 갱신 행수를 반환한다(멱등).
 */
export async function markAllNotificationsReadAction(): Promise<{ ok: boolean; count: number }> {
  const { user } = await getServerUserWithProfile();
  if (!user) return { ok: false, count: 0 };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) return { ok: false, count: 0 };

  revalidatePath("/notifications");
  return { ok: true, count: typeof data === "number" ? data : 0 };
}

/**
 * 폼(progressive-enhancement)용 래퍼 — 서버 RPC 로 본인 전체 미읽음 처리 후 목록 갱신.
 * D-MT-11: RPC 실패 시 {ok:false} 를 무시하지 않고 ?error= 로 리다이렉트해 표면화한다
 * (단건 읽음의 contract_mismatch 처리와 동일하게 실패를 조용히 삼키지 않는다).
 */
export async function markAllNotificationsReadFormAction(): Promise<void> {
  const res = await markAllNotificationsReadAction();
  if (!res.ok) {
    redirect("/notifications?error=mark_all_failed");
  }
}
