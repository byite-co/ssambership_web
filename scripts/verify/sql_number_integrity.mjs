#!/usr/bin/env node
// sql_number_integrity.mjs — 오프라인 SQL 번호·물리 정책 무결성 검사.
// 규칙(CLAUDE.md·docs/audit/apply_manifest_prod.md·docs/audit/s2_2_migration_physical_policy_20260730.md):
//   [레거시 3자리 체계 — 기존 검사 보존]
//   - 기존 SQL 재번호화 금지 → 신규 번호(146+)는 절대 중복이 없어야 한다(발견 시 exit 1).
//   - 레거시 번호 중복(002/032/033/034/039 등)은 알려진 상태 — 보고만 하고 실패로 치지 않는다.
//   - 레거시 다음 번호는 3자리 체계 전용이며 S2 M0~M17 에는 적용하지 않는다.
//   [S2 UTC timestamp 체계 — 물리 정책 정본]
//   - S2 신규 migration 은 정확한 14자리 UTC timestamp(YYYYMMDDHHMMSS) 파일명만 허용.
//   - S2 timestamp 중복 0 · Batch A: M0 < M15 · Batch B: M1 < M13 < M4 ·
//     Batch C: M5 < M6 < M7 · Batch D: M17 < M8 < M14 · Batch E: M9 단독 ·
//     Batch F: M11 < M12 < M16 < M10 ·
//     Batch 간 전건 순서 A < B < C < D < E < F (물리 계획표 §9 생성 순서).
//   - supabase/migrations/ 잔존 SQL 0 (CLI 는 timestamp 채번에만 사용).
//   - S2 forward 각각에 supabase/rollback/<TS>_<STEM>_rollback.sql 정확히 1개 —
//     단 M10(contract_permission_assertions)은 상태 0 checkpoint 로 rollback 없음(정확히 0개).
//   - rollback 은 supabase/sql/ 아래 금지·clean-install 수에 불포함.
//   - 레거시 190개·제외 15개 불변 / Batch F 후 supabase/sql/*.sql 총 206개(190+16) /
//     정규 clean-install 175+16=191 · rollback 15개(M10 없음·M2/M3 retired).
// 사용: node scripts/verify/sql_number_integrity.mjs

import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NEW_NUMBER_FLOOR = 146; // v16(1) 세대 신규 번호 시작(146~) — 중복 0 강제 구간.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sqlDir = join(root, "supabase", "sql");
const rollbackDir = join(root, "supabase", "rollback");
const migrationsDir = join(root, "supabase", "migrations");

const files = readdirSync(sqlDir).filter((f) => f.endsWith(".sql"));

let failed = false;
const fail = (msg) => {
  console.error(`\nERROR: ${msg}`);
  failed = true;
};

// ---------------------------------------------------------------------------
// 1. 레거시 3자리 번호 검사 (기존 검사 — 결과 약화·skip 금지)
// ---------------------------------------------------------------------------
const byNumber = new Map();
for (const f of files) {
  const m = /^(\d{3})([a-z]?)_/.exec(f);
  if (!m) continue; // INDEX.md·README·S2 timestamp 파일 등 비번호 파일 제외
  const key = `${m[1]}${m[2]}`;
  if (!byNumber.has(key)) byNumber.set(key, []);
  byNumber.get(key).push(f);
}

const legacyDup = [];
const newDup = [];
let maxNum = 0;
for (const [key, list] of [...byNumber.entries()].sort()) {
  const n = Number.parseInt(key, 10);
  if (n > maxNum) maxNum = n;
  if (list.length > 1) {
    (n >= NEW_NUMBER_FLOOR ? newDup : legacyDup).push({ key, list });
  }
}

console.log(`sql files with numeric prefix: ${[...byNumber.keys()].length} (max=${String(maxNum).padStart(3, "0")})`);
console.log(
  `next free LEGACY number: ${String(maxNum + 1).padStart(3, "0")} — 레거시 3자리 체계 전용. ` +
    `S2 M0~M17 은 물리 정책 정본에 따라 UTC timestamp 파일명을 사용하며 이 번호를 쓰지 않는다.`
);

