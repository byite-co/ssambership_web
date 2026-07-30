// Toss 캐시 충전 코어 — 순수 모듈(포트 주입, next/supabase 미의존, node --test 대상).
//
// 두 코어를 한 파일에 둔다(순수 모듈 간 cross-import 는 node --test 확장자 제약으로 금지):
//   1) confirmCashTopupCore  — 인증 사용자 기반 승인(confirm) 경로의 검증 순서·판정.
//      success page 와 /api/toss/confirm 이 같은 서버 래퍼(confirmCashTopupServer)로 공유한다.
//   2) recordCashTopupCore   — 원장 멱등 기록 + past_due 복구(best-effort) 오케스트레이션.
//      confirm·webhook 이 recordCashTopupFromTossOrder(서버 래퍼)를 통해 공유한다.
//
// 검증 순서 계약(§confirm): 입력 형식 → 인증 → orderId 파싱 → 소유자 일치 → 패키지
// allowlist → secret → (그제서야) Toss 외부 승인 → 응답 상태·orderId·소유자·금액 재검증 →
// 멱등 원장. 미로그인·타인 orderId·형식 오류·비허용 패키지·secret 누락에서는
// Toss 외부 호출이 정확히 0회다.
//
// 기승인 수렴 계약(§4-2): Toss 가 ALREADY_PROCESSED_PAYMENT 로 응답하면 정본 주문을
// orderId 로 조회해 orderId·userId·amount 가 **전부** 일치할 때만 성공으로 수렴한다.
// 하나라도 불일치면 성공 처리하지 않고 사유별로 차단한다. 수렴 경로도 동일한 멱등
// 원장(9단계)을 통과하므로 중복 원장은 생기지 않는다(hasTopupForOrderId 조기 반환).
// tossLookupOrder 는 이 경우에만 호출되고, 그 외에는 정확히 0회다.
//
// 사용자 오류 노출 계약(§4-4): 사용자에게 보이는 문구는 CONFIRM_ERROR_MESSAGES 고정값
// 뿐이다. Toss 응답 원문·오류 코드 문자열·내부 메시지는 반환값에 담지 않는다.

export function parseUserIdFromCashOrderId(orderId: string): string | null {
  const m = /^cash-(.+)-(\d+)$/.exec(orderId);
  return m?.[1] ?? null;
}

export function krwWonToCents(won: number): number {
  if (!Number.isFinite(won) || won <= 0 || won > 10_000_000) return 0;
  return Math.round(won) * 100;
}

// ── 0. 사용자 오류 매핑 ───────────────────────────────────────────────────────
//
// 계약: 사용자에게는 아래 고정 문구만 보여준다. Toss 응답 원문·내부 오류 메시지·
// 코드 문자열은 절대 노출하지 않는다(원문은 서버 로그에만 남긴다).

export const CONFIRM_ERROR_MESSAGES: Record<string, string> = {
  invalid_params: "결제 정보가 올바르지 않습니다.",
  unauthorized: "로그인이 필요합니다.",
  invalid_order: "주문 번호 형식이 올바르지 않습니다.",
  invalid_package: "허용되지 않은 충전 금액입니다.",
  server_config: "결제 설정이 준비되지 않았습니다.",
  payment_failed: "결제 승인에 실패했습니다.",
  payment_not_done: "결제가 완료 상태가 아닙니다.",
  order_mismatch: "주문 번호가 일치하지 않습니다.",
  amount_mismatch: "결제 금액이 일치하지 않습니다.",
  order_owner_mismatch: "본인 주문만 확인할 수 있습니다.",
  payment_lookup_failed: "이미 처리된 결제를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  ledger_failed: "충전 기록에 실패했습니다.",
  card_declined: "카드사에서 결제를 거절했어요. 다른 카드로 다시 시도해 주세요.",
  card_limit: "카드 한도 또는 잔액이 부족해요. 다른 결제 수단을 이용해 주세요.",
  payment_not_found: "결제 정보를 찾을 수 없습니다. 충전 화면에서 다시 시도해 주세요.",
  provider_error: "결제사 오류로 승인에 실패했어요. 잠시 후 다시 시도해 주세요.",
};

