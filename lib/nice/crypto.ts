// S-C: NICE 통합인증 암복호 스펙 (매뉴얼 Node.js 샘플 이식 — 임의 변경 금지).
//
// keyString = base64url_nopad( pbkdf2Sync(ticket, transaction_id, iterators, 64, 'sha256') )
// symKey    = keyString.substring(0, 32)   // 문자열 그대로 bytes → AES-256 키
// hmacKey   = keyString.substring(48, 80)  // 무결성 키
// 검증      = base64url_nopad( HMAC-SHA256(enc_data 문자열, hmacKey) ) === integrity_value
// 복호화    = buf = base64url_decode(enc_data); iv=buf[0:16]; tag=buf[-16:]; cipher=buf[16:-16]
//             AES-256-GCM(symKey, iv, tag 128bit) → UTF-8 JSON
//
// 이 모듈은 순수 계산만 담당한다 — env·DB·네트워크 접근 0, 키 재료(ticket 등)는 전부
// 인자로 받는다(§5 유닛 게이트가 node:test 로 직접 검증). env·시크릿을 읽는 코드는
// server-only 가 부착된 lib/nice/client.ts 에만 둔다.
// 어떤 함수도 입력(ticket/enc_data/복호 결과)을 로그에 남기지 않는다.

import { createDecipheriv, createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";

/** NICE result_code 성공값 */
export const NICE_RESULT_SUCCESS = "0000";

const GCM_IV_BYTES = 16;
const GCM_TAG_BYTES = 16;

/** Node 'base64url' 인코딩은 무패딩 — 매뉴얼의 base64url_nopad 와 동일. */
export function base64UrlNoPad(buf: Buffer): string {
  return buf.toString("base64url");
}

/** base64url·표준 base64 를 모두 허용하는 관대한 디코더 (패딩 유무 무관). */
export function decodeBase64Flexible(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

export type NiceSymmetricKeys = {
  /** substring(0,32) — 문자열 bytes 그대로 AES-256 키 */
  symKey: string;
  /** substring(48,80) — HMAC-SHA256 무결성 키 */
  hmacKey: string;
};

/**
 * 복호화 키 유도. 키 재료는 반드시 "result 호출에 실제 사용한 토큰"의
 * ticket/iterators + auth/url 의 transaction_id 여야 한다 (client.ts 계약).
 */
export function deriveNiceSymmetricKeys(ticket: string, transactionId: string, iterators: number): NiceSymmetricKeys {
  if (!ticket || !transactionId) {
    throw new Error("NICE_KDF_INPUT_MISSING");
  }
  if (!Number.isInteger(iterators) || iterators <= 0) {
    throw new Error("NICE_KDF_ITERATORS_INVALID");
  }
  const keyString = base64UrlNoPad(pbkdf2Sync(ticket, transactionId, iterators, 64, "sha256"));
  // 64byte → base64url 무패딩 86자. substring(48,80) 이 성립해야 한다.
  if (keyString.length < 80) {
    throw new Error("NICE_KDF_OUTPUT_SHORT");
  }
  return {
    symKey: keyString.substring(0, 32),
    hmacKey: keyString.substring(48, 80),
  };
}

/** enc_data 문자열 무결성 검증 (불일치 시 false — 호출측이 failed/INTEGRITY_FAIL 처리). */
export function verifyNiceIntegrity(encData: string, hmacKey: string, integrityValue: string): boolean {
  if (!encData || !hmacKey || !integrityValue) return false;
  const expected = base64UrlNoPad(createHmac("sha256", hmacKey).update(encData, "utf8").digest());
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(integrityValue.trim(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** NICE 인증 결과 복호 JSON (매뉴얼 확정 필드) */
export type NiceDecryptedResult = {
  name: string;
  /** yyyymmdd */
  birthdate: string;
  /** '0' 여 / '1' 남 */
  gender: string;
  national_info: string;
  ci: string;
  di: string;
  mobile_co: string;
  mobile_no: string;
};

function stringField(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

/**
 * enc_data 복호화 → 결과 JSON. 실패 시 throw (호출측이 failed/3025 계열 처리).
 * 반환값·중간 버퍼를 절대 로그로 내보내지 말 것.
 */
export function decryptNiceResult(encData: string, symKey: string): NiceDecryptedResult {
  const buf = decodeBase64Flexible(encData);
  if (buf.length <= GCM_IV_BYTES + GCM_TAG_BYTES) {
    throw new Error("NICE_ENC_DATA_TOO_SHORT");
  }
  const keyBytes = Buffer.from(symKey, "utf8");
  if (keyBytes.length !== 32) {
    throw new Error("NICE_SYM_KEY_LENGTH_INVALID");
  }
  const iv = buf.subarray(0, GCM_IV_BYTES);
  const tag = buf.subarray(buf.length - GCM_TAG_BYTES);
  const cipherText = buf.subarray(GCM_IV_BYTES, buf.length - GCM_TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", keyBytes, iv, { authTagLength: GCM_TAG_BYTES });
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(plain);
  } catch {
    throw new Error("NICE_RESULT_JSON_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("NICE_RESULT_JSON_INVALID");
  }
  const obj = parsed as Record<string, unknown>;
  return {
    name: stringField(obj, "name"),
    birthdate: stringField(obj, "birthdate"),
    gender: stringField(obj, "gender"),
    national_info: stringField(obj, "national_info"),
    ci: stringField(obj, "ci"),
    di: stringField(obj, "di"),
    mobile_co: stringField(obj, "mobile_co"),
    mobile_no: stringField(obj, "mobile_no"),
  };
}

/**
 * 토큰 만료 시각 해석. 매뉴얼 확정값은 expires_in = epoch ms 이나,
 * 단위 오판 시 만료 토큰으로 복호화 키를 유도하는 사고가 나므로 방어적으로 해석한다:
 *   ≥ 1e12  → epoch ms 그대로
 *   ≥ 1e9   → epoch seconds → ×1000 (1e9~1e12 를 ms 로 읽으면 1970~2001 — 만료시각으로 불가능)
 *   > 0     → 상대 seconds → now + ×1000
 *   그 외   → null (호출측이 보수적 짧은 캐시로 폴백)
 */
export function resolveNiceTokenExpiryMs(expiresIn: unknown, nowMs: number): number | null {
  const v = typeof expiresIn === "string" ? Number(expiresIn.trim()) : expiresIn;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  if (v >= 1e12) return Math.floor(v);
  if (v >= 1e9) return Math.floor(v * 1000);
  return nowMs + Math.floor(v * 1000);
}
