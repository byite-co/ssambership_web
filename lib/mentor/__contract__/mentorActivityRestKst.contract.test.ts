// 계약 테스트: 멘토 일반휴식 6개월 게이트 KST 달력 산술 — TZ-FIX R2 #16+#17 회귀 고정.
//
// canRequestNormalRest 의 기준선(threshold)은 now 의 KST 벽시계에서 달력 −6개월,
// 대상 월에 없는 일자는 말일로 clamp 해야 한다(setMonth 이월 금지). 지시서 G6 3케이스:
// ① KST 2/29 없음(2026 평년) 경계 ② 8/31 −6개월 = 2/28 clamp ③ KST 08:59/09:01 '오늘' 분기.

import test from "node:test";
import assert from "node:assert/strict";
import { canRequestNormalRest } from "../mentorActivity.ts";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 벽시계 (y, m, d, hh:mm) 의 instant ISO */
function kstIso(y: number, m: number, d: number, hh: number, mm = 0): string {
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - KST_OFFSET_MS).toISOString();
}

test("① 2026 평년 2월 경계 — KST 8/29 신청의 기준선은 2/28(2/29 없음) clamp", () => {
  const now = new Date(kstIso(2026, 8, 29, 10, 0));
  // 기준선 = KST 2026-02-28 10:00. 그 이전(포함) 휴식은 허용, 이후는 차단.
  assert.equal(canRequestNormalRest(kstIso(2026, 2, 28, 10, 0), now), true, "기준선 정각(포함) 허용");
  assert.equal(canRequestNormalRest(kstIso(2026, 2, 28, 10, 1), now), false, "기준선 1분 뒤 차단");
});

test("② KST 8/31 −6개월 = 2/28 clamp — 3/1~3/3 이월(구 setMonth) 금지", () => {
  const now = new Date(kstIso(2026, 8, 31, 10, 0));
  // 구 UTC setMonth 는 8/31→(2/31)→3/3 으로 이월돼 기준선이 최대 3일 미래로 밀렸다.
  assert.equal(canRequestNormalRest(kstIso(2026, 2, 28, 10, 0), now), true, "2/28 10:00(기준선) 허용");
  assert.equal(canRequestNormalRest(kstIso(2026, 3, 1, 10, 0), now), false, "3/1(구 이월 구간) 차단");
  assert.equal(canRequestNormalRest(kstIso(2026, 3, 3, 9, 0), now), false, "3/3(구 이월 상한) 차단");
});

test("③ KST 08:59/09:01 '오늘' 분기 — UTC 날짜가 갈려도 KST 달력 −6개월 동일", () => {
  // 8/29 08:59 KST(UTC 8/28)와 09:01 KST(UTC 8/29) — 어느 쪽이든 기준선은 KST 2/28 동시각.
  const now0859 = new Date(kstIso(2026, 8, 29, 8, 59));
  const now0901 = new Date(kstIso(2026, 8, 29, 9, 1));
  assert.equal(canRequestNormalRest(kstIso(2026, 2, 28, 8, 59), now0859), true, "08:59 기준선 포함 허용");
  assert.equal(canRequestNormalRest(kstIso(2026, 2, 28, 9, 0), now0859), false, "08:59 기준선 1분 뒤 차단");
  assert.equal(canRequestNormalRest(kstIso(2026, 2, 28, 9, 1), now0901), true, "09:01 기준선 포함 허용");
  assert.equal(canRequestNormalRest(kstIso(2026, 2, 28, 9, 2), now0901), false, "09:01 기준선 1분 뒤 차단");
});

test("경계 외 계약 유지 — 휴식 이력 없음·파싱 불가는 허용(true)", () => {
  const now = new Date(kstIso(2026, 8, 29, 10, 0));
  assert.equal(canRequestNormalRest(null, now), true);
  assert.equal(canRequestNormalRest(undefined, now), true);
  assert.equal(canRequestNormalRest("not-a-date", now), true);
});
