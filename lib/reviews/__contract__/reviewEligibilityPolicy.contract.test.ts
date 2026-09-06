// 계약 테스트: 리뷰 자격 정책 — SQL 208(`review_eligibility_self` · `check_review_eligibility` 와 동일 판정) 응답 해석 + 편집 모드 진입 계약.
// 실행: node --test --experimental-strip-types lib/reviews/__contract__/reviewEligibilityPolicy.contract.test.ts
//
// ⚠️ 170 시절의 상태 집합 진리표(구독 7종·IQ 9종)는 폐기됐다 — 웹은 상태를 세지 않고 RPC 응답을 그대로 쓴다.
//    이 파일이 고정하는 것은 (1) RPC 응답 → UI 판정 매핑 (2) 검사 순서(기존 후기 → 신규 자격)
//    (3) 사유 문구 "현재 N/2" (4) INSERT 가 RLS 로 거부될 때의 오류 매핑 (5) 배선(RPC 호출·상태 집계 잔재 0).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REVIEW_ELIGIBILITY_REASON,
  REVIEW_ELIGIBILITY_RPC,
  REVIEW_ELIGIBILITY_RPC_SCHEMA,
  REVIEW_INSERT_DENIED_MESSAGE,
  REVIEW_REQUIRED_PAID_COUNT,
  decideReviewEligibilityFromRpc,
  mapReviewInsertError,
} from "../reviewEligibilityPolicy.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("RPC 이름·스키마·요구 횟수 — DB-5 보고서 §3 행과 1:1", () => {
  assert.equal(REVIEW_ELIGIBILITY_RPC_SCHEMA, "api_app_v1");
  assert.equal(REVIEW_ELIGIBILITY_RPC, "review_eligibility_self");
  assert.equal(REVIEW_REQUIRED_PAID_COUNT, 2);
});

test("OK → eligible · create · 사유 없음 (paid_count 그대로)", () => {
  const r = decideReviewEligibilityFromRpc({ ok: true, eligible: true, reason: "OK", paid_count: 3, required_count: 2, existing_review_id: null, can_edit: false });
  assert.deepEqual(r, { eligible: true, mode: "create", existingReviewId: null, canEdit: false, paidCount: 3, requiredCount: 2, reasonCode: "OK" });
});

test("NOT_ENOUGH_PAYMENTS → eligible=false · '같은 멘토에게 2회 결제하면 후기를 남길 수 있어요 (현재 N/2)'", () => {
  const r = decideReviewEligibilityFromRpc({ ok: true, eligible: false, reason: "NOT_ENOUGH_PAYMENTS", paid_count: 1, required_count: 2, existing_review_id: null, can_edit: false });
  assert.equal(r.eligible, false);
  assert.equal(r.mode, "create");
  assert.equal(r.reason, "같은 멘토에게 2회 결제하면 후기를 남길 수 있어요 (현재 1/2)");
  assert.equal(r.paidCount, 1);
  // 결제 0회 · 응답에 required_count 가 없어도 2 로 폴백
  const zero = decideReviewEligibilityFromRpc({ ok: true, eligible: false, reason: "NOT_ENOUGH_PAYMENTS", paid_count: 0 });
  assert.equal(zero.reason, REVIEW_ELIGIBILITY_REASON.NOT_ENOUGH_PAYMENTS(0));
  assert.equal(zero.requiredCount, 2);
});

test("① ALREADY_REVIEWED → 신규 자격과 무관하게 edit 모드(existing_review_id) · can_edit=false 면 MODERATED", () => {
  const editable = decideReviewEligibilityFromRpc({ ok: true, eligible: false, reason: "ALREADY_REVIEWED", existing_review_id: "rev-1", can_edit: true, paid_count: null, required_count: 2 });
  assert.equal(editable.eligible, true);
  assert.equal(editable.mode, "edit");
  assert.equal(editable.existingReviewId, "rev-1");
  assert.equal(editable.canEdit, true);
  assert.equal(editable.reason, undefined);

  const moderated = decideReviewEligibilityFromRpc({ ok: true, eligible: false, reason: "ALREADY_REVIEWED", existing_review_id: "rev-2", can_edit: false });
  assert.equal(moderated.mode, "edit");
  assert.equal(moderated.canEdit, false);
  assert.equal(moderated.reason, REVIEW_ELIGIBILITY_REASON.MODERATED);
  assert.notEqual(moderated.mode, "create", "숨김·블라인드 후기를 create 로 오판하면 uq_reviews_mentor_author 23505");
});

