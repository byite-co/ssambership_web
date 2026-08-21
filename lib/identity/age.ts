// S-C: 만나이 판정 — birthdate 를 인자로 받는 순수함수 (KST 기준, 지시서 §2).
//
// NICE 결과 birthdate 는 yyyymmdd 8자리. 판정은 항상 KST 달력 날짜 기준이다
// (서버 타임존과 무관하게 UTC+9 로 환산해 연·월·일만 비교).
// 반환 null = 판정 불가(형식 오류) — 호출측은 fail-closed 로 다룬다.

/** 만 14세 미만 → 보호자 본인인증 의무 체인 대상 */
export const IDENTITY_MINOR_AGE_THRESHOLD = 14 as const;
/** 보호자(법정대리인)는 만 19세 이상이어야 한다 */
export const GUARDIAN_MIN_ADULT_AGE = 19 as const;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type YmdParts = { year: number; month: number; day: number };

/** yyyymmdd(NICE) → 달력 유효성까지 검증한 연·월·일. 실패 시 null. */
export function parseNiceBirthdate(value: string): YmdParts | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** yyyymmdd → 'yyyy-mm-dd' (users.birth_date 저장 형식). 실패 시 null. */
export function niceBirthdateToIsoDate(value: string): string | null {
  const parts = parseNiceBirthdate(value);
  if (!parts) return null;
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}-${mm}-${dd}`;
}

/** 기준 시각의 KST 달력 날짜 (서버 타임존 무관) */
export function kstTodayParts(at: Date): YmdParts {
  const shifted = new Date(at.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** KST 기준 만나이. birthdate 는 yyyymmdd. 판정 불가 시 null. */
export function fullAgeAtKst(birthdate: string, at: Date): number | null {
  const birth = parseNiceBirthdate(birthdate);
  if (!birth) return null;
  const today = kstTodayParts(at);
  let age = today.year - birth.year;
  const birthdayPassed =
    today.month > birth.month || (today.month === birth.month && today.day >= birth.day);
  if (!birthdayPassed) age -= 1;
  return age;
}

/** 만 14세 미만 여부 (self 분기: true → 보호자 체인 필요). 판정 불가 시 null. */
export function isUnderFourteenKst(birthdate: string, at = new Date()): boolean | null {
  const age = fullAgeAtKst(birthdate, at);
  if (age === null) return null;
  return age < IDENTITY_MINOR_AGE_THRESHOLD;
}

/** 보호자 성인(만 19세 이상) 여부. 판정 불가 시 null. */
export function isAdultGuardianKst(birthdate: string, at = new Date()): boolean | null {
  const age = fullAgeAtKst(birthdate, at);
  if (age === null) return null;
  return age >= GUARDIAN_MIN_ADULT_AGE;
}

/**
 * users.birth_date('yyyy-mm-dd') 기반 만 14세 미만 판정 — guardian start 전이 검증용.
 * (verified self 행의 birthdate 는 date 컬럼이라 ISO 로 돌아온다)
 */
export function isUnderFourteenFromIsoDateKst(isoDate: string, at = new Date()): boolean | null {
  const compact = isoDate.trim().replace(/-/g, "");
  return isUnderFourteenKst(compact, at);
}
