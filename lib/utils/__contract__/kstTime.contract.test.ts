// 계약 테스트: KST 고정 시각 유틸 (TZ-FIX R2 §1-2 신설분) — 경계 4시각 × 각 함수 고정.
//
// 경계 4시각(KST): 00:30(UTC 전날 15:30 — UTC 달력이 하루 이르게 갈리는 구간) ·
// 08:59(UTC 전날 23:59 — 경계 직전) · 09:00(UTC 00:00 — UTC/KST 달력일 일치 시작) ·
// 23:59(UTC 14:59). 서버(UTC)·브라우저(임의 TZ) 어디서 실행해도 결과가 같아야 한다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  formatKoDateTimeKst,
  kstDayString,
  kstDayDiff,
  kstMonthStartInstant,
} from "../kstTime.ts";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** KST 벽시계 (y, m, d, hh:mm) 의 instant */
function kstInstant(y: number, m: number, d: number, hh: number, mm = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - KST_OFFSET_MS);
}

// 기준일: 2026-08-29 (KST) — 경계 4시각의 instant
const CASES: Array<[label: string, at: Date]> = [
  ["00:30", kstInstant(2026, 8, 29, 0, 30)], // 2026-08-28T15:30:00Z
  ["08:59", kstInstant(2026, 8, 29, 8, 59)], // 2026-08-28T23:59:00Z
  ["09:00", kstInstant(2026, 8, 29, 9, 0)],  // 2026-08-29T00:00:00Z
  ["23:59", kstInstant(2026, 8, 29, 23, 59)], // 2026-08-29T14:59:00Z
];

test("formatKoDateTimeKst — 경계 4시각 전부 KST 달력일 8월 29일·해당 시각으로 표기", () => {
  // 오전/오후 라벨은 ICU 빌드(full-icu/small-icu)에 따라 "오전"/"AM"으로 갈리므로
  // 기대값은 KST 판정에 핵심인 달력일 + 12시간제 시:분만 고정한다.
  const expectedHm: Record<string, string> = {
    "00:30": "12:30",
    "08:59": "8:59",
    "09:00": "9:00",
    "23:59": "11:59",
  };
  for (const [label, at] of CASES) {
    const out = formatKoDateTimeKst(at.toISOString());
    assert.ok(out.includes("2026. 8. 29."), `KST ${label}: 달력일이 KST(8/29)가 아니다 — ${out}`);
    assert.ok(out.includes(expectedHm[label]), `KST ${label}: 시각 표기 상이 — ${out}`);
    assert.ok(!out.includes("8. 28."), `KST ${label}: UTC 달력일(8/28) 잔존 — ${out}`);
  }
  // 빈 값·파싱 불가 값 계약
  assert.equal(formatKoDateTimeKst(null), "—");
  assert.equal(formatKoDateTimeKst(""), "—");
  assert.equal(formatKoDateTimeKst("not-a-date"), "not-a-date");
});

test("kstDayString — 경계 4시각 전부 '2026-08-29' (UTC 달력일과 무관)", () => {
  for (const [label, at] of CASES) {
    assert.equal(kstDayString(at), "2026-08-29", `KST ${label} (Date 입력)`);
    assert.equal(kstDayString(at.toISOString()), "2026-08-29", `KST ${label} (string 입력)`);
  }
  // 대조: UTC 달력일은 00:30·08:59 케이스에서 전날(08-28)이다.
  assert.equal(CASES[0][1].toISOString().slice(0, 10), "2026-08-28");
  assert.equal(CASES[1][1].toISOString().slice(0, 10), "2026-08-28");
});

test("kstDayDiff — 경계 4시각 어느 시각끼리도 같은 KST 달력일이면 0, 다음 날 00:30과는 1", () => {
  for (const [labelA, a] of CASES) {
    for (const [labelB, b] of CASES) {
      assert.equal(kstDayDiff(a, b), 0, `${labelA} → ${labelB}`);
    }
  }
  const nextDay0030 = kstInstant(2026, 8, 30, 0, 30);
  for (const [label, at] of CASES) {
    assert.equal(kstDayDiff(at, nextDay0030), 1, `${label} → 익일 00:30`);
    assert.equal(kstDayDiff(nextDay0030, at), -1, `익일 00:30 → ${label} (역방향)`);
  }
});

test("kstMonthStartInstant — 경계 4시각 전부 KST 8/1 00:00 instant (= 2026-07-31T15:00:00Z)", () => {
  const expected = kstInstant(2026, 8, 1, 0, 0);
  assert.equal(expected.toISOString(), "2026-07-31T15:00:00.000Z");
  for (const [label, at] of CASES) {
    assert.equal(kstMonthStartInstant(at).toISOString(), expected.toISOString(), `KST ${label}`);
  }
  // 월초 경계 대조: KST 9/1 00:30(UTC 8/31 15:30)은 9월 1일 00:00 KST 로 귀속돼야 한다.
  assert.equal(
    kstMonthStartInstant(kstInstant(2026, 9, 1, 0, 30)).toISOString(),
    kstInstant(2026, 9, 1, 0, 0).toISOString()
  );
});
