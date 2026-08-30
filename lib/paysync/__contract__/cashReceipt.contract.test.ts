// 현금영수증 입력 계약 (Phase 3 §5, 분리 커밋):
//   * 신청 안 하면 cashReceipt 필드 자체를 보내지 않는다(null).
//   * 신청했는데 번호가 유효하지 않으면 발급을 막는다 — 그대로 보내면 주문 발급이
//     422 INVALID_CASH_RECEIPT_IDENTIFIER 로 실패해 충전이 통째로 막힌다.
//   * 하이픈 입력은 받아주되 페이싱크에는 숫자만 보낸다.
// 실행: node --test --experimental-strip-types lib/paysync/__contract__/cashReceipt.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  CASH_RECEIPT_PHONE_ERROR,
  buildCashReceiptInput,
  isValidReceiptPhone,
  normalizeReceiptPhone,
  receiptPhoneError,
} from "../cashReceipt.ts";

test("정상 번호: 10~11자리 01x", () => {
  for (const phone of ["01012345678", "0101234567", "01112345678", "01612345678"]) {
    assert.equal(isValidReceiptPhone(phone), true, phone);
    assert.equal(receiptPhoneError(phone), null, phone);
  }
});

test("하이픈·공백은 받아주고 숫자만 남긴다", () => {
  assert.equal(normalizeReceiptPhone("010-1234-5678"), "01012345678");
  assert.equal(normalizeReceiptPhone(" 010 1234 5678 "), "01012345678");
  assert.equal(isValidReceiptPhone("010-1234-5678"), true);
});

test("거부: 01x 아님·자릿수 미달/초과·문자 포함·빈 값", () => {
  for (const phone of ["", "0212345678", "010123456", "010123456789", "010abcd5678", "1012345678", null, undefined]) {
    assert.equal(isValidReceiptPhone(phone), false, String(phone));
    assert.equal(receiptPhoneError(phone), CASH_RECEIPT_PHONE_ERROR, String(phone));
  }
});

test("미신청이면 cashReceipt 는 null — 요청 본문에서 필드가 빠진다", () => {
  const r = buildCashReceiptInput({ requested: false, phone: null });
  assert.deepEqual(r, { ok: true, cashReceipt: null });
  // 번호가 들어 있어도 미신청이면 무시한다.
  assert.deepEqual(buildCashReceiptInput({ requested: false, phone: "01012345678" }), {
    ok: true,
    cashReceipt: null,
  });
});

test("신청 + 유효 번호 → PERSONAL 로 숫자만 실어 보낸다", () => {
  const r = buildCashReceiptInput({ requested: true, phone: "010-1234-5678" });
  assert.deepEqual(r, { ok: true, cashReceipt: { type: "PERSONAL", identifier: "01012345678" } });
});

test("신청 + 잘못된 번호 → 발급을 막는다(422 로 충전 전체가 실패하지 않게)", () => {
  const r = buildCashReceiptInput({ requested: true, phone: "0212345678" });
  assert.deepEqual(r, { ok: false, message: CASH_RECEIPT_PHONE_ERROR });
  assert.deepEqual(buildCashReceiptInput({ requested: true, phone: null }), {
    ok: false,
    message: CASH_RECEIPT_PHONE_ERROR,
  });
});
