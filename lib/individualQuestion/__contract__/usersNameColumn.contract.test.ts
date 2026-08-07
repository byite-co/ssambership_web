// 계약 테스트: users 조회에 존재하지 않는 컬럼을 요청하지 않는다 — QA-B7 회귀 방지.
//
// public.users 에 `name` 컬럼은 없다(실측). 그런데 개별질문 목록 조회가
// select("id, full_name, nickname, name, email, role") 를 보내 매번
// `column users.name does not exist` 로 실패했고, 호출부가 오류를 삼켜
// 빈 맵을 돌려주는 바람에 학생·멘토 이름이 전부 폴백('학생'·'멘토')이 됐다.
// 로그만 더러워진 게 아니라 화면에 잘못된 값이 나갔다.
//
// 소스 텍스트를 직접 검사한다 — 런타임 DB 없이도 회귀를 잡을 수 있는 유일한 지점이다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** public.users 에 실제로 없는 컬럼(실측 기준). 늘어나면 여기에 추가한다. */
const NONEXISTENT_USER_COLUMNS = ["name"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // 계약 테스트 자신의 위반 fixture 문자열까지 잡지 않도록 테스트 디렉터리는 건너뛴다.
    if (entry === "node_modules" || entry === ".next" || entry === "__contract__") continue;
    if (entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** `.from("users")` 바로 뒤에 이어지는 `.select("...")` 문자열들을 뽑는다. */
function userSelectLists(source: string): string[] {
  const out: string[] = [];
  const re = /from\(\s*["']users["']\s*\)([\s\S]{0,400}?)\.select\(\s*(["'])([\s\S]*?)\2/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // from(...) 과 select(...) 사이에 다른 from( 이 끼면 짝이 아니다.
    if (m[1].includes("from(")) continue;
    out.push(m[3] ?? "");
  }
  return out;
}

test("users select 에 존재하지 않는 컬럼이 없다", () => {
  const roots = ["lib", "app", "components"].filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      if (file.includes("__contract__") || file.endsWith(".test.ts")) continue;
      if (!src.includes('from("users")') && !src.includes("from('users')")) continue;
      for (const list of userSelectLists(src)) {
        const cols = list.split(",").map((c) => c.trim().split(":")[0]!.trim());
        for (const bad of NONEXISTENT_USER_COLUMNS) {
          if (cols.includes(bad)) offenders.push(`${file}: "${list}" — '${bad}'`);
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `public.users 에 없는 컬럼을 요청하면 조회 전체가 실패하고, 호출부가 오류를 삼키면 
표시가 조용히 폴백으로 바뀐다(QA-B7):\n${offenders.join("\n")}`
  );
});

test("탐지기 자체 시험 — 위반 문자열을 실제로 잡는다", () => {
  const fake = `const r = await supabase.from("users").select("id, full_name, name, email");`;
  const lists = userSelectLists(fake);
  assert.equal(lists.length, 1);
  assert.ok(lists[0]!.split(",").map((c) => c.trim()).includes("name"));
});
