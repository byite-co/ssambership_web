// 토스 심사 게이트 — 순수 모듈(next/supabase 미의존, node --test 대상).
//
// PG 심사 기간 동안 토스 카드 결제 표면(UI 렌더 · confirm · webhook 적립)은
// `TOSS_REVIEW_ALLOWED_USER_IDS`(쉼표 구분 UUID, 서버 전용 env)에 등재된 심사용
// 계정에만 허용된다. 일반 계정의 충전 수단은 페이싱크 무통장입금이다.
//
// 계약:
//   * env 미설정·빈 값 = **전원 차단**(기본 닫힘). 허용은 명시 등재로만 열린다.
//   * 비교는 trim + 소문자 정규화(UUID 대소문자 표기 차이에 견고).
//   * 이 모듈은 서버 env 를 읽는다 — 클라이언트 컴포넌트에서 import 금지.
//     UI 에는 서버 컴포넌트가 판정한 boolean(tossEnabled)만 내려보낸다.

export function parseTossReviewAllowedUserIds(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of String(raw ?? "").split(",")) {
    const id = part.trim().toLowerCase();
    if (id) out.add(id);
  }
  return out;
}

export function isTossUserIdAllowed(
  userId: string | null | undefined,
  allowlist: ReadonlySet<string>,
): boolean {
  const id = String(userId ?? "").trim().toLowerCase();
  return id.length > 0 && allowlist.has(id);
}

/** 현재 프로세스 env 기준 판정 — 미설정·빈 env 는 전원 차단(기본 닫힘). */
export function isTossAllowedUser(userId: string | null | undefined): boolean {
  return isTossUserIdAllowed(
    userId,
    parseTossReviewAllowedUserIds(process.env.TOSS_REVIEW_ALLOWED_USER_IDS),
  );
}
