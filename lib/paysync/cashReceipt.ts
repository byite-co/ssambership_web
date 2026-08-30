// 현금영수증(소득공제용) 입력 검증 — 순수 모듈(node --test 대상).
//
// §5: 옵션 `cashReceipt` — 소득공제 PERSONAL + 휴대폰번호.
// 페이싱크가 결제 완료 직후 자동 발행을 시도하고, 결과는 **별도 이벤트로 오지 않는다**
// (문서 FAQ — 대시보드에서 확인). 그래서 우리는 발행 상태를 추적하지 않고,
// 발급 요청 시점의 입력 검증만 책임진다.
//
// 잘못된 번호로 요청하면 주문 발급 자체가 422 `INVALID_CASH_RECEIPT_IDENTIFIER` 로
// 실패한다 — 충전이 통째로 막히므로 클라에서 먼저 거른다.

export const CASH_RECEIPT_PHONE_ERROR = "휴대폰 번호는 하이픈 없이 10~11자리 숫자로 입력해 주세요.";

/** 하이픈·공백 제거. 사용자가 010-1234-5678 로 넣어도 받아준다. */
export function normalizeReceiptPhone(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/[\s-]/g, "");
}

/** 국내 휴대폰 번호(01x) — 하이픈 없이 숫자만, 10~11자리. */
export function isValidReceiptPhone(raw: string | null | undefined): boolean {
  const digits = normalizeReceiptPhone(raw);
  return /^01[0-9]{8,9}$/.test(digits);
}

export function receiptPhoneError(raw: string | null | undefined): string | null {
  return isValidReceiptPhone(raw) ? null : CASH_RECEIPT_PHONE_ERROR;
}

/**
 * 발급 요청에 실을 cashReceipt 객체. 미신청이면 null 을 돌려주고 호출부가 필드를 뺀다.
 * 신청했는데 번호가 유효하지 않으면 `invalid` 로 알려 발급을 막는다.
 */
export function buildCashReceiptInput(params: {
  requested: boolean;
  phone: string | null | undefined;
}): { ok: true; cashReceipt: { type: "PERSONAL"; identifier: string } | null } | { ok: false; message: string } {
  if (!params.requested) return { ok: true, cashReceipt: null };
  if (!isValidReceiptPhone(params.phone)) return { ok: false, message: CASH_RECEIPT_PHONE_ERROR };
  return { ok: true, cashReceipt: { type: "PERSONAL", identifier: normalizeReceiptPhone(params.phone) } };
}
