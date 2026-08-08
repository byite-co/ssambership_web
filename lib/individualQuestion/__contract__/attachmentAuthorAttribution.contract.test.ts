// 계약 테스트: IQ 첨부 생성 시 author attribution 이 누락되지 않는다 — F1 회귀 방지.
//
// individual_question_attachments 는 service-role 클라이언트로 INSERT 되므로
// auth.uid() 를 복원할 수 없다. 상위 server action 에서 인증된 actor uid 를
// authorId 로 명시 전달하고, helper 는 author_id 컬럼에 반드시 기록해야 한다.
// 과거에는 author_id 없이 INSERT 되어 attribution NULL 행이 실제로 발생했다.
//
// 소스 텍스트를 직접 검사한다 — 런타임 DB 없이 회귀를 잡을 수 있는 지점이다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const HELPER_PATH = join("lib", "individualQuestion", "individualQuestionAttachmentStorage.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "__contract__") continue;
    if (entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** uploadIndividualQuestionAttachment( 호출의 인자 객체 리터럴 텍스트를 뽑는다. */
function uploadCallParamBlocks(source: string): string[] {
  const out: string[] = [];
  const re = /uploadIndividualQuestionAttachment\s*\(\s*[\w.]+\s*,\s*\{([\s\S]*?)\}\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push(m[1] ?? "");
  }
  return out;
}

test("attachment helper INSERT 는 author_id 를 포함한다", () => {
  const src = readFileSync(HELPER_PATH, "utf8");
  const insertMatch = /from\(\s*["']individual_question_attachments["']\s*\)\s*\.insert\(\s*\{([\s\S]*?)\}\s*\)/.exec(src);
  assert.ok(insertMatch, "individual_question_attachments INSERT 블록을 찾지 못했다");
  assert.ok(
    /\bauthor_id\s*:/.test(insertMatch![1]!),
    "INSERT 컬럼에 author_id 가 없다 — attribution NULL 행이 다시 생긴다(F1 회귀)"
  );
});

test("모든 uploadIndividualQuestionAttachment 호출부가 authorId 를 전달한다", () => {
  const roots = ["lib", "app", "components"].filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
  const offenders: string[] = [];
  let callSites = 0;
  for (const root of roots) {
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("uploadIndividualQuestionAttachment(")) continue;
      if (file === HELPER_PATH) continue;
      for (const params of uploadCallParamBlocks(src)) {
        callSites += 1;
        if (!/\bauthorId\s*[:,]/.test(params)) {
          offenders.push(`${file}: { ${params.replace(/\s+/g, " ").trim()} }`);
        }
      }
    }
  }
  assert.ok(callSites >= 3, `호출부가 ${callSites}곳뿐이다 — 탐지 정규식이 호출부를 놓치고 있는지 확인 필요`);
  assert.deepEqual(
    offenders,
    [],
    `authorId 를 전달하지 않는 호출부가 있다 — 해당 경로의 첨부는 author_id NULL 로 저장된다(F1 회귀):\n${offenders.join("\n")}`
  );
});

test("탐지기 자체 시험 — authorId 누락 호출을 실제로 잡는다", () => {
  const fake = `await uploadIndividualQuestionAttachment(admin, { questionId, messageId: null, file: attachment });`;
  const blocks = uploadCallParamBlocks(fake);
  assert.equal(blocks.length, 1);
  assert.ok(!/\bauthorId\s*[:,]/.test(blocks[0]!));
});
