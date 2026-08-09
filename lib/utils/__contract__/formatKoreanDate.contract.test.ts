import test from "node:test";
import assert from "node:assert/strict";
import { formatKoreanDate } from "../formatDisplay.ts";

// N21 회귀 감시: formatKoreanDate 는 시각이 포함된 타임스탬프를 KST(UTC+9) 달력 날짜로
// 변환해야 한다. 구 구현은 ISO 앞 10자를 정규식으로 잘라 UTC 날짜를 그대로 노출했고,
// `…T15:00Z`(KST 자정) 이후 값이 하루 이른 마감일로 보였다(계정 삭제 cancelable_until 등).

test("UTC 15:00 이후 타임스탬프는 KST 다음 날로 표기된다 (N21 핵심 케이스)", () => {
  // 2026-09-08T15:00:00Z == 2026-09-09T00:00:00+09:00
  assert.equal(formatKoreanDate("2026-09-08T15:00:00Z"), "2026.09.09");
  assert.equal(formatKoreanDate("2026-09-08T23:59:59+00:00"), "2026.09.09");
});

test("UTC 15:00 이전 타임스탬프는 같은 날짜로 표기된다", () => {
  // pending 삭제 job 3건의 요청 시각대(06:17 UTC) — KST 로도 같은 날.
  assert.equal(formatKoreanDate("2026-08-09T06:17:00+00:00"), "2026.08.09");
  assert.equal(formatKoreanDate("2026-08-09T14:59:59Z"), "2026.08.09");
});

test("오프셋 명시 입력은 실행 환경 시간대와 무관하게 동일 결과", () => {
  // +09:00 로 이미 표기된 값도 epoch 기준 산술이라 동일 KST 날짜가 나온다.
  assert.equal(formatKoreanDate("2026-09-09T00:00:00+09:00"), "2026.09.09");
});

test("순수 날짜 문자열(YYYY-MM-DD)은 변환 없이 그대로 표기한다", () => {
  assert.equal(formatKoreanDate("2026-08-09"), "2026.08.09");
});

test("빈 값·파싱 불가 값은 — 로 표기한다", () => {
  assert.equal(formatKoreanDate(null), "—");
  assert.equal(formatKoreanDate(""), "—");
  assert.equal(formatKoreanDate("not-a-date"), "—");
});

test("연말 경계: 12-31 15:00Z 는 다음 해 1월 1일(KST)", () => {
  assert.equal(formatKoreanDate("2026-12-31T15:00:00Z"), "2027.01.01");
});
