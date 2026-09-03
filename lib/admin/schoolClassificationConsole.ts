/**
 * 관리자 · 등급 분류 화면(PR-11 §3 · PR-W1 정정)의 순수 규칙 — 카탈로그(읽기 전용) · 판정 규칙 표(DB 트리거의 LIKE 패턴) · 매핑 표(읽기 전용) ·
 * 등급별 분포 · 미분류 멘토 목록 + 등급 정정(같은 확정 RPC) · 정정 경로 안내.
 *
 * §0-B 실측(DB-1 SQL 192 · 운영 DB 2026-09-03):
 *   1. 트리거 `trg_auto_school_verification` → `auto_school_verification()` → `school_tier_suggest(university_name)` 는 **LIKE 패턴 하드코딩**이다.
 *      `school_tier_mappings` 를 읽는 함수·트리거·RPC 는 없다(읽는 코드 0 · 행 0). → 매핑 표를 편집해도 판정이 바뀌지 않으므로 화면은 읽기 전용이고
 *      트리거의 패턴 자체를 표로 보여준다(`SCHOOL_TIER_LIKE_RULES` — 계약 테스트가 SQL 192 원문과 대조한다).
 *   2. 확정된 행(`approved` + `reviewed_by NOT NULL`)의 정정은 확정 RPC `approve_mentor_school_verification_admin` **한 경로**다(PR-W1 · DB-2 SQL 193 A-2:
 *      approved 는 reviewed_by 유무와 무관하게 허용 · 정정 시 이전 등급·확정자를 감사 로그에 남긴다). 반려·재제출 액션은 여전히 pending·resubmit_required 만 갱신한다.
 *      → 미분류 목록의 `등급 정정` 버튼은 같은 RPC 액션(`approveMentorSchoolVerificationAction`)으로 등급을 '그외'(새 폴백)로 넘긴다(새 쓰기 경로 0).
 *      DB-2(193) 적용 전에는 옛 RPC(192)가 확정된 행을 NOT_REVIEWABLE 로 거절한다(처리 실패 표시 · 데이터 불변 — 오너 허용 구간).
 *
 * 여기의 LIKE 표·판정 헬퍼는 **표시 전용**이다(정본은 DB 함수 · TS 사본으로 판정하지 않는다).
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { adminStatusAllowedValues, resolveAdminStatus } from "./adminStatusDictionary.ts";
import { buildAccountDetailUrl } from "./accountDetailConsole.ts";

export const SCHOOL_CLASSIFICATION_BASE_PATH = "/admin/school-classifications";
export const SCHOOL_VERIFICATION_TABLE = "mentor_school_verifications";

// ── 카탈로그 — 상태 사전(= DB CHECK) 그대로 · 읽기 전용 ─────────────────────────

export const SCHOOL_TIER_VALUES: readonly string[] = adminStatusAllowedValues(SCHOOL_VERIFICATION_TABLE, "school_tier");
export const MAJOR_CATEGORY_VALUES: readonly string[] = adminStatusAllowedValues(SCHOOL_VERIFICATION_TABLE, "verified_major_category");

export const SCHOOL_TIER_UNCLASSIFIED = "미분류";
export const SCHOOL_TIER_OTHER = "그외";
export const MAJOR_CATEGORY_OTHER = "기타";

export const SCHOOL_CATALOG_FIXED_NOTICE = "DB CHECK 제약으로 고정된 값입니다.";

export function schoolTierLabel(tier: string | null | undefined): string {
  return resolveAdminStatus(SCHOOL_VERIFICATION_TABLE, "school_tier", tier).label;
}

export function majorCategoryLabel(category: string | null | undefined): string {
  return resolveAdminStatus(SCHOOL_VERIFICATION_TABLE, "verified_major_category", category).label;
}

// ── 판정 규칙 — SQL 192 `school_tier_suggest` · `major_category_suggest` 의 LIKE 패턴(표시용 사본) ───

export type SchoolLikeRule = { pattern: string; result: string };

/** `school_tier_suggest(p_university_name)` — 접두 LIKE(`x%`). 순서 = CASE 순서. 어느 것도 아니면 미분류. */
export const SCHOOL_TIER_LIKE_RULES: readonly SchoolLikeRule[] = [
  { pattern: "서울대%", result: "서연고" },
  { pattern: "연세대%", result: "서연고" },
  { pattern: "고려대%", result: "서연고" },
  { pattern: "서강대%", result: "서성한" },
  { pattern: "성균관대%", result: "서성한" },
  { pattern: "한양대%", result: "서성한" },
  { pattern: "중앙대%", result: "중경외시" },
  { pattern: "경희대%", result: "중경외시" },
  { pattern: "한국외%", result: "중경외시" },
  { pattern: "서울시립대%", result: "중경외시" },
  { pattern: "건국대%", result: "건동홍" },
  { pattern: "동국대%", result: "건동홍" },
  { pattern: "홍익대%", result: "건동홍" },
];
export const SCHOOL_TIER_LIKE_FALLBACK = SCHOOL_TIER_UNCLASSIFIED;

