import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAppSurfaceAccountActiveStrictCore,
  strictAccountStatusDecision,
  strictDeletionDecision,
  strictMentorRoleDecision,
} from "../appSurfaceAccountGate.ts";
import type { AppSurfaceAccountRow, AppSurfaceGateResult } from "../appSurfaceAccountGate.ts";

const NOW = new Date("2026-07-24T12:00:00Z");
const PAST = "2026-07-01T00:00:00Z";
const FUTURE = "2026-12-31T00:00:00Z";

test("users 상태 판정 — table-driven(allowlist: active·만료된 suspended 만 허용)", () => {
  const cases: Array<{
    name: string;
    row: AppSurfaceAccountRow | null;
    error?: boolean;
    expect: AppSurfaceGateResult;
  }> = [
    { name: "1 active → 허용", row: { status: "active" }, expect: { ok: true } },
    {
      name: "2 만료된 suspended → 허용",
      row: { status: "suspended", suspended_until: PAST },
      expect: { ok: true },
    },
    {
      name: "3 유효 suspended → 거부",
      row: { status: "suspended", suspended_until: FUTURE },
      expect: { ok: false, reason: "suspended" },
    },
    {
      name: "3b 기한 미상 suspended → 거부",
      row: { status: "suspended" },
      expect: { ok: false, reason: "suspended" },
    },
    {
      name: "4 suspended_until 형식 오류 → 거부",
      row: { status: "suspended", suspended_until: "not-a-date" },
      expect: { ok: false, reason: "suspended_until_invalid" },
    },
    { name: "5 banned → 거부", row: { status: "banned" }, expect: { ok: false, reason: "banned" } },
    {
      name: "6 unknown status → 거부(active 폴백 금지)",
      row: { status: "deletionpending" },
      expect: { ok: false, reason: "status_unknown" },
    },
    { name: "6b NULL status → 거부", row: { status: null }, expect: { ok: false, reason: "status_unknown" } },
    { name: "6c 비문자 status → 거부", row: { status: 7 }, expect: { ok: false, reason: "status_unknown" } },
    { name: "7 users 행 없음 → 거부", row: null, expect: { ok: false, reason: "row_missing" } },
    {
      name: "8 users 조회 오류 → 거부",
      row: { status: "active" },
      error: true,
      expect: { ok: false, reason: "query_error" },
    },
  ];
  for (const c of cases) {
    assert.deepEqual(strictAccountStatusDecision(c.row, Boolean(c.error), NOW), c.expect, c.name);
  }
});

test("삭제 상태 판정 — table-driven(write_blocked=false 만 통과)", () => {
  const okPayload = { ok: true, exists: false, write_blocked: false };
  const cases: Array<{ name: string; payload: unknown; error?: boolean; expect: AppSurfaceGateResult }> = [
    { name: "10 write_blocked=false → 허용", payload: okPayload, expect: { ok: true } },
    {
      name: "11 deletion pending(write_blocked=true) → 거부",
      payload: { ok: true, exists: true, state: "pending", write_blocked: true },
      expect: { ok: false, reason: "deletion_blocked" },
    },
    {
      name: "12 locked/purging(write_blocked=true) → 거부",
      payload: { ok: true, exists: true, state: "purging", write_blocked: true },
      expect: { ok: false, reason: "deletion_blocked" },
    },
    {
      name: "13 deleted(write_blocked=true) → 거부",
      payload: { ok: true, exists: true, state: "deleted", write_blocked: true },
      expect: { ok: false, reason: "deletion_blocked" },
    },
    { name: "14 RPC 실패 → 거부", payload: null, error: true, expect: { ok: false, reason: "deletion_unknown" } },
    { name: "14b payload null → 거부", payload: null, expect: { ok: false, reason: "deletion_unknown" } },
    { name: "14c ok!=true → 거부", payload: { ok: false }, expect: { ok: false, reason: "deletion_unknown" } },
    {
      name: "14d write_blocked 누락 → 거부(확인 불가=거부)",
      payload: { ok: true },
      expect: { ok: false, reason: "deletion_unknown" },
    },
    {
      name: "14e write_blocked 비불리언 → 거부",
      payload: { ok: true, write_blocked: "false" },
      expect: { ok: false, reason: "deletion_unknown" },
    },
  ];
  for (const c of cases) {
    assert.deepEqual(strictDeletionDecision(c.payload, Boolean(c.error)), c.expect, c.name);
  }
});

