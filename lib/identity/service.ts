import "server-only";

// S-C: 본인인증 플로우 서비스 — start(전이 검증·스로틀·NICE url) / return(완료 처리) /
// 온보딩 상태 판정. 전부 service_role 경유(identity_verifications·users 갱신은
// service_role 전용 — IMPACT W4·수정 제안 #7).
//
// 완료 처리 계약:
//  - NICE 결과는 1회성(3033) — result 수신 이후의 DB 쓰기 실패는 동일 요청 내 1회
//    재시도한다(여기서 잃으면 유저 재인증 = 재과금). 각 쓰기는 멱등으로 설계.
//  - 복호화 키 재료는 "result 호출에 실제 사용한 토큰"의 ticket/iterators (client.ts 반환).
//  - 로그에는 vid·코드만 — 이름/생년월일/ci/di/전화번호/enc_data 로그 금지.

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NiceApiError, requestNiceAuthResult, requestNiceAuthUrl } from "@/lib/nice/client";
import {
  decryptNiceResult,
  deriveNiceSymmetricKeys,
  verifyNiceIntegrity,
  type NiceDecryptedResult,
} from "@/lib/nice/crypto";
import { diHash, encryptIdentityField } from "@/lib/identity/encryption";
import {
  isAdultGuardianKst,
  isUnderFourteenFromIsoDateKst,
  isUnderFourteenKst,
  niceBirthdateToIsoDate,
} from "@/lib/identity/age";

export type IdentityVerificationKind = "self" | "guardian";
export type IdentityVerificationStatus = "pending" | "processing" | "verified" | "failed" | "expired";

export type IdentityVerificationRow = {
  id: string;
  user_id: string;
  kind: IdentityVerificationKind;
  request_no: string;
  transaction_id: string | null;
  token_id: string | null;
  status: IdentityVerificationStatus;
  verified_name: string | null;
  birthdate: string | null;
  di_hash: string | null;
  failure_code: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

const IV_SELECT =
  "id, user_id, kind, request_no, transaction_id, token_id, status, verified_name, birthdate, di_hash, failure_code, verified_at, created_at, updated_at";

/** pending 생성 30분 초과 → expired (return 조회 시 전환) */
const PENDING_TTL_MS = 30 * 60_000;
/** processing 고착 10분 초과 → failed/STUCK_PROCESSING (크래시 고착 방지) */
const PROCESSING_STUCK_MS = 10 * 60_000;
/** 동일 유저 인증 시작 스로틀: 10분당 5회 (인증 건당 과금·남용 방어) */
const START_THROTTLE_WINDOW_MS = 10 * 60_000;
const START_THROTTLE_MAX = 5;
/** NICE return_url 길이 제한 (매뉴얼 250byte) */
const RETURN_URL_MAX_BYTES = 250;

/** 보호자 동의 기록 버전 — user_consent_records.consent_version 관례(kebab + 날짜) */
export const GUARDIAN_CONSENT_VERSION = "guardian-nice-v1-2026-08-21";

/** return 팝업에서 vid 쿼리 유실 대비 이중화 쿠키 이름 (httpOnly — start 가 설정) */
export const NICE_VID_COOKIE = "nice_identity_vid";

/** APP_URL(우선) → NEXT_PUBLIC_SITE_URL 재사용 — return_url 조립용 */
export function resolveAppUrl(): string {
  const raw = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) {
    throw new Error("APP_URL_MISSING");
  }
  return raw.replace(/\/+$/, "");
}

function nowIso(): string {
  return new Date().toISOString();
}

function logError(label: string, meta: Record<string, unknown>): void {
  console.error(`[identity] ${label}`, meta);
}

/** result 수신 이후 DB 쓰기 실패 1회 재시도 (각 쓰기는 멱등) */
async function withOneRetry<T>(label: string, vid: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    logError(`${label} 1차 실패 — 1회 재시도`, { vid, error: e instanceof Error ? e.message : "unknown" });
    return await fn();
  }
}

