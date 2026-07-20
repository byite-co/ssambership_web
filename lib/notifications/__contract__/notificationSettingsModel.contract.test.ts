// 계약 테스트: 알림 설정 모델(기본값·row 변환·delivery 판정).
// 실행: node --test --experimental-strip-types lib/notifications/__contract__/notificationSettingsModel.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultNotificationSettings,
  isDeliveryAllowed,
  notificationSettingsFromRow,
  notificationSettingsToGroupsJson,
} from "../notificationSettingsModel.ts";

test("기본값: 전부 on", () => {
  const s = defaultNotificationSettings();
  assert.equal(s.pushEnabled, true);
  for (const v of Object.values(s.groups)) assert.equal(v, true);
});

test("row 없으면 기본 전부 on", () => {
  const s = notificationSettingsFromRow(null);
  assert.equal(s.pushEnabled, true);
  assert.equal(s.groups.qna, true);
});

test("row: push off + 특정 그룹 off 반영, 누락 그룹은 on", () => {
  const s = notificationSettingsFromRow({ push_enabled: false, groups: { qna: false } });
  assert.equal(s.pushEnabled, false);
  assert.equal(s.groups.qna, false);
  assert.equal(s.groups.order, true); // 누락 → 기본 on
});

test("delivery 판정: push off 면 그룹 무관 불가", () => {
  const s = notificationSettingsFromRow({ push_enabled: false, groups: { qna: true } });
  assert.equal(isDeliveryAllowed(s, "qna"), false);
});

test("delivery 판정: push on & 그룹 on 만 허용", () => {
  const s = notificationSettingsFromRow({ push_enabled: true, groups: { qna: false, order: true } });
  assert.equal(isDeliveryAllowed(s, "qna"), false);
  assert.equal(isDeliveryAllowed(s, "order"), true);
  assert.equal(isDeliveryAllowed(s, "system"), true); // 누락 → on
});

test("groups jsonb 왕복", () => {
  const s = defaultNotificationSettings();
  s.groups.refund = false;
  const j = notificationSettingsToGroupsJson(s);
  assert.equal(j.refund, false);
  assert.equal(j.qna, true);
  const back = notificationSettingsFromRow({ push_enabled: true, groups: j });
  assert.equal(back.groups.refund, false);
});
