// 페이싱크 원장 참조 계약 (Phase 2):
//   * F11 형식(`^cash-(.+)-(\d+)$`)을 만족하고 uuid 캡처가 소유자와 일치한다.
//   * **토스 채널 ref 와 절대 충돌하지 않는다** — 충돌은 F11 에서 조용한 미적립으로
//     나타나므로(duplicate:true 성공 응답) '드묾'이 아니라 '불가능'을 검증한다.
//   * 분리자는 숫자부 선행 '0'. 토스는 `Date.now()` 라 선행 0 이 구조적으로 불가능하다.
// 실행: node --test --experimental-strip-types lib/paysync/__contract__/paysyncLedgerRef.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPaysyncLedgerOrderRef,
  buildTossCashOrderRefForContract,
  digitsOfCashOrderRef,
  isPaysyncLedgerOrderRef,
  isTossCashOrderRef,
  PAYSYNC_LEDGER_REF_DIGIT_PREFIX,
} from "../paysyncLedgerRef.ts";

const USER = "8f14e45f-ceea-4a67-8f2b-1a2b3c4d5e6f";
const OTHER = "0f14e45f-ceea-4a67-8f2b-1a2b3c4d5e6f";

/** F11 `api_web_v1.record_cash_topup_v2` 2·3항의 판정을 그대로 옮긴 것. */
function f11Verdict(ref: string, expectedUserId: string): "OK" | "ORDER_REF_INVALID" | "ORDER_REF_OWNER_MISMATCH" {
  const m = /^cash-(.+)-(\d+)$/.exec(ref);
  if (!m) return "ORDER_REF_INVALID";
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (!uuidRe.test(m[1])) return "ORDER_REF_OWNER_MISMATCH";
  return m[1] === expectedUserId ? "OK" : "ORDER_REF_OWNER_MISMATCH";
}

test("F11 형식 통과 — 선행 0 이 붙어도 uuid 캡처·소유자 판정이 어긋나지 않는다", () => {
  const ref = buildPaysyncLedgerOrderRef(USER, 1_756_543_210_123);
  assert.equal(ref, `cash-${USER}-01756543210123`);
  assert.equal(f11Verdict(ref, USER), "OK");
  // 타인 소유자로는 통과하지 않는다.
  assert.equal(f11Verdict(ref, OTHER), "ORDER_REF_OWNER_MISMATCH");
});

test("페이싱크 ref 는 항상 선행 0, 토스 ref 는 절대 선행 0 이 아니다", () => {
  for (const ms of [1, 9, 10, 999, 1_000_000_000_000, 1_756_543_210_123, 9_999_999_999_999]) {
    const ps = buildPaysyncLedgerOrderRef(USER, ms);
    const toss = buildTossCashOrderRefForContract(USER, ms);
    assert.equal(digitsOfCashOrderRef(ps)?.startsWith("0"), true, `paysync ms=${ms}`);
    assert.equal(digitsOfCashOrderRef(toss)?.startsWith("0"), false, `toss ms=${ms}`);
    assert.equal(isPaysyncLedgerOrderRef(ps), true);
    assert.equal(isTossCashOrderRef(ps), false);
    assert.equal(isTossCashOrderRef(toss), true);
    assert.equal(isPaysyncLedgerOrderRef(toss), false);
  }
});

test("충돌 불가: 같은 유저·같은 시각이어도 두 채널 ref 는 문자열로 다르다", () => {
  // 충돌이 가능한 최악 조건(동일 userId·동일 ms)에서도 서로소여야 한다.
  for (let ms = 1; ms <= 5000; ms++) {
    assert.notEqual(
      buildPaysyncLedgerOrderRef(USER, ms),
      buildTossCashOrderRefForContract(USER, ms),
      `ms=${ms} 에서 두 채널 ref 가 같다 — F11 이 뒤 결제를 duplicate 로 삼킨다`,
    );
  }
});

