// 계약 테스트: 구독 +1개월 기간 산출 KST 달력 패리티 — TZ-FIX R1 (감사 버그표 #1) 회귀 고정.
//
// addMonthsClampedKst 는 DB `((ts at time zone 'Asia/Seoul' + interval '1 month')
// at time zone 'Asia/Seoul')` (SQL 185)와 동일 산술이어야 한다. 핵심 회귀:
// KST 00~09시 결제(UTC 달력으로는 전날)와 같은 날 09시 이후 결제의 기간 길이가
// 같아야 한다 — 3/1 02:00 결제 = 3/1 09:00 결제 = 31일.
//
// 케이스 구성(총 27): 2026년 12개월 각 1일 × KST 02:00/09:00 = 24 + 월말 clamp 3
// (1/31→2/28 · 3/31→4/30 · 8/31→9/30, KST 02:00). 라이브 SQL 대조 27케이스와 동일 입력.

import test from "node:test";
import assert from "node:assert/strict";
import { addMonthsClampedKst } from "../subscriptionsTable.ts";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** KST 벽시계 (y, m, d, hh:mm) 의 instant */
function kstInstant(y: number, m: number, d: number, hh: number, mm = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - KST_OFFSET_MS);
}

/** 2026년 각 월의 일수 (평년) */
const DAYS_IN_MONTH_2026 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

test("2026년 12개월 × KST 02:00/09:00 — 기간 종료가 KST 달력 익월 1일 동시각", () => {
  for (let month = 1; month <= 12; month += 1) {
    for (const hour of [2, 9]) {
      const start = kstInstant(2026, month, 1, hour);
      const end = addMonthsClampedKst(start, 1);
      const expectedEnd =
        month === 12 ? kstInstant(2027, 1, 1, hour) : kstInstant(2026, month + 1, 1, hour);
      assert.equal(
        end.toISOString(),
        expectedEnd.toISOString(),
        `2026-${month}월 1일 KST ${hour}시 결제의 기간 종료가 KST 익월 1일 ${hour}시가 아니다`
      );
    }
  }
});

test("기간 일수 = 해당 KST 월 일수 — 02:00 결제와 09:00 결제가 같은 길이", () => {
  for (let month = 1; month <= 12; month += 1) {
    const days = (hour: number) => {
      const start = kstInstant(2026, month, 1, hour);
      return (addMonthsClampedKst(start, 1).getTime() - start.getTime()) / DAY_MS;
    };
    const days0200 = days(2);
    const days0900 = days(9);
    assert.equal(days0200, days0900, `2026-${month}월: 02:00/09:00 결제 기간 길이 불일치`);
    assert.equal(
      days0200,
      DAYS_IN_MONTH_2026[month - 1],
      `2026-${month}월: 기간 일수가 KST 달력 월 일수와 다르다`
    );
  }
});

test("월말 clamp 3케이스 (KST 02:00) — 1/31→2/28 · 3/31→4/30 · 8/31→9/30", () => {
  const cases: Array<[[number, number], [number, number]]> = [
    [[1, 31], [2, 28]], // 2026 평년
    [[3, 31], [4, 30]],
    [[8, 31], [9, 30]],
  ];
  for (const [[sm, sd], [em, ed]] of cases) {
    const start = kstInstant(2026, sm, sd, 2);
    const end = addMonthsClampedKst(start, 1);
    assert.equal(
      end.toISOString(),
      kstInstant(2026, em, ed, 2).toISOString(),
      `2026-${sm}/${sd} KST 02:00 +1개월이 ${em}/${ed} 02:00 으로 clamp 되지 않았다`
    );
  }
});
