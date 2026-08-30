import "server-only";

// 페이싱크 REST API 클라이언트 (Phase 2).
//
// 정본: https://docs.paysync.kr/api-reference/introduction.md · .../error-codes.md
//   Base URL `https://api.paysync.kr`, 모든 엔드포인트 `/v1` 접두.
//   인증 `Authorization: Bearer <PAYSYNC_API_KEY>` (서버 전용 — 클라이언트 노출 금지).
//   모든 응답이 `{ code, data }` 형태다. HTTP 상태와 별개로 `code` 가 비즈니스 결과다.
//
// 오류 노출 계약(§1 · 토스 경로와 동일): 사용자에게는 고정 문구만 보여준다.
//   페이싱크 응답 원문·코드 문자열은 반환값에 담지 않고 서버 로그에만 남긴다.
//   env 누락은 토스의 `server_config` 패턴을 그대로 따른다.

import { PAYSYNC_USER_MESSAGES, userMessageForPaysyncCode } from "@/lib/paysync/paysyncErrorMessages";

const PAYSYNC_API_BASE = "https://api.paysync.kr/v1";

/** 문서 §성공 — 이 셋만 성공으로 취급한다. */
const SUCCESS_CODES = new Set(["OK", "CREATED", "DELETED"]);

export type PaysyncInvoiceResource = {
  id?: unknown;
  issuerId?: unknown;
  amount?: unknown;
  paid?: unknown;
  metadata?: unknown;
  customer?: unknown;
  issuedAt?: unknown;
  expiresAt?: unknown;
};

export type PaysyncApiResult<T> =
  | { ok: true; code: string; data: T }
  | {
      ok: false;
      /** 내부 코드 — 페이싱크 `code` 원문 또는 전송 계층 코드. 사용자에게 노출 금지. */
      code: string;
      /** 사용자 노출용 고정 문구. */
      message: string;
      /** HTTP 상태(전송 실패면 null). */
      httpStatus: number | null;
    };

function fail(code: string, httpStatus: number | null): PaysyncApiResult<never> {
  return { ok: false, code, message: userMessageForPaysyncCode(code), httpStatus };
}

function hasApiKey(): string | null {
  const key = process.env.PAYSYNC_API_KEY?.trim();
  return key ? key : null;
}

/**
 * 페이싱크 API 호출 공통부. 성공 판정은 HTTP 상태가 아니라 `code` 다 —
 * 문서가 "HTTP 상태와 별개로 code 가 비즈니스 결과"라고 명시한다.
 *
 * 타임아웃을 반드시 건다: 웹훅 핸들러는 10초 안에 200 을 돌려줘야 하고(페이싱크는
 * 재시도하지 않는다), 크론도 무한 대기하면 안 된다.
 */
async function callPaysync<T>(
  path: string,
  init: { method: "GET" | "POST" | "DELETE"; body?: unknown; timeoutMs?: number },
): Promise<PaysyncApiResult<T>> {
  const key = hasApiKey();
  if (!key) {
    console.error("[paysync/client] PAYSYNC_API_KEY missing");
    return fail("server_config", null);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 5_000);

  let res: Response;
  try {
    res = await fetch(`${PAYSYNC_API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (e) {
    // 네트워크 오류·타임아웃 — 원문은 로그에만.
    console.error("[paysync/client] transport", { path, method: init.method, error: String(e) });
    return fail("transport_failed", null);
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => null)) as
    | { code?: unknown; data?: unknown; error?: unknown; requestId?: unknown }
    | null;

  if (!body || typeof body.code !== "string") {
    // 실측(2026-08-30): 프레임워크 단 검증 실패(400)는 `code` 없이
    // `{timestamp, path, status, error, requestId}` 로 온다 — 문서의 "모든 응답은 code 를
    // 포함한다"와 어긋난다. 성공으로 승격하지 않고, 지원 문의용 requestId 만 남긴다.
    console.error("[paysync/client] non-envelope response", {
      path,
      status: res.status,
      error: typeof body?.error === "string" ? body.error : null,
      requestId: typeof body?.requestId === "string" ? body.requestId : null,
    });
    return fail(res.status === 400 ? "bad_request" : "malformed_response", res.status);
  }

  if (!SUCCESS_CODES.has(body.code)) {
    // 코드 원문은 로그에만 — 사용자에게는 매핑된 고정 문구만 나간다.
    console.error("[paysync/client] api error", { path, status: res.status, code: body.code });
    return fail(body.code, res.status);
  }

  return { ok: true, code: body.code, data: body.data as T };
}

/**
 * 주문 단건 조회 — 적립 직전 **정본 대조**의 근거다.
 *
 * 웹훅 페이로드의 `paid` 는 신뢰할 수 없다(2026-08-30 실측: `invoice.paid` 이벤트인데
 * 본문은 `paid: false`. paysyncWebhookEvent.ts 주석 참조). 반면 이 API 응답의 `paid`
 * 는 전이가 커밋된 뒤 값이라 정본이다. 토스 웹훅이 적립 전 Toss 에 재조회하는
 * `verifyWebhookPaymentWithToss` 와 같은 자리·같은 역할이다.
 */
export function fetchPaysyncInvoice(invoiceId: string, timeoutMs?: number) {
  return callPaysync<PaysyncInvoiceResource>(`/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "GET",
    timeoutMs,
  });
}

