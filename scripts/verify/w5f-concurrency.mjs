#!/usr/bin/env node
// w5f-concurrency.mjs — W5-f F3 동시성 2세션 런타임 실증 (C1~C3).
//
// 목적: 회원탈퇴 saga 의 동시성 계약을 **실왕복**으로 증명한다.
//   C1  잔액 잠금 대기(TOCTOU 창) → begin_locked 이 A 커밋을 기다렸다가
//       FORFEIT_CONSENT_STALE 로 거절 · job pending 유지 · 잔액 1500.
//   C2  locked 사용자 충전 → 쓰기 게이트(151 adg_cash_ledger)가
//       ACCOUNT_DELETION_IN_PROGRESS 로 거부 · 잔액 불변.
//   C3  동시 요청 → 활성 job 정확히 1행(175 부분 UNIQUE uq_adj_active_user) ·
//       한쪽 멱등 반환 · unique_violation 누출 0.
//
// 안전 경계:
//   · 대상 DB 는 staging(lbeqxarxothkmzqvpudy) 단 하나 — 접속 문자열 가드 후에만 진행.
//   · fixture 사용자·행만 만들고 종료 시 해당 uid 한정 전량 정리(운영 행 무접촉).
//   · worker/cron 미실행 · real-run 0 · 상태기계는 begin_locked/write-gate 만 건드린다.
//
// 런타임 의존: pg, @supabase/supabase-js (미설치 시: npm install pg @supabase/supabase-js --no-save --no-package-lock).
// 실행: node --env-file=.env scripts/verify/w5f-concurrency.mjs

import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

const STAGING_REF = "lbeqxarxothkmzqvpudy";
const dbUrl = process.env.SUPABASE_DB_URL;
const supaUrl = process.env.SUPABASE_URL;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function guardFail(msg) { console.error(`GUARD_FAIL: ${msg}`); process.exit(2); }
if (!dbUrl || !dbUrl.includes(STAGING_REF)) guardFail("SUPABASE_DB_URL missing or not staging ref");
if (!supaUrl || !supaUrl.includes(STAGING_REF)) guardFail("SUPABASE_URL missing or not staging ref");
if (!svcKey) guardFail("SUPABASE_SERVICE_ROLE_KEY missing");

// ── 접속 설정: 접속 문자열의 password 인코딩 관례가 환경마다 달라(리터럴 vs %-encoded)
//    세 해석을 순서대로 시도하고 처음 붙는 것을 채택한다. staging ref 재확인 필수.
function manualUserinfo(u, decode) {
  const after = u.slice(u.indexOf("://") + 3);
  const at = after.lastIndexOf("@");
  const info = after.slice(0, at);
  const hostpart = after.slice(at + 1);
  const fc = info.indexOf(":");
  const rawUser = info.slice(0, fc);
  const rawPw = info.slice(fc + 1);
  const [hostport, dbSeg = "postgres"] = hostpart.split("/");
  const [host, port = "5432"] = hostport.split(":");
  const dec = (s) => (decode ? decodeURIComponent(s) : s);
  return { user: dec(rawUser), password: dec(rawPw), host, port: Number(port), database: dbSeg.split("?")[0], ssl: { rejectUnauthorized: false } };
}
const CANDIDATES = [
  () => ({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } }),
  () => manualUserinfo(dbUrl, false),
  () => manualUserinfo(dbUrl, true),
];
let PG_CONFIG = null;
async function resolvePgConfig() {
  let lastErr = null;
  for (const make of CANDIDATES) {
    const cfg = make();
    if (!JSON.stringify(cfg).includes(STAGING_REF)) continue; // ref 가드 재확인
    const probe = new pg.Client({ connectionTimeoutMillis: 12000, ...cfg });
    try { await probe.connect(); await probe.query("select 1"); await probe.end(); PG_CONFIG = cfg; return; }
    catch (e) { lastErr = e; try { await probe.end(); } catch {} }
  }
  throw new Error(`no working SUPABASE_DB_URL credential interpretation (last: ${lastErr?.code} ${lastErr?.message})`);
}
const newClient = () => new pg.Client({ connectionTimeoutMillis: 12000, ...PG_CONFIG });

