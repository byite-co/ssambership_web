// 계약 테스트: 리뷰 자격 정책(관계 기준 B+C) — SQL 170 과의 판정 일치 + 편집 모드 진입 계약.
// 실행: node --test --experimental-strip-types lib/reviews/__contract__/reviewEligibilityPolicy.contract.test.ts
//
// ⚠️ 이 파일의 진리표는 **staging 실측 결과를 그대로 옮긴 것**이다
//    (2026-07-25, supabase/sql/170 적용 후 check_review_eligibility 전수 호출).
//    TS(UI 사전 판정)와 RPC(INSERT 정책 정본)가 어긋나면 화면은 "작성 가능"인데
//    INSERT 가 막힌다. 상태 집합을 바꿀 때는 170 과 이 진리표를 함께 고친다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ELIGIBLE_INDIVIDUAL_QUESTION_STATUSES,
  ELIGIBLE_SUBSCRIPTION_STATUSES,
  EXCLUDED_INDIVIDUAL_QUESTION_STATUSES,
  EXCLUDED_SUBSCRIPTION_STATUSES,
  REVIEW_ELIGIBILITY_REASON,
  decideReviewEligibility,
  hasRelationshipEligibility,
  individualQuestionMentorId,
  isEligibleIndividualQuestionStatus,
  isEligibleSubscriptionStatus,
} from "../reviewEligibilityPolicy.ts";

const MENTOR = "11111111-1111-1111-1111-111111111111";
const OTHER_MENTOR = "22222222-2222-2222-2222-222222222222";

/** staging 실측 진리표 — 구독 상태 7종 (170 적용 후 RPC 반환값) */
const SUBSCRIPTION_TRUTH: Record<string, boolean> = {
  pending: false,
  active: true,
  past_due: false,
  cancel_scheduled: true,
  canceled: false,
  expired: true,
  refunded: false,
};

/** staging 실측 진리표 — 개별질문 상태 9종 */
const IQ_TRUTH: Record<string, boolean> = {
  escrowed: false,
  assigned: false,
  open: false,
  claimed: false,
  answered: true,
  released: true,
  expired: false,
  refunded: false,
  canceled: false,
};

function relEligible(input: {
  subscriptions?: Array<Record<string, unknown>>;
  individualQuestions?: Array<Record<string, unknown>>;
  mentorId?: string;
}): boolean {
  return hasRelationshipEligibility({
    mentorId: input.mentorId ?? MENTOR,
    subscriptions: input.subscriptions ?? [],
    individualQuestions: input.individualQuestions ?? [],
  });
}

test("구독 상태 7종 전수 — SQL 170 실측 진리표와 일치", () => {
  for (const [status, expected] of Object.entries(SUBSCRIPTION_TRUTH)) {
    assert.equal(
      relEligible({ subscriptions: [{ mentor_id: MENTOR, status }] }),
      expected,
      `subscription status=${status} 기대 ${expected}`
    );
  }
  // 상태 집합이 실 enum 7종을 정확히 분할하는지
  assert.equal(
    ELIGIBLE_SUBSCRIPTION_STATUSES.length + EXCLUDED_SUBSCRIPTION_STATUSES.length,
    Object.keys(SUBSCRIPTION_TRUTH).length
  );
});

test("개별질문 상태 9종 전수 — SQL 170 실측 진리표와 일치", () => {
  for (const [status, expected] of Object.entries(IQ_TRUTH)) {
    assert.equal(
      relEligible({ individualQuestions: [{ claimed_mentor_id: MENTOR, status }] }),
      expected,
      `iq status=${status} 기대 ${expected}`
    );
  }
  assert.equal(
    ELIGIBLE_INDIVIDUAL_QUESTION_STATUSES.length + EXCLUDED_INDIVIDUAL_QUESTION_STATUSES.length,
    Object.keys(IQ_TRUTH).length
  );
});

test("멘토 식별 = coalesce(claimed, designated) — claim 우선", () => {
  // designated 만 있으면 designated 사용
  assert.equal(individualQuestionMentorId({ designated_mentor_id: MENTOR }), MENTOR);
  // claimed 가 있으면 claimed 우선
  assert.equal(
    individualQuestionMentorId({ claimed_mentor_id: MENTOR, designated_mentor_id: OTHER_MENTOR }),
    MENTOR
  );
  // 둘 다 없으면 null
  assert.equal(individualQuestionMentorId({}), null);
  assert.equal(individualQuestionMentorId({ claimed_mentor_id: null, designated_mentor_id: "" }), null);
});

test("claim 이 타 멘토면 designated 가 대상 멘토여도 자격 없음(실측 seq19 재현)", () => {
  assert.equal(
    relEligible({
      individualQuestions: [
        { claimed_mentor_id: OTHER_MENTOR, designated_mentor_id: MENTOR, status: "answered" },
      ],
    }),
    false
  );
});

test("designated 전용 경로도 자격 성립(실측 seq18 재현)", () => {
  assert.equal(
    relEligible({
      individualQuestions: [{ claimed_mentor_id: null, designated_mentor_id: MENTOR, status: "answered" }],
    }),
    true
  );
});

test("다른 멘토의 관계는 자격 근거가 되지 않는다", () => {
  assert.equal(relEligible({ subscriptions: [{ mentor_id: OTHER_MENTOR, status: "active" }] }), false);
  assert.equal(
    relEligible({ individualQuestions: [{ claimed_mentor_id: OTHER_MENTOR, status: "released" }] }),
    false
  );
});