if (legacyDup.length) {
  console.log(`\nlegacy duplicates (known, report-only):`);
  for (const d of legacyDup) console.log(`  ${d.key}: ${d.list.join(", ")}`);
}

if (newDup.length) {
  console.error(`\nERROR: duplicate NEW numbers (>=${NEW_NUMBER_FLOOR}) — 재번호화/충돌 금지 위반:`);
  for (const d of newDup) console.error(`  ${d.key}: ${d.list.join(", ")}`);
  process.exit(1);
}

console.log(`\nOK: no duplicate numbers in the ${NEW_NUMBER_FLOOR}+ range.`);

// ---------------------------------------------------------------------------
// 2. S2 timestamp 체계 검사 (Batch A — 물리 정책 정본)
// ---------------------------------------------------------------------------
const LEGACY_TOTAL = 190; // 기존 3자리 SQL — 불변
const LEGACY_EXCLUDED = [
  "002_app_core_schema_draft.sql",
  "039_storage_buckets_private_audit.sql",
  "071_individual_question_test_data_cleanup.sql",
  "105_subscription_settlement_period_gating.sql",
  "106_payout_runs.sql",
  "107_due_payouts_view.sql",
  "108_pay_due_payouts_rpc.sql",
  "109_individual_question_release_split.sql",
  "110_custom_request_remove_immediate_payout.sql",
  "111_due_payouts_completion_guard.sql",
  "114_payout_withholding_3_3pct.sql",
  "146_p2_1_avatar_document_crossref_diagnostic.sql",
  "153_p2_25_pay_due_payouts_convergence.sql",
  "156_p2_25_payout_scheduler_foundation.sql",
  "184_seed_additional_admin.sql",
]; // 제외 15 — 불변 (apply_manifest_prod.md §3)

// S2 확정 집합 — batch 내 순서는 배열 순서(물리 계획표 §9 생성 순서)로 강제한다.
const S2_BATCH_A = [
  { id: "M0", stem: "mentor_profile_privileged_column_guard" },
  { id: "M15", stem: "weekly_usage_pair_party_guard" },
];
const S2_BATCH_B = [
  { id: "M1", stem: "api_web_v1_schemas" },
  { id: "M13", stem: "comments_author_label_denormalize" },
  { id: "M4", stem: "api_web_v1_read_views" },
];
const S2_BATCH_C = [
  { id: "M5", stem: "core_private_room_ensure" },
  { id: "M6", stem: "api_web_v1_self_rpc" },
  { id: "M7", stem: "api_web_v1_community_rpc" },
];
const S2_BATCH_D = [
  { id: "M17", stem: "api_app_v1_surface" },
  { id: "M8", stem: "api_web_v1_mentor_rpc" },
  { id: "M14", stem: "api_web_v1_payout_account_rpc" },
];
const S2_BATCH_E = [
  { id: "M9", stem: "money_rpc" },
];
const S2_BATCH_F = [
  { id: "M11", stem: "revoke_mentor_profiles_write" },
  { id: "M12", stem: "revoke_mentor_plans_write" },
  { id: "M16", stem: "community_direct_write_lockdown" },
  { id: "M10", stem: "contract_permission_assertions", noRollback: true }, // 상태 0 checkpoint — rollback 없음
];
const S2_EXPECTED = [...S2_BATCH_A, ...S2_BATCH_B, ...S2_BATCH_C, ...S2_BATCH_D, ...S2_BATCH_E, ...S2_BATCH_F];
const S2_NO_ROLLBACK_STEMS = new Set(S2_EXPECTED.filter((x) => x.noRollback).map((x) => x.stem));

const legacyFiles = files.filter((f) => /^\d{3}[a-z]?_/.test(f));
const s2Files = files.filter((f) => !/^\d{3}[a-z]?_/.test(f));