test("ok:false(MENTOR_NOT_FOUND · AUTH_REQUIRED) · RPC 오류 · 깨진 응답 → 판정 불가(무음 false 금지 — 사유 문구 있음)", () => {
  const notFound = decideReviewEligibilityFromRpc({ ok: false, code: "MENTOR_NOT_FOUND" });
  assert.equal(notFound.eligible, false);
  assert.equal(notFound.reason, REVIEW_ELIGIBILITY_REASON.MENTOR_NOT_FOUND);
  const auth = decideReviewEligibilityFromRpc({ ok: false, code: "AUTH_REQUIRED" });
  assert.equal(auth.reason, REVIEW_ELIGIBILITY_REASON.AUTH_REQUIRED);
  for (const bad of [null, undefined, "x", ["x"], { ok: true, reason: "ALREADY_REVIEWED", existing_review_id: "" }]) {
    const r = decideReviewEligibilityFromRpc(bad);
    assert.equal(r.eligible, false);
    assert.equal(r.reason, REVIEW_ELIGIBILITY_REASON.LOOKUP_FAILED);
  }
  const err = decideReviewEligibilityFromRpc({ ok: true, eligible: true }, { message: "permission denied for schema api_app_v1" });
  assert.equal(err.reasonCode, "LOOKUP_FAILED");
  assert.ok(!(err.reason ?? "").includes("permission"), "원문 비반영");
});

test("POST /api/reviews: INSERT 가 RLS(reviews_insert_student = 208 판정)로 거부되면 자격 부족 문구 · 유니크는 중복 문구 · 원문 비반영", () => {
  assert.equal(mapReviewInsertError({ code: "42501", message: 'new row violates row-level security policy for table "reviews"' }), REVIEW_INSERT_DENIED_MESSAGE);
  assert.equal(mapReviewInsertError({ message: "new row violates row-level security policy" }), REVIEW_INSERT_DENIED_MESSAGE);
  assert.equal(mapReviewInsertError({ code: "23505", message: 'duplicate key value violates unique constraint "uq_reviews_mentor_author"' }), "이미 리뷰를 작성했습니다.");
  assert.equal(mapReviewInsertError({ message: "connection refused" }), "리뷰 저장에 실패했습니다.");
  assert.ok(!REVIEW_INSERT_DENIED_MESSAGE.includes("reviews_insert_student"));
  assert.ok(REVIEW_INSERT_DENIED_MESSAGE.includes("2회"));
});

test("배선: checkReviewEligibility 는 review_eligibility_self 만 호출 · 170 상태 집합·직접 집계 잔재 0 · 문구 208", () => {
  const io = read("lib/reviews/checkReviewEligibility.ts");
  assert.ok(io.includes(".schema(REVIEW_ELIGIBILITY_RPC_SCHEMA)") && io.includes(".rpc(REVIEW_ELIGIBILITY_RPC,"), "RPC 호출 없음");
  for (const forbidden of ['from("subscriptions")', 'from("individual_questions")', 'from("reviews")', 'from("subscription_billing_events")']) {
    assert.ok(!io.includes(forbidden), `웹이 직접 집계한다: ${forbidden}`);
  }
  const policy = read("lib/reviews/reviewEligibilityPolicy.ts");
  for (const forbidden of ["ELIGIBLE_SUBSCRIPTION_STATUSES", "ELIGIBLE_INDIVIDUAL_QUESTION_STATUSES", "hasRelationshipEligibility", "cancel_scheduled"]) {
    assert.ok(!policy.includes(forbidden), `170 상태 집합 판정 코드 잔존: ${forbidden}`);
  }
  assert.ok(policy.includes("check_review_eligibility") && policy.includes("208"), "헤더 주석이 208 정본을 가리키지 않음");
  const queries = read("lib/reviews/reviewQueries.ts");
  assert.ok(queries.includes("mapReviewInsertError(error)"), "createReview 의 RLS 거부 매핑 미배선");
  const modal = read("components/reviews/ReviewWriteModal.tsx");
  assert.ok(modal.includes("REVIEW_ELIGIBILITY_REASON.NOT_ENOUGH_PAYMENTS("), "모달 기본 안내가 208 문구가 아님");
  assert.ok(!modal.includes("개별 질문 이용 이력"), "구 170 문구 잔존");
  const banner = read("components/reviews/ReviewEligibilityBanner.tsx");
  assert.ok(banner.includes("회 결제하면 후기를 남길 수 있어요") && !banner.includes("개별 질문을 이용한 이력"), "배너 문구가 208 이 아님");
});
