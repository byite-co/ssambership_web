import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MENTOR_CAP_RPC,
  buildMentorCapUsage,
  createSupabaseMentorCapDataSource,
  loadMentorCapUsageBatchFrom,
  wouldExceedCap,
  type CapWeightByTier,
  type MentorCapDataSource,
} from "../mentorCapUsageCore.ts";

// PR-1b(관리자 콘솔 값 연동) — 정원(cap) 은 DB RPC 정본만 쓴다.
//   • mentor_cap_used / mentor_cap_limit / subscription_cap_weight 반환값이 화면 값 그대로인지
//   • TS 가중치(1.0/2.5/4.5)·기본 한도(28) 상수가 코드베이스(app/lib/components)에 남아 있지 않은지
//   • RPC 실패 시 숫자를 지어내지 않고 판정 불가(fail-closed)로 남기는지
//
// 실행: node --test --experimental-strip-types lib/subscribe/__contract__/mentorCapRpcBinding.contract.test.ts

// 픽스처 가중치·한도는 **의도적으로 운영값(1.0/2.5/4.5 · 28)과 다르게** 둔다 — 코드에 숨은 상수가 있으면
// 아래 기대값이 맞을 수 없다(DB 가 무엇을 돌려주든 그대로 반영해야 한다).
const FIXTURE_WEIGHTS: CapWeightByTier = { limited: 2, standard: 3, premium: 7 };

type SourceOverrides = Partial<{ [K in keyof MentorCapDataSource]: MentorCapDataSource[K] }>;

function fakeSource(
  perMentor: Record<string, { used: number | null; limit: number | null; active?: number }>,
  overrides: SourceOverrides = {}
): MentorCapDataSource {
  return {
    capUsed: async (id) => perMentor[id]?.used ?? null,
    capLimit: async (id) => perMentor[id]?.limit ?? null,
    capWeight: async (tier) => FIXTURE_WEIGHTS[tier],
    activeSubscriptionCounts: async (ids) => {
      const m = new Map<string, number>();
      for (const id of ids) m.set(id, perMentor[id]?.active ?? 0);
      return m;
    },
    ...overrides,
  };
}

test("정원 사용량·한도는 RPC 반환값을 그대로 쓴다 (TS 재합산 없음)", async () => {
  const map = await loadMentorCapUsageBatchFrom(
    fakeSource({ A: { used: 12.5, limit: 20, active: 4 }, B: { used: 0, limit: 31, active: 0 } }),
    ["A", "B", "A", ""]
  );
  const a = map.get("A")!;
  assert.equal(a.indeterminate, false);
  assert.equal(a.usedCap, 12.5, "사용량은 mentor_cap_used 값 그대로");
  assert.equal(a.capLimit, 20, "한도는 mentor_cap_limit 값 그대로(기본 28 폴백 없음)");
  assert.equal(a.activeCount, 4);
  assert.equal(a.pct, 63, "pct = round(12.5/20*100)");
  assert.equal(a.isFull, false, "12.5 + limited(2) = 14.5 ≤ 20");
  assert.deepEqual(a.capWeightByTier, FIXTURE_WEIGHTS, "가중치 표는 DB subscription_cap_weight 값");

  const b = map.get("B")!;
  assert.equal(b.usedCap, 0);
  assert.equal(b.capLimit, 31);
  assert.equal(b.pct, 0);
  assert.equal(b.isFull, false);
  assert.equal(map.size, 2, "중복·빈 id 는 제거");
});

test("마감(isFull) 판정은 DB 의 limited 가중치로 한다", () => {
  const nearFull = buildMentorCapUsage({ usedCap: 18.5, capLimit: 20, activeCount: 1, capWeightByTier: FIXTURE_WEIGHTS });
  assert.equal(nearFull.isFull, true, "18.5 + 2 = 20.5 > 20 → 마감");
  const exact = buildMentorCapUsage({ usedCap: 18, capLimit: 20, activeCount: 1, capWeightByTier: FIXTURE_WEIGHTS });
  assert.equal(exact.isFull, false, "18 + 2 = 20 ≤ 20 → 여유");
  const zeroLimit = buildMentorCapUsage({ usedCap: 0, capLimit: 0, activeCount: 0, capWeightByTier: FIXTURE_WEIGHTS });
  assert.equal(zeroLimit.isFull, true, "한도 0 은 DB 값 그대로 존중(구 코드는 28 로 바꿔치기했다)");
  assert.equal(zeroLimit.capLimit, 0);
});

test("wouldExceedCap 은 DB tier 가중치로 판정한다", () => {
  const u = buildMentorCapUsage({ usedCap: 10, capLimit: 15, activeCount: 2, capWeightByTier: FIXTURE_WEIGHTS });
  assert.equal(wouldExceedCap(u, "limited"), false, "10 + 2 = 12 ≤ 15");
  assert.equal(wouldExceedCap(u, "standard"), false, "10 + 3 = 13 ≤ 15");
  assert.equal(wouldExceedCap(u, "premium"), true, "10 + 7 = 17 > 15");
});

