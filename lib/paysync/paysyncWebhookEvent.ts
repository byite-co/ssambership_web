// 페이싱크 웹훅 이벤트 파싱·판정 — 순수 모듈(next/supabase 미의존, node --test 대상).
//
// 정본: https://docs.paysync.kr/api-reference/webhooks/invoice-paid.md
//
// 페이로드 실제 형태(문서 §페이로드 예시):
//   { "type": "invoice.paid", "invoice": { id, amount, paid, metadata, ... }, "trigger": "..." }
// 리소스 키는 `invoice` 다 — 킥오프 문서 §3 의 `data.metadata` 표기는 문서와 어긋나며
// 여기서는 페이싱크 공식 문서를 따른다(§8 보고 대상).
//
// 판정 계약:
//   * `invoice.paid` 외의 type 은 처리하지 않는다(라우트가 200 으로 무시 — 새 이벤트가
//     추가돼도 기존 핸들러가 깨지지 않게).
//   * 적립 대상은 **우리가 발급한 주문**뿐이다: `metadata.userId` 가 있어야 하고,
//     주문 ID 가 `ivc_` 접두사여야 하며, 금액이 충전 패키지 allowlist 를 통과해야 한다.
//     하나라도 어긋나면 적립하지 않고 사유를 남긴다(기본 닫힘).
//   * 멱등키는 주문 ID(`ivc_...`) 다 — 라우트가 `record_cash_topup_v2(p_order_ref)` 로 넘긴다.

/** 문서에 명시된 trigger 값. 로직 분기 없이 감사 로그용으로만 쓴다. */
export const PAYSYNC_PAID_TRIGGERS = [
  "AUTOMATIC_MATCHING",
  "MANUAL_MATCHING",
  "MANUAL_APPROVE",
  "API_CALL",
] as const;

export type PaysyncPaidTrigger = (typeof PAYSYNC_PAID_TRIGGERS)[number];

export function isKnownPaysyncTrigger(raw: unknown): raw is PaysyncPaidTrigger {
  return typeof raw === "string" && (PAYSYNC_PAID_TRIGGERS as readonly string[]).includes(raw);
}

export type PaysyncInvoice = {
  id: string | null;
  amountWon: number;
  paid: boolean;
  userId: string | null;
  customerName: string | null;
  metadata: Record<string, unknown> | null;
};

export type PaysyncWebhookEvent = {
  type: string | null;
  invoice: PaysyncInvoice | null;
  /** 문서 밖 값도 그대로 보존한다(감사 로그용). */
  trigger: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** 원본 JSON → 이벤트 구조. 형태가 어긋나면 해당 필드를 null 로 둔다(throw 하지 않는다). */
export function parsePaysyncWebhookEvent(raw: unknown): PaysyncWebhookEvent {
  const root = asRecord(raw);
  if (!root) return { type: null, invoice: null, trigger: null };

  const invoiceRaw = asRecord(root.invoice);
  let invoice: PaysyncInvoice | null = null;
  if (invoiceRaw) {
    const metadata = asRecord(invoiceRaw.metadata);
    // 금액은 숫자 타입만 인정한다 — `"30000"` 같은 문자열을 조용히 강제변환하지 않는다.
    // 서명으로 발신자는 보장되지만, 직렬화 형태가 바뀌면 금액 해석이 흔들리므로 기본 닫힘.
    const amount = typeof invoiceRaw.amount === "number" ? invoiceRaw.amount : Number.NaN;
    invoice = {
      id: asTrimmedString(invoiceRaw.id),
      amountWon: Number.isFinite(amount) ? amount : Number.NaN,
      paid: invoiceRaw.paid === true,
      userId: metadata ? asTrimmedString(metadata.userId) : null,
      customerName: asTrimmedString(asRecord(invoiceRaw.customer)?.name),
      metadata,
    };
  }

  return {
    type: asTrimmedString(root.type),
    invoice,
    trigger: asTrimmedString(root.trigger),
  };
}

export type PaysyncTopupSkipReason =
  /** `invoice.paid` 이벤트가 아님. */
  | "not_invoice_paid"
  /** `invoice` 객체 자체가 없음(페이로드 형태 이상). */
  | "invoice_missing"
  /** 주문 ID 가 없거나 `ivc_` 접두사가 아님. */
  | "invoice_id_invalid"
  /** `paid` 가 true 가 아님. */
  | "not_paid"
  /** `metadata.userId` 없음 — 우리가 발급하지 않은 주문(대시보드 수기 발행 등). */
  | "user_id_missing"
  /** 금액이 양의 정수가 아님. */
  | "amount_invalid"
  /** 충전 패키지 allowlist 밖 금액. */
  | "amount_not_allowed";

export type PaysyncTopupDecision =
  | {
      ok: true;
      invoiceId: string;
      userId: string;
      payAmountWon: number;
      cashKrw: number;
      trigger: string | null;
    }
  | { ok: false; skip: PaysyncTopupSkipReason };

export type PaysyncTopupDecisionPorts = {
  /** 충전 패키지 allowlist(chargePackages 정본 주입). */
  isAllowedPayKrw: (payKrw: number) => boolean;
  /** 결제 금액 → 지급 캐시(보너스 포함). allowlist 밖이면 null. */
  cashKrwForPayKrw: (payKrw: number) => number | null;
};

/**
 * 적립 대상 여부 판정. 외부 호출·DB 접근 없이 페이로드만으로 결정하며,
 * 거부 사유를 그대로 돌려 라우트가 수신 로그에 남길 수 있게 한다.
 */
export function decidePaysyncTopup(
  event: PaysyncWebhookEvent,
  ports: PaysyncTopupDecisionPorts,
): PaysyncTopupDecision {
  if (event.type !== "invoice.paid") return { ok: false, skip: "not_invoice_paid" };

  const invoice = event.invoice;
  if (!invoice) return { ok: false, skip: "invoice_missing" };
  if (!invoice.id || !invoice.id.startsWith("ivc_")) return { ok: false, skip: "invoice_id_invalid" };
  if (!invoice.paid) return { ok: false, skip: "not_paid" };
  if (!invoice.userId) return { ok: false, skip: "user_id_missing" };

  const payAmountWon = invoice.amountWon;
  if (!Number.isInteger(payAmountWon) || payAmountWon <= 0) return { ok: false, skip: "amount_invalid" };
  if (!ports.isAllowedPayKrw(payAmountWon)) return { ok: false, skip: "amount_not_allowed" };

  const cashKrw = ports.cashKrwForPayKrw(payAmountWon);
  if (cashKrw == null || cashKrw <= 0) return { ok: false, skip: "amount_not_allowed" };

  return {
    ok: true,
    invoiceId: invoice.id,
    userId: invoice.userId,
    payAmountWon,
    cashKrw,
    trigger: event.trigger,
  };
}
