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

export type MyNotificationSettingsResult = {
  settings: NotificationSettings;
  /**
   * D-MT-12: 조회 실패 여부. true 면 `settings` 는 기본값 placeholder 이며 사용자의 실제
   * 설정이 아니다(폼을 비활성화하고 재시도를 안내해야 한다). false + 행 없음은 정상적인
   * '기본값(전부 on)'을 뜻한다.
   */
  loadFailed: boolean;
};

/**
 * 본인 알림 설정 조회(행 없으면 기본 전부 on). RLS: 본인 행만.
 *
 * D-MT-12: 조회 실패(error)를 defaultNotificationSettings()(전부 on)로 흡수하지 않는다.
 * 실패를 그대로 저장하면 알림을 끈 사용자의 설정이 전부 on 으로 덮어써진다(설정 유실).
 * 행 없음(기본값)과 조회 실패를 loadFailed 로 구분해 반환한다.
 */
export async function getMyNotificationSettings(): Promise<MyNotificationSettingsResult> {
  const { user } = await getServerAuthUser();
  if (!user) return { settings: defaultNotificationSettings(), loadFailed: true };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_settings")
    .select("push_enabled, groups")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[getMyNotificationSettings]", error.message);
    return { settings: defaultNotificationSettings(), loadFailed: true };
  }
  return {
    settings: notificationSettingsFromRow(data as { push_enabled?: unknown; groups?: unknown } | null),
    loadFailed: false,
  };
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
