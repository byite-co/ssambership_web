import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
function read(rel: string): string {
  return readFileSync(ROOT + rel, "utf-8");
}

const MENTOR_ROOM_PAGE = "app/(mentor)/mentor/question-room/[roomId]/page.tsx";
const STUDENT_ROOM_PAGE = "app/(student)/question-room/[roomId]/page.tsx";
const WORKSPACE = "components/qna/QuestionRoomWorkspace.tsx";
const MENTOR_DESIGN_WORKSPACE = "components/qna/QuestionRoomMentorDesignWorkspace.tsx";

/**
 * D-QR-8 회귀 고정: 멘토 방 상세의 ?thread= 정규화 redirect 는 thread 만 경로 세그먼트로
 * 승격하고 나머지 쿼리(ok/error/kind/t/dNote 등 액션 피드백·초안)는 전부 보존해야 한다.
 * 구 회귀: `redirect(threadDetailPath(...))` 단독 호출이 쿼리를 통째로 폐기 —
 * 연결노트 액션(kind=note)이 room+?thread= 로 복귀하므로 성공/실패 피드백·초안이 무음 소실됐다.
 */
test("D-QR-8: 멘토 방 상세 정규화 redirect — thread 외 쿼리 보존 (bare redirect 금지)", () => {
  const src = read(MENTOR_ROOM_PAGE);
  // 1) 쿼리 폐기형 bare redirect 가 되살아나면 안 된다.
  assert.ok(
    !/redirect\(\s*threadDetailPath\(/.test(src),
    "redirect(threadDetailPath(...)) 단독 호출 — 나머지 쿼리를 폐기하는 구 회귀"
  );
  // 2) thread 를 제외한 나머지 searchParams 를 URLSearchParams 로 옮겨 담는 보존 루프가 있어야 한다.
  assert.ok(src.includes("new URLSearchParams()"), "보존용 URLSearchParams 생성이 없다");
  assert.ok(/key === "thread"/.test(src), "thread 키만 제외(경로 승격)하는 분기가 없다");
});

/**
 * D-QR-8 대칭(학생): 학생 방 상세의 ?thread= 정규화 redirect 도 나머지 쿼리를 보존해야 한다.
 * 학생 메시지 액션은 room+?thread=&kind=message&ok= 로 복귀하므로, bare redirect 는
 * 전송 피드백(하단 정렬 트리거 포함)을 thread 상세에 도달하지 못하게 한다.
 */
test("D-QR-8 대칭: 학생 방 상세 정규화 redirect — thread 외 쿼리 보존 (bare redirect 금지)", () => {
  const src = read(STUDENT_ROOM_PAGE);
  assert.ok(
    !/redirect\(\s*threadDetailPath\(/.test(src),
    "redirect(threadDetailPath(...)) 단독 호출 — 나머지 쿼리를 폐기하는 구 회귀"
  );
  assert.ok(src.includes("new URLSearchParams()"), "보존용 URLSearchParams 생성이 없다");
  assert.ok(/key === "thread"/.test(src), "thread 키만 제외(경로 승격)하는 분기가 없다");
});

/** 전송 직후 하단 정렬: 멘토 상세 분기가 actionFeedback(kind 포함)을 통째로 전달해야 한다. */
test("첨부 하단 정렬: QuestionRoomWorkspace 멘토 상세 분기 — actionFeedback kind 보존", () => {
  const src = read(WORKSPACE);
  const mentorBranch = src.slice(src.indexOf("<QuestionRoomMentorDesignWorkspace"));
  assert.ok(
    /actionFeedback=\{props\.actionFeedback\}/.test(mentorBranch),
    "멘토 상세 분기가 actionFeedback 을 재구성하며 kind 를 탈락시킨다(하단 정렬 무발화 회귀)"
  );
});

/** D-QR-9 회귀 고정: 실제 렌더 경로가 freeTrialThreadIds 를 받아 고정 정렬·배지에 쓰는지. */
test("D-QR-9: QuestionRoomWorkspace 멘토 상세 분기 — freeTrialThreadIds 전달", () => {
  const src = read(WORKSPACE);
  const mentorBranch = src.slice(src.indexOf("<QuestionRoomMentorDesignWorkspace"));
  assert.ok(
    /freeTrialThreadIds=\{props\.freeTrialThreadIds\}/.test(mentorBranch),
    "멘토 상세 분기가 freeTrialThreadIds prop 을 전달하지 않는다(서버 주입값 무음 폐기 회귀)"
  );
});

test("D-QR-9: QuestionRoomMentorDesignWorkspace — 무료 체험 최상단 고정 + 배지 렌더", () => {
  const src = read(MENTOR_DESIGN_WORKSPACE);
  assert.ok(src.includes("freeTrialThreadIds?: string[]"), "freeTrialThreadIds prop 선언이 없다");
  // 정렬 memo 가 무료 체험 id 집합으로 최상단 고정(안정 분할)을 수행해야 한다.
  assert.ok(src.includes("freeTrialIdSet"), "무료 체험 id 집합을 정렬에 사용하지 않는다");
  const sortedIdx = src.indexOf("const sortedThreads = useMemo");
  assert.ok(sortedIdx >= 0, "sortedThreads memo 가 없다");
  const sortedBlock = src.slice(sortedIdx, src.indexOf("}, [", sortedIdx));
  assert.ok(
    sortedBlock.includes("freeTrialIdSet"),
    "sortedThreads 정렬이 무료 체험 스레드를 고정하지 않는다(created_at 재정렬로 서버 순서 파기 회귀)"
  );
  // 목록 아이템 배지 — 방 상세(QuestionRoomWorkspace) 기존 배지와 동일 라벨 상수 사용.
  assert.ok(
    src.includes("FREE_TRIAL_PRIORITY_LABEL"),
    "무료 체험 우선 답변 배지가 렌더되지 않는다"
  );
});
