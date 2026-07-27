"use server";

import { getServerAuthUser } from "@/lib/auth/getCurrentUser";
import { createClient } from "@/lib/supabase/server";
import {
  NOTIFICATION_GROUPS,
  defaultNotificationSettings,
  notificationSettingsFromRow,
  notificationSettingsToGroupsJson,
  type NotificationSettings,
} from "@/lib/notifications/notificationSettingsModel";

/** 본인 알림 설정 조회(없으면 기본 전부 on). RLS: 본인 행만. */
export async function getMyNotificationSettings(): Promise<NotificationSettings> {
  const { user } = await getServerAuthUser();
  if (!user) return defaultNotificationSettings();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_settings")
    .select("push_enabled, groups")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return defaultNotificationSettings();
  return notificationSettingsFromRow(data as { push_enabled?: unknown; groups?: unknown } | null);
}

/**
 * 알림 설정 저장(본인). DB 저장 실패 시 ok:false — 호출 UI 는 성공 표시 금지.
 * push_enabled + 각 그룹 on/off 를 FormData("push","group_<key>")에서 파싱.
 */
export async function updateNotificationSettingsAction(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user } = await getServerAuthUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };

  const pushEnabled = formData.get("push") === "on";
  const groups: Record<string, boolean> = {};
  for (const key of NOTIFICATION_GROUPS) {
    groups[key] = formData.get(`group_${key}`) === "on";
  }
  const settings: NotificationSettings = {
    pushEnabled,
    groups: groups as NotificationSettings["groups"],
  };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_settings")
    .upsert(
      { user_id: user.id, push_enabled: settings.pushEnabled, groups: notificationSettingsToGroupsJson(settings), updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) return { ok: false, error: "설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요." };
  return { ok: true };
}
