// 계약 테스트: 알림 카테고리 파싱·타입목록·href(필터/카테고리 변경 시 커서 초기화).
// 실행: node --test --experimental-strip-types lib/notifications/__contract__/notificationCategories.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  notificationCategoryTypeList,
  notificationsHref,
  parseNotificationCategory,
} from "../notificationCategories.ts";

test("카테고리 파싱: 유효값 통과, 그 외 all 폴백", () => {
  assert.equal(parseNotificationCategory("qna"), "qna");
  assert.equal(parseNotificationCategory("subscription"), "subscription");
  assert.equal(parseNotificationCategory("bogus"), "all");
  assert.equal(parseNotificationCategory(undefined), "all");
  assert.equal(parseNotificationCategory(""), "all");
});

test("타입목록: all 은 null(필터 없음), 그 외는 비어있지 않은 배열", () => {
  assert.equal(notificationCategoryTypeList("all"), null);
  const qna = notificationCategoryTypeList("qna");
  assert.ok(Array.isArray(qna) && qna.length > 0);
});

test("href: unread 필터·카테고리 반영, cursor 는 dir 과 함께일 때만", () => {
  assert.equal(notificationsHref({ filter: "all", category: "all" }), "/notifications");
  assert.equal(notificationsHref({ filter: "unread", category: "all" }), "/notifications?filter=unread");
  assert.equal(
    notificationsHref({ filter: "all", category: "qna" }),
    "/notifications?category=qna",
  );
  assert.equal(
    notificationsHref({ filter: "unread", category: "qna", dir: "next", cursor: "abc" }),
    "/notifications?filter=unread&category=qna&dir=next&cursor=abc",
  );
});

test("href: 필터/카테고리 전환 시 cursor 미포함(초기화) — dir 없이 cursor 만 주면 무시", () => {
  // 카테고리를 바꾸는 링크는 dir/cursor 를 주지 않는다 → 커서 초기화(1페이지부터).
  assert.equal(notificationsHref({ filter: "all", category: "order", cursor: "stale" }), "/notifications?category=order");
});