async function markRowFailed(
  admin: SupabaseClient,
  vid: string,
  failureCode: string,
  fromStatus: IdentityVerificationStatus = "processing"
): Promise<void> {
  const { error } = await admin
    .from("identity_verifications")
    .update({ status: "failed", failure_code: failureCode })
    .eq("id", vid)
    .eq("status", fromStatus);
  if (error) {
    logError("failed 마킹 실패", { vid, failureCode, message: error.message });
  }
}

async function loadVerifiedRows(admin: SupabaseClient, userId: string): Promise<IdentityVerificationRow[]> {
  const { data, error } = await admin
    .from("identity_verifications")
    .select(IV_SELECT)
    .eq("user_id", userId)
    .eq("status", "verified")
    .order("verified_at", { ascending: false });
  if (error) {
    throw new Error(`IDENTITY_ROWS_READ_FAILED:${error.message}`);
  }
  return (data ?? []) as IdentityVerificationRow[];
}

async function loadUserIdentityColumns(
  admin: SupabaseClient,
  userId: string
): Promise<{ id: string; identity_verified_at: string | null } | null> {
  const { data, error } = await admin
    .from("users")
    .select("id, identity_verified_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`IDENTITY_USER_READ_FAILED:${error.message}`);
  }
  return (data as { id: string; identity_verified_at: string | null } | null) ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// start
// ────────────────────────────────────────────────────────────────────────────

export type StartVerificationResult =
  | { ok: true; vid: string; authUrl: string }
  | { ok: false; status: 403 | 429 | 500 | 502; code: string; message: string };

/**
 * 인증 시작 — kind 전이 규칙 검증(§3) 후 NICE 인증 URL 발급 + pending 행 생성.
 *  - self: identity_verified_at null && verified self 행 없음일 때만
 *  - guardian: verified self 존재 + 만 14세 미만 + verified guardian 없음일 때만
 */
export async function startIdentityVerification(
  admin: SupabaseClient,
  opts: { userId: string; kind: IdentityVerificationKind }
): Promise<StartVerificationResult> {
  let user: { id: string; identity_verified_at: string | null } | null;
  let verifiedRows: IdentityVerificationRow[];
  try {
    [user, verifiedRows] = await Promise.all([
      loadUserIdentityColumns(admin, opts.userId),
      loadVerifiedRows(admin, opts.userId),
    ]);
  } catch (e) {
    logError("start 상태 조회 실패", { userId: opts.userId, error: e instanceof Error ? e.message : "unknown" });
    return { ok: false, status: 500, code: "STATE_READ_FAILED", message: "잠시 후 다시 시도해 주세요." };
  }
  if (!user) {
    return { ok: false, status: 500, code: "USER_NOT_FOUND", message: "계정 정보를 확인하지 못했습니다." };
  }

  const verifiedSelf = verifiedRows.find((r) => r.kind === "self") ?? null;
  const verifiedGuardian = verifiedRows.find((r) => r.kind === "guardian") ?? null;

  if (user.identity_verified_at) {
    return { ok: false, status: 403, code: "ALREADY_VERIFIED", message: "이미 본인인증이 완료된 계정입니다." };
  }
  if (opts.kind === "self") {
    if (verifiedSelf) {
      return { ok: false, status: 403, code: "SELF_ALREADY_VERIFIED", message: "본인 인증은 이미 완료됐습니다." };
    }
  } else {
    if (!verifiedSelf || !verifiedSelf.birthdate) {
      return { ok: false, status: 403, code: "GUARDIAN_NOT_APPLICABLE", message: "본인 인증을 먼저 완료해 주세요." };
    }
    if (isUnderFourteenFromIsoDateKst(verifiedSelf.birthdate) !== true) {
      return { ok: false, status: 403, code: "GUARDIAN_NOT_APPLICABLE", message: "보호자 인증 대상이 아닙니다." };
    }
    if (verifiedGuardian) {
      return { ok: false, status: 403, code: "GUARDIAN_ALREADY_VERIFIED", message: "보호자 인증은 이미 완료됐습니다." };
    }
  }

  // 스로틀 — 최근 10분 내 이 유저의 인증 행 생성 수(성공적으로 NICE url 을 받은 건수)
  const windowStartIso = new Date(Date.now() - START_THROTTLE_WINDOW_MS).toISOString();
  const { count, error: countError } = await admin
    .from("identity_verifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", opts.userId)
    .gte("created_at", windowStartIso);
  if (countError) {
    logError("start 스로틀 조회 실패", { userId: opts.userId, message: countError.message });
    return { ok: false, status: 500, code: "STATE_READ_FAILED", message: "잠시 후 다시 시도해 주세요." };
  }
  if ((count ?? 0) >= START_THROTTLE_MAX) {
    return {
      ok: false,
      status: 429,
      code: "THROTTLED",
      message: "인증 시도가 너무 잦습니다. 10분 후 다시 시도해 주세요.",
    };
  }

  const vid = randomUUID();
  let appUrl: string;
  try {
    appUrl = resolveAppUrl();
  } catch {
    logError("APP_URL/NEXT_PUBLIC_SITE_URL 미설정", {});
    return { ok: false, status: 500, code: "APP_URL_MISSING", message: "설정 오류입니다. 관리자에게 문의해 주세요." };
  }
  const returnUrl = `${appUrl}/api/identity/return?vid=${vid}`;
  const closeUrl = `${appUrl}/api/identity/return?vid=${vid}&close=1`;
  if (Buffer.byteLength(returnUrl, "utf8") > RETURN_URL_MAX_BYTES) {
    logError("return_url 250byte 초과", { length: Buffer.byteLength(returnUrl, "utf8") });
    return { ok: false, status: 500, code: "RETURN_URL_TOO_LONG", message: "설정 오류입니다. 관리자에게 문의해 주세요." };
  }

  let authUrl: string;
  let requestNo: string;
  let transactionId: string;
  let tokenId: string;
  try {
    const issued = await requestNiceAuthUrl(admin, { returnUrl, closeUrl });
    authUrl = issued.authUrl;
    requestNo = issued.requestNo;
    transactionId = issued.transactionId;
    tokenId = issued.tokenId;
  } catch (e) {
    const code = e instanceof NiceApiError ? e.code : "NICE_CALL_FAILED";
    return {
      ok: false,
      status: 502,
      code,
      message: "본인인증 기관 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  const { error: insertError } = await admin.from("identity_verifications").insert({
    id: vid,
    user_id: opts.userId,
    kind: opts.kind,
    status: "pending",
    request_no: requestNo,
    transaction_id: transactionId,
    token_id: tokenId,
  });
  if (insertError) {
    logError("start 행 생성 실패", { vid, message: insertError.message });
    return { ok: false, status: 500, code: "START_PERSIST_FAILED", message: "잠시 후 다시 시도해 주세요." };
  }

  return { ok: true, vid, authUrl };
}

// ────────────────────────────────────────────────────────────────────────────
// return — 조회·CAS·완료 처리
// ────────────────────────────────────────────────────────────────────────────

export async function loadVerificationById(
  admin: SupabaseClient,
  vid: string
): Promise<IdentityVerificationRow | null> {
  const { data, error } = await admin
    .from("identity_verifications")
    .select(IV_SELECT)
    .eq("id", vid)
    .maybeSingle();
  if (error) {
    logError("행 조회 실패", { vid, message: error.message });
    return null;
  }
  return (data as IdentityVerificationRow | null) ?? null;
}

/** 생성 30분 초과 pending → expired 전환. 전환했으면 true. */
export async function expirePendingIfStale(admin: SupabaseClient, row: IdentityVerificationRow): Promise<boolean> {
  if (row.status !== "pending") return false;
  if (Date.now() - Date.parse(row.created_at) <= PENDING_TTL_MS) return false;
  const { error } = await admin
    .from("identity_verifications")
    .update({ status: "expired", failure_code: "PENDING_TIMEOUT" })
    .eq("id", row.id)
    .eq("status", "pending");
  if (error) {
    logError("pending 만료 전환 실패", { vid: row.id, message: error.message });
  }
  return true;
}

/** processing 10분 고착 → failed/STUCK_PROCESSING (유저 재시도 가능하게). 전환했으면 true. */
export async function recoverStuckProcessing(admin: SupabaseClient, row: IdentityVerificationRow): Promise<boolean> {
  if (row.status !== "processing") return false;
  if (Date.now() - Date.parse(row.updated_at) <= PROCESSING_STUCK_MS) return false;
  await markRowFailed(admin, row.id, "STUCK_PROCESSING", "processing");
  return true;
}

/**
 * CAS 락: pending → processing 원자 전환. 0행이면 null (중복 실행 — result 재호출 금지).
 */
export async function casLockForProcessing(
  admin: SupabaseClient,
  vid: string
): Promise<IdentityVerificationRow | null> {
  const { data, error } = await admin
    .from("identity_verifications")
    .update({ status: "processing" })
    .eq("id", vid)
    .eq("status", "pending")
    .select(IV_SELECT)
    .maybeSingle();
  if (error) {
    logError("CAS 락 실패", { vid, message: error.message });
    return null;
  }
  return (data as IdentityVerificationRow | null) ?? null;
}

export type CompletionOutcome = {
  status: "verified" | "failed" | "expired";
  /** VERIFIED | GUARDIAN_REQUIRED | DI_CONFLICT | GUARDIAN_NOT_ADULT | GUARDIAN_SELF |
   *  INTEGRITY_FAIL | DECRYPT_FAIL | BIRTHDATE_INVALID | STUCK_PROCESSING | NICE 숫자코드 등 */
  code: string;
};

function isUniqueViolation(error: { code?: string | null } | null): boolean {
  return Boolean(error && error.code === "23505");
}

/** self 완료 반영 — DI 충돌 검사 → 행 verified → users 갱신(14세 분기) */
async function finalizeSelf(
  admin: SupabaseClient,
  row: IdentityVerificationRow,
  result: NiceDecryptedResult
): Promise<CompletionOutcome> {
  const birthIso = niceBirthdateToIsoDate(result.birthdate);
  if (!birthIso) {
    await markRowFailed(admin, row.id, "BIRTHDATE_INVALID");
    return { status: "failed", code: "BIRTHDATE_INVALID" };
  }
  const hash = diHash(result.di);

  const { data: conflict, error: conflictError } = await admin
    .from("identity_verifications")
    .select("id")
    .eq("kind", "self")
    .eq("status", "verified")
    .eq("di_hash", hash)
    .neq("user_id", row.user_id)
    .limit(1)
    .maybeSingle();
  if (conflictError) {
    throw new Error(`DI_CONFLICT_CHECK_FAILED:${conflictError.message}`);
  }
  if (conflict) {
    await markRowFailed(admin, row.id, "DI_CONFLICT");
    return { status: "failed", code: "DI_CONFLICT" };
  }

  const { error: updateError } = await admin
    .from("identity_verifications")
    .update({
      status: "verified",
      verified_at: nowIso(),
      failure_code: null,
      verified_name: result.name || null,
      birthdate: birthIso,
      gender: result.gender || null,
      national_info: result.national_info || null,
      mobile_co: result.mobile_co || null,
      ci_enc: result.ci ? encryptIdentityField(result.ci) : null,
      di_enc: result.di ? encryptIdentityField(result.di) : null,
      mobile_no_enc: result.mobile_no ? encryptIdentityField(result.mobile_no) : null,
      di_hash: hash,
    })
    .eq("id", row.id)
    .eq("status", "processing");
  if (updateError) {
    // 부분 유니크(di_hash, kind='self') 경합 — 동시 인증 레이스도 기존 계정 존재로 처리
    if (isUniqueViolation(updateError)) {
      await markRowFailed(admin, row.id, "DI_CONFLICT");
      return { status: "failed", code: "DI_CONFLICT" };
    }
    throw new Error(`SELF_ROW_UPDATE_FAILED:${updateError.message}`);
  }

  const minor = isUnderFourteenKst(result.birthdate);
  const userPayload: Record<string, unknown> = { birth_date: birthIso };
  if (result.name) {
    userPayload.full_name = result.name;
  }
  // 만 14세 이상일 때만 게이트 개방. 판정 불가(null)는 fail-closed — 보호자 체인으로.
  if (minor === false) {
    userPayload.identity_verified_at = nowIso();
  }
  const { error: userError } = await admin.from("users").update(userPayload).eq("id", row.user_id);
  if (userError) {
    throw new Error(`USER_UPDATE_FAILED:${userError.message}`);
  }
  return minor === false
    ? { status: "verified", code: "VERIFIED" }
    : { status: "verified", code: "GUARDIAN_REQUIRED" };
}

/** 보호자 동의 원장 기록 — idempotency_key=vid 로 멱등 */
async function upsertGuardianConsent(
  admin: SupabaseClient,
  opts: { userId: string; guardianRowId: string }
): Promise<void> {
  const { error } = await admin.from("user_consent_records").upsert(
    {
      user_id: opts.userId,
      consent_type: "minor_guardian_consent",
      consent_actor: "guardian",
      is_minor: true,
      guardian_consent: true,
      consent_version: GUARDIAN_CONSENT_VERSION,
      guardian_ref: opts.guardianRowId,
      source: "identity_verification",
      metadata: { verification_method: "nice_standard_m", verification_id: opts.guardianRowId },
      idempotency_key: opts.guardianRowId,
    },
    { onConflict: "idempotency_key", ignoreDuplicates: true }
  );
  if (error) {
    throw new Error(`GUARDIAN_CONSENT_WRITE_FAILED:${error.message}`);
  }
}

/** guardian 완료 반영 — 성인·본인동일 검사 → 행 verified → 동의 기록 → 게이트 개방 */
async function finalizeGuardian(
  admin: SupabaseClient,
  row: IdentityVerificationRow,
  result: NiceDecryptedResult
): Promise<CompletionOutcome> {
  const birthIso = niceBirthdateToIsoDate(result.birthdate);
  if (!birthIso) {
    await markRowFailed(admin, row.id, "BIRTHDATE_INVALID");
    return { status: "failed", code: "BIRTHDATE_INVALID" };
  }

  const { data: selfRow, error: selfError } = await admin
    .from("identity_verifications")
    .select("id, di_hash")
    .eq("user_id", row.user_id)
    .eq("kind", "self")
    .eq("status", "verified")
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selfError) {
    throw new Error(`GUARDIAN_SELF_LOOKUP_FAILED:${selfError.message}`);
  }
  if (!selfRow || !selfRow.di_hash) {
    await markRowFailed(admin, row.id, "GUARDIAN_NOT_APPLICABLE");
    return { status: "failed", code: "GUARDIAN_NOT_APPLICABLE" };
  }

  if (isAdultGuardianKst(result.birthdate) !== true) {
    await markRowFailed(admin, row.id, "GUARDIAN_NOT_ADULT");
    return { status: "failed", code: "GUARDIAN_NOT_ADULT" };
  }

  const hash = diHash(result.di);
  if (hash === selfRow.di_hash) {
    await markRowFailed(admin, row.id, "GUARDIAN_SELF");
    return { status: "failed", code: "GUARDIAN_SELF" };
  }

  const { error: updateError } = await admin
    .from("identity_verifications")
    .update({
      status: "verified",
      verified_at: nowIso(),
      failure_code: null,
      verified_name: result.name || null,
      birthdate: birthIso,
      gender: result.gender || null,
      national_info: result.national_info || null,
      mobile_co: result.mobile_co || null,
      ci_enc: result.ci ? encryptIdentityField(result.ci) : null,
      di_enc: result.di ? encryptIdentityField(result.di) : null,
      mobile_no_enc: result.mobile_no ? encryptIdentityField(result.mobile_no) : null,
      di_hash: hash,
    })
    .eq("id", row.id)
    .eq("status", "processing");
  if (updateError) {
    throw new Error(`GUARDIAN_ROW_UPDATE_FAILED:${updateError.message}`);
  }

  await upsertGuardianConsent(admin, { userId: row.user_id, guardianRowId: row.id });

  // 보호자 인증 완료 → 게이트 개방. 보호자의 이름·생년월일로 자녀 users 를 덮지 않는다.
  const { error: userError } = await admin
    .from("users")
    .update({ identity_verified_at: nowIso() })
    .eq("id", row.user_id);
  if (userError) {
    throw new Error(`USER_GATE_OPEN_FAILED:${userError.message}`);
  }
  return { status: "verified", code: "VERIFIED" };
}