test("role 판정 — mentor 만 허용, 조회 실패·행 없음은 확인 불가", () => {
  assert.equal(strictMentorRoleDecision({ role: "mentor" }, false), "ok"); // 15(전제)
  assert.equal(strictMentorRoleDecision({ role: "student" }, false), "not_mentor"); // 16
  assert.equal(strictMentorRoleDecision({ role: "admin" }, false), "not_mentor"); // 17
  assert.equal(strictMentorRoleDecision(null, false), "profile_unavailable"); // 18
  assert.equal(strictMentorRoleDecision({ role: "mentor" }, true), "profile_unavailable"); // 19
  assert.equal(strictMentorRoleDecision({ role: "MENTOR" }, false), "not_mentor"); // 대소문자 위조 불가
});

test("DI 코어 — deps 예외도 fail-closed(9), 상태→삭제 순차 판정", async () => {
  // 9 예외 → 거부
  const thrown = await assertAppSurfaceAccountActiveStrictCore({
    fetchAccountRow: async () => {
      throw new Error("boom");
    },
    fetchDeletionStatus: async () => ({ payload: null, error: false }),
  });
  assert.deepEqual(thrown, { ok: false, reason: "query_error" });

  const thrownDeletion = await assertAppSurfaceAccountActiveStrictCore({
    fetchAccountRow: async () => ({ row: { status: "active" }, error: false }),
    fetchDeletionStatus: async () => {
      throw new Error("rpc down");
    },
  });
  assert.deepEqual(thrownDeletion, { ok: false, reason: "query_error" });

  // active + write_blocked=false → 허용(15 전제 성공 경로)
  const pass = await assertAppSurfaceAccountActiveStrictCore({
    fetchAccountRow: async () => ({ row: { status: "active" }, error: false }),
    fetchDeletionStatus: async () => ({ payload: { ok: true, write_blocked: false }, error: false }),
  });
  assert.deepEqual(pass, { ok: true });

  // 상태 거부면 삭제 RPC 를 아예 부르지 않는다(불필요 호출·정보 노출 방지).
  let deletionCalls = 0;
  const denied = await assertAppSurfaceAccountActiveStrictCore({
    fetchAccountRow: async () => ({ row: { status: "banned" }, error: false }),
    fetchDeletionStatus: async () => {
      deletionCalls++;
      return { payload: { ok: true, write_blocked: false }, error: false };
    },
  });
  assert.deepEqual(denied, { ok: false, reason: "banned" });
  assert.equal(deletionCalls, 0);
});

test("bootstrap 이후 상태 변화 시나리오(21·22) — 매 요청 재판정으로 차단", async () => {
  // 같은 deps 소스가 상태만 바뀐다 — 게이트는 호출 시점 상태로 판정한다.
  let status = "active";
  let writeBlocked = false;
  const deps = {
    fetchAccountRow: async () => ({ row: { status } as AppSurfaceAccountRow, error: false }),
    fetchDeletionStatus: async () => ({ payload: { ok: true, write_blocked: writeBlocked }, error: false }),
  };

  // bootstrap 시점: 통과.
  assert.deepEqual(await assertAppSurfaceAccountActiveStrictCore(deps), { ok: true });

  // 21 bootstrap 후 정지 → 다음 요청(서명 티켓)에서 거부.
  status = "suspended";
  assert.deepEqual(await assertAppSurfaceAccountActiveStrictCore(deps), {
    ok: false,
    reason: "suspended",
  });

  // 22 bootstrap 후 deletion pending → 다음 요청(finalize)에서 거부.
  status = "active";
  writeBlocked = true;
  assert.deepEqual(await assertAppSurfaceAccountActiveStrictCore(deps), {
    ok: false,
    reason: "deletion_blocked",
  });
});
