import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuestionRoomRedirectUrl,
  questionRoomRedirectBasePath,
  usesCanonicalThreadDetailBase,
} from "../questionRoomRedirect.ts";
import { draftToParam } from "../draftQuery.ts";

const ROOM = "11111111-2222-3333-4444-555555555555";
const THREAD = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const NOW = 1754006400000;

function parse(url: string): { path: string; qs: URLSearchParams } {
  const u = new URL(url, "http://contract.test");
  return { path: u.pathname, qs: u.searchParams };
}

test("D-27 §7-1 멘토 message+thread 성공 — 정본 thread 상세 경로 + ok/kind/t, thread 쿼리 중복 없음", () => {
  const url = buildQuestionRoomRedirectUrl(
    ROOM,
    "mentor",
    { thread: THREAD, kind: "message", ok: "답변이 저장되었습니다." },
    NOW
  );
  const { path, qs } = parse(url);
  assert.equal(path, `/mentor/question-room/${ROOM}/thread/${THREAD}`);
  assert.equal(qs.get("ok"), "답변이 저장되었습니다.");
  assert.equal(qs.get("kind"), "message");
  assert.equal(qs.get("t"), String(NOW));
  // 정본 thread 상세 경로에서는 thread 쿼리를 붙이지 않는다(소비자는 room 페이지뿐 — 회귀 고정).
  assert.equal(qs.get("thread"), null);
});

test("D-27 §7-2 멘토 message+thread 실패 — 정본 thread 상세 경로 유지 + error/dMessage 보존", () => {
  const draft = "적분 상수 C 를 빼먹었어요\n두 번째 줄부터 다시 볼게요";
  const url = buildQuestionRoomRedirectUrl(
    ROOM,
    "mentor",
    { thread: THREAD, kind: "message", error: "메시지를 보내지 못했습니다.", draftMessage: draft },
    NOW
  );
  const { path, qs } = parse(url);
  assert.equal(path, `/mentor/question-room/${ROOM}/thread/${THREAD}`);
  assert.equal(qs.get("error"), "메시지를 보내지 못했습니다.");
  assert.equal(qs.get("kind"), "message");
  assert.equal(qs.get("dMessage"), draftToParam(draft));
  assert.equal(qs.get("thread"), null);
});

test("D-27 §7-1 금지 결과 — 멘토 message+thread 가 room 경로 + ?thread= 로 돌아가지 않는다", () => {
  const url = buildQuestionRoomRedirectUrl(ROOM, "mentor", { thread: THREAD, kind: "message", ok: "x" }, NOW);
  assert.ok(!url.startsWith(`/mentor/question-room/${ROOM}?`), `room+query 구계약 잔존: ${url}`);
  assert.ok(!url.includes(`?thread=`) && !url.includes(`&thread=`), `thread 쿼리 잔존: ${url}`);
});

test("멘토 message + thread 없음 — 기존 room 경로 유지", () => {
  const url = buildQuestionRoomRedirectUrl(ROOM, "mentor", { kind: "message", error: "질문을 먼저 선택해 주세요." }, NOW);
  const { path, qs } = parse(url);
  assert.equal(path, `/mentor/question-room/${ROOM}`);
  assert.equal(qs.get("thread"), null);
  assert.equal(qs.get("kind"), "message");
});

test("공백 thread 는 미지정과 동일 — room 경로", () => {
  const url = buildQuestionRoomRedirectUrl(ROOM, "mentor", { thread: "   ", kind: "message", error: "e" }, NOW);
  assert.equal(parse(url).path, `/mentor/question-room/${ROOM}`);
});

test("멘토 note+thread — 기존 room 경로 + thread 쿼리 계약 유지", () => {
  const url = buildQuestionRoomRedirectUrl(
    ROOM,
    "mentor",
    { thread: THREAD, kind: "note", ok: "connection note를 저장했습니다." },
    NOW
  );
  const { path, qs } = parse(url);
  assert.equal(path, `/mentor/question-room/${ROOM}`);
  assert.equal(qs.get("thread"), THREAD);
  assert.equal(qs.get("kind"), "note");
});

test("멘토 thread(주제 생성 거절)+thread — 기존 room 경로 + thread/dThread 계약 유지", () => {
  const url = buildQuestionRoomRedirectUrl(
    ROOM,
    "mentor",
    { thread: THREAD, kind: "thread", error: "학생만 만들 수 있습니다.", draftThread: "제목 초안" },
    NOW
  );
  const { path, qs } = parse(url);
  assert.equal(path, `/mentor/question-room/${ROOM}`);
  assert.equal(qs.get("thread"), THREAD);
  assert.equal(qs.get("dThread"), draftToParam("제목 초안"));
});

