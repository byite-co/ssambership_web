"use server";

import { revalidatePath } from "next/cache";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { isNotificationReadRow } from "@/lib/notifications/notificationsHubQueries";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

const TABLE = "notifications";
// W4(C10): 수신자 FK 프로빙(6종 순회)·읽음 컬럼 프로빙(7종 순회) 제거 —
// 정본 고정: 수신자 user_id + 읽음 is_read/read_at (133 정본 술어·132 정본 writer, 187 baseline 실측).
const USER_COLUMN = "user_id";
const READ_COLUMN = "is_read";

/**
 * 수신자 본인 알림 1건 읽음 처리 — 정본 갱신(133 RPC 패턴의 단건판):
 * is_read = true, read_at = coalesce(read_at, now()).
 */
async function markNotificationRead(notificationId: string): Promise<{ ok: boolean; reason: string | null }> {
  const { user } = await getServerUserWithProfile();
  if (!user) return { ok: false, reason: "not_authenticated" };

  const supabase = await createClient();
  const { data: row, error: fe } = await supabase
    .from(TABLE)
    .select("id, is_read, read_at")
    .eq("id", notificationId)
    .eq(USER_COLUMN, user.id)
    .maybeSingle();

  if (fe) return { ok: false, reason: fe.message };
  if (!row) return { ok: false, reason: "not_found" };

  const r = row as Row;
  if (isNotificationReadRow(r, READ_COLUMN)) {
    revalidatePath("/notifications");
    return { ok: true, reason: null };
  }

  const readAt = typeof r.read_at === "string" && r.read_at ? r.read_at : new Date().toISOString();
  const { error: ue } = await supabase
    .from(TABLE)
    .update({ is_read: true, read_at: readAt })
    .eq("id", notificationId)
    .eq(USER_COLUMN, user.id);
  if (ue) return { ok: false, reason: ue.message };

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

/** 폼(progressive-enhancement)용 래퍼 — 서버 RPC 로 본인 전체 미읽음 처리 후 목록 갱신. */
export async function markAllNotificationsReadFormAction(): Promise<void> {
  await markAllNotificationsReadAction();
}
