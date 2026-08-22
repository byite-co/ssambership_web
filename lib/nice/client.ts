import "server-only";

// S-C: NICE 통합인증 API 클라이언트 — 전 호출이 Gabia 고정IP 프록시(NICE_API_BASE) 경유.
// NICE_API_BASE 외 도메인으로의 직접 호출 코드는 금지다(지시서 금지사항).
//
// 계약:
//  - 토큰 캐시: nice_auth_tokens(service_role 전용) — 만료 5분 버퍼, 없으면 발급.
//  - 1003/1004(토큰 만료/무효): 사용 토큰 폐기 → 재발급 → **1회만** 재시도.
//  - requestNiceAuthResult 는 "실제 사용한 토큰"을 반환한다 — 복호화 키 재료는
//    반드시 이 토큰의 ticket/iterators 다 (lib/nice/crypto.ts 계약).
//  - 로그에는 코드·HTTP 상태만 남긴다. access_token/ticket/enc_data/개인정보 로그 금지.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NICE_RESULT_SUCCESS, resolveNiceTokenExpiryMs } from "@/lib/nice/crypto";

/** 만료 5분 버퍼 — 이 시각 이후까지 유효한 토큰만 캐시 히트로 인정 */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60_000;
/** expires_in 해석 불가 시 보수적 캐시 수명 (짧게 잡아 재발급 유도) */
const TOKEN_FALLBACK_TTL_MS = 30 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;

const TOKEN_INVALID_CODES = new Set(["1003", "1004"]);

export class NiceApiError extends Error {
  /** NICE result_code 원문(예: '1007') 또는 내부 코드(예: 'HTTP_502') */
  readonly code: string;
  readonly httpStatus: number | null;
  constructor(code: string, httpStatus: number | null = null) {
    super(`NICE_API_ERROR:${code}`);
    this.name = "NiceApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function isNiceTokenInvalidCode(code: string | null): boolean {
  return code !== null && TOKEN_INVALID_CODES.has(code);
}

export type NiceTokenRow = {
  id: string;
  access_token: string;
  ticket: string;
  iterators: number;
  expires_at: string;
};

function requiredEnv(name: "NICE_CLIENT_ID" | "NICE_CLIENT_SECRET" | "NICE_API_BASE"): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new NiceApiError(`ENV_MISSING_${name}`);
  }
  return v;
}

function commonHeaders(authorization: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-type": "application/json",
    "X-Intc-DevLang": "Linux/Node.js",
    Authorization: authorization,
  };
  const proxyKey = process.env.NICE_PROXY_KEY?.trim();
  if (proxyKey) {
    headers["X-Proxy-Key"] = proxyKey;
  }
  return headers;
}