const FALLBACK_MESSAGE = CONFIRM_ERROR_MESSAGES.payment_failed;

/** 내부 오류 코드 → 사용자 노출 문구. 미등록 코드는 일반 문구로 폴백(원문 노출 금지). */
export function userMessageForConfirmCode(code: string): string {
  return CONFIRM_ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
}

/** Toss 가 '이미 승인된 주문'이라고 응답하는 코드. */
const ALREADY_APPROVED_TOSS_CODES = new Set(["ALREADY_PROCESSED_PAYMENT"]);

export function isAlreadyApprovedTossCode(raw: string | null | undefined): boolean {
  return ALREADY_APPROVED_TOSS_CODES.has(String(raw ?? "").trim().toUpperCase());
}

const TOSS_CODE_TO_INTERNAL: Record<string, string> = {
  REJECT_CARD_COMPANY: "card_declined",
  INVALID_STOPPED_CARD: "card_declined",
  INVALID_CARD_EXPIRATION: "card_declined",
  INVALID_CARD_NUMBER: "card_declined",
  NOT_SUPPORTED_CARD_TYPE: "card_declined",
  EXCEED_MAX_DAILY_PAYMENT_COUNT: "card_limit",
  EXCEED_MAX_ONE_DAY_AMOUNT: "card_limit",
  EXCEED_MAX_AMOUNT: "card_limit",
  EXCEED_MAX_PAYMENT_AMOUNT: "card_limit",
  NOT_ENOUGH_BALANCE: "card_limit",
  NOT_FOUND_PAYMENT: "payment_not_found",
  NOT_FOUND_PAYMENT_SESSION: "payment_not_found",
  PROVIDER_ERROR: "provider_error",
  FAILED_INTERNAL_SYSTEM_PROCESSING: "provider_error",
  FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING: "provider_error",
  // 키·권한 문제는 서버 설정 문제다 — 사용자에게 원인을 노출하지 않는다.
  UNAUTHORIZED_KEY: "server_config",
  INCORRECT_BASIC_AUTH_FORMAT: "server_config",
  FORBIDDEN_REQUEST: "server_config",
};

/**
 * Toss 오류 코드 → 내부 코드·HTTP 상태. 미등록 코드는 payment_failed(400)로 폴백한다.
 * server_config 만 500 이고 나머지 사용자 대응 가능 실패는 기존 계약대로 400 이다.
 */
export function mapTossErrorCode(raw: string | null | undefined): { code: string; httpStatus: number } {
  const key = String(raw ?? "").trim().toUpperCase();
  const code = TOSS_CODE_TO_INTERNAL[key] ?? "payment_failed";
  return { code, httpStatus: code === "server_config" ? 500 : 400 };
}

/**
 * 기승인 주문 정본 대조 — orderId·userId·amount **전부** 일치할 때만 ok.
 * 하나라도 어긋나면 성공 수렴을 금지하고 사유 코드를 돌려준다.
 */
export function verifyApprovedOrderMatches(
  data: { status?: unknown; orderId?: unknown; totalAmount?: unknown } | null,
  expected: { orderId: string; userId: string; amountWon: number },
): { ok: true } | { ok: false; code: string } {
  if (!data) return { ok: false, code: "payment_lookup_failed" };
  if (data.status !== "DONE") return { ok: false, code: "payment_not_done" };
  const orderId = typeof data.orderId === "string" ? data.orderId : "";
  if (!orderId || orderId !== expected.orderId) return { ok: false, code: "order_mismatch" };
  // orderId 는 `cash-{userId}-{ts}` — 정본 주문의 소유자가 요청자와 같아야 한다.
  if (parseUserIdFromCashOrderId(orderId) !== expected.userId) {
    return { ok: false, code: "order_owner_mismatch" };
  }
  const won = Number(data.totalAmount ?? Number.NaN);
  if (!Number.isFinite(won) || won !== expected.amountWon) {
    return { ok: false, code: "amount_mismatch" };
  }
  return { ok: true };
}

