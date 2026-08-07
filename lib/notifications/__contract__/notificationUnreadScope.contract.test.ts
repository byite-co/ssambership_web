// 계약 테스트: 알림 목록-뱃지 미읽음 술어 단일화 — D-MT-10 회귀 방지.
//
// 뱃지 카운트를 DB RPC(notification_unread_count_self)로 교체하자 목록과 술어가 갈렸다 —
// RPC 는 앱 게이팅 타입(new_order_message/new_application)을 제외하고 수신자 매칭도 7컬럼
// OR 로 더 넓어서, 해당 타입 미읽음만 있으면 목록엔 안읽음이 보이는데 뱃지·'모두 읽음'이
// 사라졌다. 웹 허브 뱃지는 목록과 동일 술어의 직접 count 로 고정한다(RPC 는 앱 표면용).
// 여기서 그 단일 술어(applyUnreadScope)의 컬럼·연산 형태를 고정한다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  applyUnreadScope,
  NOTIFICATION_READ_COLUMN,
  NOTIFICATION_USER_COLUMN,
  type NotificationUnreadScopeBuilder,
} from "../notificationUnreadScope.ts";

type Call = [op: string, ...args: unknown[]];

function recordingBuilder(calls: Call[]): NotificationUnreadScopeBuilder {
  const qb: NotificationUnreadScopeBuilder = {
    eq(c, v) {
      calls.push(["eq", c, v]);
      return qb;
    },
    not(c, o, v) {
      calls.push(["not", c, o, v]);
      return qb;
    },
  };
  return qb;
}

test("미읽음 술어 = user_id eq + is_read is distinct from true (목록·뱃지 공용, D-MT-10 핵심)", () => {
  const calls: Call[] = [];
  applyUnreadScope(recordingBuilder(calls), "user-1");
  assert.deepEqual(calls, [
    ["eq", "user_id", "user-1"],
    ["not", "is_read", "is", true],
  ]);
});

test("정본 컬럼 고정(W4(C10)): 수신자 user_id · 읽음 is_read", () => {
  assert.equal(NOTIFICATION_USER_COLUMN, "user_id");
  assert.equal(NOTIFICATION_READ_COLUMN, "is_read");
});

test("빌더를 그대로 되돌린다 — 유형 제외 등 추가 필터가 끼어들면 안 된다", () => {
  const calls: Call[] = [];
  const qb = recordingBuilder(calls);
  const out = applyUnreadScope(qb, "user-2");
  assert.equal(out, qb);
  assert.equal(calls.length, 2);
});

test("허브 모듈 경유 re-export 가 동일 함수다(실사용 경로 검증)", async () => {
  // notificationsHubQueries 는 `@/` 경로를 import 하므로 node 에서 직접 import 불가 —
  // 대신 소스 텍스트로 re-export·양쪽 사용처(withScope·count)를 검증한다.
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../notificationsHubQueries.ts", import.meta.url), "utf8");
  assert.match(src, /export \{ applyUnreadScope \}/);
  // 목록(withScope)과 뱃지 count 양쪽 모두 applyUnreadScope 호출이어야 한다(정의·re-export 제외 2회 이상).
  const uses = src.match(/applyUnreadScope\(/g) ?? [];
  assert.ok(uses.length >= 2, `applyUnreadScope 사용처 ${uses.length}회 — 목록·뱃지 양쪽에서 써야 한다`);
  // RPC 로 되돌아가는 회귀 방지: 뱃지 카운트에 notification_unread_count_self 호출이 없어야 한다.
  assert.doesNotMatch(src, /rpc\(\s*["']notification_unread_count_self["']/);
});
