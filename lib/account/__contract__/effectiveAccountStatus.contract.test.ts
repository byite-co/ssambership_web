// 계약 테스트: P2-22 effective account status.
// 실행: node --test --experimental-strip-types lib/account/__contract__/effectiveAccountStatus.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { resolveEffectiveAccountStatus } from "../effectiveAccountStatus.ts";

const NOW = "2026-07-20T00:00:00Z";

test("정상 active", () => {
  const r = resolveEffectiveAccountStatus({ status: "active", roleResolved: true, nowIso: NOW });
  assert.equal(r.effective, "active");
  assert.equal(r.canLogin, true);
});

test("role 조회 실패는 active 로 폴백하지 않는다(transient error, retryable)", () => {
  const r = resolveEffectiveAccountStatus({ status: "active", roleResolved: false, nowIso: NOW });
  assert.equal(r.effective, "error");
  assert.equal(r.retryable, true);
  assert.equal(r.canLogin, false);
});

test("정지: suspended_until 미래면 suspended, 과거면 active(자동 해제)", () => {
  const future = resolveEffectiveAccountStatus({
    status: "suspended",
    suspendedUntil: "2026-08-01T00:00:00Z",
    roleResolved: true,
    nowIso: NOW,
  });
  assert.equal(future.effective, "suspended");
  assert.equal(future.canLogin, false);

  const past = resolveEffectiveAccountStatus({
    status: "suspended",
    suspendedUntil: "2026-07-01T00:00:00Z",
    roleResolved: true,
    nowIso: NOW,
  });
  assert.equal(past.effective, "active");
  assert.equal(past.canLogin, true);
});

test("정지: suspended_until 없음 → 무기한 정지로 간주", () => {
  const r = resolveEffectiveAccountStatus({ status: "suspended", roleResolved: true, nowIso: NOW });
  assert.equal(r.effective, "suspended");
});

test("banned 는 role 해석 없이 즉시 거부", () => {
  const r = resolveEffectiveAccountStatus({ status: "banned", roleResolved: false, nowIso: NOW });
  assert.equal(r.effective, "banned");
  assert.equal(r.canLogin, false);
});

test("삭제 saga: locked~finalized 는 deletion_in_progress, 완료계열은 deleted", () => {
  for (const s of ["locked", "purging", "storage_purged", "finalized"]) {
    const r = resolveEffectiveAccountStatus({ status: "active", deletionState: s, roleResolved: true, nowIso: NOW });
    assert.equal(r.effective, "deletion_in_progress", `state=${s}`);
    assert.equal(r.canLogin, false);
  }
  for (const s of ["auth_soft_deleted", "completed"]) {
    const r = resolveEffectiveAccountStatus({ status: "active", deletionState: s, roleResolved: true, nowIso: NOW });
    assert.equal(r.effective, "deleted", `state=${s}`);
  }
});

test("삭제 진행은 active 보다 우선(취소 불가 시점 계정은 로그인 불가)", () => {
  const r = resolveEffectiveAccountStatus({ status: "active", deletionState: "purging", roleResolved: true, nowIso: NOW });
  assert.equal(r.canLogin, false);
});

test("status=deleted 는 deleted", () => {
  const r = resolveEffectiveAccountStatus({ status: "deleted", roleResolved: true, nowIso: NOW });
  assert.equal(r.effective, "deleted");
});