/** 응답 envelope 관대 탐색 — top-level 우선, 흔한 래퍼(dataBody/data/body) 폴백 */
function probeField(json: unknown, key: string): unknown {
  if (typeof json !== "object" || json === null) return undefined;
  const obj = json as Record<string, unknown>;
  if (obj[key] !== undefined) return obj[key];
  for (const wrapper of ["dataBody", "data", "body"]) {
    const inner = obj[wrapper];
    if (typeof inner === "object" && inner !== null) {
      const v = (inner as Record<string, unknown>)[key];
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

function stringOf(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function resultCodeOf(json: unknown): string | null {
  return stringOf(probeField(json, "result_code"));
}

async function niceFetch(
  path: string,
  body: Record<string, unknown>,
  authorization: string
): Promise<{ httpStatus: number; json: unknown }> {
  const base = requiredEnv("NICE_API_BASE").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: commonHeaders(authorization),
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    console.error("[nice] fetch failed", { path, error: e instanceof Error ? e.name : "unknown" });
    throw new NiceApiError("NETWORK_ERROR");
  }
  let json: unknown = null;
  try {
    const text = await res.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { httpStatus: res.status, json };
}

/** 실패 응답 → NiceApiError. 1007 은 프록시/IP 등록 문제라 즉시 중단 안내를 로그로 남긴다. */
function throwNiceFailure(path: string, httpStatus: number, code: string | null): never {
  const effective = code ?? `HTTP_${httpStatus}`;
  if (effective === "1007") {
    console.error(
      "[nice] 1007 미등록 IP — 호출이 Gabia 고정IP 프록시(NICE_API_BASE)를 경유하는지, 프록시 공인 IP가 NICE에 등록돼 있는지 확인하세요.",
      { path, httpStatus }
    );
  } else {
    console.error("[nice] api failure", { path, httpStatus, code: effective });
  }
  throw new NiceApiError(effective, httpStatus);
}

/** ① 토큰 발급 — Authorization: Basic + base64url 인코딩·패딩 제거(client_id:client_secret) */
async function issueToken(admin: SupabaseClient): Promise<NiceTokenRow> {
  const clientId = requiredEnv("NICE_CLIENT_ID");
  const clientSecret = requiredEnv("NICE_CLIENT_SECRET");
  // 일반 base64 아님 주의 — Node 'base64url' 은 무패딩 base64url.
  const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64url")}`;

  const { httpStatus, json } = await niceFetch(
    "/ido/intc/v1.0/auth/token",
    { grant_type: "client_credentials", request_no: randomUUID() },
    basic
  );
  const code = resultCodeOf(json);
  if (httpStatus < 200 || httpStatus >= 300 || (code !== null && code !== NICE_RESULT_SUCCESS)) {
    throwNiceFailure("auth/token", httpStatus, code);
  }

  const accessToken = stringOf(probeField(json, "access_token"));
  const ticket = stringOf(probeField(json, "ticket"));
  const iteratorsRaw = probeField(json, "iterators");
  const iterators =
    typeof iteratorsRaw === "number" ? iteratorsRaw : Number(stringOf(iteratorsRaw) ?? Number.NaN);
  if (!accessToken || !ticket || !Number.isInteger(iterators) || iterators <= 0) {
    console.error("[nice] token response malformed", { httpStatus });
    throw new NiceApiError("TOKEN_RESPONSE_MALFORMED", httpStatus);
  }

  const expiresAtMs = resolveNiceTokenExpiryMs(probeField(json, "expires_in"), Date.now());
  if (expiresAtMs === null) {
    console.error("[nice] token expires_in unparsable — fallback ttl 적용", { httpStatus });
  }
  const expiresAtIso = new Date(expiresAtMs ?? Date.now() + TOKEN_FALLBACK_TTL_MS).toISOString();

  const { data, error } = await admin
    .from("nice_auth_tokens")
    .insert({ access_token: accessToken, ticket, iterators, expires_at: expiresAtIso })
    .select("id, access_token, ticket, iterators, expires_at")
    .single();
  if (error || !data) {
    console.error("[nice] token cache insert failed", { message: error?.message });
    throw new NiceApiError("TOKEN_CACHE_WRITE_FAILED");
  }
  return data as NiceTokenRow;
}

/** 캐시 히트(만료 5분 버퍼) 또는 신규 발급 */
export async function getValidNiceToken(admin: SupabaseClient): Promise<NiceTokenRow> {
  const cutoffIso = new Date(Date.now() + TOKEN_EXPIRY_BUFFER_MS).toISOString();
  const { data, error } = await admin
    .from("nice_auth_tokens")
    .select("id, access_token, ticket, iterators, expires_at")
    .gt("expires_at", cutoffIso)
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[nice] token cache read failed — 신규 발급 시도", { message: error.message });
  }
  if (data) return data as NiceTokenRow;
  return issueToken(admin);
}

async function loadTokenById(admin: SupabaseClient, tokenId: string): Promise<NiceTokenRow | null> {
  const { data, error } = await admin
    .from("nice_auth_tokens")
    .select("id, access_token, ticket, iterators, expires_at")
    .eq("id", tokenId)
    .maybeSingle();
  if (error) {
    console.error("[nice] token load failed", { message: error.message });
    return null;
  }
  return (data as NiceTokenRow | null) ?? null;
}

/** 1003/1004 를 받은 토큰은 캐시에서 제거(베스트 에포트 — 실패해도 흐름 지속) */
async function discardToken(admin: SupabaseClient, tokenId: string): Promise<void> {
  const { error } = await admin.from("nice_auth_tokens").delete().eq("id", tokenId);
  if (error) {
    console.error("[nice] token discard failed", { message: error.message });
  }
}

export type NiceAuthUrlResult = {
  requestNo: string;
  transactionId: string;
  authUrl: string;
  /** auth/url 호출에 사용한 토큰 행 id — identity_verifications.token_id 로 저장 */
  tokenId: string;
};

/** ② 인증 URL 요청 (svc_types ["M"] 고정 — 카논, method_type GET) */
export async function requestNiceAuthUrl(
  admin: SupabaseClient,
  opts: { returnUrl: string; closeUrl: string }
): Promise<NiceAuthUrlResult> {
  const requestNo = randomUUID();
  const body = {
    request_no: requestNo,
    return_url: opts.returnUrl,
    close_url: opts.closeUrl,
    svc_types: ["M"],
    method_type: "GET",
  };

  let token = await getValidNiceToken(admin);
  let { httpStatus, json } = await niceFetch("/ido/intc/v1.0/auth/url", body, `Bearer ${token.access_token}`);
  let code = resultCodeOf(json);
  if (isNiceTokenInvalidCode(code)) {
    await discardToken(admin, token.id);
    token = await issueToken(admin);
    ({ httpStatus, json } = await niceFetch("/ido/intc/v1.0/auth/url", body, `Bearer ${token.access_token}`));
    code = resultCodeOf(json);
  }
  if (httpStatus < 200 || httpStatus >= 300 || (code !== null && code !== NICE_RESULT_SUCCESS)) {
    throwNiceFailure("auth/url", httpStatus, code);
  }

  const authUrl = stringOf(probeField(json, "auth_url"));
  const transactionId = stringOf(probeField(json, "transaction_id"));
  if (!authUrl || !transactionId) {
    console.error("[nice] auth/url response malformed", { httpStatus });
    throw new NiceApiError("AUTH_URL_RESPONSE_MALFORMED", httpStatus);
  }
  return { requestNo, transactionId, authUrl, tokenId: token.id };
}

export type NiceAuthResultOk = {
  encData: string;
  integrityValue: string;
  /** result 호출에 실제 사용한 토큰 — 복호화 키 재료는 반드시 이 토큰이다 */
  usedToken: NiceTokenRow;
};

/** ③ 인증 결과 요청 — NICE 결과는 1회성(3033). 호출측(CAS 락)이 중복 호출을 막는다. */
export async function requestNiceAuthResult(
  admin: SupabaseClient,
  opts: { requestNo: string; transactionId: string; webTransactionId: string; boundTokenId: string | null }
): Promise<NiceAuthResultOk> {
  const body = {
    request_no: opts.requestNo,
    transaction_id: opts.transactionId,
    web_transaction_id: opts.webTransactionId,
  };

  // 행에 바인딩된 토큰이 아직 유효하면 그대로, 아니면 캐시/발급 경로.
  let token: NiceTokenRow | null = opts.boundTokenId ? await loadTokenById(admin, opts.boundTokenId) : null;
  if (!token || Date.parse(token.expires_at) <= Date.now() + 60_000) {
    token = await getValidNiceToken(admin);
  }

  let { httpStatus, json } = await niceFetch("/ido/intc/v1.0/auth/result", body, `Bearer ${token.access_token}`);
  let code = resultCodeOf(json);
  if (isNiceTokenInvalidCode(code)) {
    await discardToken(admin, token.id);
    token = await issueToken(admin);
    ({ httpStatus, json } = await niceFetch("/ido/intc/v1.0/auth/result", body, `Bearer ${token.access_token}`));
    code = resultCodeOf(json);
  }
  if (httpStatus < 200 || httpStatus >= 300 || (code !== null && code !== NICE_RESULT_SUCCESS)) {
    throwNiceFailure("auth/result", httpStatus, code);
  }

  const encData = stringOf(probeField(json, "enc_data"));
  const integrityValue = stringOf(probeField(json, "integrity_value"));
  if (!encData || !integrityValue) {
    console.error("[nice] auth/result response malformed", { httpStatus });
    throw new NiceApiError("RESULT_RESPONSE_MALFORMED", httpStatus);
  }
  return { encData, integrityValue, usedToken: token };
}