/** `major_category_suggest(p_department_name)` — 포함 LIKE(`%x%`). 순서 = CASE 순서. 어느 것도 아니면 기타. */
export const MAJOR_CATEGORY_LIKE_RULES: readonly SchoolLikeRule[] = [
  { pattern: "%의예%", result: "메디컬" },
  { pattern: "%의학%", result: "메디컬" },
  { pattern: "%치의%", result: "메디컬" },
  { pattern: "%약학%", result: "메디컬" },
  { pattern: "%한의%", result: "메디컬" },
  { pattern: "%수의%", result: "메디컬" },
  { pattern: "%간호%", result: "메디컬" },
  { pattern: "%교육%", result: "교육" },
  { pattern: "%국어국문%", result: "인문" },
  { pattern: "%문헌정보%", result: "인문" },
  { pattern: "%철학%", result: "인문" },
  { pattern: "%사학%", result: "인문" },
  { pattern: "%어문%", result: "인문" },
  { pattern: "%경영%", result: "사회상경" },
  { pattern: "%경제%", result: "사회상경" },
  { pattern: "%미디어%", result: "사회상경" },
  { pattern: "%정치%", result: "사회상경" },
  { pattern: "%사회학%", result: "사회상경" },
  { pattern: "%행정%", result: "사회상경" },
  { pattern: "%심리%", result: "사회상경" },
  { pattern: "%수학%", result: "자연" },
  { pattern: "%물리%", result: "자연" },
  { pattern: "%화학%", result: "자연" },
  { pattern: "%생명%", result: "자연" },
  { pattern: "%통계%", result: "자연" },
  { pattern: "%공학%", result: "공학" },
  { pattern: "%컴퓨터%", result: "공학" },
  { pattern: "%전자%", result: "공학" },
  { pattern: "%기계%", result: "공학" },
  { pattern: "%소프트웨어%", result: "공학" },
  { pattern: "%모빌리티%", result: "공학" },
  { pattern: "%융합%", result: "공학" },
  { pattern: "%음악%", result: "예체능" },
  { pattern: "%미술%", result: "예체능" },
  { pattern: "%체육%", result: "예체능" },
  { pattern: "%디자인%", result: "예체능" },
];
export const MAJOR_CATEGORY_LIKE_FALLBACK = MAJOR_CATEGORY_OTHER;

export const SCHOOL_RULE_SOURCE = {
  tierFunction: "school_tier_suggest",
  majorFunction: "major_category_suggest",
  trigger: "trg_auto_school_verification",
  reassessTrigger: "trg_school_verification_reassess_on_academic_change",
  migration: "supabase/sql/192_school_verification_provisional_rule.sql",
} as const;

export const SCHOOL_RULE_HARDCODED_NOTICE = "판정 규칙은 DB 트리거에 고정돼 있습니다. 이 표를 수정해도 판정이 바뀌지 않습니다.";
export const SCHOOL_MAPPING_READONLY_NOTE =
  "학교명 → 학교군 매핑(school_tier_mappings)은 트리거·RPC·화면 어디서도 읽지 않습니다(읽는 코드 0). 표는 읽기 전용이며 트리거 연동은 DB-2 항목입니다.";

/** SQL LIKE 흉내 — 앞·뒤 `%` 만 지원(192 의 패턴이 그 둘뿐이다). 표시용. */
export function matchSqlLike(value: string | null | undefined, pattern: string): boolean {
  const v = String(value ?? "");
  const startsWild = pattern.startsWith("%");
  const endsWild = pattern.endsWith("%");
  const core = pattern.slice(startsWild ? 1 : 0, endsWild ? pattern.length - 1 : pattern.length);
  if (!core) return true;
  if (startsWild && endsWild) return v.includes(core);
  if (endsWild) return v.startsWith(core);
  if (startsWild) return v.endsWith(core);
  return v === core;
}