// ── 1. confirm 코어 ───────────────────────────────────────────────────────────

export type TossPaymentData = { status?: unknown; orderId?: unknown; totalAmount?: unknown; method?: unknown };

export type TossConfirmPortResult = {
  ok: boolean;
  data: TossPaymentData | null;
  /** 실패 시 Toss 오류 코드(있으면). 사용자에게 원문을 노출하지 않는다. */
  errorCode?: string | null;
};

/** orderId 로 정본 주문을 조회하는 포트(기승인 대조 전용). */
export type TossOrderLookupResult = { ok: boolean; data: TossPaymentData | null };

export type RecordTopupPortResult =
  | { ok: true; duplicate: boolean; amount: number; payAmount: number }
  | { ok: false; code: string; message: string };

export type ConfirmCashTopupPorts = {
  /** 현재 인증 사용자 id(없으면 null). Toss 호출보다 반드시 먼저 평가된다. */
  getAuthenticatedUserId: () => Promise<string | null>;
  /** 서버 allowlist 패키지 검사(chargePackages 정본을 주입). */
  isAllowedPayKrw: (payKrw: number) => boolean;
  /** TOSS_SECRET_KEY 존재 여부. */
  hasTossSecret: () => boolean;
  /** Toss 승인 외부 호출 포트 — 테스트가 호출 횟수를 계약으로 검증한다. */
  tossConfirm: (args: { paymentKey: string; orderId: string; amount: number }) => Promise<TossConfirmPortResult>;
  /**
   * orderId 로 정본 주문 조회 포트 — Toss 가 '이미 승인된 주문'이라고 응답했을 때만
   * 호출된다. 그 외 경로에서는 정확히 0회다.
   */
  tossLookupOrder: (orderId: string) => Promise<TossOrderLookupResult>;
  /** 기존 멱등 원장 정본(recordCashTopupFromTossOrder) 포트. */
  recordTopup: (orderId: string, payAmountWon: number) => Promise<RecordTopupPortResult>;
};

export type ConfirmCashTopupOutcome =
  | { ok: true; duplicate: boolean; amount: number; payAmount: number; method: string }
  | { ok: false; httpStatus: number; error: string; message: string };

function fail(httpStatus: number, error: string, message: string): ConfirmCashTopupOutcome {
  return { ok: false, httpStatus, error, message };
}

