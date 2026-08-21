// S-C: 본인인증 결과 저장용 암복호 — 순수 계산 코어 (키를 인자로 받는다).
//
// 저장 계약 (S-B m2 — identity_verifications 헤더가 정본):
//   *_enc  = 'v1:' + base64(iv ‖ ciphertext ‖ tag), AES-256-GCM
//   di_hash = 결정적 HMAC-SHA256 — S-C 지시서 확정: base64url 무패딩 인코딩
//   평문 CI/DI/전화번호는 어떤 컬럼·로그에도 두지 않는다.
//
// env(IDENTITY_DATA_KEY/IDENTITY_HASH_KEY)를 읽는 래퍼는 server-only 가 부착된
// lib/identity/encryption.ts 다. 이 파일은 §5 유닛 게이트가 node:test 로 직접
// 라운드트립·결정성을 검증하기 위해 env 접근 없이 분리했다.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const VERSION_PREFIX = "v1:";
/** GCM 권장 IV 96bit. 복호화가 같은 상수를 사용하므로 형식 내에서 자기완결. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

function assertDataKey(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error("IDENTITY_DATA_KEY_LENGTH_INVALID");
  }
}

/** 평문 → 'v1:' + base64(iv‖cipher‖tag). 빈 문자열은 그대로 암호화된다(호출측이 빈 값 제외). */
export function encryptIdentityFieldV1(dataKey: Buffer, plain: string): string {
  assertDataKey(dataKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv, { authTagLength: TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return VERSION_PREFIX + Buffer.concat([iv, encrypted, tag]).toString("base64");
}

/** 'v1:' 암호문 → 평문. 형식·무결성 불일치 시 throw. */
export function decryptIdentityFieldV1(dataKey: Buffer, encoded: string): string {
  assertDataKey(dataKey);
  if (!encoded.startsWith(VERSION_PREFIX)) {
    throw new Error("IDENTITY_ENC_VERSION_UNSUPPORTED");
  }
  const buf = Buffer.from(encoded.slice(VERSION_PREFIX.length), "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error("IDENTITY_ENC_MALFORMED");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const cipherText = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", dataKey, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");
}

/** 결정적 di 해시 — base64url 무패딩(HMAC-SHA256(di, hashKey)). 중복계정 차단 키. */
export function diHashWithKey(hashKey: Buffer, di: string): string {
  if (hashKey.length < 16) {
    throw new Error("IDENTITY_HASH_KEY_TOO_SHORT");
  }
  if (!di) {
    throw new Error("IDENTITY_DI_EMPTY");
  }
  return createHmac("sha256", hashKey).update(di, "utf8").digest("base64url");
}
