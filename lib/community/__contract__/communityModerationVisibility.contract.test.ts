// 계약 테스트: 관리자 숨김 글의 작성자 본인 표면 노출 판정(배지·사유·복구).
// 실행: node --test --experimental-strip-types lib/community/__contract__/communityModerationVisibility.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  authorModerationNotice,
  canAuthorViewHiddenDetail,
  communityRowAuthorId,
  isCommunityRowAuthor,
  resolveCommunityVisibility,
} from "../communityModerationVisibility.ts";

const AUTHOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const hiddenRow = { id: "p1", author_id: AUTHOR, status: "hidden", deleted_at: null };
const publishedRow = { id: "p1", author_id: AUTHOR, status: "published", deleted_at: null };
const draftRow = { id: "p1", author_id: AUTHOR, status: "draft", deleted_at: null };
const deletedRow = { id: "p1", author_id: AUTHOR, status: "published", deleted_at: "2026-07-20T00:00:00Z" };

test("노출 상태 판정: deleted_at 이 status 보다 우선한다", () => {
  assert.equal(resolveCommunityVisibility(publishedRow), "published");
  assert.equal(resolveCommunityVisibility(hiddenRow), "hidden");
  assert.equal(resolveCommunityVisibility(draftRow), "draft");
  assert.equal(resolveCommunityVisibility(deletedRow), "deleted");
  // 숨김 + 삭제 동시 → 삭제가 이긴다.
  assert.equal(resolveCommunityVisibility({ ...hiddenRow, deleted_at: "2026-07-20T00:00:00Z" }), "deleted");
  // status 누락 레거시 행은 published 로 본다.
  assert.equal(resolveCommunityVisibility({ id: "p1" }), "published");
});

test("작성자 본인에게는 숨김 배지 + 공개 가능한 사유가 나온다", () => {
  const notice = authorModerationNotice(hiddenRow, AUTHOR);
  assert.ok(notice);
  assert.equal(notice.state, "hidden");
  assert.equal(notice.badgeLabel, "숨김");
  assert.ok(notice.reason.length > 0);
});

test("타인·비로그인에게는 어떤 배지도 노출되지 않는다", () => {
  assert.equal(authorModerationNotice(hiddenRow, OTHER), null);
  assert.equal(authorModerationNotice(hiddenRow, null), null);
  assert.equal(authorModerationNotice(hiddenRow, ""), null);
  assert.equal(authorModerationNotice(hiddenRow, undefined), null);
});

test("복구(restored → published) 후 배지가 사라진다", () => {
  assert.ok(authorModerationNotice(hiddenRow, AUTHOR));
  const restored = { ...hiddenRow, status: "published" };
  assert.equal(authorModerationNotice(restored, AUTHOR), null);
});

test("임시저장(draft)은 모더레이션 배지 대상이 아니다", () => {
  assert.equal(authorModerationNotice(draftRow, AUTHOR), null);
});

test("관리자 삭제 글은 작성자에게 삭제 배지로 구분된다", () => {
  const notice = authorModerationNotice(deletedRow, AUTHOR);
  assert.ok(notice);
  assert.equal(notice.state, "deleted");
  assert.equal(notice.badgeLabel, "삭제됨");
});

test("사유 문구에 내부 관리자 메모·원문이 섞이지 않는다(고정 정책 문구)", () => {
  const a = authorModerationNotice({ ...hiddenRow, moderation_reason: "내부메모-욕설다수" }, AUTHOR);
  const b = authorModerationNotice(hiddenRow, AUTHOR);
  assert.ok(a && b);
  // 행에 어떤 필드가 있어도 사유는 고정값이다.
  assert.equal(a.reason, b.reason);
  assert.equal(a.reason.includes("내부메모"), false);
});

test("상세 열람 권한: 작성자 본인의 숨김 글만 허용, 삭제·타인은 불가", () => {
  assert.equal(canAuthorViewHiddenDetail(hiddenRow, AUTHOR), true);
  assert.equal(canAuthorViewHiddenDetail(hiddenRow, OTHER), false);
  assert.equal(canAuthorViewHiddenDetail(hiddenRow, null), false);
  assert.equal(canAuthorViewHiddenDetail(deletedRow, AUTHOR), false);
  assert.equal(canAuthorViewHiddenDetail(publishedRow, AUTHOR), false);
});

test("작성자 id 는 author_id → creator_id → user_id 순으로 찾는다(숏폼 스키마 폴백)", () => {
  assert.equal(communityRowAuthorId({ author_id: AUTHOR }), AUTHOR);
  assert.equal(communityRowAuthorId({ creator_id: AUTHOR }), AUTHOR);
  assert.equal(communityRowAuthorId({ user_id: AUTHOR }), AUTHOR);
  assert.equal(communityRowAuthorId({}), null);
  assert.equal(communityRowAuthorId(null), null);
  // creator_id 로만 소유가 표기된 숏폼도 본인 판정이 된다.
  assert.equal(isCommunityRowAuthor({ creator_id: AUTHOR, status: "hidden" }, AUTHOR), true);
  assert.equal(isCommunityRowAuthor({ creator_id: AUTHOR, status: "hidden" }, OTHER), false);
});
