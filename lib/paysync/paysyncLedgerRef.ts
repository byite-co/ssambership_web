// 페이싱크 원장 참조(ledger_order_ref) 생성·판정 — 순수 모듈(node --test 대상).
//
// 왜 이 모듈이 따로 있는가:
//   F11 `api_web_v1.record_cash_topup_v2` 는 `p_order_ref` 에 Toss 주문 형식
//   `^cash-(.+)-(\d+)$` 를 강제하고 캡처한 uuid 가 `p_user_id` 와 같아야 한다.
//   `ivc_...` 를 그대로 넘기면 항상 ORDER_REF_INVALID 다. 새 원장 RPC 신설은
//   금지(킥오프 §1)이므로, 주문 발급 시점에 F11 이 받아들이는 형식의 참조를 만들어
//   `paysync_invoices.ledger_order_ref` 에 고정 저장하고 그 값을 멱등키로 쓴다.
//
// ── 토스 채널과의 충돌은 '불가능'해야 한다 ────────────────────────────────────
// 두 채널의 ref 는 같은 `cash_ledger.idempotency_key` 네임스페이스를 공유한다.
// 같은 값이 두 번 도착하면 F11 은 ON CONFLICT DO NOTHING 후 6필드 대조를 거쳐
// `duplicate: true` 로 **성공 응답**한다. 즉 충돌은 시끄러운 오류가 아니라
// **적립 없는 성공** 으로 나타난다 — 뒤에 온 결제의 돈만 사라진다.
//
// 분리자: 숫자부의 선행 `0`.
//   토스     `cash-{uuid}-{Date.now()}`    (components/cash/CashChargeWidget.tsx)
//   페이싱크  `cash-{uuid}-0{Date.now()}`   (이 모듈)
//
// `Date.now()` 는 양의 정수이고 Number→string 변환은 선행 0 을 만들지 않는다.
// 따라서 토스 숫자부는 절대 '0' 으로 시작하지 않고, 페이싱크 숫자부는 항상
// '0' 으로 시작한다 — 두 문자열 집합의 교집합은 공집합이다. 확률이 아니라 표현
// 형식에서 나오는 구조적 분리이며, 양쪽을 계약 테스트가 고정한다.
//
// DB 쪽에서는 `paysync_invoices_ledger_ref_shape` CHECK 가 선행 0 없는 ref 의
// 저장을 거부한다(마이그레이션 20260830100100).

/** 페이싱크 참조의 숫자부 접두사. 토스(`Date.now()`)가 만들 수 없는 형태. */
export const PAYSYNC_LEDGER_REF_DIGIT_PREFIX = "0";

/** F11 이 강제하는 형식 — 두 채널 공통. */
const CASH_ORDER_REF_RE = /^cash-(.+)-(\d+)$/;

/**
 * 주문 발급 시점에 1회 생성해 `paysync_invoices.ledger_order_ref` 에 고정 저장한다.
 * 저장 후 불변이므로 웹훅이 몇 번 재전송돼도 같은 멱등키가 쓰인다.
 *
 * `nowMs` 는 주입 가능(테스트·결정성). 실제 발급에서는 `Date.now()`.
 */
export function buildPaysyncLedgerOrderRef(userId: string, nowMs: number): string {
  const id = String(userId ?? "").trim().toLowerCase();
  if (!id) throw new Error("buildPaysyncLedgerOrderRef: userId is required");
  if (!Number.isInteger(nowMs) || nowMs <= 0) {
    throw new Error("buildPaysyncLedgerOrderRef: nowMs must be a positive integer");
  }
  return `cash-${id}-${PAYSYNC_LEDGER_REF_DIGIT_PREFIX}${nowMs}`;
}

/** ref 의 숫자부(F11 이 캡처만 하고 쓰지 않는 구간). 형식 불일치면 null. */
export function digitsOfCashOrderRef(ref: string | null | undefined): string | null {
  const m = CASH_ORDER_REF_RE.exec(String(ref ?? "").trim());
  return m?.[2] ?? null;
}

/** 페이싱크가 발급한 참조인가 — 숫자부가 '0' 으로 시작한다. */
export function isPaysyncLedgerOrderRef(ref: string | null | undefined): boolean {
  const digits = digitsOfCashOrderRef(ref);
  return digits !== null && digits.startsWith(PAYSYNC_LEDGER_REF_DIGIT_PREFIX);
}

/** 토스가 발급한 주문 참조인가 — 숫자부가 '0' 으로 시작하지 않는다. */
export function isTossCashOrderRef(ref: string | null | undefined): boolean {
  const digits = digitsOfCashOrderRef(ref);
  return digits !== null && !digits.startsWith(PAYSYNC_LEDGER_REF_DIGIT_PREFIX);
}

/**
 * 토스 주문 참조 생성기의 **정본 복제** — `components/cash/CashChargeWidget.tsx` 와 동일 식.
 * 프로덕션 경로가 이 함수를 쓰지는 않는다. 계약 테스트가 두 채널의 출력이 서로소임을
 * 실제 문자열로 검증할 수 있도록 두는 참조 구현이며, 위젯 쪽 식이 바뀌면 계약 테스트가
 * 먼저 깨지도록 하는 장치다.
 */
export function buildTossCashOrderRefForContract(userId: string, nowMs: number): string {
  return `cash-${userId}-${nowMs}`;
}
