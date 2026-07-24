// Toss 캐시 충전 코어 — 순수 모듈(포트 주입, next/supabase 미의존, node --test 대상).
//
// 두 코어를 한 파일에 둔다(순수 모듈 간 cross-import 는 node --test 확장자 제약으로 금지):
//   1) confirmCashTopupCore  — 인증 사용자 기반 승인(confirm) 경로의 검증 순서·판정.
//      success page 와 /api/toss/confirm 이 같은 서버 래퍼(confirmCashTopupServer)로 공유한다.
//   2) recordCashTopupCore   — 원장 멱등 기록 + past_due 복구(best-effort) 오케스트레이션.
//      confirm·webhook 이 recordCashTopupFromTossOrder(서버 래퍼)를 통해 공유한다.
//
// 검증 순서 계약(§confirm): 입력 형식 → 인증 → orderId 파싱 → 소유자 일치 → 패키지
// allowlist → secret → (그제서야) Toss 외부 승인 → 응답 상태·orderId·금액 재검증 →
// 멱등 원장. 미로그인·타인 orderId·형식 오류·비허용 패키지·secret 누락에서는
// Toss 외부 호출이 정확히 0회다.

export function parseUserIdFromCashOrderId(orderId: string): string | null {
  const m = /^cash-(.+)-(\d+)$/.exec(orderId);
  return m?.[1] ?? null;
}

export function krwWonToCents(won: number): number {
  if (!Number.isFinite(won) || won <= 0 || won > 10_000_000) return 0;
  return Math.round(won) * 100;
}

// ── 1. confirm 코어 ───────────────────────────────────────────────────────────

export type TossConfirmPortResult = {
  ok: boolean;
  data: { status?: unknown; orderId?: unknown; totalAmount?: unknown; method?: unknown } | null;
};

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
    return fail(400, "invalid_params", "결제 정보가 올바르지 않습니다.");
  }
  // 2) 인증
  const userId = await ports.getAuthenticatedUserId();
  if (!userId) return fail(401, "unauthorized", "로그인이 필요합니다.");
  // 3) orderId 에서 사용자 식별자 파싱
  const orderUserId = parseUserIdFromCashOrderId(orderId);
  if (!orderUserId) return fail(400, "invalid_order", "주문 번호 형식이 올바르지 않습니다.");
  // 4) 소유자 일치
  if (orderUserId !== userId) return fail(401, "unauthorized", "본인 주문만 확인할 수 있습니다.");
  // 5) 패키지 allowlist(사전 판정 가능한 금액 불일치 차단)
  if (!ports.isAllowedPayKrw(amount)) return fail(400, "invalid_package", "허용되지 않은 충전 금액입니다.");
  // 6) 서버 설정
  if (!ports.hasTossSecret()) return fail(500, "server_config", "결제 설정이 준비되지 않았습니다.");
  // 7) Toss 외부 승인(여기까지 전부 통과한 뒤에만)
  const toss = await ports.tossConfirm({ paymentKey, orderId, amount });
  if (!toss.ok || !toss.data) return fail(400, "payment_failed", "결제 승인에 실패했습니다.");
  // 8) 응답 재검증: 상태·orderId·금액
  const d = toss.data;
  if (d.status !== "DONE") return fail(400, "payment_not_done", "결제가 완료 상태가 아닙니다.");
  if (d.orderId !== orderId) return fail(400, "order_mismatch", "주문 번호가 일치하지 않습니다.");
  const confirmedWon = Number(d.totalAmount ?? Number.NaN);
  if (!Number.isFinite(confirmedWon) || confirmedWon !== amount) {
    return fail(400, "amount_mismatch", "결제 금액이 일치하지 않습니다.");
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

// ── 2. 원장 기록 코어(confirm·webhook 공용 — 기존 계약 그대로 이식) ─────────────

export type RecordCashTopupCoreResult =
  | { ok: true; duplicate: boolean; amount: number; payAmount: number; userId: string }
  | { ok: false; code: string; message: string };

export type RecordCashTopupPorts = {
  isAllowedPayKrw: (payKrw: number) => boolean;
  cashKrwForPayKrw: (payKrw: number) => number | null;
  hasTopupForOrderId: (orderId: string) => Promise<boolean>;
  /** record_cash_topup RPC — error true 면 실패. */
  recordTopupRpc: (userId: string, amountCents: number, idempotencyKey: string) => Promise<{ error: boolean }>;
  /**
   * past_due 복구 포트 — '신규 원장 기록 성공' 직후에만 1회 호출된다.
   * duplicate 재호출에서는 호출하지 않는다(기존 함수 계약 유지). 실패는 코어가
   * 삼켜 적립 결과를 되돌리지 않는다(best-effort 계약 유지).
   */
  recoverPastDue: (userId: string) => Promise<void>;
};

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
  const already = await ports.hasTopupForOrderId(orderId);
  if (already) {
    return { ok: true, duplicate: true, amount: cashKrw, payAmount: payAmountWon, userId };
  }
  const amountCents = krwWonToCents(cashKrw);
  if (amountCents <= 0) {
    return { ok: false, code: "invalid_amount", message: "충전 금액이 올바르지 않습니다." };
  }
  const rpc = await ports.recordTopupRpc(userId, amountCents, orderId);
  if (rpc.error) {
    return { ok: false, code: "ledger_failed", message: "충전 기록에 실패했습니다." };
  }
  // 신규 적립 성공 → past_due 복구 1회(best-effort — 실패해도 적립 결과 유지).
  try {
    await ports.recoverPastDue(userId);
  } catch {
    // 복구 실패는 적립을 되돌리지 않는다(기존 계약).
  }
  return { ok: true, duplicate: false, amount: cashKrw, payAmount: payAmountWon, userId };
}
