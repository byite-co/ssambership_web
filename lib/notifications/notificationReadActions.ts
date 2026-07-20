"use server";

import { revalidatePath } from "next/cache";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { isNotificationReadRow } from "@/lib/notifications/notificationsHubQueries";
import { pickExistingColumn } from "@/lib/qna/safeSelect";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

const TABLE = "notifications";
const USER_FK = ["user_id", "recipient_id", "student_id", "mentor_id", "target_user_id", "owner_id"] as const;
const READ_FK = ["read_at", "read_at_utc", "is_read", "seen_at", "opened_at", "viewed_at", "acknowledged_at"] as const;

async function resolveRecipientColumn(supabase: SupabaseClient, userId: string): Promise<string | null> {
  for (const col of USER_FK) {
    const p = await supabase.from(TABLE).select("id").eq(col, userId).limit(1);
    if (!p.error) {
      return col;
    }
  }
  return null;
}

/**
 * 수신자 본인 알림만 읽음 처리. read 컬럼은 스키마 탐지(is_read vs read_at 등).
 */
export async function markNotificationReadFormAction(formData: FormData): Promise<void> {
  const notificationId = String(formData.get("notificationId") ?? "").trim();
  if (!notificationId) {
    return;
  }

  const { user } = await getServerUserWithProfile();
  if (!user) {
    return;
  }

  const supabase = await createClient();
  const userColumn = await resolveRecipientColumn(supabase, user.id);
  if (!userColumn) {
    return;
  }

  const { column: readCol } = await pickExistingColumn(supabase, TABLE, READ_FK);
  if (!readCol) {
    return;
  }

  const { data: row, error: fe } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", notificationId)
    .eq(userColumn, user.id)
    .maybeSingle();

  if (fe || !row) {
    return;
  }

  const r = row as Row;
  if (isNotificationReadRow(r, readCol)) {
    revalidatePath("/notifications");
    return;
  }

  const patch: Record<string, unknown> = {};
  if (readCol === "is_read" || readCol === "read" || readCol === "acknowledged") {
    patch[readCol] = true;
  } else {
    patch[readCol] = new Date().toISOString();
  }

  const { error: ue } = await supabase.from(TABLE).update(patch).eq("id", notificationId).eq(userColumn, user.id);
  if (!ue) {
    revalidatePath("/notifications");
  }
}

/** 클라이언트(드롭다운)에서 읽음 처리 */
export async function markNotificationReadByIdAction(notificationId: string): Promise<{ ok: boolean }> {
  const id = String(notificationId ?? "").trim();
  if (!id) return { ok: false };

  const { user } = await getServerUserWithProfile();
  if (!user) return { ok: false };

  const supabase = await createClient();
  const userColumn = await resolveRecipientColumn(supabase, user.id);
  if (!userColumn) return { ok: false };

  const { column: readCol } = await pickExistingColumn(supabase, TABLE, READ_FK);
  if (!readCol) return { ok: false };

  const { data: row, error: fe } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .eq(userColumn, user.id)
    .maybeSingle();

  if (fe || !row) return { ok: false };

  const r = row as Row;
  if (isNotificationReadRow(r, readCol)) {
    return { ok: true };
  }

  const patch: Record<string, unknown> = {};
  if (readCol === "is_read" || readCol === "read" || readCol === "acknowledged") {
    patch[readCol] = true;
  } else {
    patch[readCol] = new Date().toISOString();
  }

  const { error: ue } = await supabase.from(TABLE).update(patch).eq("id", id).eq(userColumn, user.id);
  if (!ue) {
    revalidatePath("/notifications");
    return { ok: true };
  }
  return { ok: false };
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
