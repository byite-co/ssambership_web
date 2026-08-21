import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptIdentityFieldV1, diHashWithKey, encryptIdentityFieldV1 } from "../identityCrypto.ts";

// S-C §5 유닛 게이트 — 저장 암호화('v1:' + base64(iv‖cipher‖tag)) 라운드트립 + diHash 결정성.

const DATA_KEY = randomBytes(32);
const HASH_KEY = Buffer.from("identity-hash-key-for-tests-0001", "utf8");

test("저장 암호화 라운드트립: 'v1:' 접두 + 복호 일치", () => {
  const samples = ["DI_SAMPLE_VALUE", "01012345678", "CI+VALUE/==긴문자열".repeat(5), "한글 값 · 특수문자 !@#"];
  for (const plain of samples) {
    const enc = encryptIdentityFieldV1(DATA_KEY, plain);
    assert.ok(enc.startsWith("v1:"), "버전 접두 v1: 필수 (m2 계약)");
    assert.notEqual(enc.slice(3), plain, "평문 노출 금지");
    assert.equal(decryptIdentityFieldV1(DATA_KEY, enc), plain);
  }
});

test("같은 평문도 매번 다른 암호문(iv 랜덤) — 그러나 복호는 항상 동일", () => {
  const a = encryptIdentityFieldV1(DATA_KEY, "DI_SAMPLE_VALUE");
  const b = encryptIdentityFieldV1(DATA_KEY, "DI_SAMPLE_VALUE");
  assert.notEqual(a, b);
  assert.equal(decryptIdentityFieldV1(DATA_KEY, a), decryptIdentityFieldV1(DATA_KEY, b));
});

test("변조·잘못된 키·형식 오류는 복호 실패", () => {
  const enc = encryptIdentityFieldV1(DATA_KEY, "DI_SAMPLE_VALUE");
  const otherKey = randomBytes(32);
  assert.throws(() => decryptIdentityFieldV1(otherKey, enc), "다른 키로 복호 금지");
  const raw = Buffer.from(enc.slice(3), "base64");
  raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff; // tag 변조
  assert.throws(() => decryptIdentityFieldV1(DATA_KEY, `v1:${raw.toString("base64")}`));
  assert.throws(() => decryptIdentityFieldV1(DATA_KEY, "v2:whatever"), "미지 버전 거부");
  assert.throws(() => decryptIdentityFieldV1(DATA_KEY, "v1:aGk="), "iv+tag 미달 길이 거부");
  assert.throws(() => encryptIdentityFieldV1(randomBytes(16), "x"), "32byte 키만 허용");
});

test("diHash 결정성: 같은 입력=같은 해시 · 키/입력 다르면 다른 해시 · base64url 무패딩", () => {
  const h1 = diHashWithKey(HASH_KEY, "DI_SAMPLE_VALUE");
  const h2 = diHashWithKey(HASH_KEY, "DI_SAMPLE_VALUE");
  assert.equal(h1, h2, "결정성 — 중복계정 차단 키");
  assert.notEqual(diHashWithKey(HASH_KEY, "DI_OTHER"), h1);
  assert.notEqual(diHashWithKey(Buffer.from("another-hash-key-0123456789ab"), "DI_SAMPLE_VALUE"), h1);
  assert.equal(/[+/=]/.test(h1), false, "base64url 무패딩 인코딩");
  assert.throws(() => diHashWithKey(HASH_KEY, ""), "빈 di 거부");
  assert.throws(() => diHashWithKey(Buffer.from("short"), "DI_SAMPLE_VALUE"), "짧은 키 거부");
});
