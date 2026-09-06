// 계약 테스트: IQ→질문방 이전 없음(웹 PR-2 §5-2 · 기획서 §"IQ 이전 없음" 정본).
// 실행: node --test --experimental-strip-types lib/individualQuestion/__contract__/noRoomTransfer.contract.test.ts
//
// 테이블 individual_question_transfers(075)·정책은 DB-6 이 걷는다 — 웹 코드의 참조 재등장만 막는다.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__contract__" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(p)) yield p;
  }
}

test("이전 모듈 파일 삭제 · 참조 0(app·lib·components)", () => {
  assert.equal(existsSync(join(ROOT, "lib/individualQuestion/transferIndividualQuestionsToRoom.ts")), false, "이전 모듈이 되살아남");
  const offenders: string[] = [];
  for (const dir of ["app", "lib", "components"]) {
    for (const file of walk(join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      const code = src.replace(/^\s*\/\/.*$/gm, "");
      if (/transferReleasedIndividualQuestionsToRoom|fetchIndividualQuestionTransfer|from\(["']individual_question_transfers["']\)/.test(code)) {
        offenders.push(file.slice(ROOT.length));
      }
    }
  }
  assert.deepEqual(offenders, [], `이전 참조 재등장: ${offenders.join(", ")}`);
});

test("구독 확정(subscribeCheckoutService)에 이전 부수효과 0 · 개별질문 상세에 '구독 질문방에서 보기' 링크 0", () => {
  const svc = read("lib/subscribe/subscribeCheckoutService.ts");
  assert.ok(!svc.includes("transferReleasedIndividualQuestionsToRoom("), "구독 확정 이전 호출 재등장");
  const view = read("components/individualQuestion/IndividualQuestionViews.tsx");
  assert.ok(!view.includes("구독 질문방에서 보기") && !view.includes("transferThreadHref"), "이관 링크 재등장");
  const page = read("app/(student)/individual-questions/[questionId]/page.tsx");
  assert.ok(!page.includes("transfer"), "상세 페이지 이전 조회 재등장");
});
