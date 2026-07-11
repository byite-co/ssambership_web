import type { UserRow } from "@/lib/types/user";
import {
  getProfileFieldBool,
  getProfileFieldString,
} from "@/lib/mentor/mentorProfileQueries";

type Row = Record<string, unknown>;

/** 편집 폼 initial / 공개 상세 상단에서 동일 키 풀로 읽기 */
export type MentorProfileDisplay = {
  displayName: string;
  intro: string;
  university: string;
  department: string;
  rawUniversity?: string;
  rawDepartment?: string;
  verifiedUniversity?: string;
  verifiedDepartment?: string;
  verifiedMajorCategory?: string;
  verifiedMajorCategoryLabel?: string;
  schoolTier?: string;
  schoolTierLabel?: string;
  schoolVerified?: boolean;
  subjects: string;
  highSchool: string;
  tags: string;
  subOpen: boolean;
  photoUrl: string;
  verification: string;
  grade: string;
};

function looksLikeStudentId(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  return /\d{1,2}학번/.test(v) || /^\d{2}$/.test(v);
}

/** 학번 필드 우선, legacy로 department_name에 학번이 들어간 경우 보조 표시 */
export function resolveMentorGradeDisplay(profileRow: Row | null): string {
  const grade = getProfileFieldString(profileRow, ["grade", "grade_level", "academic_year"]);
  if (grade.trim()) return grade.trim();
  const dept = getProfileFieldString(profileRow, ["department_name"]);
  if (looksLikeStudentId(dept)) return dept.trim();
  return "";
}

export function mentorDisplayNameFromUser(user: UserRow | null): string {
  if (!user) return "멘토";
  const n = (user.full_name ?? "").trim() || (user.nickname ?? "").trim();
  return n || "멘토";
}

export function buildMentorProfileDisplay(
  profileRow: Row | null,
  userRow: UserRow | null
): MentorProfileDisplay {
  const rawUniversity = getProfileFieldString(profileRow, ["university_name"]);
  const rawDepartment = getProfileFieldString(profileRow, ["department_name", "major_name"]);
  const verifiedUniversity = getProfileFieldString(profileRow, ["verified_university_name"]);
  const verifiedDepartment = getProfileFieldString(profileRow, ["verified_department_name"]);
  const verifiedMajorCategory = getProfileFieldString(profileRow, ["verified_major_category"]);
  const rawSchoolTier = getProfileFieldString(profileRow, ["school_tier"]);
  // "그외" 학교군은 공개 화면·필터에서 "미분류"로 종속 처리
  const schoolTier = rawSchoolTier === "그외" ? "미분류" : rawSchoolTier;
  const schoolVerified = getProfileFieldBool(profileRow, ["school_verified"]) ?? false;

  return {
    displayName: mentorDisplayNameFromUser(userRow),
    intro: getProfileFieldString(profileRow, ["intro_line", "bio", "about"]),
    university: schoolVerified ? verifiedUniversity || rawUniversity : rawUniversity,
    department: schoolVerified ? verifiedDepartment || rawDepartment : rawDepartment,
    rawUniversity,
    rawDepartment,
    verifiedUniversity,
    verifiedDepartment,
    verifiedMajorCategory,
    verifiedMajorCategoryLabel: verifiedMajorCategory,
    schoolTier,
    schoolTierLabel: schoolTier,
    schoolVerified,
    subjects: getProfileFieldString(profileRow, ["teaching_subjects", "subjects", "subject_list"]),
    highSchool: getProfileFieldString(profileRow, ["high_school_name"]),
    tags: getProfileFieldString(profileRow, ["tags", "featured_tags", "label_list"]),
    subOpen:
      getProfileFieldBool(profileRow, [
        "accepts_subscriptions",
        "accept_subscriptions",
        "is_open_for_subscriptions",
      ]) ?? false,
    photoUrl: getProfileFieldString(profileRow, [
      "profile_image_url",
      "avatar_url",
      "portrait_url",
    ]),
    verification: getProfileFieldString(profileRow, ["verification_status", "kyc_status"]),
    grade: resolveMentorGradeDisplay(profileRow),
  };
}

/** 멘토 인증 상태 — 사용자 화면용 */
export function mentorVerificationKo(raw: string | null | undefined): string {
  const t = String(raw ?? "").trim();
  if (!t || /^null$/i.test(t)) return "미등록";
  const s = t.toLowerCase();
  const map: Record<string, string> = {
    approved: "인증 완료",
    verified: "인증 완료",
    complete: "인증 완료",
    pending: "검토 중",
    in_review: "검토 중",
    reviewing: "검토 중",
    under_review: "검토 중",
    rejected: "반려",
    denied: "반려",
    none: "미인증",
    unset: "미인증",
    unverified: "미인증",
    not_verified: "미인증",
    not_submitted: "미제출",
  };
  // 매핑 없는 영어 원문이 그대로 노출되지 않게 한글 폴백.
  return map[s] ?? "미인증";
}
