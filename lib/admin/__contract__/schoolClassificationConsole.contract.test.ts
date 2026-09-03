// 계약 테스트: 등급 분류 화면(PR-11 §3 · PR-W1 정정 · PR-W2) — §0-B-1(트리거는 LIKE 하드코딩)과 정정 경로(확정 RPC 한 경로 · 미분류 목록의
// 등급 정정 버튼 = 같은 RPC 액션 · '그외')를 코드·SQL 로 고정하고, 화면의 LIKE 규칙 표가 SQL 193(school_tier_suggest — 폴백 그외 · NULL/공백 미분류)·
// SQL 192(major_category_suggest) 원문과 같은지, 매핑 표(SQL 195 DROP) 참조가 0인지, 정정 폼 외 편집 폼이 없는지, 미분류 목록이 맨 위인지 대조한다.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/schoolClassificationConsole.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { adminStatusAllowedValues } from "../adminStatusDictionary.ts";
import { SCHOOL_TIERS, VERIFIED_MAJOR_CATEGORIES } from "../../mentor/schoolVerificationConstants.ts";
import {
  BRANCH_CAMPUS_HINT_LABELS,
  MAJOR_CATEGORY_LIKE_FALLBACK,
  MAJOR_CATEGORY_LIKE_RULES,
  MAJOR_CATEGORY_VALUES,
  SCHOOL_CATALOG_FIXED_NOTICE,
  SCHOOL_RULE_HARDCODED_NOTICE,
  SCHOOL_RULE_SOURCE,
  SCHOOL_TIER_CORRECTION_BUTTON_LABEL,
  SCHOOL_TIER_CORRECTION_DETAIL,
  SCHOOL_TIER_CORRECTION_FORM_FIELDS,
  SCHOOL_TIER_CORRECTION_NOTE,
  SCHOOL_TIER_CORRECTION_TARGET,
  SCHOOL_TIER_CORRECTION_UNAVAILABLE_LABEL,
  SCHOOL_TIER_LIKE_BLANK_RESULT,
  SCHOOL_TIER_LIKE_FALLBACK,
  SCHOOL_TIER_LIKE_RULES,
  SCHOOL_TIER_OTHER,
  SCHOOL_TIER_UNCLASSIFIED,
  SCHOOL_TIER_VALUES,
  SCHOOL_UNCLASSIFIED_EMPTY_STATE,
  branchCampusHint,
  buildSchoolTierCorrectionSummary,
  buildSchoolTierDistribution,
  formatSchoolTierDistribution,
  isBranchCampusSuspect,
  majorCategoryByLikeRules,
  matchSqlLike,
  schoolTierByLikeRules,
  schoolTierCorrectionFormValues,
  sortUnclassifiedMentors,
  unclassifiedMentorAccountUrl,
  type UnclassifiedMentorItem,
} from "../schoolClassificationConsole.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGE = "app/(admin)/admin/(console)/school-classifications/page.tsx";
const LOADING = "app/(admin)/admin/(console)/school-classifications/loading.tsx";
const PANELS = "components/admin/SchoolClassificationPanels.tsx";
const CONSOLE = "lib/admin/schoolClassificationConsole.ts";
const QUERIES = "lib/admin/schoolClassificationQueries.ts";
const SQL_192 = "supabase/sql/192_school_verification_provisional_rule.sql";
const SQL_193 = "supabase/sql/193_school_tier_fallback_other_and_correction.sql";
const RPC_ACTIONS = "lib/admin/mentorSchoolVerificationReviewActions.ts";
const TIER_REVIEW = "lib/admin/mentorSchoolTierReview.ts";

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** SQL 함수 본문의 CASE — `when … like '…' [or … like '…'] then '결과'` 를 순서대로 뽑는다(LIKE 가 없는 분기(NULL·공백)는 blank 로). */
function likeRulesFromSql(file: string, fnName: string): { rules: { pattern: string; result: string }[]; fallback: string; blank: string | null } {
  const sql = read(file);
  const start = sql.indexOf(`create or replace function public.${fnName}(`);
  assert.ok(start >= 0, `${fnName} 정의(${file})`);
  const body = sql.slice(start, sql.indexOf("$$;", start));
  const rules: { pattern: string; result: string }[] = [];
  let blank: string | null = null;
  for (const m of body.matchAll(/when\s+([\s\S]*?)\s+then\s+'([^']+)'/g)) {
    const likes = [...m[1].matchAll(/like\s+'([^']+)'/g)];
    if (!likes.length && /is null/.test(m[1])) blank = m[2];
    for (const p of likes) rules.push({ pattern: p[1], result: m[2] });
  }
  const fallback = body.match(/else\s+'([^']+)'/)?.[1] ?? "";
  return { rules, fallback, blank };
}

