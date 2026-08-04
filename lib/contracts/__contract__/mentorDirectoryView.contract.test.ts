/**
 * mentorDirectoryView.contract.test.ts — 멘토 디렉토리 공개 표면 잠금.
 *
 * advisor 예외 SECDEF-MENTOR-DIRECTORY-001 의 가드다(웹 감사 문서 §G-1).
 * api_web_v1.mentor_directory_v1 이 SECURITY DEFINER view 로 남는 대신, 아래를
 * 소스로 잠가 개인정보 유출·쓰기 노출 회귀를 차단한다:
 *  - view 존재 · mentor_id 컬럼 존재
 *  - full_name/email/birth_date/status_reason 컬럼 부재(공개 projection 최소화)
 *  - 읽기 전용(select 대상 = 공개 read role 만; 쓰기 role 노출 0)
 *  - security_invoker=false 고정(변경 시 예외 재검토 필요 — 의도적 트립와이어)
 *  - M2 view 정의에 active/approved/삭제진행-제외 gate 유지
 *
 * 정본: contract snapshot(staging 실측) + 수렴 M2 view 정의.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const snapshot = JSON.parse(
  readFileSync(join(ROOT, "contracts/snapshots/staging_contract.json"), "utf8")
);
const M2 = readFileSync(
  join(ROOT, "supabase/sql/20260803162808_domain_contract_convergence.sql"),
  "utf8"
);

function directoryView() {
  const v = (snapshot.views ?? []).find(
    (x: { schema: string; name: string }) =>
      x.schema === "api_web_v1" && x.name === "mentor_directory_v1"
  );
  assert.ok(v, "snapshot 에 api_web_v1.mentor_directory_v1 view 가 없음");
  return v as {
    columns: string[];
    select: string[];
    security_invoker: boolean;
  };
}

test("view 존재 + mentor_id 컬럼", () => {
  const v = directoryView();
  assert.ok(v.columns.includes("mentor_id"), "mentor_id 컬럼 없음");
});

test("개인정보 컬럼 부재 (full_name/email/birth_date/status_reason)", () => {
  const v = directoryView();
  for (const forbidden of ["full_name", "email", "birth_date", "status_reason"]) {
    assert.ok(!v.columns.includes(forbidden), `공개 projection 에 ${forbidden} 노출`);
  }
});

test("읽기 전용 — select 대상은 공개 read role 만, 쓰기 노출 0", () => {
  const v = directoryView();
  const allowed = new Set(["anon", "authenticated", "service_role"]);
  for (const r of v.select) assert.ok(allowed.has(r), `예상 밖 select role: ${r}`);
  // 스냅샷의 table_grants(공개 테이블 UPDATE/INSERT/DELETE)에 이 view 는 등장하지 않아야 한다.
  const writeGrant = (snapshot.table_grants ?? []).find((t: { table: string }) =>
    t.table.includes("mentor_directory_v1")
  );
  assert.equal(writeGrant, undefined, "mentor_directory_v1 에 테이블 write grant 노출");
});

test("security_invoker=false 고정 (변경 시 예외 재검토 트립와이어)", () => {
  const v = directoryView();
  assert.equal(
    v.security_invoker,
    false,
    "security option 이 바뀌었다 — advisor 예외 SECDEF-MENTOR-DIRECTORY-001 재검토 필요"
  );
});

test("M2 view 정의에 active/approved/삭제진행-제외 gate 유지", () => {
  const idx = M2.indexOf("create or replace view api_web_v1.mentor_directory_v1");
  assert.ok(idx >= 0, "M2 에서 mentor_directory_v1 정의를 찾지 못함");
  const def = M2.slice(idx, M2.indexOf("alter view api_web_v1.mentor_directory_v1", idx));
  assert.ok(/u\.role\s*=\s*'mentor'/.test(def), "role=mentor gate 없음");
  assert.ok(/status.*=\s*'active'/.test(def), "status=active gate 없음");
  assert.ok(/verification_status/.test(def) && /approved/.test(def), "verification gate 없음");
  assert.ok(/account_deletion_jobs/.test(def), "삭제 진행 계정 제외 gate 없음");
  assert.ok(!/u\.full_name/.test(def) && !/u\.email/.test(def), "projection 에 full_name/email 노출");
});
