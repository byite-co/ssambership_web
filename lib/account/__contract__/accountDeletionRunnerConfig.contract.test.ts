// 계약 테스트: 계정 삭제 러너 게이트 — 파괴 실행은 세 조건이 모두 참일 때만.
// 실행: node --test --experimental-strip-types lib/account/__contract__/accountDeletionRunnerConfig.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DELETION_CLAIM_LIMIT,
  DEFAULT_DELETION_LEASE_SECONDS,
  effectiveJobDryRun,
  isAccountDeletionWorkerEnabled,
  parseCronRealRunEnv,
  parseRequestedDryRun,
  resolveClaimParams,
  resolveDeletionRunMode,
} from "../accountDeletionRunnerConfig.ts";

test("kill switch 기본 off — 미설정·빈 값·오타는 전부 비활성", () => {
  for (const raw of [undefined, "", " ", "TRUE", "True", "yes", "on", "2", "false", "0"]) {
    assert.equal(isAccountDeletionWorkerEnabled(raw), false, JSON.stringify(raw));
  }
  assert.equal(isAccountDeletionWorkerEnabled("true"), true);
  assert.equal(isAccountDeletionWorkerEnabled("1"), true);
});

test("worker 비활성이면 claim 자체를 하지 않는다(enabled=false)", () => {
  const mode = resolveDeletionRunMode({
    workerEnabledRaw: undefined,
    featureEnabled: true,
    requestedDryRun: false,
  });
  assert.deepEqual(mode, { enabled: false, dryRun: true, reason: "worker_disabled" });
});

test("기능 플래그가 꺼져 있으면 worker 가 켜져 있어도 실행하지 않는다", () => {
  const mode = resolveDeletionRunMode({
    workerEnabledRaw: "true",
    featureEnabled: false,
    requestedDryRun: false,
  });
  assert.deepEqual(mode, { enabled: false, dryRun: true, reason: "feature_disabled" });
});

test("dryRun 미지정이면 dry-run 이 기본(파괴 동작 금지)", () => {
  const mode = resolveDeletionRunMode({
    workerEnabledRaw: "true",
    featureEnabled: true,
    requestedDryRun: undefined,
  });
  assert.equal(mode.enabled, true);
  assert.equal(mode.dryRun, true);
  assert.equal(mode.reason, "dry_run_default");
});

test("실제 삭제는 세 조건이 모두 참일 때만", () => {
  const mode = resolveDeletionRunMode({
    workerEnabledRaw: "true",
    featureEnabled: true,
    requestedDryRun: false,
  });
  assert.deepEqual(mode, { enabled: true, dryRun: false, reason: "real_run" });
});

test("dryRun 파라미터 파싱 — false/0 만 실제 삭제로 내려간다", () => {
  assert.equal(parseRequestedDryRun("false"), false);
  assert.equal(parseRequestedDryRun("0"), false);
  assert.equal(parseRequestedDryRun("FALSE"), false);
  assert.equal(parseRequestedDryRun("true"), true);
  assert.equal(parseRequestedDryRun("1"), true);
  // 미지정·알 수 없는 값은 undefined → 상위에서 dry-run 기본이 적용된다.
  assert.equal(parseRequestedDryRun(null), undefined);
  assert.equal(parseRequestedDryRun("maybe"), undefined);
  assert.equal(parseRequestedDryRun(""), undefined);
});

test("cron real-run env 파싱 — true/1 만 dryRun=false, 그 외는 dry-run 기본 유지", () => {
  assert.equal(parseCronRealRunEnv("true"), false);
  assert.equal(parseCronRealRunEnv("1"), false);
  // 미설정·빈 값·오타·대문자는 전부 undefined → dry-run 기본. kill switch(①)와 동일 파싱 관례.
  for (const raw of [undefined, "", " ", "TRUE", "True", "yes", "on", "false", "0"]) {
    assert.equal(parseCronRealRunEnv(raw), undefined, JSON.stringify(raw));
  }
});

test("cron real-run env 가 켜져도 worker·기능 플래그 게이트는 그대로다", () => {
  // env 신호는 requestedDryRun 으로만 흘러들어온다 — ①②가 꺼져 있으면 실행 자체가 없다.
  const mode = resolveDeletionRunMode({
    workerEnabledRaw: undefined,
    featureEnabled: true,
    requestedDryRun: parseCronRealRunEnv("true"),
  });
  assert.deepEqual(mode, { enabled: false, dryRun: true, reason: "worker_disabled" });
});

test("job.dry_run=true 는 러너가 real_run 이어도 뒤집히지 않는다", () => {
  const realRun = { enabled: true, dryRun: false, reason: "real_run" };
  assert.equal(effectiveJobDryRun(true, realRun), true, "job 이 dry 면 dry");
  assert.equal(effectiveJobDryRun(false, realRun), false);

  const dryMode = { enabled: true, dryRun: true, reason: "dry_run_default" };
  assert.equal(effectiveJobDryRun(false, dryMode), true, "러너가 dry 면 dry");
});

test("claim 파라미터는 기본값과 상한을 강제한다", () => {
  assert.deepEqual(resolveClaimParams({}), {
    limit: DEFAULT_DELETION_CLAIM_LIMIT,
    leaseSeconds: DEFAULT_DELETION_LEASE_SECONDS,
  });
  assert.equal(resolveClaimParams({ limitRaw: "999" }).limit, 20, "상한 20");
  assert.equal(resolveClaimParams({ limitRaw: "0" }).limit, 1, "하한 1");
  assert.equal(resolveClaimParams({ limitRaw: "쓰레기" }).limit, DEFAULT_DELETION_CLAIM_LIMIT);
  assert.equal(resolveClaimParams({ leaseSecondsRaw: "10" }).leaseSeconds, 60, "lease 하한 60");
  assert.equal(resolveClaimParams({ leaseSecondsRaw: "99999" }).leaseSeconds, 3600, "lease 상한 3600");
});