// ── §0-B-1 트리거는 LIKE 하드코딩 — 화면 표 == SQL 192 원문 ───────────────────

test("§0-B-1: school_tier_suggest(SQL 193)·major_category_suggest(SQL 192)는 LIKE 하드코딩 · auto_school_verification 트리거가 그 헬퍼를 부른다 · 매핑 표(SQL 195 DROP) 참조 0", () => {
  const sql = read(SQL_192);
  const sql193 = read(SQL_193);
  const tierFn = sql193.slice(sql193.indexOf("create or replace function public.school_tier_suggest("), sql193.indexOf("$$;", sql193.indexOf("create or replace function public.school_tier_suggest(")));
  const autoFn = sql.slice(sql.indexOf("create or replace function public.auto_school_verification("), sql.indexOf("$$;", sql.indexOf("create or replace function public.auto_school_verification(")));
  assert.ok(tierFn.length > 0 && !tierFn.includes("school_tier_mappings") && !autoFn.includes("school_tier_mappings"), "매핑 표 참조 없음");
  assert.ok(autoFn.includes("public.school_tier_suggest(new.university_name)") && autoFn.includes("public.major_category_suggest(new.department_name)"));
  assert.ok(sql.includes("create trigger trg_auto_school_verification") && sql.includes("execute function public.auto_school_verification()"));
  assert.equal(SCHOOL_RULE_SOURCE.trigger, "trg_auto_school_verification");
  assert.equal(SCHOOL_RULE_SOURCE.migration, SQL_192);
  assert.equal(SCHOOL_RULE_SOURCE.tierMigration, SQL_193);
  assert.ok(existsSync(join(ROOT, "supabase/sql/195_drop_school_tier_mappings.sql")), "매핑 표 DROP(DB-2 C)");
  // 저장소 어디에서도 매핑 표를 읽지 않는다 — 테이블이 없으므로(SQL 195) 로더·액션·화면 섹션도 PR-W2 에서 내렸다
  const files = [...walk(join(ROOT, "lib"), []), ...walk(join(ROOT, "app"), []), ...walk(join(ROOT, "components"), [])].filter((f) => !f.includes("__contract__"));
  const readers = files.filter((f) => stripComments(readFileSync(f, "utf8")).includes("school_tier_mappings")).map((f) => f.slice(ROOT.length).replace(/\\/g, "/").replace(/^\//, "")).sort();
  assert.deepEqual(readers, [], "school_tier_mappings 를 참조하는 TS 0");
  for (const sym of ["findSchoolTierMappingForSchool", "loadSchoolTierMappings", "SchoolTierMappingRow", "SchoolClassificationMappingTable", "upsertSchoolTierMappingAction"]) {
    assert.deepEqual(files.filter((f) => stripComments(readFileSync(f, "utf8")).includes(sym)).map((f) => f.slice(ROOT.length)), [], `${sym} 제거`);
  }
});

test("화면의 LIKE 규칙 표 == SQL 원문(순서·패턴·결과·else) — 학교 등급 13(SQL 193 · 폴백 그외 · NULL/공백 미분류) · 전공 계열 36(SQL 192 · 폴백 기타)", () => {
  const tier = likeRulesFromSql(SQL_193, "school_tier_suggest");
  assert.deepEqual([...SCHOOL_TIER_LIKE_RULES], tier.rules);
  assert.equal(SCHOOL_TIER_LIKE_FALLBACK, tier.fallback);
  assert.equal(SCHOOL_TIER_LIKE_FALLBACK, SCHOOL_TIER_OTHER, "DB-2 SQL 193: 규칙 밖 대학은 그외");
  assert.equal(tier.blank, SCHOOL_TIER_LIKE_BLANK_RESULT);
  assert.equal(SCHOOL_TIER_LIKE_BLANK_RESULT, SCHOOL_TIER_UNCLASSIFIED, "대학명 NULL·공백만 미분류");
  assert.equal(SCHOOL_TIER_LIKE_RULES.length, 13);
  const major = likeRulesFromSql(SQL_192, "major_category_suggest");
  assert.deepEqual([...MAJOR_CATEGORY_LIKE_RULES], major.rules);
  assert.equal(MAJOR_CATEGORY_LIKE_FALLBACK, major.fallback);
  assert.equal(major.blank, null);
  assert.equal(MAJOR_CATEGORY_LIKE_RULES.length, 36);
  for (const r of [...SCHOOL_TIER_LIKE_RULES, ...MAJOR_CATEGORY_LIKE_RULES]) assert.ok(SCHOOL_TIER_VALUES.includes(r.result) || MAJOR_CATEGORY_VALUES.includes(r.result), r.result);
  assert.ok(SCHOOL_TIER_LIKE_RULES.every((r) => r.pattern.endsWith("%") && !r.pattern.startsWith("%")), "학교 등급은 접두 LIKE");
  assert.ok(MAJOR_CATEGORY_LIKE_RULES.every((r) => r.pattern.startsWith("%") && r.pattern.endsWith("%")), "전공 계열은 포함 LIKE");
});

test("표시용 LIKE 흉내는 SQL 193/192 자가 검증 예와 같다: 성균관대학교→서성한 · null/공백→미분류 · 가천대학교→그외 · 의예과→메디컬 · null→기타 · 접두/포함 의미", () => {
  assert.equal(schoolTierByLikeRules("성균관대학교"), "서성한");
  assert.equal(schoolTierByLikeRules(null), SCHOOL_TIER_UNCLASSIFIED);
  assert.equal(schoolTierByLikeRules("   "), SCHOOL_TIER_UNCLASSIFIED, "공백도 대학명 없음");
  assert.equal(schoolTierByLikeRules("가천대학교"), SCHOOL_TIER_OTHER, "규칙 밖 대학은 그외(193)");
  assert.equal(schoolTierByLikeRules("연세대학교 미래캠퍼스"), "서연고", "접두 LIKE 는 분교를 구분하지 못한다(§3-2)");
  assert.equal(majorCategoryByLikeRules("의예과"), "메디컬");
  assert.equal(majorCategoryByLikeRules(null), "기타");
  assert.equal(majorCategoryByLikeRules("스마트모빌리티학부"), "공학");
  assert.equal(matchSqlLike("서울대학교", "서울대%"), true);
  assert.equal(matchSqlLike("국립서울대", "서울대%"), false);
  assert.equal(matchSqlLike("정경대학 경제학과", "%경제%"), true);
  assert.equal(matchSqlLike("경제", "%경제%"), true);
  assert.equal(matchSqlLike("x", "%"), true);
});

// ── 정정 경로(PR-W1) — 확정 RPC 한 경로 · 미분류 목록의 등급 정정 버튼 ─────────────

test("정정 경로(PR-W1): 확정 RPC 한 경로 — 확정된 approved 잠금 폐기 · 반려·재제출 액션 불변 · 관리자 코드에 다른 갱신 경로 없음 · 미분류 목록의 등급 정정 = 같은 RPC 액션('그외' · 폼 필드 = 액션이 읽는 키)", () => {
  const sql = read(SQL_192);
  assert.ok(sql.includes("raise exception 'NOT_REVIEWABLE: %'"), "rejected·superseded 는 여전히 NOT_REVIEWABLE");
  const actions = stripComments(read(RPC_ACTIONS));
  assert.ok(actions.includes('const REVIEWABLE_STATUSES = ["pending", "resubmit_required"] as const;') && actions.includes('.in("status", [...REVIEWABLE_STATUSES])'), "반려·재제출은 pending·resubmit_required 만");
  const review = stripComments(read(TIER_REVIEW));
  assert.ok(!review.includes("already_confirmed") && review.includes("SCHOOL_TIER_CONFIRMABLE_STATUSES"), "PR-W1: 확정된 행(approved · reviewed_by) 잠금 폐기 — 정정 가능");
  const adminFiles = walk(join(ROOT, "lib", "admin"), []).filter((f) => !f.includes("__contract__"));
  // `.from(TABLE)` 상수 참조(반려·재제출 액션)까지 잡는다 — 테이블명이 리터럴이든 상수든 갱신 체인이면 대상.
  const updaters = adminFiles
    .filter((f) => {
      const code = stripComments(readFileSync(f, "utf8"));
      return code.includes("mentor_school_verifications") && /\.from\((TABLE|"mentor_school_verifications")\)\s*\.\s*(update|upsert|delete)\(/.test(code);
    })
    .map((f) => f.slice(ROOT.length).replace(/\\/g, "/").replace(/^\//, ""));
  assert.deepEqual(updaters, ["lib/admin/mentorSchoolVerificationReviewActions.ts"], "관리자 쪽 직접 갱신 경로는 반려·재제출 액션뿐(정정은 RPC)");
  // 정정 버튼 계약 — 지시서: `등급 정정` · stateChange · summary `김OO 멘토의 등급을 미분류 → 그외로 정정합니다`
  assert.equal(SCHOOL_TIER_CORRECTION_BUTTON_LABEL, "등급 정정");
  assert.equal(SCHOOL_TIER_CORRECTION_TARGET, "그외");
  assert.equal(buildSchoolTierCorrectionSummary("김OO", "미분류"), "김OO 멘토의 등급을 미분류 → 그외로 정정합니다.");
  assert.ok(SCHOOL_TIER_CORRECTION_NOTE.includes("정정") && SCHOOL_TIER_CORRECTION_DETAIL.includes("approve_mentor_school_verification_admin"));
  assert.ok(!SCHOOL_TIER_CORRECTION_DETAIL.includes("적용 전") && !SCHOOL_TIER_CORRECTION_DETAIL.includes("NOT_REVIEWABLE"), "DB-2 적용 완료 — 적용 전 안내 문구 제거(PR-W2)");
  assert.equal(SCHOOL_TIER_CORRECTION_UNAVAILABLE_LABEL, "학교·학과 미입력 — 계정 상세에서 정정");
  // 폼 필드명 == 서버 액션(approveMentorSchoolVerificationAction)이 formData.get 으로 읽는 키 전부
  const fnStart = actions.indexOf("export async function approveMentorSchoolVerificationAction");
  const fnEnd = actions.indexOf("export async function", fnStart + 1);
  assert.ok(fnStart >= 0 && fnEnd > fnStart);
  const keys = [...actions.slice(fnStart, fnEnd).matchAll(/formData\.get\("(\w+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, [...Object.values(SCHOOL_TIER_CORRECTION_FORM_FIELDS)].sort());
  assert.deepEqual(Object.keys(SCHOOL_TIER_CORRECTION_FORM_FIELDS), [...Object.values(SCHOOL_TIER_CORRECTION_FORM_FIELDS)]);
  // 폼 값: 인증 행 값 그대로 · 등급은 그외 · 학교/학과/계열이 비면 null(RPC INVALID_INPUT 방지 → 안내)
  const base: UnclassifiedMentorItem = {
    verificationId: "v1",
    mentorId: "m1",
    name: "김OO",
    universityName: "가천대학교",
    departmentName: "의예과",
    reviewerName: "관리자",
    reviewedAt: "2026-09-03T02:58:53Z",
    confirmed: true,
    verifiedUniversityName: "가천대학교",
    verifiedUniversityId: null,
    verifiedDepartmentName: "의예과",
    verifiedMajorCategory: "메디컬",
    tier: "미분류",
  };
  assert.deepEqual(schoolTierCorrectionFormValues(base), {
    verificationId: "v1",
    verifiedUniversityName: "가천대학교",
    verifiedUniversityId: "",
    verifiedDepartmentName: "의예과",
    verifiedMajorCategory: "메디컬",
    schoolTier: "그외",
  });
  assert.deepEqual(schoolTierCorrectionFormValues({ ...base, verifiedUniversityId: "gachon" })?.verifiedUniversityId, "gachon");
  assert.equal(schoolTierCorrectionFormValues({ ...base, verifiedUniversityName: "  " }), null);
  assert.equal(schoolTierCorrectionFormValues({ ...base, verifiedDepartmentName: null }), null);
  assert.equal(schoolTierCorrectionFormValues({ ...base, verifiedMajorCategory: null }), null);
});

// ── 카탈로그 · 분포 · 미분류 · 분교 ─────────────────────────────────────────

test("카탈로그 = 상태 사전(= DB CHECK) = 077 상수: 학교 등급 6 · 전공 계열 8 · 고정 안내 문구", () => {
  assert.deepEqual([...SCHOOL_TIER_VALUES], adminStatusAllowedValues("mentor_school_verifications", "school_tier"));
  assert.deepEqual([...SCHOOL_TIER_VALUES].sort(), [...SCHOOL_TIERS].sort());
  assert.deepEqual([...MAJOR_CATEGORY_VALUES], adminStatusAllowedValues("mentor_school_verifications", "verified_major_category"));
  assert.deepEqual([...MAJOR_CATEGORY_VALUES].sort(), [...VERIFIED_MAJOR_CATEGORIES].sort());
  assert.deepEqual([...SCHOOL_TIER_VALUES], ["서연고", "서성한", "중경외시", "건동홍", "그외", "미분류"]);
  assert.equal(SCHOOL_CATALOG_FIXED_NOTICE, "DB CHECK 제약으로 고정된 값입니다.");
  assert.equal(SCHOOL_RULE_HARDCODED_NOTICE, "판정 규칙은 DB 트리거에 고정돼 있습니다. 이 표를 수정해도 판정이 바뀌지 않습니다.");
});

test("등급별 분포는 사전 순서 6칸(0 포함) + 사전 밖 값 · 한 줄 표기 · 미분류 목록 정렬(대학명 → 이름) · 계정 상세(멘토 탭) 링크 · 빈 상태", () => {
  const rows = buildSchoolTierDistribution([{ school_tier: "서연고" }, { school_tier: "서연고" }, { school_tier: "미분류" }, { school_tier: null }, { school_tier: "이상값" }]);
  assert.deepEqual(rows.map((r) => [r.tier, r.count]), [["서연고", 2], ["서성한", 0], ["중경외시", 0], ["건동홍", 0], ["그외", 0], ["미분류", 2], ["이상값", 1]]);
  assert.equal(formatSchoolTierDistribution(rows.slice(0, 6)), "서연고 2명 · 서성한 0명 · 중경외시 0명 · 건동홍 0명 · 그외 0명 · 미분류 2명");
  const item = (name: string, uni: string): UnclassifiedMentorItem => ({
    verificationId: `v-${name}`,
    mentorId: `m-${name}`,
    name,
    universityName: uni,
    departmentName: "의예과",
    reviewerName: "관리자",
    reviewedAt: null,
    confirmed: true,
    verifiedUniversityName: uni,
    verifiedUniversityId: null,
    verifiedDepartmentName: "의예과",
    verifiedMajorCategory: "메디컬",
    tier: "미분류",
  });
  assert.deepEqual(sortUnclassifiedMentors([item("나", "계명대학교"), item("가", "계명대학교"), item("다", "가천대학교")]).map((i) => i.name), ["다", "가", "나"]);
  assert.equal(unclassifiedMentorAccountUrl("u1"), "/admin/users/u1?tab=mentor");
  assert.equal(SCHOOL_UNCLASSIFIED_EMPTY_STATE.title, "미분류 멘토가 없습니다");
});

test("분교 확인(§3-2): 캠퍼스·분교 표기 + 미분류가 아닌 등급만 후보 · 서울/신촌/관악/본교 표기는 '본교 표기' 힌트, 그 외 '분교 여부 확인'", () => {
  assert.equal(isBranchCampusSuspect("연세대학교 미래캠퍼스", "서연고"), true);
  assert.equal(isBranchCampusSuspect("연세대학교 신촌캠퍼스", "서연고"), true, "표기가 있으면 목록에 올리고 힌트로 구분");
  assert.equal(isBranchCampusSuspect("연세대학교", "서연고"), false);
  assert.equal(isBranchCampusSuspect("가천대학교 글로벌캠퍼스", "미분류"), false, "미분류는 규칙이 잡지 않았으므로 제외");
  assert.equal(branchCampusHint("연세대학교 신촌캠퍼스"), "main");
  assert.equal(branchCampusHint("고려대학교 서울캠퍼스"), "main");
  assert.equal(branchCampusHint("연세대학교 미래캠퍼스"), "check");
  assert.deepEqual(BRANCH_CAMPUS_HINT_LABELS, { main: "본교 표기", check: "분교 여부 확인" });
});

// ── tripwire ────────────────────────────────────────────────────────────────

test("페이지: PageScaffold 미사용 · AdminPageLayout · 편집 액션 import 0 · 미분류 목록이 첫 섹션 · 5섹션 순서(매핑 섹션 제거 — PR-W2) · loading.tsx", () => {
  const page = stripComments(read(PAGE));
  assert.ok(!page.includes("PageScaffold") && !page.includes("FormSubmitButton") && !page.includes("schoolClassificationActions"), "편집 폼·액션 없음(§8-3)");
  assert.ok(page.includes("<AdminPageLayout") && page.includes("loadSchoolClassificationOverview(supabase)"));
  const order = ["<SchoolClassificationUnclassifiedTable", "<SchoolClassificationDistribution", "<SchoolClassificationRulesTable", "<SchoolClassificationCatalog", "<SchoolClassificationBranchCampusList"];
  const idx = order.map((s) => page.indexOf(s));
  assert.ok(idx.every((i) => i >= 0), "5섹션 전부");
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, "미분류 목록이 맨 위, 그 순서대로");
  assert.ok(!page.includes("Mapping"), "매핑 섹션·로더 없음(SQL 195)");
  assert.ok(existsSync(join(ROOT, LOADING)));
});

test("섹션 부품: Server Component · 폼은 미분류 행의 등급 정정 하나(approveMentorSchoolVerificationAction · ConfirmSubmitButton stateChange · hidden 6 필드 상수) · 카탈로그 편집 폼 0 · 매핑 섹션 0 · 안내 2종(정정 · 규칙 고정) · LIKE 표 렌더(폴백 그외 · 대학명 없음 미분류) · AdminStatusPill · 조회 모듈은 select 만", () => {
  const src = stripComments(read(PANELS));
  assert.ok(!src.startsWith('"use client"'));
  assert.equal((src.match(/<form\b/g) ?? []).length, 1, "폼은 정정 하나");
  assert.ok(src.includes("action={approveMentorSchoolVerificationAction}"), "정정 = 기존 확정 RPC 액션(새 쓰기 경로 0)");
  assert.equal((src.match(/<ConfirmSubmitButton/g) ?? []).length, 1);
  assert.equal((src.match(/level="stateChange"/g) ?? []).length, 1, "정정은 stateChange(재입력 없음)");
  assert.ok(!src.includes('level="destructive"') && !src.includes('level="critical"'));
  assert.ok(!src.includes("schoolClassificationActions"), "매핑·카탈로그 편집 액션 0(§8-3)");
  for (const k of Object.keys(SCHOOL_TIER_CORRECTION_FORM_FIELDS)) assert.ok(src.includes(`name={SCHOOL_TIER_CORRECTION_FORM_FIELDS.${k}}`), `hidden 필드 ${k}`);
  assert.ok(src.includes("schoolTierCorrectionFormValues(it)") && src.includes("buildSchoolTierCorrectionSummary(it.name, it.tier)"), "폼 값·summary 헬퍼");
  assert.ok(src.includes("confirmLabel={SCHOOL_TIER_CORRECTION_BUTTON_LABEL}") && src.includes("{SCHOOL_TIER_CORRECTION_BUTTON_LABEL}") && src.includes("SCHOOL_TIER_CORRECTION_UNAVAILABLE_LABEL"), "버튼 라벨 상수 · 미입력 안내");
  assert.ok(src.includes("{SCHOOL_TIER_CORRECTION_NOTE} — {SCHOOL_TIER_CORRECTION_DETAIL}") && src.includes("{SCHOOL_RULE_HARDCODED_NOTICE}"));
  assert.ok(!src.includes("Mapping") && !src.includes("SCHOOL_MAPPING"), "매핑 표 섹션 제거(SQL 195)");
  assert.ok(src.includes("SCHOOL_TIER_LIKE_RULES.map") && src.includes("MAJOR_CATEGORY_LIKE_RULES.map"), "트리거 패턴 표");
  assert.ok(src.includes("data-school-rule-blank") && src.includes("value={SCHOOL_TIER_LIKE_BLANK_RESULT}") && src.includes("data-school-rule-fallback") && src.includes("value={SCHOOL_TIER_LIKE_FALLBACK}"), "폴백 두 줄(대학명 없음 → 미분류 · 그 외 → 그외)");
  assert.ok(src.includes("SCHOOL_RULE_SOURCE.tierMigration"), "학교 등급 규칙 출처 = SQL 193");
  assert.ok(src.includes('column="school_tier"') && src.includes('column="verified_major_category"'));
  assert.ok(src.includes("unclassifiedMentorAccountUrl(it.mentorId)"), "미분류 행 → 계정 상세");
  assert.ok(src.includes("SCHOOL_UNCLASSIFIED_EMPTY_STATE.title"));
  const q = stripComments(read(QUERIES));
  assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(q), "조회 전용");
  assert.ok(q.includes('.eq("status", "approved")'), "확정 승인 행 기준");
  assert.ok(q.includes("verified_university_id") && q.includes("verifiedMajorCategory: strOrNull(r.verified_major_category)"), "정정 폼 값을 인증 행에서 읽는다");
  const pure = stripComments(read(CONSOLE));
  assert.ok(!/from "react"|from "@\//.test(pure), "순수 모듈은 React·@/ import 없음");
  const nav = read("components/admin/adminConsoleNavConfig.ts");
  assert.ok(nav.includes('{ href: "/admin/school-classifications", label: "등급 분류", icon: "settings" }'), "나브 라벨 '등급 분류'");
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert)", () => {
  for (const rel of [PAGE, PANELS, CONSOLE, QUERIES]) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) {
      assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    }
  }
});