export type CreatePaysyncInvoiceInput = {
  /** 입금자명 — 페이싱크 자동 매칭 키. 공백 없이 1~5자(INVALID_CUSTOMER_NAME). */
  depositorName: string;
  /** 결제 금액(원). 패키지 allowlist 검증은 호출부 책임. */
  amountWon: number;
  /** 최대 5쌍 · 키 64자 · 값 1024자. */
  metadata: Record<string, string>;
  /** 기본 "1d". 최대 365일. */
  expireAfter?: string;
  /**
   * 현금영수증(소득공제 PERSONAL). 결제 완료 시 페이싱크가 자동 발행을 시도한다.
   * 생략하면 발행하지 않는다 — 발행 결과는 별도 이벤트로 오지 않으므로(문서 FAQ)
   * 우리 쪽에서 상태를 추적하지 않는다.
   */
  cashReceipt?: { type: "PERSONAL"; identifier: string } | null;
};

/**
 * 주문 발급 — `POST /v1/invoices`.
 *
 * `bankAccountIds` 는 **필수**다(빈 배열 = 전 계좌 수신). 문서 §요청 본문이 required 로
 * 표시하는데 개요 페이지의 예시에는 빠져 있다 — 빠뜨리면 `code` 없는 400 이 온다
 * (2026-08-30 실측). 다중 계좌 라우팅이 필요해지면 그때 채운다.
 *
 * 409 `INVOICE_ALREADY_EXISTS` 는 같은 입금자명·금액의 미결제 주문이 이미 있다는
 * 뜻이다(동명이인 충돌 포함) — 호출부가 본인 pending 주문 재사용/재시도 안내를
 * 판단한다(§5).
 */
export function createPaysyncInvoice(input: CreatePaysyncInvoiceInput, timeoutMs?: number) {
  return callPaysync<PaysyncInvoiceResource>("/invoices", {
    method: "POST",
    timeoutMs,
    body: {
      bankAccountIds: [],
      customer: { name: input.depositorName },
      amount: input.amountWon,
      expireAfter: input.expireAfter ?? "1d",
      metadata: input.metadata,
      ...(input.cashReceipt ? { cashReceipt: input.cashReceipt } : {}),
    },
  });
}

/**
 * 주문 삭제 — `DELETE /v1/invoices/{id}`. 미결제 주문만 삭제할 수 있다.
 * 이미 결제된 주문은 403 `INVOICE_ALREADY_PAID` 로 거부된다 — 호출부는 그 경우
 * 로컬을 canceled 로 내리면 안 된다(입금된 돈이 있다).
 */
export function deletePaysyncInvoice(invoiceId: string, timeoutMs?: number) {
  return callPaysync<null>(`/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "DELETE",
    timeoutMs,
  });
}

export { PAYSYNC_API_BASE, PAYSYNC_USER_MESSAGES };
