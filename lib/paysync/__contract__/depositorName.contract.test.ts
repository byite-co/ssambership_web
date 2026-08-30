// 입금자명 계약 (Phase 3 §5):
//   * 1~5자·공백 불가 — 페이싱크 `customer.name` 규칙(INVALID_CUSTOMER_NAME)과 동치.
//   * DB CHECK `depositor_name ~ '^[^[:space:]]{1,5}$'` 와도 동치여야 한다.
//   * 기본값은 본인인증 실명이되, 규칙 위반이면 **자르지 않고 빈 값**을 준다
//     (잘린 이름으로 발급하면 은행 입금자명과 어긋나 자동 매칭이 실패한다).
// 실행: node --test --experimental-strip-types lib/paysync/__contract__/depositorName.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEPOSITOR_NAME_ERROR,
  defaultDepositorNameFrom,
  depositorNameError,
  isValidDepositorName,
  normalizeDepositorName,
} from "../depositorName.ts";

/** DB CHECK 재현 — 두 판정이 갈라지면 발급은 통과하고 INSERT 가 터진다. */
function dbCheck(name: string): boolean {
  return /^[^\s]{1,5}$/u.test(name);
}

test("정상: 1~5자 공백 없음", () => {
  for (const name of ["김", "홍길동", "남궁민수", "가나다라마", "Kim", "ABCDE"]) {
    assert.equal(isValidDepositorName(name), true, name);
    assert.equal(depositorNameError(name), null, name);
  }
});

test("거부: 빈 값·6자 이상·공백 포함", () => {
  for (const name of ["", "   ", "가나다라마바", "홍 길동", "홍길동 ", " 홍길동", "A B"]) {
    const normalized = normalizeDepositorName(name);
    // 앞뒤 공백만은 trim 으로 살린다 — " 홍길동" 은 유효해야 한다.
    if (normalized === "홍길동") continue;
    assert.equal(isValidDepositorName(name), false, JSON.stringify(name));
    assert.equal(depositorNameError(name), DEPOSITOR_NAME_ERROR, JSON.stringify(name));
  }
});

test("앞뒤 공백은 다듬고, 중간 공백은 거부한다", () => {
  assert.equal(isValidDepositorName("  홍길동  "), true);
  assert.equal(normalizeDepositorName("  홍길동  "), "홍길동");
  assert.equal(isValidDepositorName("홍 길동"), false);
});

test("전각 공백(U+3000)도 공백으로 잡는다", () => {
  assert.equal(isValidDepositorName("홍　길"), false);
  assert.equal(isValidDepositorName("　　"), false);
});

test("null·undefined 안전", () => {
  for (const v of [null, undefined]) {
    assert.equal(isValidDepositorName(v), false);
    assert.equal(depositorNameError(v), DEPOSITOR_NAME_ERROR);
    assert.equal(normalizeDepositorName(v), "");
  }
});

test("DB CHECK 와 동치 — 통과시킨 값은 반드시 INSERT 도 통과한다", () => {
  const samples = ["김", "홍길동", "가나다라마", "가나다라마바", "홍 길동", "", "  홍길동  ", "ABCDE", "ABCDEF"];
  for (const raw of samples) {
    const normalized = normalizeDepositorName(raw);
    if (isValidDepositorName(raw)) {
      assert.equal(dbCheck(normalized), true, `JS 통과인데 DB CHECK 실패: ${JSON.stringify(raw)}`);
    }
  }
});

test("기본값: 규칙에 맞는 실명만 채우고, 위반이면 자르지 않고 빈 값", () => {
  assert.equal(defaultDepositorNameFrom("홍길동"), "홍길동");
  assert.equal(defaultDepositorNameFrom("  홍길동 "), "홍길동");
  // 6자 실명은 잘라서 넣지 않는다 — 잘린 이름으로 이체하면 매칭이 실패한다.
  assert.equal(defaultDepositorNameFrom("남궁민수한별"), "");
  assert.equal(defaultDepositorNameFrom("홍 길동"), "");
  assert.equal(defaultDepositorNameFrom(null), "");
  assert.equal(defaultDepositorNameFrom(""), "");
});

test("길이는 코드포인트 기준 — 서로게이트 쌍이 2자로 세어지지 않는다", () => {
  // 이모지 5개 = 코드포인트 5개. (실무에서 쓸 값은 아니지만 길이 계산 규칙을 고정한다.)
  assert.equal(isValidDepositorName("😀😀😀😀😀"), true);
  assert.equal(isValidDepositorName("😀😀😀😀😀😀"), false);
});