// 2-1. S2 파일은 정확한 14자리 timestamp 형식만 허용
const S2_RE = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const s2Parsed = [];
for (const f of s2Files) {
  const m = S2_RE.exec(f);
  if (!m) {
    fail(`S2 파일명 형식 위반(14자리 UTC timestamp 아님): supabase/sql/${f}`);
    continue;
  }
  const ts = m[1];
  const mm = Number(ts.slice(4, 6));
  const dd = Number(ts.slice(6, 8));
  const hh = Number(ts.slice(8, 10));
  const mi = Number(ts.slice(10, 12));
  const ss = Number(ts.slice(12, 14));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59 || ss > 59) {
    fail(`S2 timestamp 값이 유효한 UTC 시각이 아님: ${f}`);
  }
  s2Parsed.push({ file: f, ts, stem: m[2] });
}

// 2-2. S2 timestamp 중복 0
const tsSeen = new Map();
for (const s of s2Parsed) {
  if (tsSeen.has(s.ts)) fail(`S2 timestamp 중복: ${tsSeen.get(s.ts)} vs ${s.file}`);
  tsSeen.set(s.ts, s.file);
}

// 2-3. Batch 구성·순서 — batch 내 timestamp 오름차순(M0<M15 · M1<M13<M4) +
//       Batch A 전건 < Batch B 전건
const byStem = new Map(s2Parsed.map((s) => [s.stem, s]));
for (const { id, stem } of S2_EXPECTED) {
  if (!byStem.has(stem)) fail(`S2 forward 부재: ${id} (${stem})`);
}
for (const batch of [S2_BATCH_A, S2_BATCH_B, S2_BATCH_C, S2_BATCH_D, S2_BATCH_E, S2_BATCH_F]) {
  for (let i = 1; i < batch.length; i++) {
    const prev = byStem.get(batch[i - 1].stem);
    const cur = byStem.get(batch[i].stem);
    if (prev && cur && !(prev.ts < cur.ts)) {
      fail(`${batch[i - 1].id} timestamp(${prev.ts}) < ${batch[i].id} timestamp(${cur.ts}) 위반`);
    }
  }
}
{
  const batches = [["A", S2_BATCH_A], ["B", S2_BATCH_B], ["C", S2_BATCH_C], ["D", S2_BATCH_D], ["E", S2_BATCH_E], ["F", S2_BATCH_F]];
  for (let i = 1; i < batches.length; i++) {
    const [prevName, prev] = batches[i - 1];
    const [curName, cur] = batches[i];
    const prevMax = Math.max(...prev.map((x) => Number(byStem.get(x.stem)?.ts ?? "0")));
    const curMin = Math.min(...cur.map((x) => Number(byStem.get(x.stem)?.ts ?? "99999999999999")));
    if (Number.isFinite(prevMax) && Number.isFinite(curMin) && !(prevMax < curMin)) {
      fail(`Batch ${prevName} 전건 timestamp < Batch ${curName} 전건 timestamp 위반 (max=${prevMax}, min=${curMin})`);
    }
  }
}
const knownStems = new Set(S2_EXPECTED.map((x) => x.stem));
for (const s of s2Parsed) {
  if (!knownStems.has(s.stem)) {
    fail(`허용되지 않은 S2 파일(Batch A~F 범위 밖): ${s.file} — 물리 정책 §9 계획표에 따라 배치별로만 추가한다`);
  }
}

// 2-4. supabase/migrations/ 잔존 SQL 0
if (existsSync(migrationsDir)) {
  const leftovers = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  if (leftovers.length) fail(`supabase/migrations/ 잔존 SQL ${leftovers.length}건: ${leftovers.join(", ")}`);
}

// 2-5. rollback 검사 — forward:rollback 1:1, sql/ 아래 금지, clean-install 불포함
const rollbackFiles = existsSync(rollbackDir)
  ? readdirSync(rollbackDir).filter((f) => f.endsWith(".sql"))
  : [];
