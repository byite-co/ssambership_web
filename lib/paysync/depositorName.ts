// 입금자명 검증 — 순수 모듈(node --test 대상). 클라이언트·서버가 **같은 함수**를 쓴다.
//
// 왜 단일 소스인가: 이 값은 페이싱크 자동 매칭의 키다(입금자명 + 금액 정확 일치).
// 클라와 서버 규칙이 어긋나면 통과한 값이 발급 단계에서 INVALID_CUSTOMER_NAME 으로
// 튕기거나(사용자에겐 이유 없는 실패), 더 나쁘게는 발급은 됐는데 은행 입금자명과
// 매칭이 안 되는 주문이 만들어진다.
//
// 규칙 정본: 페이싱크 §요청 본문 `customer.name` — 1~5자, 공백 불가.
//   DB CHECK `paysync_invoices.depositor_name ~ '^[^[:space:]]{1,5}$'` 와 동치여야 한다.

export const DEPOSITOR_NAME_MIN = 1;
export const DEPOSITOR_NAME_MAX = 5;

export const DEPOSITOR_NAME_ERROR = "입금자명은 공백 없이 1~5자로 입력해 주세요.";

/** 앞뒤 공백만 제거한다 — 중간 공백은 제거하지 않고 검증에서 거른다(사용자가 인지해야 한다). */
export function normalizeDepositorName(raw: string | null | undefined): string {
  return String(raw ?? "").trim();
}

/**
 * 1~5자 · 공백 불가. 길이는 **코드포인트** 기준으로 센다
 * (서로게이트 쌍이 2자로 세어져 5자 제한이 흔들리지 않도록).
 */
export function isValidDepositorName(raw: string | null | undefined): boolean {
  const name = normalizeDepositorName(raw);
  if (!name) return false;
  // \s 는 유니코드 공백(전각 공백 U+3000 포함)을 잡는다.
  if (/\s/u.test(name)) return false;
  const length = Array.from(name).length;
  return length >= DEPOSITOR_NAME_MIN && length <= DEPOSITOR_NAME_MAX;
}

/** 유효하면 null, 아니면 고정 문구. 폼 인라인 표시·서버 거부 양쪽이 이 문구를 쓴다. */
export function depositorNameError(raw: string | null | undefined): string | null {
  return isValidDepositorName(raw) ? null : DEPOSITOR_NAME_ERROR;
}

/**
 * 본인인증 실명에서 기본 입금자명을 뽑는다.
 * 5자를 넘거나 공백이 있으면 **자동으로 자르지 않는다** — 잘린 이름으로 발급하면
 * 은행 입금자명과 어긋나 자동 매칭이 실패한다. 빈 기본값을 주고 사용자가 직접 넣게 한다.
 */
export function defaultDepositorNameFrom(verifiedName: string | null | undefined): string {
  const name = normalizeDepositorName(verifiedName);
  return isValidDepositorName(name) ? name : "";
}
