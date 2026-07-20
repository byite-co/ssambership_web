// 알림 설정 순수 모델 — DB row ↔ UI 상태 변환·기본값(node:test 검증). Supabase/`@/` 의존 없음.
//
// event group 은 notification_event_group(SQL 152)·notificationCategories 와 정합.
// 규칙: 설정행 없으면 전부 on. 그룹은 groups[key]===false 일 때만 off. push_enabled 는 전역 스위치.

export const NOTIFICATION_GROUPS = ["qna", "order", "subscription", "refund", "system"] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export const NOTIFICATION_GROUP_LABELS: Record<NotificationGroup, { label: string; note: string }> = {
  qna: { label: "질문방 알림", note: "답변·스레드 관련" },
  order: { label: "맞춤의뢰·개별질문 알림", note: "지원·납품·수정 요청" },
  subscription: { label: "구독 알림", note: "구독·갱신·요금 변경" },
  refund: { label: "환불 알림", note: "환불 신청·처리" },
  system: { label: "커뮤니티·시스템 알림", note: "댓글·검수·공지" },
};

export type NotificationSettings = {
  pushEnabled: boolean;
  groups: Record<NotificationGroup, boolean>;
};

export function defaultNotificationSettings(): NotificationSettings {
  return {
    pushEnabled: true,
    groups: { qna: true, order: true, subscription: true, refund: true, system: true },
  };
}

/** DB row(push_enabled, groups jsonb) → 설정. 누락 그룹은 기본 on. */
export function notificationSettingsFromRow(row: {
  push_enabled?: unknown;
  groups?: unknown;
} | null | undefined): NotificationSettings {
  const s = defaultNotificationSettings();
  if (!row) return s;
  if (typeof row.push_enabled === "boolean") s.pushEnabled = row.push_enabled;
  const g = (row.groups && typeof row.groups === "object" ? row.groups : {}) as Record<string, unknown>;
  for (const key of NOTIFICATION_GROUPS) {
    if (g[key] === false) s.groups[key] = false;
    else if (g[key] === true) s.groups[key] = true;
  }
  return s;
}

/** 설정 → DB groups jsonb(명시적 boolean 전부 기록). */
export function notificationSettingsToGroupsJson(s: NotificationSettings): Record<NotificationGroup, boolean> {
  return { ...s.groups };
}

/** worker 강제와 동일한 판정(로컬 미리보기용): push on && 그룹 on. */
export function isDeliveryAllowed(s: NotificationSettings, group: NotificationGroup): boolean {
  return s.pushEnabled && s.groups[group] !== false;
}
