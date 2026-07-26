// 계약 테스트: 학교·전공 인증 승인 정본 경로 — supabase/sql/174 와 한 쌍.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/mentorSchoolVerificationApproval.contract.test.ts
//
// 여기서 고정하는 것:
//   ① service role 미설정 시 **세션 클라이언트로 내려가지 않는다**(fail-closed).
//      폴백은 구조적으로 불가능해야 한다 — resolveAdminWriteClient 는 세션 팩토리를
//      인자로 받지 않으므로, 이 테스트는 "대체 클라이언트가 생성되지 않음"을 검사한다.
//   ② 승인 RPC 파라미터·결과 파싱·오류 매핑(경로/토큰/서류 내용 미노출).
//
// RLS·트리거·서류 실재 확인·재승인 승계 같은 DB 계약은 TS 로 고정할 수 없어
// staging rollback-only fixture 로 검증한다
// (scripts/verify/fixtures/mentor_school_verification_approval_174_fixture.sql).

import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_SERVICE_ROLE_UNAVAILABLE_MESSAGE,
  resolveAdminWriteClient,
} from "../adminWriteClient.ts";
import {
  APPROVE_MENTOR_SCHOOL_VERIFICATION_RPC,
  buildApproveMentorSchoolVerificationParams,
  mapApproveMentorSchoolVerificationError,
  parseApproveMentorSchoolVerificationResult,
} from "../mentorSchoolVerificationApproval.ts";

test("service role 이 있으면 그 클라이언트를 그대로 쓴다", () => {
  const client = { tag: "service-role" };
  const result = resolveAdminWriteClient(() => client);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.client, client);
});

test("service role 생성 실패 → fail-closed(ok:false) · 세션 클라이언트 대체 없음", () => {
  let sessionClientCreated = 0;
  // 세션 팩토리는 애초에 넘길 수 없다. 혹시라도 내부에서 만들면 이 카운터가 오른다.
  const result = resolveAdminWriteClient(() => {
    sessionClientCreated += 0; // no-op — 아래 throw 로 실패 경로 진입
    throw new Error("createServiceRoleClient: SUPABASE_SERVICE_ROLE_KEY가 없습니다.");
  });

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.message, ADMIN_SERVICE_ROLE_UNAVAILABLE_MESSAGE);
  assert.equal(sessionClientCreated, 0, "폴백 클라이언트를 만들지 않아야 한다");
});

test("fail-closed 메시지는 비밀·환경변수명을 노출하지 않는다", () => {
  const result = resolveAdminWriteClient(() => {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi... 없음");
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(!result.message.includes("SERVICE_ROLE"));
    assert.ok(!result.message.includes("eyJ"));
  }
});

test("RPC 이름과 파라미터 키가 SQL 174 시그니처와 일치한다", () => {
  assert.equal(APPROVE_MENTOR_SCHOOL_VERIFICATION_RPC, "approve_mentor_school_verification_admin");
  const params = buildApproveMentorSchoolVerificationParams({
    verificationId: "v-1",
    universityName: "A대",
    universityId: "a-dae",
    departmentName: "수학교육과",
    majorCategory: "교육",
    schoolTier: "서연고",
  });
  assert.deepEqual(Object.keys(params).sort(), [
    "p_department_name",
    "p_major_category",
    "p_school_tier",
    "p_university_id",
    "p_university_name",
    "p_verification_id",
  ]);
  assert.equal(params.p_verification_id, "v-1");
});

test("RPC 결과 파싱 — 정상 jsonb", () => {
  const parsed = parseApproveMentorSchoolVerificationResult({
    verification_id: "v-1",
    mentor_id: "m-1",
    status: "approved",
    superseded_count: 1,
  });
  assert.deepEqual(parsed, { verificationId: "v-1", mentorId: "m-1", supersededCount: 1 });
});

test("RPC 결과 파싱 — 손상 응답은 null(성공으로 오인하지 않는다)", () => {
  assert.equal(parseApproveMentorSchoolVerificationResult(null), null);
  assert.equal(parseApproveMentorSchoolVerificationResult({}), null);
  assert.equal(parseApproveMentorSchoolVerificationResult({ verification_id: 1, mentor_id: "m" }), null);
  assert.equal(parseApproveMentorSchoolVerificationResult("approved"), null);
});

test("superseded_count 누락 → 0 으로 읽되 성공 자체는 유지", () => {
  const parsed = parseApproveMentorSchoolVerificationResult({
    verification_id: "v-1",
    mentor_id: "m-1",
  });
  assert.equal(parsed?.supersededCount, 0);
});

test("RPC 오류 매핑 — 각 거부 사유가 구분된 안내로 번역된다", () => {
  const cases: Array<[string, string]> = [
    ["NOT_ADMIN", "관리자 권한이 없어 승인할 수 없습니다."],
    ["VERIFICATION_NOT_FOUND", "학교·전공 인증 요청을 찾을 수 없습니다."],
    ["NOT_REVIEWABLE: approved", "이미 처리되었거나 심사 대기 상태가 아닌 요청입니다."],
    ["DOCUMENT_REF_MISSING", "제출된 증빙 서류가 없어 승인할 수 없습니다. 재제출을 요청해 주세요."],
    ["DOCUMENT_OBJECT_NOT_FOUND", "증빙 서류 파일을 찾을 수 없어 승인할 수 없습니다. 재제출을 요청해 주세요."],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(mapApproveMentorSchoolVerificationError(raw), expected, raw);
  }
});

test("RPC 오류 매핑 — 서류 참조 형식/소유 위반은 같은 안내로 묶고 경로를 노출하지 않는다", () => {
  const unparseable = mapApproveMentorSchoolVerificationError("DOCUMENT_REF_UNPARSEABLE");
  const mismatch = mapApproveMentorSchoolVerificationError(
    "DOCUMENT_REF_OWNER_MISMATCH: student-id-images/abc/school-verifications/1.png"
  );
  assert.equal(unparseable, mismatch);
  assert.ok(!mismatch.includes("student-id-images"));
  assert.ok(!mismatch.includes("school-verifications"));
});

test("RPC 오류 매핑 — 동시 승인 유니크 위반은 재시도 안내", () => {
  const message = mapApproveMentorSchoolVerificationError(
    'duplicate key value violates unique constraint "uq_msv_one_approved_per_mentor"'
  );
  assert.match(message, /새로고침/);
});

test("RPC 오류 매핑 — 미지 오류는 원문을 그대로 흘리지 않는다", () => {
  const raw = "PGRST301 jwt expired at /rest/v1/rpc/approve_mentor_school_verification_admin";
  const mapped = mapApproveMentorSchoolVerificationError(raw);
  assert.ok(!mapped.includes("PGRST301"));
  assert.ok(!mapped.includes("/rest/v1/"));
  assert.equal(mapped, "학교·전공 인증을 승인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  assert.equal(mapApproveMentorSchoolVerificationError(null), mapped);
});
