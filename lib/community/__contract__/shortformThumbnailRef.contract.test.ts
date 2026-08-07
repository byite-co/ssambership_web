// 계약 테스트: 숏폼 썸네일 ref·데이터URL — QA-C15(shortform-thumbnails 0건) 배선의 관문.
//
// 썸네일은 영상과 달리 액션 body 로 바이트가 오므로, 서버가 올리기 전에 형식·크기·소유
// 경로를 여기서 막는다. 이 관문이 느슨하면 임의 바이트가 버킷에 들어가거나 남의 경로
// ref 가 DB 에 실리고 보상 삭제 대상이 된다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseShortformThumbnailDataUrl,
  shortformThumbnailRefBelongsToUser,
  SHORTFORM_THUMBNAIL_MAX_BYTES,
} from "../shortformThumbnailRef.ts";

const UID = "11111111-1111-4111-8111-111111111111";

function dataUrl(mime: string, bytes: number): string {
  const raw = Buffer.alloc(bytes, 7).toString("base64");
  return `data:${mime};base64,${raw}`;
}

test("허용 mime 만 통과한다", () => {
  for (const m of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(parseShortformThumbnailDataUrl(dataUrl(m, 128))?.mime, m);
  }
  assert.equal(parseShortformThumbnailDataUrl(dataUrl("image/svg+xml", 128)), null);
  assert.equal(parseShortformThumbnailDataUrl(dataUrl("video/mp4", 128)), null);
  assert.equal(parseShortformThumbnailDataUrl(dataUrl("text/html", 128)), null);
});

test("data URL 형식이 아니면 거부한다", () => {
  assert.equal(parseShortformThumbnailDataUrl("https://example.invalid/a.jpg"), null);
  assert.equal(parseShortformThumbnailDataUrl("data:image/jpeg,notbase64"), null);
  assert.equal(parseShortformThumbnailDataUrl("data:image/jpeg;base64,"), null);
  assert.equal(parseShortformThumbnailDataUrl(""), null);
  assert.equal(parseShortformThumbnailDataUrl(null), null);
  assert.equal(parseShortformThumbnailDataUrl(123), null);
});

test("base64 문자 집합 밖 값은 거부한다(조용한 절삭 방지)", () => {
  assert.equal(parseShortformThumbnailDataUrl("data:image/jpeg;base64,abc$%^&*"), null);
  assert.equal(parseShortformThumbnailDataUrl("data:image/jpeg;base64,ab cd"), null);
});

test("상한을 넘는 바이트는 디코딩 전에 거부한다", () => {
  assert.notEqual(parseShortformThumbnailDataUrl(dataUrl("image/jpeg", SHORTFORM_THUMBNAIL_MAX_BYTES - 16)), null);
  assert.equal(parseShortformThumbnailDataUrl(dataUrl("image/jpeg", SHORTFORM_THUMBNAIL_MAX_BYTES + 1024)), null);
});

test("본인 경로 ref 만 인정한다", () => {
  assert.equal(shortformThumbnailRefBelongsToUser(`shortform-thumbnails/${UID}/a-thumb.jpg`, UID), true);
  // 남의 경로
  assert.equal(
    shortformThumbnailRefBelongsToUser("shortform-thumbnails/22222222-2222-4222-8222-222222222222/a-thumb.jpg", UID),
    false
  );
  // 다른 버킷으로 위장
  assert.equal(shortformThumbnailRefBelongsToUser(`shortform-videos/${UID}/a.mp4`, UID), false);
  // 접두사만 흉내낸 경로
  assert.equal(shortformThumbnailRefBelongsToUser(`shortform-thumbnails-evil/${UID}/a.jpg`, UID), false);
  // 파일명 없음
  assert.equal(shortformThumbnailRefBelongsToUser(`shortform-thumbnails/${UID}/`, UID), false);
  assert.equal(shortformThumbnailRefBelongsToUser(`shortform-thumbnails/${UID}`, UID), false);
  // 빈 값·비문자
  assert.equal(shortformThumbnailRefBelongsToUser(null, UID), false);
  assert.equal(shortformThumbnailRefBelongsToUser(`shortform-thumbnails/${UID}/a.jpg`, ""), false);
});
