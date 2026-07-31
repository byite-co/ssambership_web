import { getStringField } from "@/lib/qna/safeSelect";

type Row = Record<string, unknown>;

const LEDGER_TYPE_KO: Record<string, string> = {
  refund_approved: "환불 승인",
  subscription_payment: "구독 결제",
  subscription_renewal: "구독 갱신",
  staging_manual_cash_topup_for_subscription_repair_test: "운영 조정(수동 충전)",
  custom_order_escrow_hold: "맞춤의뢰 안전 결제",
  custom_order_escrow_payout: "맞춤의뢰 정산 지급",
  custom_order_escrow_refund: "맞춤의뢰 환불",
  custom_order_dispute_payout: "맞춤의뢰 분쟁 분배(멘토)",
  custom_order_dispute_refund: "맞춤의뢰 분쟁 분배(학생)",
  individual_question_escrow_hold: "개별 질문 안전 결제",
  individual_question_payout: "개별 질문 답변 지급",
  individual_question_refund: "개별 질문 환불",
  cash_topup: "캐시 충전",
  topup: "충전",
  debit: "차감",
  credit: "적립",
  adjustment: "조정",
  payout: "지급",
  refund: "환불",
};

function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim());
}

function formatKoDateTime(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function ledgerAt(row: Row): string {
  const raw = getStringField(row, ["created_at", "inserted_at", "occurred_at", "updated_at", "at"]) ?? "—";
  if (raw === "—") return "—";
  return formatKoDateTime(raw);
}

export function ledgerTypeLabel(row: Row): string {
  const raw = getStringField(row, ["type", "entry_type", "kind", "category", "direction", "action"]) ?? "—";
  if (raw === "—") return "—";
  const key = raw.trim().toLowerCase();
  if (LEDGER_TYPE_KO[key]) return LEDGER_TYPE_KO[key];
  if (key.includes("_")) return key.replace(/_/g, " ");
  return raw;
}

export function ledgerAmountLabel(row: Row): string {
  for (const k of ["delta_cents", "amount_cents", "change_amount", "amount", "value"] as const) {
    if (!(k in row)) continue;
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      if (k === "delta_cents" || k === "amount_cents" || k === "change_amount") {
        const n = v / 100;
        const body = Math.abs(n).toLocaleString("ko-KR", { maximumFractionDigits: 0 });
        return `${n < 0 ? "-" : ""}${body}캐시`;
      }
      return `${v.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}캐시`;
    }
  }
  return "—";
}

export function ledgerReasonLabel(row: Row): string {
  for (const field of ["ref_type", "reason", "description", "note", "memo", "summary", "label", "title"] as const) {
    const raw = getStringField(row, [field]);
    if (!raw || raw === "—") continue;
    const key = raw.trim().toLowerCase();
    if (LEDGER_TYPE_KO[key]) return LEDGER_TYPE_KO[key];
  }
  return ledgerTypeLabel(row);
}

/** 주문/결제 연결(있다면) — UUID는 축약 표기 */
export type LedgerUiKind = "charge" | "subscription" | "custom_request" | "other";

export function ledgerUiKind(row: Row): LedgerUiKind {
  const typeRaw = getStringField(row, ["type", "entry_type", "kind", "category"]) ?? "";
  const reasonRaw = getStringField(row, ["reason", "description", "note", "memo", "summary"]) ?? "";
  const blob = `${typeRaw} ${reasonRaw}`.toLowerCase();
  if (/custom.?request|맞춤|의뢰|order/.test(blob)) return "custom_request";
  if (/subscription|구독|subscribe|멤버십/.test(blob)) return "subscription";
  if (/topup|charge|충전|credit|deposit|staging/.test(blob)) return "charge";
  return "other";
}

export function ledgerIsCredit(row: Row): boolean {
  const label = ledgerAmountLabel(row);
  return !label.startsWith("-") && label !== "—";
}

export function ledgerBalanceAfter(row: Row): string {
  for (const k of ["balance_after_cents", "balance_cents", "balance_after", "running_balance_cents"] as const) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      const n = k.includes("cents") ? v / 100 : v;
      return `${Math.round(n).toLocaleString("ko-KR")}캐시`;
    }
  }
  return "—";
}

export function ledgerOrderOrPaymentRef(row: Row): string {
  // W1(C1): V5 `order_ref` 우선 — topup 행의 Toss 주문번호(계약 §6 V5, W3 가시화)
  const a = getStringField(row, [
    "order_ref",
    "payment_id",
    "order_id",
    "ref_id",
    "reference_id",
    "external_id",
    "pg_transaction_id",
    "transaction_id",
    "custom_request_order_id",
  ]);
  if (a) {
    if (looksLikeUuid(a)) return `관련 번호 ···${a.slice(-6)}`;
    if (a.length > 24) return `${a.slice(0, 10)}…`;
    return a;
  }
  for (const k of ["metadata", "payload", "data"]) {
    const v = row[k];
    if (typeof v === "string" && v.length < 200) return v.length > 24 ? `${v.slice(0, 12)}…` : v;
  }
  return "—";
}