test("충돌 불가: 서로 다른 시각 조합 전수에서도 교집합이 없다", () => {
  // paysync(a) 와 toss(b) 가 우연히 같아지려면 '0'+a === b 여야 한다.
  // b 는 Date.now() 문자열이라 선행 0 이 불가능하므로 성립할 수 없다.
  const paysync = new Set<string>();
  const toss = new Set<string>();
  for (let ms = 1; ms <= 3000; ms++) {
    paysync.add(buildPaysyncLedgerOrderRef(USER, ms));
    toss.add(buildTossCashOrderRefForContract(USER, ms));
  }
  // 자릿수가 겹치도록 큰 값도 섞는다(예: toss 14자리 vs paysync 14자리).
  for (const ms of [1_000_000_000_000, 1_756_543_210_123, 10_000_000_000_000]) {
    paysync.add(buildPaysyncLedgerOrderRef(USER, ms));
    toss.add(buildTossCashOrderRefForContract(USER, ms));
  }
  for (const ref of paysync) {
    assert.equal(toss.has(ref), false, `교집합 발생: ${ref}`);
  }
});

test("토스 생성기가 선행 0 을 만들 수 없음을 실측으로 고정(구조적 근거)", () => {
  // Number→string 은 선행 0 을 만들지 않는다 — 이것이 분리의 근거다.
  // 위젯 식이 바뀌어 0 으로 시작할 수 있게 되면 이 테스트가 먼저 깨진다.
  const now = Date.now();
  for (let i = 0; i < 20_000; i++) {
    const digits = digitsOfCashOrderRef(buildTossCashOrderRefForContract(USER, now + i));
    assert.equal(digits?.startsWith("0"), false);
  }
  assert.equal(String(1_756_543_210_123)[0], "1");
  assert.equal(PAYSYNC_LEDGER_REF_DIGIT_PREFIX, "0");
});

test("DB CHECK 와 동치: paysync_invoices_ledger_ref_shape 가 받는 형태만 생성한다", () => {
  // 마이그레이션 20260830100100 의
  //   check (ledger_order_ref ~ ('^cash-' || user_id::text || '-0[0-9]+$'))
  // 와 같은 판정을 JS 로 재현한다. 생성기가 이 CHECK 를 위반하면 INSERT 가 실패한다.
  const dbCheck = (ref: string, userId: string) =>
    new RegExp(`^cash-${userId}-0[0-9]+$`).test(ref);

  for (const ms of [1, 1_756_543_210_123]) {
    assert.equal(dbCheck(buildPaysyncLedgerOrderRef(USER, ms), USER), true);
    // 토스 형식은 이 테이블에 저장될 수 없다.
    assert.equal(dbCheck(buildTossCashOrderRefForContract(USER, ms), USER), false);
  }
});

test("결정성: 같은 입력이면 항상 같은 ref (발급 시 1회 고정 → 재전송 멱등)", () => {
  const a = buildPaysyncLedgerOrderRef(USER, 1_756_543_210_123);
  const b = buildPaysyncLedgerOrderRef(USER, 1_756_543_210_123);
  assert.equal(a, b);
  // userId 는 소문자 정규화(대소문자 표기 차이로 다른 키가 생기지 않게).
  assert.equal(buildPaysyncLedgerOrderRef(USER.toUpperCase(), 1_756_543_210_123), a);
  assert.equal(buildPaysyncLedgerOrderRef(` ${USER} `, 1_756_543_210_123), a);
});

test("입력 방어: 빈 userId·비정수 nowMs 는 throw (조용한 잘못된 키 생성 금지)", () => {
  assert.throws(() => buildPaysyncLedgerOrderRef("", 1));
  assert.throws(() => buildPaysyncLedgerOrderRef("   ", 1));
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => buildPaysyncLedgerOrderRef(USER, bad), `nowMs=${bad}`);
  }
});

test("판정 함수: 형식 불일치는 양쪽 다 false (null·빈값 포함)", () => {
  for (const bad of ["", "   ", null, undefined, "ivc_abc", "cash-abc", "cash--1", "cash_topup_x_1_a"]) {
    assert.equal(isPaysyncLedgerOrderRef(bad), false, String(bad));
    assert.equal(isTossCashOrderRef(bad), false, String(bad));
    assert.equal(digitsOfCashOrderRef(bad), null, String(bad));
  }
});