/** 표시용 판정(정본은 DB `school_tier_suggest`). null·빈 값은 미분류. */
export function schoolTierByLikeRules(universityName: string | null | undefined): string {
  for (const rule of SCHOOL_TIER_LIKE_RULES) if (matchSqlLike(universityName, rule.pattern)) return rule.result;
  return SCHOOL_TIER_LIKE_FALLBACK;
}

export function majorCategoryByLikeRules(departmentName: string | null | undefined): string {
  for (const rule of MAJOR_CATEGORY_LIKE_RULES) if (matchSqlLike(departmentName, rule.pattern)) return rule.result;
  return MAJOR_CATEGORY_LIKE_FALLBACK;
}

// ── 정정 경로 — 확정 RPC 한 경로(PR-W1 · SQL 193 A-2) ──────────────────────────────

/** 미분류 목록의 정정 버튼이 넘기는 등급 — 새 폴백 '그외'. 다른 등급은 계정 상세(멘토 탭) 드롭다운으로 정정한다. */
export const SCHOOL_TIER_CORRECTION_TARGET = SCHOOL_TIER_OTHER;
export const SCHOOL_TIER_CORRECTION_BUTTON_LABEL = "등급 정정";
export const SCHOOL_TIER_CORRECTION_DIALOG_TITLE = "학교 등급 정정";
export const SCHOOL_TIER_CORRECTION_PENDING_LABEL = "정정 중…";
export const SCHOOL_TIER_CORRECTION_NOTE = "확정된 등급도 정정할 수 있습니다.";
export const SCHOOL_TIER_CORRECTION_DETAIL =
  "정정은 확정 RPC approve_mentor_school_verification_admin 과 같은 경로입니다 — 등급을 '그외'로 바꾸고 reviewed_by·reviewed_at 을 새로 기록하며 이전 등급·확정자는 감사 로그(school_tier_corrected)에 남습니다. 다른 등급으로 바꾸려면 계정 상세(멘토 탭)에서 정정하세요. DB-2(SQL 193) 적용 전에는 확정된 행의 정정이 NOT_REVIEWABLE 로 거절됩니다(처리 실패 표시 · 데이터 불변).";
/** 학교·학과·계열이 비어 RPC 가 INVALID_INPUT 으로 거절할 행 — 버튼 대신 안내 */
export const SCHOOL_TIER_CORRECTION_UNAVAILABLE_LABEL = "학교·학과 미입력 — 계정 상세에서 정정";

/** 서버 액션(`approveMentorSchoolVerificationAction`)이 읽는 폼 필드명 — 계약 테스트가 액션 원문과 대조한다. */
export const SCHOOL_TIER_CORRECTION_FORM_FIELDS = {
  verificationId: "verificationId",
  verifiedUniversityName: "verifiedUniversityName",
  verifiedUniversityId: "verifiedUniversityId",
  verifiedDepartmentName: "verifiedDepartmentName",
  verifiedMajorCategory: "verifiedMajorCategory",
  schoolTier: "schoolTier",
} as const;

export type SchoolTierCorrectionFormValues = Record<keyof typeof SCHOOL_TIER_CORRECTION_FORM_FIELDS, string>;

/** 정정 summary — `김OO 멘토의 등급을 미분류 → 그외로 정정합니다.` */
export function buildSchoolTierCorrectionSummary(displayName: string, fromTier: string, toTier: string = SCHOOL_TIER_CORRECTION_TARGET): string {
  return `${displayName} 멘토의 등급을 ${fromTier} → ${toTier}로 정정합니다.`;
}

/** 정정 폼 값 — 인증 행의 verified_* 값(없으면 프로필 값)을 그대로 넘긴다. 학교·학과·계열이 비면 null(RPC INVALID_INPUT 방지). */
export function schoolTierCorrectionFormValues(item: UnclassifiedMentorItem): SchoolTierCorrectionFormValues | null {
  const university = String(item.verifiedUniversityName ?? "").trim();
  const department = String(item.verifiedDepartmentName ?? "").trim();
  const category = String(item.verifiedMajorCategory ?? "").trim();
  if (!item.verificationId || !university || !department || !category) return null;
  return {
    verificationId: item.verificationId,
    verifiedUniversityName: university,
    verifiedUniversityId: String(item.verifiedUniversityId ?? "").trim(),
    verifiedDepartmentName: department,
    verifiedMajorCategory: category,
    schoolTier: SCHOOL_TIER_CORRECTION_TARGET,
  };
}