test("학생 message+thread — 기존 학생 계약 유지 (room 경로 + thread 쿼리)", () => {
  const okUrl = buildQuestionRoomRedirectUrl(ROOM, "student", { thread: THREAD, kind: "message", ok: "질문이 저장되었습니다." }, NOW);
  const { path, qs } = parse(okUrl);
  assert.equal(path, `/question-room/${ROOM}`);
  assert.equal(qs.get("thread"), THREAD);
  assert.equal(qs.get("kind"), "message");
  const errUrl = buildQuestionRoomRedirectUrl(
    ROOM,
    "student",
    { thread: THREAD, kind: "message", error: "e", draftMessage: "질문 초안" },
    NOW
  );
  const errParsed = parse(errUrl);
  assert.equal(errParsed.path, `/question-room/${ROOM}`);
  assert.equal(errParsed.qs.get("dMessage"), draftToParam("질문 초안"));
});

test("학생 note — 기존 계약 유지", () => {
  const url = buildQuestionRoomRedirectUrl(ROOM, "student", { thread: THREAD, kind: "note", ok: "저장" }, NOW);
  const { path, qs } = parse(url);
  assert.equal(path, `/question-room/${ROOM}`);
  assert.equal(qs.get("thread"), THREAD);
});

test("경로 인코딩 — room/thread 특수문자는 path segment 로 encode 된다", () => {
  const evilRoom = "r/../../admin?x=1#f";
  const evilThread = "t?ok=탈취&kind=note";
  const url = buildQuestionRoomRedirectUrl(evilRoom, "mentor", { thread: evilThread, kind: "message", ok: "ok" }, NOW);
  assert.ok(
    url.startsWith(`/mentor/question-room/${encodeURIComponent(evilRoom)}/thread/${encodeURIComponent(evilThread)}?`),
    `encode 누락: ${url}`
  );
  const { path, qs } = parse(url);
  // 주입된 ?ok=/kind= 가 쿼리로 승격되지 않고 segment 안에 갇힌다.
  assert.equal(qs.get("kind"), "message");
  assert.equal(decodeURIComponent(path.split("/thread/")[1] ?? ""), evilThread);
});

test("open redirect 불가 — 어떤 입력이든 결과는 고정 내부 base 로 시작하는 상대 경로", () => {
  const hostileIds = ["https://evil.example", "//evil.example/x", "\\\\evil", "..%2F..", "javascript:alert(1)"];
  for (const actor of ["mentor", "student"] as const) {
    const prefix = actor === "mentor" ? "/mentor/question-room/" : "/question-room/";
    for (const rid of hostileIds) {
      for (const tid of [null, ...hostileIds]) {
        const url = buildQuestionRoomRedirectUrl(rid, actor, { thread: tid, kind: "message", error: "e" }, NOW);
        assert.ok(url.startsWith(prefix), `내부 base 이탈: ${url}`);
        assert.ok(!url.startsWith("//"), `protocol-relative 이탈: ${url}`);
        assert.ok(!/^[a-z+.-]+:/i.test(url), `절대 URL 이탈: ${url}`);
        const resolved = new URL(url, "http://contract.test");
        assert.equal(resolved.origin, "http://contract.test");
      }
    }
  }
});

test("draft/error 쿼리 손실 없음 — dMessage/dNote/dThread base64url 왕복", () => {
  const multiline = "1줄\n2줄 & ?기호= #포함";
  const url = buildQuestionRoomRedirectUrl(
    ROOM,
    "mentor",
    { thread: THREAD, kind: "message", error: "err", draftMessage: multiline, draftNote: "노트", draftThread: "" },
    NOW
  );
  const { qs } = parse(url);
  assert.equal(Buffer.from(qs.get("dMessage") ?? "", "base64url").toString("utf-8"), multiline);
  assert.equal(Buffer.from(qs.get("dNote") ?? "", "base64url").toString("utf-8"), "노트");
  assert.equal(qs.get("dThread"), draftToParam(""));
});

test("base path 선택 술어 — usesCanonicalThreadDetailBase / questionRoomRedirectBasePath 정합", () => {
  assert.equal(usesCanonicalThreadDetailBase("mentor", { thread: THREAD, kind: "message" }), true);
  assert.equal(usesCanonicalThreadDetailBase("mentor", { thread: THREAD, kind: "note" }), false);
  assert.equal(usesCanonicalThreadDetailBase("mentor", { thread: THREAD, kind: "thread" }), false);
  assert.equal(usesCanonicalThreadDetailBase("mentor", { kind: "message" }), false);
  assert.equal(usesCanonicalThreadDetailBase("student", { thread: THREAD, kind: "message" }), false);
  assert.equal(
    questionRoomRedirectBasePath(ROOM, "mentor", { thread: THREAD, kind: "message" }),
    `/mentor/question-room/${ROOM}/thread/${THREAD}`
  );
  assert.equal(questionRoomRedirectBasePath(ROOM, "mentor", { thread: THREAD, kind: "note" }), `/mentor/question-room/${ROOM}`);
  assert.equal(questionRoomRedirectBasePath(ROOM, "student", { thread: THREAD, kind: "message" }), `/question-room/${ROOM}`);
});
