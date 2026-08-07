import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertAccountActive,
  assertAccountActiveCore,
  effectiveAccountStatus,
  parseAccountRow,
} from "../accountStatus.ts";
import type { AccountActiveGateDeps, AccountGateResult, AccountStatusInfo } from "../accountStatus.ts";

const NOW = new Date("2026-07-30T12:00:00Z");
const PAST = "2026-07-01T00:00:00Z";
const FUTURE = "2026-12-31T00:00:00Z";

const DELETION_OK = { ok: true, exists: false, write_blocked: false };

function depsOf(overrides: Partial<AccountActiveGateDeps>): AccountActiveGateDeps {
  return {
    fetchAccountRow: async () => ({ row: { status: "active" }, error: false }),
    fetchDeletionStatus: async () => ({ payload: DELETION_OK, error: false }),
    now: () => NOW,
    ...overrides,
  };
}

test("C9 §11.5 판정식 — 상태별 통과/거부 (fail-closed)", async () => {
  const cases: Array<{
    name: string;
    row: AccountStatusInfo | null;
    rowError?: boolean;
    expectOk: boolean;
    expectReason?: string;
  }> = [
    { name: "active 정상 통과", row: { status: "active" }, expectOk: true },
    { name: "banned 거부", row: { status: "banned" }, expectOk: false, expectReason: "banned" },
    {
      name: "suspended_until NULL 거부",
      row: { status: "suspended", suspended_until: null },
      expectOk: false,
      expectReason: "suspended",
    },
    {
      name: "suspended_until 미래 거부",
      row: { status: "suspended", suspended_until: FUTURE },
      expectOk: false,
      expectReason: "suspended",
    },
    {
      name: "만료된 suspended → 통과 (§11.5: until <= now)",
      row: { status: "suspended", suspended_until: PAST },
      expectOk: true,
    },
    {
      name: "deleted → 명시 거부 (오너 결정 1: CHECK 4종 정합 — 탈퇴 완료 계정)",
      row: { status: "deleted" },
      expectOk: false,
      expectReason: "deleted",
    },
    {
      name: "CHECK 밖 가상 status → 거부 (D-AU-3: 미지 값 fail-open 제거 — 제약상 도달 불가 방어선)",
      row: { status: "some_future_status" },
      expectOk: false,
      expectReason: "status_unknown",
    },
    {
      name: "NULL status → 통과 (뷰 COALESCE(status,'active') 정합 — NOT NULL 제약상 도달 불가 방어선)",
      row: { status: null },
      expectOk: true,
    },
    {
      name: "빈 문자열 status → 통과 (NULL 과 동일 정규화 — 도달 불가 방어선)",
      row: { status: "   " },
      expectOk: true,
    },
    {
      name: "suspended_until 해석 불가 → 거부(만료 판정 불가 = 유효 정지 취급)",
      row: { status: "suspended", suspended_until: "not-a-date" },
      expectOk: false,
      expectReason: "suspended",
    },
    { name: "사용자 행 부재 → 거부", row: null, expectOk: false, expectReason: "row_missing" },
    {
      name: "query 실패 → 거부(active 반환 금지)",
      row: { status: "active" },
      rowError: true,
      expectOk: false,
      expectReason: "unverifiable",
    },
  ];
  for (const c of cases) {
    const result = await assertAccountActiveCore(
      depsOf({ fetchAccountRow: async () => ({ row: c.row, error: Boolean(c.rowError) }) })
    );
    assert.equal(result.ok, c.expectOk, c.name);
    if (!result.ok && c.expectReason) {
      assert.equal(result.reason, c.expectReason, `${c.name} — reason`);
      assert.equal(typeof result.userMessage, "string", `${c.name} — userMessage 존재`);
      assert.ok(result.userMessage.length > 0, `${c.name} — userMessage 비어있지 않음`);
    }
  }
});

test("C9 탈퇴 write-block — 진행 중 거부·확인 불가 거부", async () => {
  const cases: Array<{ name: string; payload: unknown; error?: boolean; expectReason: string }> = [
    {
      name: "탈퇴 진행 중(write_blocked=true) 거부",
      payload: { ok: true, exists: true, state: "pending", write_blocked: true },
      expectReason: "deletion_blocked",
    },
    { name: "RPC 실패 → 거부", payload: null, error: true, expectReason: "unverifiable" },
    { name: "malformed payload(비객체) → 거부", payload: "unexpected-string", expectReason: "unverifiable" },
    { name: "malformed payload(배열) → 거부", payload: [DELETION_OK], expectReason: "unverifiable" },
    { name: "필드 누락(write_blocked 부재) → 거부", payload: { ok: true }, expectReason: "unverifiable" },
    { name: "ok=false envelope → 거부", payload: { ok: false, write_blocked: false }, expectReason: "unverifiable" },
  ];
  for (const c of cases) {
    const result = await assertAccountActiveCore(
      depsOf({ fetchDeletionStatus: async () => ({ payload: c.payload, error: Boolean(c.error) }) })
    );
    assert.equal(result.ok, false, c.name);
    if (!result.ok) assert.equal(result.reason, c.expectReason, `${c.name} — reason`);
  }
});