// ── 분포 · 미분류 목록 ─────────────────────────────────────────────────────────

export type SchoolTierDistributionRow = { tier: string; label: string; count: number };

/** 확정 승인 행(approved · 멘토당 1행)의 등급별 건수 — 사전 순서. 사전 밖 값은 뒤에 원시 값으로. */
export function buildSchoolTierDistribution(rows: readonly { school_tier: string | null }[]): SchoolTierDistributionRow[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const t = String(r.school_tier ?? "").trim() || SCHOOL_TIER_UNCLASSIFIED;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const out: SchoolTierDistributionRow[] = SCHOOL_TIER_VALUES.map((tier) => ({ tier, label: schoolTierLabel(tier), count: counts.get(tier) ?? 0 }));
  for (const [tier, count] of counts) {
    if (!SCHOOL_TIER_VALUES.includes(tier)) out.push({ tier, label: tier, count });
  }
  return out;
}

export function formatSchoolTierDistribution(rows: readonly SchoolTierDistributionRow[]): string {
  return rows.map((r) => `${r.label} ${r.count}명`).join(" · ");
}

export type UnclassifiedMentorItem = {
  verificationId: string;
  mentorId: string;
  name: string;
  /** 멘토가 입력한 대학명(`mentor_profiles.university_name`) — 그대로 보여준다 */
  universityName: string;
  departmentName: string;
  reviewerName: string | null;
  reviewedAt: string | null;
  /** `reviewed_by IS NOT NULL` */
  confirmed: boolean;
  /** 인증 행의 verified_* 값(없으면 프로필 값) — 정정 폼이 RPC 에 그대로 넘긴다 */
  verifiedUniversityName: string | null;
  verifiedUniversityId: string | null;
  verifiedDepartmentName: string | null;
  verifiedMajorCategory: string | null;
  /** 현재 등급(목록은 미분류만 담는다) */
  tier: string;
};

/** 대학명 → 이름 순. 같은 대학이 묶여 보이게. */
export function sortUnclassifiedMentors(items: readonly UnclassifiedMentorItem[]): UnclassifiedMentorItem[] {
  return [...items].sort((a, b) => a.universityName.localeCompare(b.universityName, "ko") || a.name.localeCompare(b.name, "ko"));
}

export function unclassifiedMentorAccountUrl(mentorId: string): string {
  return buildAccountDetailUrl(mentorId, { tab: "mentor" });
}

export const SCHOOL_UNCLASSIFIED_EMPTY_STATE = {
  title: "미분류 멘토가 없습니다",
  description: "확정된 학교 등급이 전부 서연고·서성한·중경외시·건동홍·그외 중 하나입니다.",
} as const;

export const SCHOOL_MAPPING_EMPTY_LABEL = "등록된 학교군 매핑이 없습니다.";

// ── 분교 확인(§3-2) — 트리거 접두 LIKE 는 `연세대%` 가 `연세대학교 미래캠퍼스` 도 서연고로 잡는다 ────

export const BRANCH_CAMPUS_PATTERN = /캠퍼스|분교/;
/** 본교 표기로 보이는 캠퍼스 이름 — 힌트 전용(판정 아님) */
export const MAIN_CAMPUS_PATTERN = /서울캠퍼스|신촌캠퍼스|관악캠퍼스|본교/;

export type BranchCampusHint = "main" | "check";

/** 캠퍼스·분교 표기가 있고 규칙상 미분류가 아닌 대학명만 목록에 올린다. */
export function isBranchCampusSuspect(universityName: string | null | undefined, tier: string | null | undefined): boolean {
  const name = String(universityName ?? "");
  return BRANCH_CAMPUS_PATTERN.test(name) && String(tier ?? "") !== SCHOOL_TIER_UNCLASSIFIED;
}

export function branchCampusHint(universityName: string | null | undefined): BranchCampusHint {
  return MAIN_CAMPUS_PATTERN.test(String(universityName ?? "")) ? "main" : "check";
}

export const BRANCH_CAMPUS_HINT_LABELS: Readonly<Record<BranchCampusHint, string>> = {
  main: "본교 표기",
  check: "분교 여부 확인",
};

export const BRANCH_CAMPUS_NOTE = "접두 LIKE 는 분교·이원화 캠퍼스를 구분하지 않습니다. 규칙 수정은 DB 작업입니다.";
