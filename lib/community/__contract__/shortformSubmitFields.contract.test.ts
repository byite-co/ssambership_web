import test from "node:test";
import assert from "node:assert/strict";
import {
  extractShortformSubmitFields,
  formDataHasBinaryEntry,
  resolveShortformIntent,
  SHORTFORM_SUBMIT_ALLOWED_KEYS,
} from "../shortformSubmitFields.ts";

function fd(entries: Array<[string, string | Blob]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

test("draft intent 유지 — hidden 캡처값(JS 활성 경로)", () => {
  const fields = extractShortformSubmitFields(fd([["title", "t"], ["intent", "draft"]]));
  assert.equal(fields.intent, "draft");
});

test("publish intent 유지 — hidden 캡처값", () => {
  const fields = extractShortformSubmitFields(fd([["title", "t"], ["intent", "publish"]]));
  assert.equal(fields.intent, "publish");
});

test("JS 비활성 폴백: 빈 hidden + submitter 값 공존 — 어느 순서든 실제 클릭 의도 보존", () => {
  // submitter 가 hidden 보다 앞(트리順)인 실제 배치.
  assert.equal(resolveShortformIntent(["draft", ""]), "draft");
  // 반대 순서(방어): 빈 문자열은 건너뛴다 — draft 가 publish 로 변질되지 않는다.
  assert.equal(resolveShortformIntent(["", "draft"]), "draft");
  assert.equal(resolveShortformIntent(["", "publish"]), "publish");
  // 유효값 없음 → 기존 기본값 publish 유지.
  assert.equal(resolveShortformIntent([""]), "publish");
  assert.equal(resolveShortformIntent([]), "publish");
  // 비문자·미지값은 무시.
  assert.equal(resolveShortformIntent([new Blob(["x"]), "draft"]), "draft");
  assert.equal(resolveShortformIntent(["DRAFT", "draft"]), "draft");
});

test("허용 키 11종만 계약에 존재", () => {
  assert.deepEqual(
    [...SHORTFORM_SUBMIT_ALLOWED_KEYS].sort(),
    ["body", "category", "draftId", "intent", "requestId", "rightsAck", "source", "thumbnailRef", "title", "videoRef", "videoUrl"],
  );
});

test("File/Blob 엔트리는 값으로 신뢰되지 않는다(문자열만 추출)", () => {
  const blob = new Blob([new Uint8Array(64)], { type: "video/mp4" });
  const f = fd([
    ["title", " 제목 "],
    ["videoRef", blob], // 위조: 파일을 ref 자리에 밀어넣음
    ["video-picker", blob], // 레거시 picker name 혼입 가정
    ["intent", "draft"],
  ]);
  const fields = extractShortformSubmitFields(f);
  assert.equal(fields.title, "제목");
  assert.equal(fields.videoRef, ""); // File 은 빈 값 취급 — 문자 ref 만 신뢰
  assert.equal(fields.intent, "draft");
  assert.equal(formDataHasBinaryEntry(f), true);
});

test("정상 finalize FormData 에는 비문자 엔트리 0 — File/Blob 0개 계약", () => {
  const f = fd([
    ["title", "t"],
    ["category", "study"],
    ["body", "b"],
    ["source", ""],
    ["rightsAck", "on"],
    ["draftId", ""],
    ["videoUrl", ""],
    ["videoRef", "shortform-videos/u1/v.mp4"],
    ["requestId", "8b9f4a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b"],
    ["intent", "publish"],
  ]);
  assert.equal(formDataHasBinaryEntry(f), false);
  const fields = extractShortformSubmitFields(f);
  assert.equal(fields.rightsAck, true);
  assert.equal(fields.videoRef, "shortform-videos/u1/v.mp4");
});

test("category 부재 → study 폴백(기존 계약 유지)", () => {
  assert.equal(extractShortformSubmitFields(fd([["title", "t"]])).category, "study");
  assert.equal(extractShortformSubmitFields(fd([["category", "info"]])).category, "info");
});
