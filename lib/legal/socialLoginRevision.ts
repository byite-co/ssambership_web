/**
 * 개인정보처리방침 "소셜 로그인(카카오·구글·애플) 도입" 개정 시행일 — **단일 소스**.
 *
 * 두 소비처가 같은 값을 본다:
 *  - `app/(public)/legal/privacy/page.tsx`: 시행일 표기 · 제12조 개정 이력 · 소셜 관련 조항 노출(ACTIVE)
 *  - `components/auth/SocialLoginButtons.tsx`: 시행일 **전에는 버튼을 렌더하지 않는다**
 *
 * 날짜는 KST 달력일 기준(한국 표준시는 DST 없음 · UTC+9 고정). 순수 모듈 — next·supabase 미의존(계약 테스트 공용).
 */

/** 시행일(ISO · KST 달력일). 오너 확정 2026-09-06(2026-09-13) → 2026-09-11 앞당김(2026-09-11 · 선택지 B). */
export const SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_ISO = "2026-09-11";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** `Date` → KST 달력일 "YYYY-MM-DD". */
export function kstCalendarDate(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "2026-09-13" → "2026년 9월 13일" (방침 페이지 표기 형식 · 기존 개정 이력 상수와 같은 꼴). */
export function formatRevisionDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  return `${Number(m[1])}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}

/** 방침 페이지 표기용 시행일 라벨 — ISO 에서 파생(두 값이 어긋날 수 없다). */
export const SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_LABEL = formatRevisionDateLabel(SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_ISO);

/** 개정 고지가 확정됐는가(시행일이 채워졌는가) — 방침 페이지의 소셜 조항·이력 노출 스위치. */
export const SOCIAL_LOGIN_REVISION_ACTIVE = SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_ISO.trim() !== "";

/** 시행일(KST 달력) 당일 0시부터 true — 소셜 로그인 버튼 노출 게이트. */
export function isSocialLoginRevisionEffective(now: Date = new Date()): boolean {
  if (!SOCIAL_LOGIN_REVISION_ACTIVE) return false;
  return kstCalendarDate(now) >= SOCIAL_LOGIN_REVISION_EFFECTIVE_DATE_ISO;
}