/**
 * CAS 락 성공 행에 대한 완료 처리 — NICE result 호출 → 무결성 → 복호화 → 반영.
 */
export async function completeIdentityVerification(
  admin: SupabaseClient,
  opts: { row: IdentityVerificationRow; webTransactionId: string }
): Promise<CompletionOutcome> {
  const { row } = opts;
  if (!row.transaction_id) {
    await markRowFailed(admin, row.id, "TRANSACTION_MISSING");
    return { status: "failed", code: "TRANSACTION_MISSING" };
  }

  let encData: string;
  let integrityValue: string;
  let usedTicket: string;
  let usedIterators: number;
  let usedTokenId: string;
  try {
    const nice = await requestNiceAuthResult(admin, {
      requestNo: row.request_no,
      transactionId: row.transaction_id,
      webTransactionId: opts.webTransactionId,
      boundTokenId: row.token_id,
    });
    encData = nice.encData;
    integrityValue = nice.integrityValue;
    usedTicket = nice.usedToken.ticket;
    usedIterators = nice.usedToken.iterators;
    usedTokenId = nice.usedToken.id;
  } catch (e) {
    if (e instanceof NiceApiError) {
      if (e.code === "3032") {
        // 인증 미완료/시간초과 — expired 로 전환해 재시도 유도
        const { error } = await admin
          .from("identity_verifications")
          .update({ status: "expired", failure_code: "3032" })
          .eq("id", row.id)
          .eq("status", "processing");
        if (error) {
          logError("3032 expired 전환 실패", { vid: row.id, message: error.message });
        }
        return { status: "expired", code: "3032" };
      }
      if (e.code === "3033") {
        // 결과 기제공 — 재호출 금지(CAS 로 예방되는 경로). 행은 failed 로 재시도 유도.
        logError("3033 결과 기제공 — CAS 우회 중복 호출 흔적 점검 필요", { vid: row.id });
      }
      if (e.code === "3025" || e.code === "3027") {
        logError("복호화/무결성 계열 NICE 오류 — token-ticket 바인딩 로직 점검 플래그", {
          vid: row.id,
          code: e.code,
        });
      }
      await markRowFailed(admin, row.id, e.code);
      return { status: "failed", code: e.code };
    }
    logError("result 호출 실패", { vid: row.id, error: e instanceof Error ? e.message : "unknown" });
    await markRowFailed(admin, row.id, "RESULT_CALL_FAILED");
    return { status: "failed", code: "RESULT_CALL_FAILED" };
  }

  // 핵심 규칙: 복호화 키 재료 = "result 에 실제 사용한 토큰". 재발급됐다면 행 token_id 갱신.
  if (usedTokenId !== row.token_id) {
    const { error } = await admin
      .from("identity_verifications")
      .update({ token_id: usedTokenId })
      .eq("id", row.id);
    if (error) {
      logError("token_id 재바인딩 실패(치명 아님 — 키는 메모리 보유)", { vid: row.id, message: error.message });
    }
  }

  let decrypted: NiceDecryptedResult;
  try {
    const keys = deriveNiceSymmetricKeys(usedTicket, row.transaction_id, usedIterators);
    if (!verifyNiceIntegrity(encData, keys.hmacKey, integrityValue)) {
      // 무결성 불일치 — 데이터 폐기(변수 스코프 종료), 저장·로그 없음
      await markRowFailed(admin, row.id, "INTEGRITY_FAIL");
      return { status: "failed", code: "INTEGRITY_FAIL" };
    }
    decrypted = decryptNiceResult(encData, keys.symKey);
  } catch (e) {
    logError("복호화 실패", { vid: row.id, error: e instanceof Error ? e.message : "unknown" });
    await markRowFailed(admin, row.id, "DECRYPT_FAIL");
    return { status: "failed", code: "DECRYPT_FAIL" };
  }

  try {
    return await withOneRetry("완료 반영", row.id, () =>
      row.kind === "guardian" ? finalizeGuardian(admin, row, decrypted) : finalizeSelf(admin, row, decrypted)
    );
  } catch (e) {
    logError("완료 반영 실패(재시도 포함)", { vid: row.id, error: e instanceof Error ? e.message : "unknown" });
    await markRowFailed(admin, row.id, "PERSIST_FAILED");
    return { status: "failed", code: "PERSIST_FAILED" };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 온보딩 상태 판정 (+ 부분 실패 자가치유)
// ────────────────────────────────────────────────────────────────────────────

export type IdentityOnboardingState =
  | { state: "verified" }
  | { state: "guardian_required" }
  | { state: "self_required" };

/**
 * /onboarding/verify 서버 렌더가 호출하는 상태 판정.
 * verified 행은 있는데 users 반영이 유실된 부분 실패(이중 DB 실패)를 재적용해
 * 유저가 재인증(재과금) 없이 빠져나올 수 있게 한다 — 모든 쓰기는 멱등.
 */
export async function getIdentityOnboardingState(
  admin: SupabaseClient,
  userId: string
): Promise<IdentityOnboardingState> {
  let user: { id: string; identity_verified_at: string | null } | null;
  let verifiedRows: IdentityVerificationRow[];
  try {
    [user, verifiedRows] = await Promise.all([
      loadUserIdentityColumns(admin, userId),
      loadVerifiedRows(admin, userId),
    ]);
  } catch (e) {
    logError("온보딩 상태 조회 실패", { userId, error: e instanceof Error ? e.message : "unknown" });
    return { state: "self_required" };
  }
  if (user?.identity_verified_at) {
    return { state: "verified" };
  }
  const verifiedSelf = verifiedRows.find((r) => r.kind === "self") ?? null;
  if (!verifiedSelf || !verifiedSelf.birthdate) {
    return { state: "self_required" };
  }

  const minor = isUnderFourteenFromIsoDateKst(verifiedSelf.birthdate);
  if (minor === false) {
    // 성인 self verified 인데 users 미반영 — 재적용(멱등)
    const payload: Record<string, unknown> = {
      identity_verified_at: nowIso(),
      birth_date: verifiedSelf.birthdate,
    };
    if (verifiedSelf.verified_name) {
      payload.full_name = verifiedSelf.verified_name;
    }
    const { error } = await admin.from("users").update(payload).eq("id", userId);
    if (error) {
      logError("self 부분실패 자가치유 실패", { userId, message: error.message });
      return { state: "self_required" };
    }
    return { state: "verified" };
  }

  const verifiedGuardian = verifiedRows.find((r) => r.kind === "guardian") ?? null;
  if (verifiedGuardian) {
    // guardian verified 인데 게이트 미개방 — 동의 기록·게이트 재적용(멱등)
    try {
      await upsertGuardianConsent(admin, { userId, guardianRowId: verifiedGuardian.id });
    } catch (e) {
      logError("guardian 동의 자가치유 실패", { userId, error: e instanceof Error ? e.message : "unknown" });
      return { state: "guardian_required" };
    }
    const { error } = await admin
      .from("users")
      .update({ identity_verified_at: nowIso() })
      .eq("id", userId);
    if (error) {
      logError("guardian 부분실패 자가치유 실패", { userId, message: error.message });
      return { state: "guardian_required" };
    }
    return { state: "verified" };
  }

  return { state: "guardian_required" };
}