test("C9 fail-closed — 실패 계열 전건에서 active(ok:true) 반환 0건", async () => {
  const failures: Array<{ name: string; deps: AccountActiveGateDeps }> = [
    {
      name: "첫 query 실패(permission 오류 포함 — error 채널 동일)",
      deps: depsOf({ fetchAccountRow: async () => ({ row: null, error: true }) }),
    },
    {
      name: "network/timeout — fetchAccountRow 예외",
      deps: depsOf({
        fetchAccountRow: async () => {
          throw new Error("network timeout");
        },
      }),
    },
    {
      name: "network/timeout — fetchDeletionStatus 예외",
      deps: depsOf({
        fetchDeletionStatus: async () => {
          throw new Error("fetch failed");
        },
      }),
    },
    { name: "사용자 행 부재", deps: depsOf({ fetchAccountRow: async () => ({ row: null, error: false }) }) },
    {
      name: "deletion RPC 실패",
      deps: depsOf({ fetchDeletionStatus: async () => ({ payload: null, error: true }) }),
    },
  ];
  const results: AccountGateResult[] = [];
  for (const f of failures) {
    const r = await assertAccountActiveCore(f.deps);
    results.push(r);
    assert.equal(r.ok, false, `${f.name} → 거부`);
  }
  assert.equal(results.filter((r) => r.ok).length, 0, "실패 계열 active 반환 0건");
});

test("C9 tripwire — status-only 재시도(스키마 추측 fallback) 미복원: 조회는 정확히 1회", async () => {
  let accountCalls = 0;
  const result = await assertAccountActiveCore(
    depsOf({
      fetchAccountRow: async () => {
        accountCalls += 1;
        return { row: null, error: true };
      },
    })
  );
  assert.equal(result.ok, false);
  assert.equal(accountCalls, 1, "query 실패 시 재시도 0회(구 status-only fallback 제거)");
});

test("C9 tripwire — 차단 판정 시 deletion RPC 미호출(불필요 왕복 없음·거부 우선)", async () => {
  let deletionCalls = 0;
  const result = await assertAccountActiveCore(
    depsOf({
      fetchAccountRow: async () => ({ row: { status: "banned" }, error: false }),
      fetchDeletionStatus: async () => {
        deletionCalls += 1;
        return { payload: DELETION_OK, error: false };
      },
    })
  );
  assert.equal(result.ok, false);
  assert.equal(deletionCalls, 0);
});

type FakeQueryResult = { data: unknown; error: unknown };

function fakeSupabase(log: string[], usersResult: FakeQueryResult, rpcResult: FakeQueryResult): SupabaseClient {
  const client = {
    from(table: string) {
      log.push(`from:${table}`);
      return {
        select(cols: string) {
          log.push(`select:${cols}`);
          return {
            eq(col: string, _v: unknown) {
              log.push(`eq:${col}`);
              return {
                maybeSingle: async () => usersResult,
              };
            },
          };
        },
      };
    },
    rpc(fn: string) {
      log.push(`rpc:${fn}`);
      return Promise.resolve(rpcResult);
    },
  };
  return client as unknown as SupabaseClient;
}

test("C9 어댑터 배선 — 정본 1회 조회(users.status,suspended_until) + 정본 삭제 RPC", async () => {
  const log: string[] = [];
  const ok = await assertAccountActive(
    fakeSupabase(log, { data: { status: "active", suspended_until: null }, error: null }, { data: DELETION_OK, error: null }),
    "00000000-0000-0000-0000-000000000001"
  );
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(log, [
    "from:users",
    "select:status, suspended_until",
    "eq:id",
    "rpc:account_deletion_status_self",
  ]);
});

test("C9 어댑터 배선 — users 조회 오류 시 추가 조회 0회·거부", async () => {
  const log: string[] = [];
  const result = await assertAccountActive(
    fakeSupabase(log, { data: null, error: { code: "42501", message: "permission denied" } }, { data: DELETION_OK, error: null }),
    "00000000-0000-0000-0000-000000000001"
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "unverifiable");
  assert.equal(log.filter((l) => l.startsWith("from:")).length, 1, "users 조회 정확히 1회(재시도 0)");
  assert.equal(log.filter((l) => l.startsWith("rpc:")).length, 0, "확인 불가 시 후속 RPC 미호출");
});

test("C9 malformed response — users 행 형식 오류는 성공으로 바꾸지 않는다(parseAccountRow)", async () => {
  assert.deepEqual(parseAccountRow(null), { row: null, error: false }, "부재는 형식 오류가 아님(row_missing 채널)");
  assert.equal(parseAccountRow("garbage").error, true, "비객체 응답 → 오류");
  assert.equal(parseAccountRow([{ status: "active" }]).error, true, "배열 응답 → 오류");
  assert.equal(parseAccountRow({ status: 123 }).error, true, "비문자 status → 오류");
  assert.equal(parseAccountRow({ status: "active", suspended_until: 42 }).error, true, "비문자 suspended_until → 오류");
  assert.deepEqual(
    parseAccountRow({ status: "active", suspended_until: null }),
    { row: { status: "active", suspended_until: null }, error: false },
    "정상 행 통과"
  );

  const malformed = await assertAccountActive(
    fakeSupabase([], { data: "garbage", error: null }, { data: DELETION_OK, error: null }),
    "00000000-0000-0000-0000-000000000001"
  );
  assert.equal(malformed.ok, false, "malformed 응답에서 active 반환 0건");
  if (!malformed.ok) assert.equal(malformed.reason, "unverifiable");
});

test("C9 표시 판정 회귀 — effectiveAccountStatus §11.5 coalesce 식 유지", () => {
  assert.equal(effectiveAccountStatus({ status: "banned" }, NOW), "banned");
  assert.equal(effectiveAccountStatus({ status: "suspended", suspended_until: FUTURE }, NOW), "suspended");
  assert.equal(effectiveAccountStatus({ status: "suspended", suspended_until: PAST }, NOW), "active");
  assert.equal(effectiveAccountStatus({ status: null }, NOW), "active");
  assert.equal(effectiveAccountStatus(null, NOW), "active");
});
