import test from "node:test";
import assert from "node:assert/strict";
import {
  fullAgeAtKst,
  isAdultGuardianKst,
  isUnderFourteenFromIsoDateKst,
  isUnderFourteenKst,
  kstTodayParts,
  niceBirthdateToIsoDate,
  parseNiceBirthdate,
} from "../age.ts";

// S-C §5 유닛 게이트 — 만나이 판정 순수함수 경계값(오늘 생일 14세 도달/미달·19세 경계, KST 기준).

// 2026-08-21 00:30 KST == 2026-08-20 15:30 UTC — 서버 UTC 로는 아직 8/20 인 시각.
const AT_KST_MIDNIGHT_PLUS = new Date("2026-08-20T15:30:00Z");

test("KST 달력 판정: UTC 로는 전날이어도 KST 오늘(8/21)로 계산한다", () => {
  assert.deepEqual(kstTodayParts(AT_KST_MIDNIGHT_PLUS), { year: 2026, month: 8, day: 21 });
});

test("만 14세 경계: 오늘(KST) 생일로 14세 도달 → 미만 아님 / 내일 생일 → 미만", () => {
  // 2012-08-21 생 — KST 2026-08-21 에 만 14세 도달
  assert.equal(fullAgeAtKst("20120821", AT_KST_MIDNIGHT_PLUS), 14);
  assert.equal(isUnderFourteenKst("20120821", AT_KST_MIDNIGHT_PLUS), false);
  // 2012-08-22 생 — 생일 전날이라 아직 만 13세
  assert.equal(fullAgeAtKst("20120822", AT_KST_MIDNIGHT_PLUS), 13);
  assert.equal(isUnderFourteenKst("20120822", AT_KST_MIDNIGHT_PLUS), true);
});

test("보호자 성인(만 19세) 경계: 오늘 생일 도달 → 성인 / 하루 미달 → 미성년", () => {
  assert.equal(fullAgeAtKst("20070821", AT_KST_MIDNIGHT_PLUS), 19);
  assert.equal(isAdultGuardianKst("20070821", AT_KST_MIDNIGHT_PLUS), true);
  assert.equal(fullAgeAtKst("20070822", AT_KST_MIDNIGHT_PLUS), 18);
  assert.equal(isAdultGuardianKst("20070822", AT_KST_MIDNIGHT_PLUS), false);
});

test("판정 불가 입력은 null (fail-closed 는 호출측 책임)", () => {
  assert.equal(isUnderFourteenKst("2012-08-21", AT_KST_MIDNIGHT_PLUS), null, "yyyymmdd 만 허용");
  assert.equal(isUnderFourteenKst("20121301", AT_KST_MIDNIGHT_PLUS), null, "13월 거부");
  assert.equal(isUnderFourteenKst("20120230", AT_KST_MIDNIGHT_PLUS), null, "2/30 거부");
  assert.equal(isAdultGuardianKst("", AT_KST_MIDNIGHT_PLUS), null);
  assert.equal(parseNiceBirthdate("18991231"), null, "1900 이전 거부");
});

test("ISO 변환·ISO 기반 판정 (verified self 행 birthdate 는 date 컬럼 → ISO)", () => {
  assert.equal(niceBirthdateToIsoDate("20120821"), "2012-08-21");
  assert.equal(niceBirthdateToIsoDate("20121301"), null);
  assert.equal(isUnderFourteenFromIsoDateKst("2012-08-22", AT_KST_MIDNIGHT_PLUS), true);
  assert.equal(isUnderFourteenFromIsoDateKst("2012-08-21", AT_KST_MIDNIGHT_PLUS), false);
});

test("윤년 2/29 출생 경계: 평년에는 3/1 에 나이가 오른다(생일 미도래 판정)", () => {
  // 2012-02-29 생, 2026-02-28 KST — 아직 만 13세 (2/29 가 없어 2/28 까지는 미도래)
  const at228 = new Date("2026-02-28T00:00:00+09:00");
  assert.equal(fullAgeAtKst("20120229", at228), 13);
  const at301 = new Date("2026-03-01T00:00:00+09:00");
  assert.equal(fullAgeAtKst("20120229", at301), 14);
});
