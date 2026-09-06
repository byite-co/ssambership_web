// 계약 테스트: `api_app_v1.complete_profile` 웹 코어 — 웹 PR-2 §2 (DB-5 보고서 §3 행과 1:1).
// 실행: node --test --experimental-strip-types lib/auth/__contract__/completeProfileCore.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPLETE_PROFILE_FIELD_ERRORS,
  COMPLETE_PROFILE_GENERIC_ERROR,
  COMPLETE_PROFILE_RPC,
  COMPLETE_PROFILE_RPC_SCHEMA,
  buildCompleteProfileArgs,
  completeProfileDestination,
  interpretCompleteProfileResponse,
  validateCompleteProfileForm,
  type CompleteProfileFormValues,
} from "../completeProfileCore.ts";

const STUDENT: CompleteProfileFormValues = {
  role: "student",
  displayName: " 민지 ",
  birthdate: "2012-03-01",
  termsAgreed: true,
  marketingAgreed: false,
  gradeLevel: " 고1 ",
  universityName: "무시됨",
  departmentName: "무시됨",
};

test("RPC 이름·스키마·인자 8종 — 보고서 §3 시그니처와 1:1(학생은 대학·학과 null · 멘토는 학년 null)", () => {
  assert.equal(COMPLETE_PROFILE_RPC_SCHEMA, "api_app_v1");
  assert.equal(COMPLETE_PROFILE_RPC, "complete_profile");
  assert.deepEqual(buildCompleteProfileArgs(STUDENT), {
    p_role: "student",
    p_display_name: "민지",
    p_birthdate: "2012-03-01",
    p_terms_agreed: true,
    p_marketing_agreed: false,
    p_grade_level: "고1",
    p_university_name: null,
    p_department_name: null,
  });
  assert.deepEqual(
    buildCompleteProfileArgs({ ...STUDENT, role: "mentor", universityName: " 쌤대 ", departmentName: "" , marketingAgreed: true }),
    {
      p_role: "mentor",
      p_display_name: "민지",
      p_birthdate: "2012-03-01",
      p_terms_agreed: true,
      p_marketing_agreed: true,
      p_grade_level: null,
      p_university_name: "쌤대",
      p_department_name: null,
    },
  );
});

test("성공 응답: next 3종 → home 은 post-login(next 존중) · guardian_consent → /onboarding/guardian · identity_verification → /onboarding/verify", () => {
  const home = interpretCompleteProfileResponse({ ok: true, role: "student", is_minor: false, next: "home" }, null, { nextPath: "/mentors" });
  assert.deepEqual(home, { kind: "done", role: "student", next: "home", isMinor: false, redirectTo: "/mentors" });
  const minor = interpretCompleteProfileResponse({ ok: true, role: "student", is_minor: true, next: "guardian_consent" }, null);
  assert.equal(minor.kind, "done");
  assert.equal(minor.kind === "done" && minor.redirectTo, "/onboarding/guardian");
  const mentor = interpretCompleteProfileResponse({ ok: true, role: "mentor", is_minor: false, next: "identity_verification" }, null, { nextPath: "/mentor/mypage" });
  assert.equal(mentor.kind === "done" && mentor.redirectTo, "/onboarding/verify");
  assert.equal(completeProfileDestination("home", "mentor", "/mypage"), "/mentor/mypage", "역할 밖 next 는 기본 홈");
});

test("오류 4종(TERMS_REQUIRED · GRADE_REQUIRED · UNIVERSITY_REQUIRED · DISPLAY_NAME/BIRTHDATE) → 필드 오류 · ALREADY_COMPLETED → post-login", () => {
  const cases: Array<[string, string]> = [
    ["TERMS_REQUIRED", "terms"],
    ["GRADE_REQUIRED", "gradeLevel"],
    ["UNIVERSITY_REQUIRED", "universityName"],
    ["DISPLAY_NAME_REQUIRED", "displayName"],
    ["DISPLAY_NAME_TOO_LONG", "displayName"],
    ["BIRTHDATE_REQUIRED", "birthdate"],
    ["BIRTHDATE_INVALID", "birthdate"],
    ["GRADE_LEVEL_TOO_LONG", "gradeLevel"],
    ["ROLE_INVALID", "role"],
  ];
  for (const [code, field] of cases) {
    const r = interpretCompleteProfileResponse({ ok: false, code }, null);
    assert.equal(r.kind, "field_error", code);
    assert.equal(r.kind === "field_error" && r.field, field, code);
    assert.equal(r.kind === "field_error" && r.message, COMPLETE_PROFILE_FIELD_ERRORS[code].message);
  }
  const done = interpretCompleteProfileResponse({ ok: false, code: "ALREADY_COMPLETED", role: "student", profile_completed_at: "2026-09-06T00:00:00Z" }, null, { nextPath: "/mentors" });
  assert.deepEqual(done, { kind: "already_completed", redirectTo: "/mentors" });
  const doneMentor = interpretCompleteProfileResponse({ ok: false, code: "ALREADY_COMPLETED", role: "mentor" }, null);
  assert.deepEqual(doneMentor, { kind: "already_completed", redirectTo: "/mentor/mypage" });
});

test("계정 거부·미지 코드·PostgREST 오류 → 일반 오류(원문 미반영)", () => {
  const banned = interpretCompleteProfileResponse({ ok: false, code: "ACCOUNT_BANNED" }, null);
  assert.equal(banned.kind, "error");
  assert.equal(banned.kind === "error" && banned.code, "ACCOUNT_BANNED");
  const unknown = interpretCompleteProfileResponse({ ok: false, code: "SOMETHING_NEW" }, null);
  assert.equal(unknown.kind === "error" && unknown.message, COMPLETE_PROFILE_GENERIC_ERROR);
  const pg = interpretCompleteProfileResponse(null, { message: 'permission denied for function complete_profile' });
  assert.equal(pg.kind === "error" && pg.message, COMPLETE_PROFILE_GENERIC_ERROR);
  assert.ok(!(pg.kind === "error" && pg.message.includes("permission")), "원문 비반영");
  const garbage = interpretCompleteProfileResponse(["x"], null);
  assert.equal(garbage.kind, "error");
});

test("클라이언트 사전 검증은 서버 규칙과 같다(30자 · 20자 · 학생 학년 필수 · 멘토 대학 필수 · 약관 필수)", () => {
  assert.deepEqual(validateCompleteProfileForm(STUDENT), {});
  const e1 = validateCompleteProfileForm({ ...STUDENT, displayName: "가".repeat(31), termsAgreed: false, gradeLevel: "" });
  assert.deepEqual(Object.keys(e1).sort(), ["displayName", "gradeLevel", "terms"]);
  const e2 = validateCompleteProfileForm({ ...STUDENT, role: "mentor", universityName: "  ", birthdate: "20120301" });
  assert.deepEqual(Object.keys(e2).sort(), ["birthdate", "universityName"]);
  const e3 = validateCompleteProfileForm({ ...STUDENT, gradeLevel: "가".repeat(21) });
  assert.deepEqual(Object.keys(e3), ["gradeLevel"]);
});
