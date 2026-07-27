// 계약 테스트: 계정 삭제 job 상태 집합·취소 가능 판정(W5 §3-5-A(e)).
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionJobStates.contract.test.ts
//
// 이 상수는 SQL 175 `account_deletion_active_states()` 와 부분 UNIQUE
// `uq_adj_active_user` 의 술어를 미러한다. 어긋나면 "활성 job 중복 0" 계약이 깨진다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_DELETION_ACTIVE_STATES,
  ACCOUNT_DELETION_TERMINAL_STATES,
  ACCOUNT_DELETION_WRITE_BLOCKED_STATES,
  canCancelAccountDeletion,
  isAccountDeletionActiveState,
} from "../accountDeletionJobStates.ts";

test("활성 상태 = SQL 175 부분 UNIQUE 술어와 동일한 6종", () => {
  assert.deepEqual([...ACCOUNT_DELETION_ACTIVE_STATES], [
    "pending",
    "locked",
    "purging",
    "storage_purged",
    "finalized",
    "auth_soft_deleted",
  ]);
});

test("종료 상태 3종은 활성과 겹치지 않는다(이력 다중 행 허용 구간)", () => {
  for (const state of ACCOUNT_DELETION_TERMINAL_STATES) {
    assert.equal(isAccountDeletionActiveState(state), false, state);
  }
});

test("write gate 차단 상태에 pending 은 포함되지 않는다(취소 창 동안 충전 허용)", () => {
  assert.ok(!(ACCOUNT_DELETION_WRITE_BLOCKED_STATES as readonly string[]).includes("pending"));
  // 그래서 동의 금액과 실제 잔액이 어긋날 수 있고, begin_locked 가 stale 을 판정한다.
  assert.deepEqual([...ACCOUNT_DELETION_WRITE_BLOCKED_STATES], [
    "locked",
    "purging",
    "storage_purged",
    "finalized",
    "auth_soft_deleted",
  ]);
});

test("취소 가능: pending + 창 이내만", () => {
  const now = new Date("2026-07-26T10:00:00Z");
  assert.equal(canCancelAccountDeletion("pending", "2026-07-26T10:30:00Z", now), true);
  assert.equal(canCancelAccountDeletion("pending", "2026-07-26T09:30:00Z", now), false, "창 경과");
  assert.equal(canCancelAccountDeletion("locked", "2026-07-26T10:30:00Z", now), false, "locked 이후 금지");
  assert.equal(canCancelAccountDeletion("pending", null, now), true, "창 미설정이면 취소 가능");
  assert.equal(canCancelAccountDeletion("pending", "not-a-date", now), false, "파싱 실패는 보수적으로 거부");
  assert.equal(canCancelAccountDeletion(null, null, now), false);
});

test("알 수 없는 상태는 활성으로 보지 않는다", () => {
  assert.equal(isAccountDeletionActiveState("weird"), false);
  assert.equal(isAccountDeletionActiveState(null), false);
  assert.equal(isAccountDeletionActiveState(undefined), false);
});
