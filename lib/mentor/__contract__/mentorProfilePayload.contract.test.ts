// 계약 테스트: 멘토 프로필 편집 payload 는 avatar 와 인증서류를 분리한다.
// 실행: node --test --experimental-strip-types lib/mentor/__contract__/mentorProfilePayload.contract.test.ts
//
// 합성 A/B ref 로 검증:
//   A = avatar ref, B = 인증서류(student_id_image_url) ref.
//   avatar 변경(A) payload 가 인증서류 컬럼을 절대 포함하지 않으며(B 오염 없음),
//   avatar 미입력 시 avatar 컬럼도 건드리지 않음(문서·기존 사진 불변)을 강제한다.

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMentorProfilePayloads,
  findForbiddenDocumentKeys,
  FORBIDDEN_DOCUMENT_COLUMNS,
  splitCsv,
  type MentorProfilePayloadInput,
} from "../mentorProfilePayload.ts";

const AVATAR_REF_A = "mentor-avatars/uid-A/avatar-A.png";
const DOCUMENT_REF_B = "student-id-images/uid-A/student-id-B.jpg";

function baseInput(over: Partial<MentorProfilePayloadInput> = {}): MentorProfilePayloadInput {
  return {
    userId: "uid-A",
    intro: "한줄 소개",
    bio: "상세 소개",
    grade: "22학번",
    subjects: "math_hs, eng_hs",
    highSchool: "쌤고등학교",
    tags: "성실, 꼼꼼",
    subscribeOpen: true,
    ...over,
  };
}

test("avatar 변경 payload 는 인증서류 컬럼(B)을 절대 포함하지 않는다", () => {
  const payloads = buildMentorProfilePayloads(baseInput({ profileImageUrl: AVATAR_REF_A }));
  // 어떤 payload 객체에도 금지된 인증서류 컬럼 키가 없어야 한다.
  assert.deepEqual(findForbiddenDocumentKeys(payloads), []);
  // imagePatch 는 avatar 단일 키만.
  assert.deepEqual(payloads.imagePatch, { profile_image_url: AVATAR_REF_A });
  // B(인증서류 ref)가 어떤 payload 값으로도 새어들지 않아야 한다.
  const allValues = JSON.stringify([payloads.core, payloads.imagePatch, ...payloads.extras]);
  assert.ok(!allValues.includes(DOCUMENT_REF_B), "인증서류 ref 가 avatar payload 로 유출됨");
});

test("avatar 미입력 시 imagePatch 는 null — 기존 사진·문서 ref 불변", () => {
  const payloads = buildMentorProfilePayloads(baseInput({ profileImageUrl: null }));
  assert.equal(payloads.imagePatch, null);
  // core/extras 어디에도 profile_image_url 이 없어야 한다(미입력 → 컬럼 미변경).
  const keys = [payloads.core, ...payloads.extras].flatMap((o) => Object.keys(o));
  assert.ok(!keys.includes("profile_image_url"), "avatar 미입력인데 profile_image_url 갱신 시도");
  assert.deepEqual(findForbiddenDocumentKeys(payloads), []);
});

test("core 는 학적 잠금 컬럼(university_name·department_name)을 UPDATE payload 에 포함하지 않는다", () => {
  const payloads = buildMentorProfilePayloads(baseInput({ profileImageUrl: AVATAR_REF_A }));
  const keys = Object.keys(payloads.core);
  assert.ok(!keys.includes("university_name"));
  assert.ok(!keys.includes("department_name"));
  // 편집 대상 기본 컬럼은 존재.
  assert.ok(keys.includes("intro_line"));
  assert.ok(keys.includes("bio"));
  assert.ok(keys.includes("teaching_subjects"));
  assert.ok(keys.includes("high_school_name"));
});

test("avatar ref 와 document ref 가 동일해도(잘못된 입력) payload 는 문서 컬럼을 만들지 않는다", () => {
  // 방어: 호출자가 실수로 문서 ref 를 avatar 로 넘겨도, payload 계약상 문서 컬럼은 생성되지 않는다.
  const payloads = buildMentorProfilePayloads(baseInput({ profileImageUrl: DOCUMENT_REF_B }));
  assert.deepEqual(findForbiddenDocumentKeys(payloads), []);
  // imagePatch 는 여전히 avatar 컬럼에만 쓴다(문서 컬럼 아님).
  assert.deepEqual(Object.keys(payloads.imagePatch ?? {}), ["profile_image_url"]);
});

test("teaching_subjects 는 CSV 를 trim/공백제거해 배열로 만든다", () => {
  assert.deepEqual(splitCsv(" a , b ,, c "), ["a", "b", "c"]);
  const payloads = buildMentorProfilePayloads(baseInput({ subjects: "math_hs, , eng_hs" }));
  assert.deepEqual(payloads.core.teaching_subjects, ["math_hs", "eng_hs"]);
});

test("FORBIDDEN_DOCUMENT_COLUMNS 는 student_id_image_url 을 포함한다(계약 앵커)", () => {
  assert.ok(FORBIDDEN_DOCUMENT_COLUMNS.includes("student_id_image_url"));
});
