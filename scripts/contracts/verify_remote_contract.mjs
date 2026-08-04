#!/usr/bin/env node
/**
 * verify_remote_contract.mjs — 계약 스냅샷 검증.
 *
 * 항상 수행(오프라인):
 *   1) 스냅샷 존재·파싱
 *   2) 스냅샷 ledger 의 모든 적용 migration 에 대응하는 소스 파일 존재(적용본·소스 파리티)
 *
 * 원격 소스가 있으면(SUPABASE_DB_URL 또는 --input) 추가 수행(온라인):
 *   3) committed snapshot vs 현재 원격 export 를 semantic diff.
 *      결과: IDENTICAL / METADATA_ONLY_DRIFT / SEMANTIC_DRIFT.
 *      제외 가능한 것은 export metadata(exported_at/generated_at/…) 뿐이다.
 *      함수 body hash·signature·return·SECURITY DEFINER/INVOKER·search_path·EXECUTE ACL·
 *      table grant·RLS policy·view 정의/보안옵션·publication·bucket·migration ledger 는
 *      절대 제외하지 않는다. SEMANTIC_DRIFT → exit 1.
 *
 * 이 스크립트는 committed snapshot 을 원격으로 '복사'하지 않으며, diff 를 무조건
 * 무시하지 않는다(그런 동작이 재발하면 아래 구조가 깨지도록 설계).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const snapshotPath = join(root, "contracts/snapshots/staging_contract.json");
const QUERY = join(root, "scripts/contracts/contract_snapshot_query.sql");

// export 시각류 metadata — semantic 이 아니다(현재 스냅샷엔 없지만 future-proof).
const METADATA_KEYS = new Set([
  "exported_at",
  "generated_at",
  "snapshot_generated_at",
  "tool_run_at",
]);

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function fail(msg) {
  console.error(`CONTRACT VERIFY FAILED: ${msg}`);
  process.exit(1);
}

if (!existsSync(snapshotPath)) fail("snapshot missing: contracts/snapshots/staging_contract.json");
let snapshot;
try {
  snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
} catch (e) {
  fail(`snapshot unparsable: ${e.message}`);
}

// 2) 적용 migration → 소스 파일 매핑.
const STRICT_FROM_VERSION = "20260731000000";
const sqlDir = join(root, "supabase/sql");
const sqlFiles = readdirSync(sqlDir);
const hasSource = (version, name) =>
  sqlFiles.some(
    (f) =>
      f.startsWith(`${version}_`) ||
      f === `${name}.sql` ||
      f.includes(name) ||
      (/^\d+_/.test(name) && f.startsWith(`${name.split("_")[0]}_`))
  );
const missingStrict = [];
const missingLegacy = [];
for (const m of snapshot.migrations ?? []) {
  const version = String(m.version ?? "");
  const name = String(m.name ?? "");
  if (hasSource(version, name)) continue;
  (version >= STRICT_FROM_VERSION ? missingStrict : missingLegacy).push(`${version} ${name}`);
}
if (missingLegacy.length) {
  console.warn(`warning: legacy-era ledger entries without filename match (${missingLegacy.length}):`);
  for (const m of missingLegacy) console.warn(`  ${m}`);
}
if (missingStrict.length) fail(`applied migrations without source file:\n  ${missingStrict.join("\n  ")}`);
console.log(`source/applied parity: OK (${(snapshot.migrations ?? []).length} ledger entries)`);

// 3) 온라인 diff (원격 소스 필요)
const inputPath = argValue("--input");
const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
if (!inputPath && !dbUrl) {
  console.log("no remote source (SUPABASE_DB_URL unset, no --input) — offline checks only");
  process.exit(0);
}

let raw;
if (inputPath) {
  raw = readFileSync(inputPath, "utf8");
} else {
  const expectedRef = process.env.EXPECTED_SUPABASE_PROJECT_REF;
  if (expectedRef && !dbUrl.includes(expectedRef)) {
    fail("SUPABASE_DB_URL project ref does not match EXPECTED_SUPABASE_PROJECT_REF");
  }
  raw = execFileSync(
    "psql",
    [dbUrl, "-Atq", "-v", "ON_ERROR_STOP=1", "-f", QUERY],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" },
    }
  );
}
let live;
try {
  live = JSON.parse(raw);
} catch (e) {
  fail(`remote export not valid JSON: ${e.message}`);
}

/** deep-diff → 경로 문자열 목록. metadata 경로는 isMeta 로 분류만 하고 수집한다. */
function diffPaths(a, b, path, acc) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const max = Math.max(a.length, b.length);
    if (a.length !== b.length) acc.push(`${path}: length ${a.length} != ${b.length}`);
    for (let i = 0; i < max && acc.length < 100; i++) diffPaths(a[i], b[i], `${path}[${i}]`, acc);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (acc.length >= 100) return;
      diffPaths(a[k], b[k], `${path}.${k}`, acc);
    }
    return;
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) acc.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

// 최상위 metadata 키만 분리(다른 위치의 동명 키는 semantic 로 취급).
function stripTopMetadata(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const copy = {};
  for (const [k, v] of Object.entries(obj)) if (!METADATA_KEYS.has(k)) copy[k] = v;
  return copy;
}

const diffs = [];
diffPaths(stripTopMetadata(snapshot), stripTopMetadata(live), "$", diffs);

// metadata 차이 존재 여부(분류용) — 최상위 metadata 키 값 비교.
let metadataDiffered = false;
for (const k of METADATA_KEYS) {
  if (JSON.stringify(snapshot?.[k]) !== JSON.stringify(live?.[k])) metadataDiffered = true;
}

if (diffs.length) {
  console.error("VERDICT: SEMANTIC_DRIFT");
  fail(`remote contract semantic drift (${diffs.length} path(s)):\n  ${diffs.join("\n  ")}`);
}
if (metadataDiffered) {
  console.log("VERDICT: METADATA_ONLY_DRIFT (export timestamps only — contract semantics identical)");
  process.exit(0);
}
console.log("VERDICT: IDENTICAL (no drift)");
process.exit(0);
