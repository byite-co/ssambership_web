#!/usr/bin/env node
/**
 * export_remote_contract.mjs — 원격 DB 계약 스냅샷 생성 (읽기 전용).
 *
 * 정본 쿼리 `scripts/contracts/contract_snapshot_query.sql` 을 staging 에 실행해
 * `contracts/snapshots/staging_contract.json` 과 동일한 canonical JSON 을 만든다.
 * 배열 정렬·키 순서는 SQL(jsonb_build_object + order by)이 결정론적으로 고정하고,
 * 이 스크립트는 2-space·개행만 정규화한다(재직렬화 = 동일 구조).
 *
 * 사용:
 *   SUPABASE_DB_URL=postgres://... node scripts/contracts/export_remote_contract.mjs --out <path>
 *   node scripts/contracts/export_remote_contract.mjs --input <query-output-file> --out <path>
 *
 * 안전 계약:
 *  - 기본 출력은 OS 임시 경로다 — committed snapshot 을 덮어쓰려면 반드시 --out 로 명시한다.
 *  - psql 은 읽기 전용 트랜잭션(PGOPTIONS=default_transaction_read_only=on)으로만 연다.
 *  - connection string·키·env 값을 stdout/stderr 에 출력하지 않는다(경로만 출력).
 *  - 임시 파일에 쓴 뒤 atomic rename; 실패 시 partial 파일을 제거한다.
 *  - egress 차단 환경: `--input <file>` 로 사전 수집한 정본 SQL 출력을 그대로 정규화한다.
 *  - business row(user/email/phone/storage path/payment/notification payload/삭제 job id)는
 *    쿼리 자체가 반환하지 않는다(카탈로그·grant·hash 만).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const QUERY = join(root, "scripts/contracts/contract_snapshot_query.sql");
const COMMITTED = join(root, "contracts/snapshots/staging_contract.json");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const outPath = argValue("--out") || join(tmpdir(), "staging_contract.export.json");
const inputPath = argValue("--input");

/** 정본 SQL 결과(단일 JSON 텍스트)를 얻는다 — --input 파일 우선, 아니면 읽기전용 psql. */
function fetchContractJson() {
  if (inputPath) return readFileSync(inputPath, "utf8");
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error(
      "no source: set SUPABASE_DB_URL for read-only psql, or pass --input <query-output-file>"
    );
    process.exit(2);
  }
  // project ref 검증(있을 때만) — URL·키는 절대 출력하지 않는다.
  const expectedRef = process.env.EXPECTED_SUPABASE_PROJECT_REF;
  if (expectedRef && !dbUrl.includes(expectedRef)) {
    console.error("SUPABASE_DB_URL project ref does not match EXPECTED_SUPABASE_PROJECT_REF");
    process.exit(2);
  }
  return execFileSync(
    "psql",
    [dbUrl, "-Atq", "-v", "ON_ERROR_STOP=1", "-f", QUERY],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // 세션 전체를 읽기 전용으로 강제 — 우발적 쓰기는 트랜잭션 레벨에서 거부된다.
      env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" },
    }
  );
}

const raw = fetchContractJson();
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  console.error(`contract query output is not valid JSON: ${e.message}`);
  process.exit(1);
}

// 정본 스냅샷 형태 sanity + 결정론적 최상위 키 순서(정본 순서).
// jsonb 내부 키 순서(길이·바이트 정규화)에 의존하지 않도록 최상위 키를 고정 순서로
// 재직렬화한다(중첩 객체는 SQL 정렬·jsonb 순서 그대로 — committed 관례와 일치).
const CANONICAL_KEYS = [
  "contract_snapshot_version",
  "schemas",
  "functions",
  "views",
  "table_grants",
  "policies",
  "publication_tables",
  "storage_buckets",
  "migrations",
];
for (const k of CANONICAL_KEYS) {
  if (!(k in parsed)) {
    console.error(`contract snapshot missing required key: ${k}`);
    process.exit(1);
  }
}
const ordered = {};
for (const k of CANONICAL_KEYS) ordered[k] = parsed[k];
for (const k of Object.keys(parsed)) if (!(k in ordered)) ordered[k] = parsed[k]; // 미지 키 보존

const serialized = `${JSON.stringify(ordered, null, 2)}\n`;
mkdirSync(dirname(outPath), { recursive: true });
const tmp = `${outPath}.tmp.${process.pid}`;
try {
  writeFileSync(tmp, serialized);
  renameSync(tmp, outPath); // atomic rename
} catch (e) {
  try {
    rmSync(tmp, { force: true });
  } catch {
    /* partial cleanup best-effort */
  }
  console.error(`failed to write snapshot: ${e.message}`);
  process.exit(1);
}

const overwritingCommitted = outPath === COMMITTED;
console.log(`snapshot written: ${outPath}${overwritingCommitted ? " (committed snapshot updated)" : " (non-committed — use --out to update committed snapshot)"}`);