for (const s of s2Parsed) {
  const expected = `${s.ts}_${s.stem}_rollback.sql`;
  const matches = rollbackFiles.filter((f) => f === expected);
  if (S2_NO_ROLLBACK_STEMS.has(s.stem)) {
    // M10 — 읽기 전용 checkpoint. rollback 파일이 존재하면 그 자체가 위반이다.
    if (matches.length !== 0) {
      fail(`상태 0 checkpoint ${s.file} 에 rollback 이 존재(정책 위반 — M10 은 rollback 없음): ${matches.join(", ")}`);
    }
  } else if (matches.length !== 1) {
    fail(`forward ${s.file} 의 rollback 이 정확히 1개가 아님(발견 ${matches.length}): supabase/rollback/${expected}`);
  }
}
for (const f of rollbackFiles) {
  const m = /^(\d{14})_([a-z0-9_]+)_rollback\.sql$/.exec(f);
  if (!m) {
    fail(`rollback 파일명 형식 위반: supabase/rollback/${f}`);
    continue;
  }
  if (!s2Parsed.some((s) => s.ts === m[1] && s.stem === m[2])) {
    fail(`대응 forward 가 없는 rollback: supabase/rollback/${f}`);
  }
}
const rollbackInSql = files.filter((f) => f.endsWith("_rollback.sql"));
if (rollbackInSql.length) {
  fail(`rollback 이 supabase/sql/ 아래에 존재(정본 경로 위반): ${rollbackInSql.join(", ")}`);
}

// 2-6. 개수 산식 — 레거시 190 불변·제외 15 불변·총 206·clean-install 191·rollback 15
if (legacyFiles.length !== LEGACY_TOTAL) {
  fail(`레거시 3자리 SQL ${LEGACY_TOTAL}개 불변 위반: 현재 ${legacyFiles.length}개`);
}
for (const ex of LEGACY_EXCLUDED) {
  if (!legacyFiles.includes(ex)) fail(`제외 15 목록 파일 부재(불변 위반): ${ex}`);
}
const EXPECTED_TOTAL = LEGACY_TOTAL + S2_EXPECTED.length; // 206 (Batch F 후 — 190+16)
if (files.length !== EXPECTED_TOTAL) {
  fail(`supabase/sql/*.sql 총수 ${EXPECTED_TOTAL}개 기대, 현재 ${files.length}개`);
}
const cleanInstallNow = LEGACY_TOTAL - LEGACY_EXCLUDED.length + s2Parsed.length; // 175 + S2 forward
const CLEAN_INSTALL_EXPECTED_NOW = 191; // Batch F 완료 — S2 forward 16 전건(175+16)
const EXPECTED_ROLLBACK_TOTAL = 15; // S2 forward 16 − M10(rollback 없음). M2·M3 retired — 파일 자체 없음
if (cleanInstallNow !== CLEAN_INSTALL_EXPECTED_NOW) {
  fail(`정규 clean-install 수 ${CLEAN_INSTALL_EXPECTED_NOW} 기대, 계산값 ${cleanInstallNow} (rollback 은 불포함)`);
}
if (rollbackFiles.length !== EXPECTED_ROLLBACK_TOTAL) {
  fail(`rollback 총수 ${EXPECTED_ROLLBACK_TOTAL} 기대(M10 없음), 현재 ${rollbackFiles.length}개`);
}

console.log(`\n[S2] forward files: ${s2Parsed.length} (${s2Parsed.map((s) => s.file).join(", ")})`);
console.log(`[S2] rollback files: ${rollbackFiles.length} (${rollbackFiles.join(", ")})`);
console.log(`[S2] legacy ${legacyFiles.length} (제외 ${LEGACY_EXCLUDED.length}) + S2 forward ${s2Parsed.length} → 정규 clean-install ${cleanInstallNow} (최종 — S2 forward 16 전건 완료)`);
console.log(`[S2] rollback ${rollbackFiles.length}/15 (M10 은 상태 0 checkpoint — rollback 없음 · M2/M3 retired)`);

if (failed) {
  console.error(`\nFAILED: S2/물리 정책 무결성 위반이 있다.`);
  process.exit(1);
}
console.log(`\nOK: S2 timestamp·rollback·개수 산식 전건 통과.`);
