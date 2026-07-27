// 계약 테스트: 커뮤니티 revalidate 매트릭스 — mutation × 표면(공개 목록·상세·내 활동·관리자).
// 실행: node --test --experimental-strip-types lib/community/__contract__/communityRevalidateTargets.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_COMMUNITY_CONTENT_PATH,
  ADMIN_MODERATION_PATH,
  ADMIN_REPORTS_PATH,
  COMMUNITY_ME_PATH,
  communityRevalidateTargets,
  communityRevalidateTargetsForModeration,
  type CommunityMutation,
} from "../communityRevalidateTargets.ts";

const POST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("게시판 글 작성: 홈·목록·상세·내 활동·관리자 표면을 모두 갱신한다", () => {
  const t = communityRevalidateTargets({ mutation: "post_create", kind: "board", postId: POST_ID });
  assert.ok(t.includes("/community"));
  assert.ok(t.includes("/community/board"));
  assert.ok(t.includes(`/community/board/${POST_ID}`));
  assert.ok(t.includes(COMMUNITY_ME_PATH));
  assert.ok(t.includes(ADMIN_COMMUNITY_CONTENT_PATH));
});

test("게시판 글 수정도 상세를 갱신한다(수정 후 상세 stale 방지)", () => {
  const t = communityRevalidateTargets({ mutation: "post_update", kind: "board", postId: POST_ID });
  assert.ok(t.includes(`/community/board/${POST_ID}`));
  assert.ok(t.includes(COMMUNITY_ME_PATH));
});

test("숏폼은 shortform 목록·상세 + 레거시 shorts 별칭을 함께 갱신한다", () => {
  const t = communityRevalidateTargets({ mutation: "post_create", kind: "shortform", postId: POST_ID });
  assert.ok(t.includes("/community/shortform"));
  assert.ok(t.includes("/community/shorts"));
  assert.ok(t.includes(`/community/shortform/${POST_ID}`));
  assert.ok(t.includes(`/community/shorts/${POST_ID}`));
  // 게시판 목록은 건드리지 않는다.
  assert.equal(t.includes("/community/board"), false);
});

test("댓글 작성·삭제는 상세·목록·내 활동을 갱신한다", () => {
  for (const mutation of ["comment_create", "comment_delete"] as const) {
    const t = communityRevalidateTargets({ mutation, kind: "board", postId: POST_ID });
    assert.ok(t.includes(`/community/board/${POST_ID}`), `${mutation} 상세`);
    assert.ok(t.includes("/community/board"), `${mutation} 목록`);
    assert.ok(t.includes(COMMUNITY_ME_PATH), `${mutation} 내 활동`);
  }
});

test("관리자 숨김·복구는 작성자 「내 활동」 표면을 반드시 갱신한다(배지 즉시 반영/해제)", () => {
  for (const mutation of ["admin_hide", "admin_restore", "admin_delete"] as const) {
    const t = communityRevalidateTargets({ mutation, kind: "board", postId: POST_ID });
    assert.ok(t.includes(COMMUNITY_ME_PATH), `${mutation} 내 활동 누락`);
    assert.ok(t.includes(`/community/board/${POST_ID}`), `${mutation} 상세 누락`);
    assert.ok(t.includes("/community/board"), `${mutation} 목록 누락`);
    assert.ok(t.includes(ADMIN_COMMUNITY_CONTENT_PATH), `${mutation} 관리자 누락`);
    assert.ok(t.includes(ADMIN_MODERATION_PATH), `${mutation} 검수 큐 누락`);
  }
});

test("반응 토글은 내 활동·관리자 표면을 갱신하지 않는다(불필요한 무효화 방지)", () => {
  const t = communityRevalidateTargets({
    mutation: "reaction_toggle",
    kind: "board",
    postId: POST_ID,
    extraPaths: ["/community/board?sort=popular"],
  });
  assert.equal(t.includes(COMMUNITY_ME_PATH), false);
  assert.equal(t.includes(ADMIN_COMMUNITY_CONTENT_PATH), false);
  assert.ok(t.includes("/community/board?sort=popular"));
});

test("신고 접수는 관리자 큐를 갱신하고 내 활동은 건드리지 않는다", () => {
  const t = communityRevalidateTargets({ mutation: "report_create", kind: "board", postId: POST_ID });
  assert.ok(t.includes(ADMIN_REPORTS_PATH));
  assert.ok(t.includes(ADMIN_MODERATION_PATH));
  assert.equal(t.includes(COMMUNITY_ME_PATH), false);
});

test("postId 가 없으면 상세 경로는 생성되지 않는다(잘못된 경로 revalidate 방지)", () => {
  const t = communityRevalidateTargets({ mutation: "comment_delete", kind: "board", postId: null });
  assert.equal(t.some((p) => p.startsWith("/community/board/")), false);
  assert.ok(t.includes("/community/board"));
});

test("외부 URL·상대 경로 extraPaths 는 무시된다", () => {
  const t = communityRevalidateTargets({
    mutation: "post_create",
    kind: "board",
    postId: POST_ID,
    extraPaths: ["https://evil.example/x", "community/relative", "", null, undefined, "/community/ok"],
  });
  assert.equal(t.includes("https://evil.example/x"), false);
  assert.equal(t.includes("community/relative"), false);
  assert.ok(t.includes("/community/ok"));
});

test("결과에 중복 경로가 없다", () => {
  const mutations: CommunityMutation[] = [
    "post_create",
    "post_update",
    "post_delete",
    "comment_create",
    "comment_delete",
    "reaction_toggle",
    "report_create",
    "admin_hide",
    "admin_restore",
    "admin_delete",
  ];
  for (const mutation of mutations) {
    for (const kind of ["board", "shortform"] as const) {
      const t = communityRevalidateTargets({
        mutation,
        kind,
        postId: POST_ID,
        extraPaths: ["/community", `/community/${kind}`],
      });
      assert.equal(new Set(t).size, t.length, `${mutation}/${kind} 중복`);
      // 전부 앱 내부 절대 경로여야 한다.
      assert.ok(t.every((p) => p.startsWith("/")), `${mutation}/${kind} 비절대 경로`);
    }
  }
});

test("종류를 모르는 댓글 모더레이션은 게시판·숏폼 표면을 모두 갱신한다", () => {
  const t = communityRevalidateTargetsForModeration({
    mutation: "admin_hide",
    kind: null,
    postId: null,
    extraPaths: [ADMIN_COMMUNITY_CONTENT_PATH],
  });
  assert.ok(t.includes("/community/board"));
  assert.ok(t.includes("/community/shortform"));
  assert.ok(t.includes(COMMUNITY_ME_PATH));
  assert.equal(new Set(t).size, t.length);
});
