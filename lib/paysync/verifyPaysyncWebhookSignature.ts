// 페이싱크 웹훅 서명 검증 — 순수 모듈(next/supabase 미의존, node --test 대상).
//
// 정본: https://docs.paysync.kr/api-reference/webhooks/overview.md §4
// 페이싱크는 Standard Webhooks 명세를 따른다.
//
// 계약:
//   * 키    — `PAYSYNC_WEBHOOK_SECRET` 은 `whsec_<base64>` 형식이다. 접두사를 떼고
//             남은 문자열을 Base64 디코드한 raw bytes 가 HMAC 키다.
//   * 서명  — HMAC-SHA256(`${webhook-id}.${webhook-timestamp}.${rawBody}`) 을 Base64 로
//             인코딩한 값이 `webhook-signature` 헤더의 `v1,` 뒤 값과 같아야 한다.
//   * 바디  — 반드시 **파싱 전 원본 문자열**을 쓴다. JSON 파싱 후 재직렬화하면 키 순서·
//             공백이 달라져 서명이 깨진다(라우트에서 `req.text()` 로 받는다).
//   * 비교  — 타이밍 세이프 비교. 길이가 다르면 timingSafeEqual 이 throw 하므로 먼저 막는다.
//   * 시각  — `webhook-timestamp` 가 현재와 ±300초를 벗어나면 재전송 공격으로 간주해 거부.
//   * 판정  — boolean 이 아니라 **사유가 있는 verdict** 를 돌려준다. 라우트가 수신 로그에
//             사유를 남겨야 운영 중 "서명이 왜 실패했는지"를 로그만으로 판별할 수 있다.
//
// 시크릿 형식 검증을 별도 사유(`secret_malformed`)로 분리한 이유: Node 의 Base64 디코더는
// 관대해서 URL·평문 같은 비-base64 문자열도 throw 없이 쓰레기 바이트를 만든다. 그대로 두면
// env 설정 실수가 전부 `signature_mismatch` 로 보여 원인 추적이 어긋난다.

import crypto from "node:crypto";

/** Standard Webhooks 필수 헤더 3종. */
export const PAYSYNC_WEBHOOK_ID_HEADER = "webhook-id";
export const PAYSYNC_WEBHOOK_TIMESTAMP_HEADER = "webhook-timestamp";
export const PAYSYNC_WEBHOOK_SIGNATURE_HEADER = "webhook-signature";

/** 타임스탬프 허용 윈도우(초) — 문서 §4 4단계. */
export const PAYSYNC_TIMESTAMP_TOLERANCE_SECONDS = 300;

export type PaysyncSignatureFailureReason =
  /** env `PAYSYNC_WEBHOOK_SECRET` 미설정·빈 값. */
  | "secret_missing"
  /** `whsec_` 접두사 없음 · base64 아님 · 디코드 결과가 너무 짧음. */
  | "secret_malformed"
  /** webhook-id / webhook-timestamp / webhook-signature 중 누락. */
  | "headers_missing"
  /** webhook-timestamp 가 정수 초가 아님. */
  | "timestamp_invalid"
  /** 현재 시각과 ±300초를 벗어남(재전송 의심). */
  | "timestamp_out_of_window"
  /** `v1,<base64>` 형태의 항목이 하나도 없음. */
  | "signature_malformed"
  /** 계산한 HMAC 과 일치하는 서명이 없음. */
  | "signature_mismatch";

export type PaysyncSignatureVerdict =
  | { ok: true; webhookId: string; timestampSeconds: number }
  | { ok: false; reason: PaysyncSignatureFailureReason };

export type PaysyncSignatureInput = {
  rawBody: string;
  webhookId: string | null | undefined;
  webhookTimestamp: string | null | undefined;
  webhookSignature: string | null | undefined;
  /** `whsec_...` 원문. */
  secret: string | null | undefined;
  /** 현재 시각(Unix 초) — 테스트 주입용. */
  nowSeconds: number;
};

const STRICT_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** HMAC 키로 쓰기에 의미 있는 최소 길이(Standard Webhooks 발급 키는 이보다 훨씬 길다). */
const MIN_KEY_BYTES = 16;

/**
 * `whsec_<base64>` → raw HMAC 키 바이트. 형식이 어긋나면 null(호출부가 secret_malformed 로 처리).
 * 접두사 유무를 관대하게 받지 않는다 — 기본 닫힘.
 */
export function decodePaysyncWebhookSecret(secret: string | null | undefined): Buffer | null {
  const trimmed = String(secret ?? "").trim();
  if (!trimmed.startsWith("whsec_")) return null;
  const encoded = trimmed.slice("whsec_".length);
  if (!encoded || !STRICT_BASE64.test(encoded)) return null;
  let key: Buffer;
  try {
    key = Buffer.from(encoded, "base64");
  } catch {
    return null;
  }
  return key.length >= MIN_KEY_BYTES ? key : null;
}

