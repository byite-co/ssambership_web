/**
 * contractToolingPresence.contract.test.ts — 계약 스냅샷 도구 정본·추적 잠금.
 *
 * WEB-TOOLING-001 회귀 가드: `contracts:export`/`contracts:verify` 가 참조하는
 * `scripts/contracts/*` 가 `scripts/*` gitignore 로 미추적되어 CI checkout 에서
 * 모듈 부재로 실패하던 결함이 재발하지 않도록, 아래를 소스로 고정한다.
 *  - package script 2종 존재 + 참조 파일 실재
 *  - 정본 SQL 이 SELECT/카탈로그 전용(DML/DDL 문 0)
 *  - .gitignore 가 scripts/contracts/ 를 추적 허용(그 외 scripts/* 는 계속 차단)
 *  - Node 도구 2종 syntax parse 성공(node --check)
 *  - exporter 는 기본 동작으로 committed snapshot 을 덮어쓰지 않는다
 *  - verifier 는 semantic drift 에서 non-zero 종료하며 스냅샷을 '복사'하지 않는다
 *  - 두 도구 모두 connection string/키/env 비밀값을 stdout 에 출력하지 않는다
 *
 * CI checkout 에는 추적된 파일만 존재하므로, 이 테스트는 미추적 회귀도 차단한다.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const EXPORTER = "scripts/contracts/export_remote_contract.mjs";
const VERIFIER = "scripts/contracts/verify_remote_contract.mjs";
const QUERY = "scripts/contracts/contract_snapshot_query.sql";

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
const exporterSrc = readFileSync(join(ROOT, EXPORTER), "utf8");
const verifierSrc = readFileSync(join(ROOT, VERIFIER), "utf8");
const querySrc = readFileSync(join(ROOT, QUERY), "utf8");

test("package script contracts:export/contracts:verify 가 실재 파일을 참조", () => {
  const exp = pkg.scripts?.["contracts:export"];
  const ver = pkg.scripts?.["contracts:verify"];
  assert.ok(exp && exp.includes(EXPORTER), "contracts:export 스크립트가 exporter 를 참조하지 않음");
  assert.ok(ver && ver.includes(VERIFIER), "contracts:verify 스크립트가 verifier 를 참조하지 않음");
  for (const f of [EXPORTER, VERIFIER, QUERY]) {
    assert.ok(existsSync(join(ROOT, f)), `${f} 파일 부재(미추적 회귀?)`);
  }
});

test("정본 SQL 은 SELECT/카탈로그 전용 — DML/DDL 문 0", () => {
  // 함수명 리터럴('..._create_impl' 등)의 부분일치가 아니라 실제 문 시작만 탐지.
  const writeStmt =
    /\b(insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from|drop\s+|alter\s+|truncate\s+|create\s+(table|function|or\s+replace|view|policy|index|schema)|grant\s+|revoke\s+)/i;
  assert.ok(!writeStmt.test(querySrc), "정본 SQL 에 쓰기/DDL 문 존재");
  // 쿼리는 with/select 로 시작하는 단일 조회문이어야 한다.
  assert.ok(/^\s*(with|select)\b/im.test(querySrc.replace(/^\s*--.*$/gm, "").trim()), "SQL 이 조회문으로 시작하지 않음");
});

test(".gitignore 가 scripts/contracts/ 만 추적 허용", () => {
  assert.ok(/^!scripts\/contracts\//m.test(gitignore), ".gitignore 에 !scripts/contracts/ 예외 없음");
  assert.ok(/^scripts\/\*/m.test(gitignore), "scripts/* 광역 차단 규칙이 사라짐(다른 스크립트 무단 추적 위험)");
});

test("Node 도구 2종 syntax parse (node --check)", () => {
  for (const f of [EXPORTER, VERIFIER]) {
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ["--check", join(ROOT, f)], { stdio: "pipe" }),
      `${f} syntax parse 실패`
    );
  }
});

test("exporter 는 기본 동작으로 committed snapshot 을 덮어쓰지 않는다", () => {
  // 기본 출력이 OS 임시 경로여야 한다(명시 --out 로만 committed 갱신).
  assert.ok(/tmpdir\(\)/.test(exporterSrc), "exporter 기본 출력이 임시 경로가 아님");
  assert.ok(/--out/.test(exporterSrc), "exporter 가 명시 출력 경로(--out)를 지원하지 않음");
  // atomic write(임시 파일 + rename) + 실패 시 정리.
  assert.ok(/renameSync/.test(exporterSrc), "exporter atomic rename 부재");
  assert.ok(/\.tmp\./.test(exporterSrc), "exporter 임시 파일 경유 쓰기 부재");
});

test("verifier 는 semantic drift 에서 non-zero, 스냅샷을 복사하지 않는다", () => {
  assert.ok(/SEMANTIC_DRIFT/.test(verifierSrc), "verifier 에 SEMANTIC_DRIFT 판정 없음");
  assert.ok(/process\.exit\(1\)/.test(verifierSrc), "verifier 가 drift 시 non-zero 종료하지 않음");
  // committed snapshot 을 원격 결과로 덮어쓰는(=복사) 코드가 없어야 한다.
  assert.ok(
    !/writeFileSync\([^)]*staging_contract\.json/.test(verifierSrc),
    "verifier 가 committed snapshot 을 write 한다(복사 금지)"
  );
});

test("도구는 connection string/키/DB URL 을 stdout 에 출력하지 않는다", () => {
  // env 변수 '이름'을 도움말 문자열에 언급하는 것은 허용 — 실제 '값' 출력/보간만 금지.
  const leakPatterns = [
    /console\.(log|error|warn)\(\s*dbUrl\b/, // 변수 직접 출력
    /console\.(log|error|warn)\([^)]*\$\{[^}]*\bdbUrl\b[^}]*\}/, // dbUrl 템플릿 보간
    /console\.(log|error|warn)\([^)]*\$\{[^}]*process\.env[^}]*\}/, // env 값 보간
    /console\.(log|error|warn)\([^)]*\$\{[^}]*DATABASE_URL[^}]*\}/,
  ];
  for (const src of [exporterSrc, verifierSrc]) {
    for (const re of leakPatterns) {
      assert.ok(!re.test(src), `도구가 비밀값을 출력할 수 있는 패턴 존재: ${re}`);
    }
  }
});
