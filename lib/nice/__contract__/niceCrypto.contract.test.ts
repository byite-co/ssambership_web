import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import {
  base64UrlNoPad,
  decodeBase64Flexible,
  decryptNiceResult,
  deriveNiceSymmetricKeys,
  resolveNiceTokenExpiryMs,
  verifyNiceIntegrity,
} from "../crypto.ts";

// S-C §5 유닛 게이트 — NICE 암복호 스펙(kdf substring 인덱스·IV/tag 분리·GCM 라운드트립).

const TICKET = "sample-ticket-value-from-token";
const TX = "sample-transaction-id-0001";
const ITERATORS = 2048;

test("kdf: keyString = base64url_nopad(pbkdf2) — symKey=[0,32) · hmacKey=[48,80) 고정", () => {
  const keyString = pbkdf2Sync(TICKET, TX, ITERATORS, 64, "sha256").toString("base64url");
  assert.equal(keyString.includes("="), false, "base64url 무패딩이어야 함");
  assert.ok(keyString.length >= 80, "64byte → base64url 86자 — substring(48,80) 성립");

  const keys = deriveNiceSymmetricKeys(TICKET, TX, ITERATORS);
  assert.equal(keys.symKey, keyString.substring(0, 32), "symKey 인덱스 드리프트");
  assert.equal(keys.hmacKey, keyString.substring(48, 80), "hmacKey 인덱스 드리프트");
  assert.equal(keys.symKey.length, 32);
  assert.equal(keys.hmacKey.length, 32);
  // 결정성 — 같은 입력이면 같은 키
  const again = deriveNiceSymmetricKeys(TICKET, TX, ITERATORS);
  assert.equal(again.symKey, keys.symKey);
  assert.equal(again.hmacKey, keys.hmacKey);
});

test("kdf 입력 검증: 빈 ticket/tx·비정상 iterators 는 throw", () => {
  assert.throws(() => deriveNiceSymmetricKeys("", TX, ITERATORS));
  assert.throws(() => deriveNiceSymmetricKeys(TICKET, "", ITERATORS));
  assert.throws(() => deriveNiceSymmetricKeys(TICKET, TX, 0));
  assert.throws(() => deriveNiceSymmetricKeys(TICKET, TX, 1.5));
});

function encryptAsNice(payload: Record<string, string>, symKey: string, hmacKey: string) {
  const iv = randomBytes(16); // 매뉴얼: IV 16byte
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(symKey, "utf8"), iv, { authTagLength: 16 });
  const cipherText = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16byte
  const encData = Buffer.concat([iv, cipherText, tag]).toString("base64url");
  const integrityValue = createHmac("sha256", hmacKey).update(encData, "utf8").digest("base64url");
  return { encData, integrityValue };
}

const SAMPLE_RESULT = {
  name: "홍길동",
  birthdate: "20120821",
  gender: "1",
  national_info: "0",
  ci: "CI+SAMPLE/VALUE==",
  di: "DI_SAMPLE_VALUE",
  mobile_co: "1",
  mobile_no: "01012345678",
};

test("GCM 라운드트립: iv[0:16]·tag[-16:]·cipher[16:-16] 분리 + 무결성 검증", () => {
  const keys = deriveNiceSymmetricKeys(TICKET, TX, ITERATORS);
  const { encData, integrityValue } = encryptAsNice(SAMPLE_RESULT, keys.symKey, keys.hmacKey);

  // 분리 스펙 확인 — 디코드 버퍼가 iv+tag 보다 커야 하고 앞 16byte 가 iv
  const buf = decodeBase64Flexible(encData);
  assert.ok(buf.length > 32);

  assert.equal(verifyNiceIntegrity(encData, keys.hmacKey, integrityValue), true, "무결성 일치해야 함");
  const decrypted = decryptNiceResult(encData, keys.symKey);
  assert.deepEqual(decrypted, SAMPLE_RESULT);
});

test("무결성 불일치·변조 데이터는 거부된다", () => {
  const keys = deriveNiceSymmetricKeys(TICKET, TX, ITERATORS);
  const { encData, integrityValue } = encryptAsNice(SAMPLE_RESULT, keys.symKey, keys.hmacKey);

  const tampered = encData.slice(0, -2) + (encData.endsWith("AA") ? "BB" : "AA");
  assert.equal(verifyNiceIntegrity(tampered, keys.hmacKey, integrityValue), false, "변조 enc_data 통과 금지");
  assert.equal(verifyNiceIntegrity(encData, keys.hmacKey, "wrong-value"), false);
  assert.equal(verifyNiceIntegrity("", keys.hmacKey, integrityValue), false);
  // GCM tag 이 틀리면 복호화 throw
  assert.throws(() => decryptNiceResult(tampered, keys.symKey));
  // 다른 토큰(ticket) 키로는 복호화 불가 — token-ticket 바인딩 회귀 방지
  const otherKeys = deriveNiceSymmetricKeys("other-ticket", TX, ITERATORS);
  assert.throws(() => decryptNiceResult(encData, otherKeys.symKey));
});

test("base64 관대 디코딩: 표준 base64(패딩 포함) enc_data 도 동일 복호", () => {
  const keys = deriveNiceSymmetricKeys(TICKET, TX, ITERATORS);
  const { encData } = encryptAsNice(SAMPLE_RESULT, keys.symKey, keys.hmacKey);
  const standardB64 = decodeBase64Flexible(encData).toString("base64"); // +,/,= 포함 가능
  const decrypted = decryptNiceResult(standardB64, keys.symKey);
  assert.deepEqual(decrypted, SAMPLE_RESULT);
});

test("base64UrlNoPad: 패딩 없는 base64url 을 낸다", () => {
  const out = base64UrlNoPad(Buffer.from([0xfb, 0xff, 0x01, 0x02]));
  assert.equal(/[+/=]/.test(out), false);
});

test("resolveNiceTokenExpiryMs: epoch ms 그대로 · epoch s ×1000 · 상대초 now 기준 · 그 외 null", () => {
  const now = 1_790_000_000_000; // 2026년대 epoch ms
  assert.equal(resolveNiceTokenExpiryMs(1_790_086_400_000, now), 1_790_086_400_000, "epoch ms");
  assert.equal(resolveNiceTokenExpiryMs(1_790_086_400, now), 1_790_086_400_000, "epoch seconds");
  assert.equal(resolveNiceTokenExpiryMs(86_400, now), now + 86_400_000, "상대 seconds(24h)");
  assert.equal(resolveNiceTokenExpiryMs("1790086400000", now), 1_790_086_400_000, "문자열 숫자 허용");
  assert.equal(resolveNiceTokenExpiryMs(0, now), null);
  assert.equal(resolveNiceTokenExpiryMs(-10, now), null);
  assert.equal(resolveNiceTokenExpiryMs(Number.NaN, now), null);
  assert.equal(resolveNiceTokenExpiryMs("abc", now), null);
  assert.equal(resolveNiceTokenExpiryMs(undefined, now), null);
});
