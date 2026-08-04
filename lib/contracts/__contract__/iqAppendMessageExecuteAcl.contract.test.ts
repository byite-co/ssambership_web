/**
 * iqAppendMessageExecuteAcl.contract.test.ts — DB-GRANT-HYGIENE-001 회귀 잠금.
 *
 * public.iq_append_message(uuid,text) 는 SECURITY DEFINER 이면서 과거 proacl=NULL
 * (기본 PUBLIC EXECUTE — anon 포함) 상태였다. 위생 migration 이후 최소권한 계약을
 * snapshot(=staging 실측)으로 고정한다:
 *   - SECURITY DEFINER 유지 · 반환 jsonb 유지 · body hash 유지(본문 불변)
 *   - EXECUTE: authenticated·service_role 만. PUBLIC('-')·anon 재등장 금지.
 *
 * snapshot 의 execute 배열은 aclexplode 결과이며, PUBLIC(빈 grantee)은 '-' 로 표기된다.
 * '-' 또는 'anon' 이 다시 나타나면 = proacl NULL 회귀 또는 PUBLIC 재부여 → FAIL.
 *
 * 정본: contracts/snapshots/staging_contract.json (export_remote_contract 로 갱신).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const snapshot = JSON.parse(
  readFileSync(join(ROOT, "contracts/snapshots/staging_contract.json"), "utf8")
);

function iqFn() {
  const f = (snapshot.functions ?? []).find(
    (x: { schema: string; name: string; args: string }) =>
      x.schema === "public" &&
      x.name === "iq_append_message" &&
      x.args === "p_question_id uuid, p_body text"
  );
  assert.ok(f, "snapshot 에 public.iq_append_message(uuid,text) 가 없음");
  return f as {
    security_definer: boolean;
    returns: string;
    execute: string[];
    body_md5: string | null;
  };
}

test("iq_append_message: SECURITY DEFINER + jsonb 반환 유지", () => {
  const f = iqFn();
  assert.equal(f.security_definer, true, "SECURITY DEFINER 가 아니게 됨");
  assert.equal(f.returns, "jsonb", "반환형이 jsonb 가 아님");
});

test("iq_append_message: EXECUTE = authenticated·service_role 만 (PUBLIC·anon 금지)", () => {
  const ex = iqFn().execute ?? [];
  assert.ok(!ex.includes("-"), "PUBLIC('-') EXECUTE 재등장 — proacl NULL 회귀");
  assert.ok(!ex.includes("anon"), "anon EXECUTE 재등장");
  assert.ok(ex.includes("authenticated"), "authenticated EXECUTE 누락(앱 계약 파손)");
  assert.ok(ex.includes("service_role"), "service_role EXECUTE 누락");
});

test("iq_append_message: body hash 존재(본문 불변 잠금 — critical fn)", () => {
  const f = iqFn();
  assert.ok(
    typeof f.body_md5 === "string" && f.body_md5.length === 32,
    "body_md5 가 snapshot 에 없음 — critical 함수 본문 잠금 상실"
  );
});
