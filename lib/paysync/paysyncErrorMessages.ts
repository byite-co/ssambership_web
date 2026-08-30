// 페이싱크 오류 코드 → 사용자 노출 문구 — 순수 모듈(node --test 대상).
//
// 계약(§1 · 토스 CONFIRM_ERROR_MESSAGES 와 동일 원칙):
//   * 사용자에게는 아래 고정 문구만 보여준다. 페이싱크 응답 원문·코드 문자열·HTTP 상태는
//     반환값에 담지 않는다(원문은 서버 로그에만).
//   * 미등록 코드는 일반 문구로 폴백한다 — 새 코드가 생겨도 원문이 새어나가지 않는다.
//
// 코드 정본: https://docs.paysync.kr/api-reference/error-codes.md

export const PAYSYNC_USER_MESSAGES: Record<string, string> = {
  // ── 서버·전송 계층(우리 쪽 문제) ─────────────────────────────────────────
  server_config: "결제 설정이 준비되지 않았습니다.",
  transport_failed: "결제사 연결에 실패했어요. 잠시 후 다시 시도해 주세요.",
  malformed_response: "결제사 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
  // 프레임워크 단 400(문서의 code 봉투가 아닌 응답) — 우리 요청 형식 문제이므로
  // 사용자에게는 원인을 노출하지 않는다(requestId 는 서버 로그에만).
  bad_request: "결제 요청 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.",

  // ── 인증·권한(전부 서버 설정 문제 — 사용자에게 원인 노출 금지) ──────────
  NOT_AUTHORIZED: "결제 설정이 준비되지 않았습니다.",
  INSUFFICIENT_PERMISSIONS: "결제 설정이 준비되지 않았습니다.",

  // ── 주문 상태 ────────────────────────────────────────────────────────────
  INVOICE_NOT_FOUND: "입금 주문을 찾을 수 없습니다. 충전 화면에서 다시 시도해 주세요.",
  INVOICE_ALREADY_PAID: "이미 입금이 확인된 주문입니다.",
  // 동명이인 충돌 — 같은 입금자명·금액의 미결제 주문이 이미 있다(§5).
  INVOICE_ALREADY_EXISTS: "같은 조건의 입금 대기 주문이 있어요. 잠시 후 다시 시도하거나 다른 금액을 선택해 주세요.",

  // ── 주문 생성 검증(Phase 3 에서 쓰지만 문구는 여기 단일 소스로 둔다) ────
  INVALID_AMOUNT: "허용되지 않은 충전 금액입니다.",
  INVALID_CUSTOMER_NAME: "입금자명은 공백 없이 1~5자로 입력해 주세요.",
  INVALID_EMAIL: "이메일 형식이 올바르지 않습니다.",
  INVALID_PHONE_NUMBER: "휴대폰 번호 형식이 올바르지 않습니다.",
  INVALID_DURATION: "결제 설정이 준비되지 않았습니다.",
  EXPIRE_AFTER_EXCEEDS_MAXIMUM: "결제 설정이 준비되지 않았습니다.",
  METADATA_KEY_VALUE_PAIR_LIMIT_EXCEEDED: "결제 설정이 준비되지 않았습니다.",
  METADATA_KEY_LENGTH_LIMIT_EXCEEDED: "결제 설정이 준비되지 않았습니다.",
  METADATA_VALUE_LENGTH_LIMIT_EXCEEDED: "결제 설정이 준비되지 않았습니다.",

  // ── 서버 오류 ────────────────────────────────────────────────────────────
  INTERNAL_SERVER_ERROR: "결제사 오류로 처리에 실패했어요. 잠시 후 다시 시도해 주세요.",
  POPBILL_API_FAILED: "현금영수증 발급 요청이 실패했어요. 고객센터로 문의해 주세요.",
};

const FALLBACK_MESSAGE = "입금 처리에 실패했어요. 잠시 후 다시 시도해 주세요.";

/** 내부/페이싱크 코드 → 사용자 문구. 미등록 코드는 일반 문구로 폴백(원문 노출 금지). */
export function userMessageForPaysyncCode(code: string | null | undefined): string {
  const key = String(code ?? "").trim();
  return PAYSYNC_USER_MESSAGES[key] ?? FALLBACK_MESSAGE;
}
