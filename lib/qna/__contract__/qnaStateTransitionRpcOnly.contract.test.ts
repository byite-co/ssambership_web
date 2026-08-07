import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 이 테스트 파일 위치: lib/qna/__contract__/ → repo root = ../../../
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
function read(rel: string): string {
  return readFileSync(ROOT + rel, "utf-8");
}
function exists(rel: string): boolean {
  return existsSync(ROOT + rel);
}

test("D-QR-2: 직접 status UPDATE 헬퍼(questionThreadMutations)는 삭제됐다", () => {
  assert.equal(
    exists("lib/qna/questionThreadMutations.ts"),
    false,
    "updateQuestionThreadStatus 사문(死文) 헬퍼가 되살아나면 상태전이 단일 진입점(P1-8A)이 깨진다"
  );
});

test("D-QR-2: 앱 코드는 question_threads.status 를 직접 UPDATE 하지 않는다(RPC 전용)", () => {
  for (const rel of ["lib/qna/questionRoomActions.ts", "lib/qna/questionRoomMutations.ts"]) {
    const src = read(rel);
    // question_threads 테이블에 대한 직접 .update( 가 없어야 한다(supabase 는 update 를
    // from() 직후에 체이닝하므로 그 인접 패턴만 금지한다). 상태 전이는
    // qna_append_message / qna_register_attachment / qna_confirm_thread RPC 내부에서만 일어난다.
    const forbidden = /from\(\s*["'`]question_threads["'`]\s*\)\s*\.update\(/;
    assert.ok(!forbidden.test(src), `${rel} 에 question_threads 직접 UPDATE 경로가 있다`);
  }
});

test("D-QR-10: 무료체험 판정에서 ±15분 시각근접 레거시 페어링은 제거됐다", () => {
  const src = read("lib/qna/freeQuestionUsage.ts");
  assert.ok(
    !/pairFreeUsageRowsToThreadIds/.test(src),
    "시각근접 페어링 함수가 남아 있으면 유료 스레드가 무료체험으로 오분류될 수 있다"
  );
  assert.ok(
    !/15\s*\*\s*60\s*\*\s*1000/.test(src),
    "±15분 근접 상수(FREE_QUESTION_THREAD_PAIR_MAX_MS)가 남아 있다"
  );
  assert.ok(
    /thread_id/.test(src),
    "thread_id 정본 링크 기반 매칭은 유지되어야 한다"
  );
});
