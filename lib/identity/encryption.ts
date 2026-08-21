import "server-only";

// S-C: 저장용 암호화 env 래퍼 — IDENTITY_DATA_KEY(32byte base64) / IDENTITY_HASH_KEY.
// 순수 계산은 lib/identity/identityCrypto.ts (유닛 게이트 대상), 이 파일은 키 로딩만.
// 키·평문·복호 결과를 로그로 내보내지 않는다.

import {
  decryptIdentityFieldV1,
  diHashWithKey,
  encryptIdentityFieldV1,
} from "@/lib/identity/identityCrypto";

let cachedDataKey: Buffer | null = null;
let cachedHashKey: Buffer | null = null;

function loadDataKey(): Buffer {
  if (cachedDataKey) return cachedDataKey;
  const raw = process.env.IDENTITY_DATA_KEY?.trim();
  if (!raw) {
    throw new Error("IDENTITY_DATA_KEY_MISSING");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("IDENTITY_DATA_KEY_LENGTH_INVALID");
  }
  cachedDataKey = key;
  return key;
}

function loadHashKey(): Buffer {
  if (cachedHashKey) return cachedHashKey;
  const raw = process.env.IDENTITY_HASH_KEY?.trim();
  if (!raw) {
    throw new Error("IDENTITY_HASH_KEY_MISSING");
  }
  // HMAC 키 — base64 여부와 무관하게 utf8 bytes 로 결정적으로 사용(최소 16자).
  const key = Buffer.from(raw, "utf8");
  if (key.length < 16) {
    throw new Error("IDENTITY_HASH_KEY_TOO_SHORT");
  }
  cachedHashKey = key;
  return key;
}

/** ci/di/휴대폰번호 저장용 암호화 → 'v1:' + base64(iv‖cipher‖tag) */
export function encryptIdentityField(plain: string): string {
  return encryptIdentityFieldV1(loadDataKey(), plain);
}

/** 'v1:' 암호문 복호화 (운영·탈퇴 파기 검증 용도 — UI 노출 금지) */
export function decryptIdentityField(encoded: string): string {
  return decryptIdentityFieldV1(loadDataKey(), encoded);
}

/** 결정적 di 해시 — base64url(HMAC-SHA256(di, IDENTITY_HASH_KEY)) */
export function diHash(di: string): string {
  return diHashWithKey(loadHashKey(), di);
}