test("RPC 실패는 판정 불가(fail-closed) — 숫자를 추측하지 않는다", async () => {
  const usedFailed = await loadMentorCapUsageBatchFrom(fakeSource({ A: { used: null, limit: 20 } }), ["A"]);
  const a = usedFailed.get("A")!;
  assert.equal(a.indeterminate, true);
  assert.equal(a.usedCap, null, "사용량 실패는 0 이 아니라 null");
  assert.equal(a.capLimit, 20, "한도만 알면 한도는 남긴다(편집 폼 prefill)");
  assert.equal(a.isFull, false, "표시 degrade");
  assert.equal(wouldExceedCap(a, "limited"), true, "결제 경로 fail-closed");

  const limitFailed = await loadMentorCapUsageBatchFrom(fakeSource({ A: { used: 3, limit: null } }), ["A"]);
  assert.equal(limitFailed.get("A")!.indeterminate, true);
  assert.equal(limitFailed.get("A")!.capLimit, null, "한도 실패는 28 이 아니라 null");

  const weightFailed = await loadMentorCapUsageBatchFrom(
    fakeSource({ A: { used: 3, limit: 20 } }, { capWeight: async (tier) => (tier === "standard" ? null : 1) }),
    ["A"]
  );
  assert.equal(weightFailed.get("A")!.indeterminate, true, "가중치 하나라도 없으면 판정 불가(부분 표 금지)");
  assert.equal(weightFailed.get("A")!.capWeightByTier, null);
});

test("활성 구독 수(명) 집계 실패는 표시 보조만 비우고 cap 판정에는 영향이 없다", async () => {
  const map = await loadMentorCapUsageBatchFrom(
    fakeSource({ A: { used: 4, limit: 20 } }, { activeSubscriptionCounts: async () => null }),
    ["A"]
  );
  const a = map.get("A")!;
  assert.equal(a.indeterminate, false);
  assert.equal(a.activeCount, null);
  assert.equal(a.usedCap, 4);
  assert.equal(wouldExceedCap(a, "limited"), false);
});

// ── supabase 어댑터: RPC 이름·인자 고정(모킹) ────────────────────────────────
type RpcCall = { fn: string; args: Record<string, unknown> };
type Chain = { table: string; select?: string; in?: [string, readonly string[]]; ilike?: [string, string]; limit?: number };

function fakeClient(opts: {
  rpc: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null } | never;
  rows?: Array<{ mentor_id: string }>;
  rowsError?: { message: string } | null;
  calls: RpcCall[];
  chains: Chain[];
}): SupabaseClient {
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      opts.calls.push({ fn, args });
      return opts.rpc(fn, args);
    },
    from: (table: string) => {
      const chain: Chain = { table };
      opts.chains.push(chain);
      const builder = {
        select(cols: string) { chain.select = cols; return builder; },
        in(col: string, vals: readonly string[]) { chain.in = [col, vals]; return builder; },
        ilike(col: string, pat: string) { chain.ilike = [col, pat]; return builder; },
        limit(n: number) {
          chain.limit = n;
          return Promise.resolve({ data: opts.rowsError ? null : (opts.rows ?? []), error: opts.rowsError ?? null });
        },
      };
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}

test("어댑터는 배포된 RPC 셋(mentor_cap_used / mentor_cap_limit / subscription_cap_weight)만 호출한다", async () => {
  assert.equal(MENTOR_CAP_RPC.used, "mentor_cap_used");
  assert.equal(MENTOR_CAP_RPC.limit, "mentor_cap_limit");
  assert.equal(MENTOR_CAP_RPC.weight, "subscription_cap_weight");

  const calls: RpcCall[] = [];
  const chains: Chain[] = [];
  const client = fakeClient({
    calls,
    chains,
    rows: [{ mentor_id: "m1" }, { mentor_id: "m1" }, { mentor_id: "m2" }],
    rpc: (fn, args) => {
      if (fn === "mentor_cap_used") return { data: args.p_mentor_id === "m1" ? "12.5" : 0, error: null }; // numeric 이 문자열로 와도 파싱
      if (fn === "mentor_cap_limit") return { data: args.p_mentor_id === "m1" ? 20 : 31, error: null };
      if (fn === "subscription_cap_weight") return { data: FIXTURE_WEIGHTS[args.p_tier as keyof CapWeightByTier], error: null };
      throw new Error(`unexpected rpc ${fn}`);
    },
  });

  const map = await loadMentorCapUsageBatchFrom(createSupabaseMentorCapDataSource(client), ["m1", "m2"]);
  const m1 = map.get("m1")!;
  assert.equal(m1.usedCap, 12.5);
  assert.equal(m1.capLimit, 20);
  assert.equal(m1.activeCount, 2);
  assert.equal(m1.indeterminate, false);
  const m2 = map.get("m2")!;
  assert.equal(m2.usedCap, 0);
  assert.equal(m2.capLimit, 31);
  assert.equal(m2.activeCount, 1);

  const byFn = (fn: string) => calls.filter((c) => c.fn === fn);
  assert.deepEqual(
    byFn("mentor_cap_used").map((c) => c.args).sort((a, b) => String(a.p_mentor_id).localeCompare(String(b.p_mentor_id))),
    [{ p_mentor_id: "m1" }, { p_mentor_id: "m2" }]
  );
  assert.deepEqual(
    byFn("mentor_cap_limit").map((c) => c.args).sort((a, b) => String(a.p_mentor_id).localeCompare(String(b.p_mentor_id))),
    [{ p_mentor_id: "m1" }, { p_mentor_id: "m2" }]
  );
  assert.deepEqual(
    byFn("subscription_cap_weight").map((c) => c.args.p_tier).sort(),
    ["limited", "premium", "standard"],
    "가중치는 tier 3종을 DB 에 묻는다(배치당 1회)"
  );
  assert.equal(new Set(calls.map((c) => c.fn)).size, 3, "RPC 는 세 종류만");

  // 활성 구독 수는 subscriptions 를 DB 함수와 같은 판정(lower(status)='active' ≒ ilike)으로 센다.
  assert.equal(chains.length, 1);
  assert.equal(chains[0].table, "subscriptions");
  assert.equal(chains[0].select, "mentor_id");
  assert.deepEqual(chains[0].in, ["mentor_id", ["m1", "m2"]]);
  assert.deepEqual(chains[0].ilike, ["status", "active"]);
});