test("B 또는 C 중 하나만 성립해도 자격 있음", () => {
  assert.equal(
    relEligible({
      subscriptions: [{ mentor_id: MENTOR, status: "canceled" }],
      individualQuestions: [{ claimed_mentor_id: MENTOR, status: "released" }],
    }),
    true
  );
  assert.equal(
    relEligible({
      subscriptions: [{ mentor_id: MENTOR, status: "expired" }],
      individualQuestions: [{ claimed_mentor_id: MENTOR, status: "refunded" }],
    }),
    true
  );
});

test("29차 정정 회귀 방지: 'confirmed'·'completed' 는 실 enum 이 아니므로 자격 없음", () => {
  for (const ghost of ["confirmed", "completed"]) {
    assert.equal(isEligibleSubscriptionStatus(ghost), false, `subscription '${ghost}' 는 자격 아님`);
    assert.equal(isEligibleIndividualQuestionStatus(ghost), false, `iq '${ghost}' 는 자격 아님`);
  }
});

test("상태 정규화: 대소문자·앞뒤 공백 허용, 빈 값·null 은 자격 없음", () => {
  assert.equal(isEligibleSubscriptionStatus("  ACTIVE "), true);
  assert.equal(isEligibleIndividualQuestionStatus("Answered"), true);
  assert.equal(isEligibleSubscriptionStatus(null), false);
  assert.equal(isEligibleSubscriptionStatus(""), false);
  assert.equal(isEligibleIndividualQuestionStatus(undefined), false);
});

test("mentorId 가 비면 어떤 관계도 자격이 되지 않는다", () => {
  assert.equal(
    hasRelationshipEligibility({
      mentorId: "",
      subscriptions: [{ mentor_id: MENTOR, status: "active" }],
      individualQuestions: [],
    }),
    false
  );
});

// ── 편집 모드 진입 계약 (§5-2 필수 테스트 5건) ────────────────────────────────

test("① 관계 자격이 없어도 기존 후기가 있으면 edit 모드에 도달한다", () => {
  // 구 구현은 결제 집계가 2 미만이면 그 자리에서 eligible:false 로 끊어
  // 이미 후기를 쓴 학생이 편집 경로에 도달하지 못했다. 순서가 계약이다.
  const r = decideReviewEligibility({
    existingReview: { id: "rev-1", isHidden: false, isBlinded: false },
    relationshipEligible: false,
  });
  assert.equal(r.eligible, true);
  assert.equal(r.mode, "edit");
  assert.equal(r.existingReviewId, "rev-1");
  assert.equal(r.canEdit, true);
});

test("② 숨김 리뷰가 있으면 create 로 오판하지 않는다(edit + canEdit=false)", () => {
  const r = decideReviewEligibility({
    existingReview: { id: "rev-2", isHidden: true, isBlinded: false },
    relationshipEligible: true,
  });
  assert.equal(r.mode, "edit");
  assert.equal(r.existingReviewId, "rev-2");
  assert.equal(r.canEdit, false);
  assert.equal(r.reason, REVIEW_ELIGIBILITY_REASON.MODERATED);
});

test("③ 블라인드 리뷰가 있으면 create 로 오판하지 않는다(edit + canEdit=false)", () => {
  const r = decideReviewEligibility({
    existingReview: { id: "rev-3", isHidden: false, isBlinded: true },
    relationshipEligible: true,
  });
  assert.equal(r.mode, "edit");
  assert.equal(r.canEdit, false);
  assert.equal(r.reason, REVIEW_ELIGIBILITY_REASON.MODERATED);
});

test("⑤ 기존 후기가 있으면 canEdit 값과 무관하게 항상 edit — 신규 POST 경로로 떨어지지 않는다", () => {
  for (const [isHidden, isBlinded] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ] as const) {
    const r = decideReviewEligibility({
      existingReview: { id: "rev-x", isHidden, isBlinded },
      relationshipEligible: false,
    });
    assert.equal(r.mode, "edit", `hidden=${isHidden} blinded=${isBlinded} 에서도 edit`);
    assert.notEqual(r.mode, "create");
    assert.equal(r.existingReviewId, "rev-x");
  }
});

test("기존 후기가 없고 관계 자격도 없으면 eligible=false · mode=create", () => {
  const r = decideReviewEligibility({ existingReview: null, relationshipEligible: false });
  assert.equal(r.eligible, false);
  assert.equal(r.mode, "create");
  assert.equal(r.existingReviewId, null);
  assert.equal(r.reason, REVIEW_ELIGIBILITY_REASON.NO_RELATIONSHIP);
});

test("기존 후기가 없고 관계 자격이 있으면 eligible=true · mode=create · 사유 없음", () => {
  const r = decideReviewEligibility({ existingReview: null, relationshipEligible: true });
  assert.equal(r.eligible, true);
  assert.equal(r.mode, "create");
  assert.equal(r.existingReviewId, null);
  assert.equal(r.reason, undefined);
});

test("빈 id 의 기존 후기는 존재하지 않는 것으로 취급한다", () => {
  const r = decideReviewEligibility({
    existingReview: { id: "", isHidden: false, isBlinded: false },
    relationshipEligible: true,
  });
  assert.equal(r.mode, "create");
  assert.equal(r.existingReviewId, null);
});

test("자격 사유 문구에 구 기준(2회 결제) 표현이 남아 있지 않다", () => {
  for (const reason of Object.values(REVIEW_ELIGIBILITY_REASON)) {
    assert.ok(!reason.includes("2회"), `구 기준 문구 잔존: ${reason}`);
    assert.ok(!reason.includes("무료체험"), `구 기준 문구 잔존: ${reason}`);
  }
});
