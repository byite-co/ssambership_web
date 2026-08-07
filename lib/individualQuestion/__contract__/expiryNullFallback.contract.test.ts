// 계약 테스트 (D-IQ-1 / D-IQ-2):
//  - expires_at 가 NULL 로 남은 행도 created_at + status별 기본 만료시간 폴백으로 회수 대상이 된다.
//  - primary + fallback 병합은 중복 id 를 제거하고 배치 한도를 넘지 않는다.
//
// 순수 함수만 검증한다(네트워크·DB 없이). NULL 행이 만료 스캔에 영영 안 걸려 에스크로 홀드가
// 무기한 유지되던 결함(D-IQ-1)의 회귀를 고정한다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  isNullExpiryRowDue,
  selectDueNullExpiryRows,
  mergeExpiryScanRows,
} from "../individualQuestionExpiryScan.ts";

// 기본 만료: open=48h, claimed=48h, assigned(direct)=72h (config 기본값 반영 스텁).
const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-08-07T00:00:00.000Z");
const hoursForStatus = (status: string): number =>
  status === "assigned" ? 72 : status === "open" || status === "claimed" ? 48 : 0;

function isoHoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * HOUR).toISOString();
}

test("open: 48h 지난 NULL-expires 행은 만료 대상", () => {
  assert.equal(
    isNullExpiryRowDue({ id: "a", status: "open", expires_at: null, created_at: isoHoursAgo(49) }, NOW, hoursForStatus),
    true
  );
});

test("open: 48h 안 지난 NULL-expires 행은 아직 아님", () => {
  assert.equal(
    isNullExpiryRowDue({ id: "a", status: "open", expires_at: null, created_at: isoHoursAgo(47) }, NOW, hoursForStatus),
    false
  );
});

test("assigned(direct): 72h 경계 — 71h 미도달 / 73h 도달", () => {
  assert.equal(isNullExpiryRowDue({ id: "a", status: "assigned", created_at: isoHoursAgo(71) }, NOW, hoursForStatus), false);
  assert.equal(isNullExpiryRowDue({ id: "a", status: "assigned", created_at: isoHoursAgo(73) }, NOW, hoursForStatus), true);
});

test("만료 대상 아닌 status(answered 등)는 폴백에서 제외", () => {
  assert.equal(isNullExpiryRowDue({ id: "a", status: "answered", created_at: isoHoursAgo(1000) }, NOW, hoursForStatus), false);
});

test("created_at 이 없거나 파싱 불가면 대상 아님(fail-safe)", () => {
  assert.equal(isNullExpiryRowDue({ id: "a", status: "open", created_at: "" }, NOW, hoursForStatus), false);
  assert.equal(isNullExpiryRowDue({ id: "a", status: "open", created_at: "not-a-date" }, NOW, hoursForStatus), false);
});

test("selectDueNullExpiryRows: expires_at 이 세팅된 행은 폴백에서 제외", () => {
  const rows = [
    { id: "null-due", status: "open", expires_at: null, created_at: isoHoursAgo(100) },
    { id: "has-expiry", status: "open", expires_at: isoHoursAgo(1), created_at: isoHoursAgo(100) },
    { id: "null-early", status: "open", expires_at: null, created_at: isoHoursAgo(1) },
  ];
  const due = selectDueNullExpiryRows(rows, NOW, hoursForStatus).map((r) => r.id);
  assert.deepEqual(due, ["null-due"]);
});

test("mergeExpiryScanRows: 중복 id 제거 + 한도 준수", () => {
  const primary = [{ id: "x" }, { id: "y" }];
  const fallback = [{ id: "y" }, { id: "z" }];
  assert.deepEqual(mergeExpiryScanRows(primary, fallback, 10).map((r) => r.id), ["x", "y", "z"]);
  assert.deepEqual(mergeExpiryScanRows(primary, fallback, 2).map((r) => r.id), ["x", "y"]);
});