test("어댑터: RPC 오류·예외·비숫자 응답은 null → 판정 불가", async () => {
  const calls: RpcCall[] = [];
  const chains: Chain[] = [];
  const erroring = fakeClient({
    calls,
    chains,
    rpc: (fn) => (fn === "mentor_cap_used" ? { data: null, error: { message: "denied" } } : { data: 5, error: null }),
  });
  const src = createSupabaseMentorCapDataSource(erroring);
  assert.equal(await src.capUsed("m1"), null);
  assert.equal(await src.capLimit("m1"), 5);

  const throwing = fakeClient({ calls, chains, rpc: () => { throw new Error("boom"); } });
  assert.equal(await createSupabaseMentorCapDataSource(throwing).capLimit("m1"), null);

  const nonNumeric = fakeClient({ calls, chains, rpc: () => ({ data: "abc", error: null }) });
  assert.equal(await createSupabaseMentorCapDataSource(nonNumeric).capWeight("limited"), null);

  const countFailed = fakeClient({ calls, chains, rowsError: { message: "rls" }, rpc: () => ({ data: 1, error: null }) });
  assert.equal(await createSupabaseMentorCapDataSource(countFailed).activeSubscriptionCounts(["m1"]), null);
});

// ── 소스 스캔 가드: TS 가중치·기본 한도 상수가 코드베이스에 남아 있지 않은지 ───────────
const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib", "components"];
const EXT = new Set([".ts", ".tsx"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__contract__" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (EXT.has(p.slice(p.lastIndexOf(".")))) yield p;
  }
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

const BANNED: Array<{ label: string; re: RegExp }> = [
  { label: "구 TS cap 상수 식별자", re: /\b(CAP_WEIGHT_BY_TIER|MENTOR_CAP_LIMIT_DEFAULT|capWeightForTier|tierWeightFromRow)\b/ },
  { label: "tier→가중치 리터럴 표(1.0/2.5/4.5)", re: /limited\s*:\s*1(?:\.0)?\s*,\s*standard\s*:\s*2\.5\s*,\s*premium\s*:\s*4\.5/ },
  { label: "cap 기본 한도 28 리터럴", re: /(?:cap_?limit|CAP_?LIMIT)\w*\s*(?:=|\?\?|\|\||:)\s*28\b/i },
];

test("가드: TS 가중치(1.0/2.5/4.5)·기본 한도(28) 상수가 app/lib/components 에 없다 — 정원 정본은 DB RPC", () => {
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const { label, re } of BANNED) {
        const m = re.exec(src);
        if (!m) continue;
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`  ${file.slice(ROOT.length + 1)}:${line} [${label}] ${m[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "cap 가중치·기본 한도 사본 발견 — DB RPC(mentor_cap_used/limit, subscription_cap_weight)로 바꾸라:\n" + offenders.join("\n"));
});

test("가드: cap RPC 이름은 mentorCapUsageCore.ts 한 곳에만 있고, 서버 진입점은 subscriptions 를 직접 합산하지 않는다", () => {
  const core = stripComments(readFileSync(join(ROOT, "lib/subscribe/mentorCapUsageCore.ts"), "utf8"));
  for (const name of ["mentor_cap_used", "mentor_cap_limit", "subscription_cap_weight"]) {
    assert.ok(core.includes(`"${name}"`), `core 에 ${name} 이 없음`);
  }
  const svc = stripComments(readFileSync(join(ROOT, "lib/subscribe/mentorCapService.ts"), "utf8"));
  assert.ok(!/\.from\(\s*["'`]subscriptions["'`]\s*\)/.test(svc), "서비스 진입점이 subscriptions 를 직접 읽는다(TS 재합산 회귀)");
  assert.ok(!/plan_tier/.test(svc), "서비스 진입점이 plan_tier 를 다룬다(TS 가중치 회귀)");
});
