// 알림 미읽음 술어 순수 유틸 — Supabase/`@/` 의존 없음(node:test 로 직접 검증 가능).
// notificationsHubQueries.ts 가 목록(withScope)과 뱃지 count 양쪽에서 이 단일 함수를
// 사용·re-export 한다(계약 테스트가 실제 경로를 검증).
//
// D-MT-10 회귀 방지: 뱃지 카운트만 DB RPC(notification_unread_count_self)로 갈아탔다가
// 목록과 술어가 갈렸다 — RPC 는 앱 게이팅 타입(new_order_message/new_application)을
// 제외하고 수신자 매칭도 7컬럼 OR 로 더 넓다. 웹 허브는 목록·뱃지가 반드시 같은 술어를
// 거치도록 여기 한 곳에 고정한다(RPC 는 앱 표면 정본으로 존속).

/** 수신자·읽음 정본 컬럼 — W4(C10) 고정: writer 132 가 set · 술어 133 `is_read is distinct from true` */
export const NOTIFICATION_USER_COLUMN = "user_id";
export const NOTIFICATION_READ_COLUMN = "is_read";

/** 미읽음 술어 적용에 필요한 최소 빌더 표면 — 계약 테스트에서 기록용 fake 로 대체한다. */
export type NotificationUnreadScopeBuilder = {
  eq: (c: string, v: unknown) => NotificationUnreadScopeBuilder;
  not: (c: string, o: string, v: unknown) => NotificationUnreadScopeBuilder;
};

/**
 * 정본 미읽음 술어(133): 수신자 본인(user_id eq) AND is_read is distinct from true.
 * 목록 미읽음 필터와 뱃지 count 가 이 함수 하나만 거치게 해 술어 분기를 구조적으로 막는다.
 */
export function applyUnreadScope<T extends NotificationUnreadScopeBuilder>(q: T, userId: string): T {
  return q.eq(NOTIFICATION_USER_COLUMN, userId).not(NOTIFICATION_READ_COLUMN, "is", true) as T;
}