const admin = createClient(supaUrl, svcKey, { auth: { persistSession: false, autoRefreshToken: false } });
const RUN = randomUUID().slice(0, 8);
const assert = (cond, msg) => { if (!cond) throw new Error(`ASSERT_FAIL: ${msg}`); };
const q1 = async (c, sql, params = []) => (await c.query(sql, params)).rows[0];

async function makeFixtureUser(tag) {
  const email = `w5f-f3-${tag}-${RUN}@example.invalid`;
  const r = await admin.auth.admin.createUser({ email, password: `Pw-${randomUUID()}`, email_confirm: true });
  if (r.error) throw new Error(`createUser(${tag}): ${r.error.message}`);
  return { id: r.data.user.id, email };
}

const report = { run: RUN, C1: {}, C2: {}, C3: {}, pass: false };

async function main() {
  await resolvePgConfig();
  const A = newClient(), B = newClient();
  await A.connect(); await B.connect();

  const u1 = await makeFixtureUser("u1");
  const u2 = await makeFixtureUser("u2");
  const u3 = await makeFixtureUser("u3");
  const uids = [u1.id, u2.id, u3.id];

  try {
    // ── C1: 잔액 잠금 대기 → FORFEIT_CONSENT_STALE ──────────────────────────────
    await q1(A, `select public.record_cash_topup($1, 1000, $2)`, [u1.id, `c1-topup1-${RUN}`]);
    const c1req = await q1(A, `select public.account_deletion_request_consented($1, 0, true, true, 1000) r`, [u1.id]);
    assert(c1req.r?.ok === true && c1req.r?.state === "pending", "C1 request_consented pending");
    assert(c1req.r?.consented_balance_cents === 1000, "C1 consented balance 1000");

    // A: 미커밋 트랜잭션에서 +500 충전 → cash_wallets 행 잠금 보유
    await A.query("BEGIN");
    await A.query(`select public.record_cash_topup($1, 500, $2)`, [u1.id, `c1-topup2-${RUN}`]);

    // B: begin_locked — A 의 wallet FOR UPDATE 에서 대기해야 한다(타임스탬프로 관측).
    const bStartTs = new Date().toISOString(); const bStartHr = performance.now();
    let bDone = false, bRow = null, bDoneTs = null, bDoneHr = null;
    const bP = B.query(`select public.account_deletion_begin_locked($1) r`, [u1.id])
      .then((r) => { bDone = true; bRow = r.rows[0].r; bDoneTs = new Date().toISOString(); bDoneHr = performance.now(); });
    await sleep(1000);
    const blockedObserved = !bDone; // A 커밋 전에는 B 가 끝나지 않아야 한다
    const aCommitTs = new Date().toISOString();
    await A.query("COMMIT");
    await bP;
    const waitedMs = Math.round(bDoneHr - bStartHr);

    const c1state = await q1(A, `select state, cancelable_until from public.account_deletion_jobs
      where user_id=$1 order by requested_at desc, id desc limit 1`, [u1.id]);
    const c1bal = await q1(A, `select coalesce(balance_cents,0)::int b from public.cash_wallets where user_id=$1`, [u1.id]);

    report.C1 = {
      b_begin_locked_started: bStartTs, a_committed: aCommitTs, b_begin_locked_returned: bDoneTs,
      b_waited_ms: waitedMs, lock_wait_observed: blockedObserved,
      b_result_code: bRow?.code, job_state: c1state.state, balance_cents: c1bal.b,
    };
    assert(blockedObserved, "C1 begin_locked must block until A commits");
    assert(new Date(bDoneTs) >= new Date(aCommitTs), "C1 begin_locked returned only after A commit");
    assert(bRow?.ok === false && bRow?.code === "FORFEIT_CONSENT_STALE", "C1 code FORFEIT_CONSENT_STALE");
    assert(c1state.state === "pending", "C1 job stays pending");
    assert(c1bal.b === 1500, "C1 balance 1500");
    report.C1.pass = true;

    // ── C2: locked 사용자 충전 거부 ─────────────────────────────────────────────
    const c2req = await q1(A, `select public.account_deletion_request_consented($1, 0, true, false, null) r`, [u2.id]);
    assert(c2req.r?.ok === true && c2req.r?.state === "pending", "C2 request_consented pending (balance 0)");
    const c2lock = await q1(A, `select public.account_deletion_begin_locked($1) r`, [u2.id]);
    assert(c2lock.r?.ok === true && c2lock.r?.state === "locked", "C2 begin_locked -> locked");

    let c2err = null;
    try { await B.query(`select public.record_cash_topup($1, 100, $2)`, [u2.id, `c2-topup-${RUN}`]); }
    catch (e) { c2err = e.message; }
    const c2bal = await q1(A, `select coalesce((select balance_cents from public.cash_wallets where user_id=$1),0)::int b`, [u2.id]);
    report.C2 = { topup_error: c2err, balance_cents: c2bal.b };
    assert(c2err && /ACCOUNT_DELETION_IN_PROGRESS/.test(c2err), "C2 topup rejected with ACCOUNT_DELETION_IN_PROGRESS");
    assert(c2bal.b === 0, "C2 balance unchanged (0)");
    report.C2.pass = true;

    // ── C3: 동시 요청 → 활성 1행 · 멱등 · unique_violation 누출 0 ────────────────
    // 실사용자 경로(account_deletion_request_self_consented)는 pg_advisory_xact_lock
    // 으로 사용자당 요청을 직렬화한다(176:172). 그 계약을 그대로 재현한다:
    // 각 세션이 동일 advisory 락을 잡고 request_consented 를 호출 → 한쪽이 멱등 반환.
    const consentedSerialized = async (client) => {
      await client.query("BEGIN");
      await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`account_deletion_self:${u3.id}`]);
      const r = await client.query(`select public.account_deletion_request_consented($1, 30, true, false, null) r`, [u3.id]);
      await client.query("COMMIT");
      return r.rows[0].r;
    };
    const settled = await Promise.allSettled([consentedSerialized(A), consentedSerialized(B)]);
    const rejected = settled.filter((s) => s.status === "rejected");
    const uniqueViolations = rejected.filter((s) => /duplicate key|unique|23505/i.test(String(s.reason?.message || s.reason)));
    const fulfilled = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
    const existingTrue = fulfilled.filter((v) => v?.ok === true && v?.existing === true).length;
    const existingFalse = fulfilled.filter((v) => v?.ok === true && v?.existing === false).length;
    const activeCount = await q1(A, `select count(*)::int n from public.account_deletion_jobs
      where user_id=$1 and state in ('pending','locked','purging','storage_purged','finalized','auth_soft_deleted')`, [u3.id]);
    report.C3 = {
      fulfilled: fulfilled.length, rejected: rejected.length, unique_violations: uniqueViolations.length,
      idempotent_existing_true: existingTrue, fresh_existing_false: existingFalse, active_job_rows: activeCount.n,
      results: fulfilled.map((v) => ({ ok: v?.ok, existing: v?.existing, state: v?.state })),
    };
    assert(uniqueViolations.length === 0, "C3 zero unique_violation leak");
    assert(activeCount.n === 1, "C3 exactly one active job row (partial UNIQUE)");
    assert(existingFalse === 1 && existingTrue === 1, "C3 one fresh insert + one idempotent existing");
    report.C3.pass = true;

    report.pass = report.C1.pass && report.C2.pass && report.C3.pass;
  } finally {
    // ── 정리: fixture uid 한정 전량 삭제 → baseline 원복 ──────────────────────
    const cleanup = newClient();
    try {
      await cleanup.connect();
      await cleanup.query(`delete from public.account_deletion_jobs where user_id = any($1::uuid[])`, [uids]);
      await cleanup.query(`delete from public.cash_ledger where user_id = any($1::uuid[])`, [uids]);
      await cleanup.query(`delete from public.cash_wallets where user_id = any($1::uuid[])`, [uids]);
    } finally { try { await cleanup.end(); } catch {} }
    for (const u of [u1, u2, u3]) { try { await admin.auth.admin.deleteUser(u.id, false); } catch {} }
    try { await A.end(); } catch {}
    try { await B.end(); } catch {}
  }
}

main()
  .then(() => { console.log(JSON.stringify(report, null, 2)); process.exit(report.pass ? 0 : 1); })
  .catch((e) => { report.error = e.message; console.log(JSON.stringify(report, null, 2)); process.exit(1); });
