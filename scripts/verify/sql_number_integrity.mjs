#!/usr/bin/env node
// sql_number_integrity.mjs — 오프라인 SQL 번호 무결성 검사.
// 규칙(CLAUDE.md·docs/audit/apply_manifest_prod.md):
//   - 기존 SQL 재번호화 금지 → 신규 번호(146+)는 절대 중복이 없어야 한다(발견 시 exit 1).
//   - 레거시 번호 중복(002/032/033/034/039 등)은 알려진 상태 — 보고만 하고 실패로 치지 않는다.
// 사용: node scripts/verify/sql_number_integrity.mjs

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NEW_NUMBER_FLOOR = 146; // v16(1) 세대 신규 번호 시작(146~) — 중복 0 강제 구간.

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sqlDir = join(root, "supabase", "sql");

const files = readdirSync(sqlDir).filter((f) => f.endsWith(".sql"));
const byNumber = new Map();
for (const f of files) {
  const m = /^(\d{3})([a-z]?)_/.exec(f);
  if (!m) continue; // INDEX.md·README 등 비번호 파일 제외
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
console.log(`next free number: ${String(maxNum + 1).padStart(3, "0")}`);

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