/**
 * `webhook-signature` 헤더에서 v1 서명 후보들을 뽑는다.
 * Standard Webhooks 는 키 로테이션을 위해 공백으로 구분된 복수 서명을 허용한다:
 *   `v1,<base64> v1,<base642>`
 * v1 이 아닌 버전 태그는 무시한다(미래 버전을 v1 키로 검증하지 않는다).
 */
export function parsePaysyncSignatureCandidates(header: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of String(header ?? "").split(/\s+/)) {
    const entry = part.trim();
    if (!entry) continue;
    const comma = entry.indexOf(",");
    if (comma <= 0) continue;
    if (entry.slice(0, comma) !== "v1") continue;
    const sig = entry.slice(comma + 1).trim();
    if (sig) out.push(sig);
  }
  return out;
}

/** 서명 대상 문자열 — `${id}.${timestamp}.${rawBody}` (문서 §4 2단계). */
export function buildPaysyncSignedContent(webhookId: string, timestamp: string, rawBody: string): string {
  return `${webhookId}.${timestamp}.${rawBody}`;
}

function timingSafeEqualBase64(expected: Buffer, candidate: string): boolean {
  if (!STRICT_BASE64.test(candidate)) return false;
  let provided: Buffer;
  try {
    provided = Buffer.from(candidate, "base64");
  } catch {
    return false;
  }
  // 길이가 다르면 timingSafeEqual 이 throw 한다 — 먼저 걸러낸다(문서 예제의 함정).
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

/**
 * 순수 검증 — env·시계에 의존하지 않는다(계약 테스트가 이 함수를 직접 호출한다).
 * 검사 순서: 시크릿 → 헤더 → 타임스탬프 → 서명. 설정 오류가 서명 불일치로 가려지지 않게 한다.
 */
export function verifyPaysyncSignature(input: PaysyncSignatureInput): PaysyncSignatureVerdict {
  const rawSecret = String(input.secret ?? "").trim();
  if (!rawSecret) return { ok: false, reason: "secret_missing" };

  const key = decodePaysyncWebhookSecret(rawSecret);
  if (!key) return { ok: false, reason: "secret_malformed" };

  const webhookId = String(input.webhookId ?? "").trim();
  const timestampRaw = String(input.webhookTimestamp ?? "").trim();
  const signatureHeader = String(input.webhookSignature ?? "").trim();
  if (!webhookId || !timestampRaw || !signatureHeader) {
    return { ok: false, reason: "headers_missing" };
  }

  if (!/^-?\d+$/.test(timestampRaw)) return { ok: false, reason: "timestamp_invalid" };
  const timestampSeconds = Number(timestampRaw);
  if (!Number.isFinite(timestampSeconds)) return { ok: false, reason: "timestamp_invalid" };
  if (Math.abs(input.nowSeconds - timestampSeconds) > PAYSYNC_TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp_out_of_window" };
  }

  const candidates = parsePaysyncSignatureCandidates(signatureHeader);
  if (candidates.length === 0) return { ok: false, reason: "signature_malformed" };

  const expected = crypto
    .createHmac("sha256", key)
    .update(buildPaysyncSignedContent(webhookId, timestampRaw, input.rawBody), "utf8")
    .digest();

  // some() 로 조기 반환하지 않고 모든 후보를 돌려 비교 시간을 후보 수에만 의존시킨다.
  let matched = false;
  for (const candidate of candidates) {
    if (timingSafeEqualBase64(expected, candidate)) matched = true;
  }
  if (!matched) return { ok: false, reason: "signature_mismatch" };

  return { ok: true, webhookId, timestampSeconds };
}

/**
 * 런타임 판정 — `PAYSYNC_WEBHOOK_SECRET` 과 현재 시각을 읽어 위 순수 함수에 넘긴다.
 * 이 모듈은 서버 env 를 읽는다 — 클라이언트 컴포넌트에서 import 금지.
 */
export function verifyPaysyncWebhookSignature(rawBody: string, headers: Headers): PaysyncSignatureVerdict {
  return verifyPaysyncSignature({
    rawBody,
    webhookId: headers.get(PAYSYNC_WEBHOOK_ID_HEADER),
    webhookTimestamp: headers.get(PAYSYNC_WEBHOOK_TIMESTAMP_HEADER),
    webhookSignature: headers.get(PAYSYNC_WEBHOOK_SIGNATURE_HEADER),
    secret: process.env.PAYSYNC_WEBHOOK_SECRET,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
}
