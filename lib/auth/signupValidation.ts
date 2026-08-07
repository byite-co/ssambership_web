import type { StudentSignupFormValues } from "@/components/auth/StudentSignupForm";
import type { MentorSignupFormValues } from "@/components/auth/MentorSignupForm";
import type { AppRole } from "@/lib/types/user";
import { isFutureBirthDate, parseBirthDateParts } from "@/lib/auth/minorAgeGate";

export type StudentSignupFields = {
  email: string;
  password: string;
  passwordConfirm: string;
  student: StudentSignupFormValues;
  termsAgree: boolean;
  privacyAgree: boolean;
};

export type MentorSignupFields = {
  email: string;
  password: string;
  passwordConfirm: string;
  mentor: MentorSignupFormValues;
  termsAgree: boolean;
  privacyAgree: boolean;
};

export type SignupFieldErrors = Partial<Record<string, string>>;

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/** 비밀번호 최소 길이(보안 정책). 영문·숫자 조합은 안내로 권장. */
export const SIGNUP_PASSWORD_MIN_LENGTH = 8;
const PASSWORD_RULE_MESSAGE = `비밀번호는 ${SIGNUP_PASSWORD_MIN_LENGTH}자 이상(영문·숫자 조합 권장)이어야 합니다.`;

export function studentSignupFieldErrors(f: StudentSignupFields): SignupFieldErrors {
  const errors: SignupFieldErrors = {};
  if (!f.email.trim()) {
    errors.email = "이메일을 입력해 주세요.";
  } else if (!emailOk(f.email)) {
    errors.email = "이메일 형식을 확인해 주세요.";
  }
  if (f.password.length < SIGNUP_PASSWORD_MIN_LENGTH) {
    errors.password = PASSWORD_RULE_MESSAGE;
  }
  if (f.password !== f.passwordConfirm) {
    errors.passwordConfirm = "비밀번호가 서로 일치하지 않습니다.";
  }
  if (!f.student.birthDate.trim()) {
    errors.birthDate = "생년월일을 입력해 주세요.";
  } else if (!parseBirthDateParts(f.student.birthDate)) {
    errors.birthDate = "생년월일 형식을 확인해 주세요.";
  } else if (isFutureBirthDate(f.student.birthDate)) {
    errors.birthDate = "생년월일은 오늘 이전이어야 합니다.";
  }
  if (!f.student.nickname.trim()) {
    errors.nickname = "닉네임을 입력해 주세요.";
  }
  if (!f.termsAgree || !f.privacyAgree) {
    errors.terms = "필수 약관(이용·개인정보)에 모두 동의해 주세요.";
  }
  return errors;
}

export function mentorSignupFieldErrors(f: MentorSignupFields): SignupFieldErrors {
  const errors: SignupFieldErrors = {};
  if (!f.email.trim()) {
    errors.email = "이메일을 입력해 주세요.";
  } else if (!emailOk(f.email)) {
    errors.email = "이메일 형식을 확인해 주세요.";
  }
  if (f.password.length < SIGNUP_PASSWORD_MIN_LENGTH) {
    errors.password = PASSWORD_RULE_MESSAGE;
  }
  if (f.password !== f.passwordConfirm) {
    errors.passwordConfirm = "비밀번호가 서로 일치하지 않습니다.";
  }
  const m = f.mentor;
  if (!m.nickname.trim()) {
    errors.nickname = "닉네임을 입력해 주세요.";
  }
  if (!m.universityName.trim()) {
    errors.universityName = "대학교를 입력해 주세요.";
  }
  if (!m.departmentName.trim()) {
    errors.departmentName = "학과를 입력해 주세요.";
  }
  if (!m.teachingSubjectsCsv.trim()) {
    errors.teachingSubjectsCsv = "전공 과목을 한 개 이상 입력해 주세요.";
  }
  if (!m.highSchoolName.trim()) {
    errors.highSchoolName = "출신 고등학교를 입력해 주세요.";
  }
  if (!m.studentIdFile) {
    errors.studentIdFile = "학생증 또는 재학증명서 파일을 선택해 주세요.";
  }
  if (!f.termsAgree || !f.privacyAgree) {
    errors.terms = "필수 약관(이용·개인정보)에 모두 동의해 주세요.";
  }
  return errors;
}

// D-AU-7: 사문 헬퍼 validateSignupByRole(및 그것만 쓰던 validateStudentSignup·
// validateMentorSignup·firstError)를 삭제했다. 정본은 signupFieldErrorsByRole 다
// (signup 페이지가 필드별 오류맵을 직접 소비한다 — 첫 오류 문자열만 뽑던 병렬 규칙 폐지).

export function signupFieldErrorsByRole(
  role: Extract<AppRole, "student" | "mentor">,
  student: StudentSignupFields,
  mentor: MentorSignupFields
): SignupFieldErrors {
  if (role === "student") {
    return studentSignupFieldErrors(student);
  }
  return mentorSignupFieldErrors(mentor);
}
