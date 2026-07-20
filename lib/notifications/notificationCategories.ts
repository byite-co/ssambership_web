// P2-26: 알림 카테고리 서브탭 — 정본 event type allowlist(서버 필터 + UI 공유).
// frozen notificationTypeMeta 정규식으로 클라이언트 결과를 후처리하지 않는다.
// UI 카테고리 → 명시적 event type 집합. 여기 없는 type 은 '전체'에서만 노출된다.

export type NotificationCategory = "all" | "qna" | "order" | "subscription" | "refund" | "system";

export const NOTIFICATION_CATEGORY_ORDER: NotificationCategory[] = [
  "all",
  "qna",
  "order",
  "subscription",
  "refund",
  "system",
];

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  all: "전체",
  qna: "질문방",
  order: "맞춤의뢰",
  subscription: "구독·결제",
  refund: "환불",
  system: "공지·안내",
};

// 실제 발행되는 notifications.type 토큰(DB 원자 producer — 142/144·155·157·158·159 트리거/RPC 기준).
export const NOTIFICATION_CATEGORY_TYPES: Record<Exclude<NotificationCategory, "all">, readonly string[]> = {
  qna: [
    "question_answered",
    "individual_question_assigned",
    "individual_question_claimed",
    "individual_question_answered",
    "individual_question_message",
    "individual_question_released",
  ],
  order: ["new_order_message", "new_application"],
  subscription: [
    "subscription_expired",
    "subscription_renewal_succeeded",
    "subscription_renewal_failed_insufficient_cash",
    "subscription_renewal_upcoming",
    "mentor_subscription_price_changed",
  ],
  refund: ["individual_question_expired_refunded", "mentor_termination_refund"],
  system: ["notice", "mentor_termination_notice", "mentor_pause_notice"],
};

export function parseNotificationCategory(v: string | undefined): NotificationCategory {
  const s = (v ?? "").trim();
  return (NOTIFICATION_CATEGORY_ORDER as string[]).includes(s) ? (s as NotificationCategory) : "all";
}

/** 카테고리에 매핑된 event type 목록(all 또는 미매핑이면 null = 필터 없음). */
export function notificationCategoryTypeList(cat: NotificationCategory): string[] | null {
  if (cat === "all") return null;
  const list = NOTIFICATION_CATEGORY_TYPES[cat];
  return list && list.length ? [...list] : null;
}

/** 알림 허브 URL 빌더 — 필터/카테고리/커서 일관 조립. 필터·카테고리 변경 시 cursor 미포함(초기화). */
export function notificationsHref(params: {
  filter: "all" | "unread";
  category: NotificationCategory;
  dir?: "next" | "prev";
  cursor?: string | null;
}): string {
  const p = new URLSearchParams();
  if (params.filter === "unread") p.set("filter", "unread");
  if (params.category !== "all") p.set("category", params.category);
  if (params.dir && params.cursor) {
    p.set("dir", params.dir);
    p.set("cursor", params.cursor);
  }
  const s = p.toString();
  return s ? `/notifications?${s}` : "/notifications";
}