export async function confirmCashTopupCore(
  input: { paymentKey: unknown; orderId: unknown; amount: unknown },
  ports: ConfirmCashTopupPorts,
): Promise<ConfirmCashTopupOutcome> {
  // 1) 입력 형식
  const paymentKey = typeof input.paymentKey === "string" ? input.paymentKey.trim() : "";
  const orderId = typeof input.orderId === "string" ? input.orderId.trim() : "";
  const amount = typeof input.amount === "number" && Number.isFinite(input.amount) ? input.amount : Number.NaN;
  if (!paymentKey || !orderId || !Number.isFinite(amount) || amount <= 0) {
    return fail(400, "invalid_params", userMessageForConfirmCode("invalid_params"));
  }
  // 2) 인증
  const userId = await ports.getAuthenticatedUserId();
  if (!userId) return fail(401, "unauthorized", userMessageForConfirmCode("unauthorized"));
  // 3) orderId 에서 사용자 식별자 파싱
  const orderUserId = parseUserIdFromCashOrderId(orderId);
  if (!orderUserId) return fail(400, "invalid_order", userMessageForConfirmCode("invalid_order"));
  // 4) 소유자 일치
  if (orderUserId !== userId) return fail(401, "unauthorized", userMessageForConfirmCode("order_owner_mismatch"));
  // 5) 패키지 allowlist(사전 판정 가능한 금액 불일치 차단)
  if (!ports.isAllowedPayKrw(amount)) return fail(400, "invalid_package", userMessageForConfirmCode("invalid_package"));
  // 6) 서버 설정
  if (!ports.hasTossSecret()) return fail(500, "server_config", userMessageForConfirmCode("server_config"));
  // 7) Toss 외부 승인(여기까지 전부 통과한 뒤에만)
  const toss = await ports.tossConfirm({ paymentKey, orderId, amount });
  let d: TossPaymentData | null = toss.ok ? toss.data : null;

  if (!d) {
    // 7-a) 기승인 수렴: Toss 가 '이미 처리된 결제'라고 응답한 경우에만 정본 주문을 조회해
    //      orderId·userId·amount 가 **전부** 일치할 때만 성공으로 수렴한다.
    //      하나라도 불일치하면 성공 처리하지 않고 차단한다(이중 적립·타인 주문 탈취 방지).
    if (isAlreadyApprovedTossCode(toss.errorCode)) {
      const lookup = await ports.tossLookupOrder(orderId);
      if (!lookup.ok || !lookup.data) {
        return fail(400, "payment_lookup_failed", userMessageForConfirmCode("payment_lookup_failed"));
      }
      const verdict = verifyApprovedOrderMatches(lookup.data, { orderId, userId, amountWon: amount });
      if (!verdict.ok) {
        return fail(400, verdict.code, userMessageForConfirmCode(verdict.code));
      }
      d = lookup.data;
    } else {
      const mapped = mapTossErrorCode(toss.errorCode);
      return fail(mapped.httpStatus, mapped.code, userMessageForConfirmCode(mapped.code));
    }
  }

  // 8) 응답 재검증: 상태·orderId·소유자·금액 (승인 경로·기승인 수렴 경로 공통)
  if (d.status !== "DONE") return fail(400, "payment_not_done", userMessageForConfirmCode("payment_not_done"));
  if (d.orderId !== orderId) return fail(400, "order_mismatch", userMessageForConfirmCode("order_mismatch"));
  if (parseUserIdFromCashOrderId(String(d.orderId)) !== userId) {
    return fail(401, "order_owner_mismatch", userMessageForConfirmCode("order_owner_mismatch"));
  }
  const confirmedWon = Number(d.totalAmount ?? Number.NaN);
  if (!Number.isFinite(confirmedWon) || confirmedWon !== amount) {
    return fail(400, "amount_mismatch", userMessageForConfirmCode("amount_mismatch"));
  }
  // 9) 멱등 원장 정본(중복 재호출은 duplicate 로 통과 — 이중 적립 0)
  const topup = await ports.recordTopup(orderId, confirmedWon);
  if (!topup.ok) {
    const httpStatus = topup.code === "invalid_order" || topup.code === "invalid_package" ? 400 : 500;
    return fail(httpStatus, topup.code, topup.message);
  }
  return {
    ok: true,
    duplicate: topup.duplicate,
    amount: topup.amount,
    payAmount: topup.payAmount,
    method: typeof d.method === "string" && d.method ? d.method : "카드",
  };
}

// ── 2. 원장 기록 코어(confirm·webhook 공용 — S2-2 W3(C7)에서 F11 로 전환) ──────
//
// F11 전환 계약(§7 F11 · W3 §4.1):
//   * `p_order_ref` = Toss orderId 원문. 같은 값이 F11 의 멱등키다(별도 키 생성 금지).
//   * 사전 SELECT 로 신규·duplicate 를 추정하지 않는다 — 판정은 F11 반환의
//     `duplicate` 하나뿐이다(구 hasTopupForOrderId 조기 반환 제거).
//   * `duplicate:true` 는 정상 멱등 성공이며 past_due 복구를 재실행하지 않는다.
//   * `LEDGER_FIELD_MISMATCH`(동일 orderId·필드 불일치)는 성공으로 바꾸거나
//     삼키지 않는다 — 코드 그대로 안정 실패로 반환한다.

export type RecordCashTopupCoreResult =
  | { ok: true; duplicate: boolean; amount: number; payAmount: number; userId: string }
  | { ok: false; code: string; message: string };

export type RecordTopupV2PortResult =
  | { ok: true; duplicate: boolean }
  | { ok: false; code: string };

export type RecordCashTopupPorts = {
  isAllowedPayKrw: (payKrw: number) => boolean;
  cashKrwForPayKrw: (payKrw: number) => number | null;
  /**
   * F11 `api_web_v1.record_cash_topup_v2(p_user_id, p_amount_cents, p_order_ref)` 포트.
   * envelope 성공이면 duplicate 플래그, 실패면 안정 코드(ORDER_REF_INVALID ·
   * ORDER_REF_OWNER_MISMATCH · LEDGER_FIELD_MISMATCH · 전송 오류)를 돌려준다.
   */
  recordTopupV2: (userId: string, amountCents: number, orderRef: string) => Promise<RecordTopupV2PortResult>;
  /**
   * past_due 복구 포트 — 'F11 신규 기록 성공(duplicate:false)' 직후에만 1회 호출된다.
   * duplicate 재생에서는 호출하지 않는다(기존 함수 계약 유지). 실패는 코어가
   * 삼켜 적립 결과를 되돌리지 않는다(best-effort 계약 유지).
   */
  recoverPastDue: (userId: string) => Promise<void>;
};

/** F11 envelope 실패 코드 → 기존 안정 실패 결과(코드 은폐·성공 승격 금지). */
function recordTopupFailureFromF11Code(code: string): RecordCashTopupCoreResult {
  switch (code) {
    case "ORDER_REF_INVALID":
      return { ok: false, code: "invalid_order", message: "주문 번호 형식이 올바르지 않습니다." };
    case "ORDER_REF_OWNER_MISMATCH":
      return { ok: false, code: "order_owner_mismatch", message: "본인 주문만 확인할 수 있습니다." };
    case "LEDGER_FIELD_MISMATCH":
      return {
        ok: false,
        code: "LEDGER_FIELD_MISMATCH",
        message: "충전 기록이 기존 결제 내역과 일치하지 않습니다. 고객센터로 문의해 주세요.",
      };
    default:
      return { ok: false, code: "ledger_failed", message: "충전 기록에 실패했습니다." };
  }
}

export async function recordCashTopupCore(
  orderId: string,
  payAmountWon: number,
  ports: RecordCashTopupPorts,
): Promise<RecordCashTopupCoreResult> {
  if (!Number.isFinite(payAmountWon) || payAmountWon <= 0) {
    return { ok: false, code: "invalid_amount", message: "결제 금액이 올바르지 않습니다." };
  }
  if (!ports.isAllowedPayKrw(payAmountWon)) {
    return { ok: false, code: "invalid_package", message: "허용되지 않은 충전 금액입니다." };
  }
  const cashKrw = ports.cashKrwForPayKrw(payAmountWon);
  if (cashKrw == null) {
    return { ok: false, code: "invalid_package", message: "허용되지 않은 충전 금액입니다." };
  }
  const userId = parseUserIdFromCashOrderId(orderId);
  if (!userId) {
    return { ok: false, code: "invalid_order", message: "주문 번호 형식이 올바르지 않습니다." };
  }
  const amountCents = krwWonToCents(cashKrw);
  if (amountCents <= 0) {
    return { ok: false, code: "invalid_amount", message: "충전 금액이 올바르지 않습니다." };
  }
  // 신규/duplicate 판정은 F11 단일 호출이 정본이다(사전 SELECT 추정 금지 — W3 §4.1).
  const rpc = await ports.recordTopupV2(userId, amountCents, orderId);
  if (!rpc.ok) {
    return recordTopupFailureFromF11Code(rpc.code);
  }
  if (rpc.duplicate) {
    return { ok: true, duplicate: true, amount: cashKrw, payAmount: payAmountWon, userId };
  }
  // 신규 적립 성공 → past_due 복구 1회(best-effort — 실패해도 적립 결과 유지).
  try {
    await ports.recoverPastDue(userId);
  } catch {
    // 복구 실패는 적립을 되돌리지 않는다(기존 계약).
  }
  return { ok: true, duplicate: false, amount: cashKrw, payAmount: payAmountWon, userId };
}
