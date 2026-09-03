// 계약 테스트: 계정 목록 · 계정 상세 허브(PR-7) — 지시서 §4 검증 항목.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/accountDetailConsole.contract.test.ts
//
// .tsx 는 node --test 로 import 할 수 없으므로(strip-types 는 JSX 미지원):
//   ① 순수 규칙(역할 탭·필터·링크 · 최근 활동 출처 · 상세 탭·헤더 상태축 · 요금제/정원 요약·내역 · 정원 조정 경고 · 조치 등급·필드 · 원장 분류)은 직접 검증한다
//   ② 렌더·배선 규칙은 소스 스캔 tripwire 로 고정한다(신원 블록이 PR-2 와 같은 컴포넌트 · 헤더 상태축 둘 · 목록에 정지·차단 폼 없음 ·
//      AdminDataTable prop 추가 0 · 정원 TS 계산 없음 · 정원 조정 = 기존 액션 재사용 · 옛 라우트 리다이렉트 · 조치 3종 등급·returnTo · 관리자 계정 패널 없음 · 조회 모듈 쓰기 0)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAdminListParams } from "../adminListParams.ts";
import { evaluateAdminConfirm, resolveAdminConfirmRequirements } from "../adminConfirmPolicy.ts";
import { ACCOUNT_SANCTION_CODES, ACCOUNT_SUSPENDED_BLOCKED_SENTENCE, ACCOUNT_SUSPENDED_NOT_BLOCKED_SENTENCE, resolveAccountStatusReturnPath } from "../accountSanctionPolicy.ts";
import { CONTENT_REPORT_WARNING_PRESETS } from "../contentReportSanctionConsole.ts";
import {
  ACCOUNT_BASE_PATH,
  ACCOUNT_BAN_FIELDS,
  ACCOUNT_DEFAULT_PAGE_SIZE,
  ACCOUNT_DEFAULT_STATUS,
  ACCOUNT_DETAIL_ACTIONS,
  ACCOUNT_DETAIL_TAB_PARAM,
  ACCOUNT_IDENTITY_UNVERIFIED_WARNING,
  ACCOUNT_ROLE_PARAM,
  ACCOUNT_ROLE_TABS,
  ACCOUNT_ROLE_TAB_VALUES,
  ACCOUNT_RETURN_TO_FIELD,
  ACCOUNT_STATUS_FILTER_VALUES,
  ACCOUNT_SUSPEND_BLOCKED_MESSAGE,
  ACCOUNT_SUSPEND_CODES,
  ACCOUNT_SUSPEND_DURATION_FIELD,
  ACCOUNT_SUSPEND_REASON_FIELD,
  ACCOUNT_SUSPEND_STATUS_FIELD,
  ACCOUNT_USER_ID_FIELD,
  ACCOUNT_VERIFIED_FILTER_VALUES,
  ACCOUNT_VERIFIED_PARAM,
  ACCOUNT_WARNING_PRESETS,
  ACCOUNT_WARN_REASON_FIELD,
  ACCOUNT_WARN_SEVERITY_FIELD,
  MENTOR_CAP_ADJUST_BLOCKED_MESSAGE,
  MENTOR_CAP_ADJUST_FIELDS,
  MENTOR_PAYOUT_MISSING_WARNING,
  MENTOR_PLAN_MISSING_WARNING,
  STUDENT_BIRTH_DATE_MISSING_WARNING,
  accountActionLogLabel,
  accountActionLogReason,
  accountBanConfirmText,
  accountDetailFlashOkMessage,
  accountDetailPath,
  accountDetailTabsForRole,
  accountDetailUserActionsAvailable,
  accountHeaderAxes,
  accountRoleTabFilter,
  accountSuspendFields,
  buildAccountDetailBanSummary,
  buildAccountDetailSuspendSummary,
  buildAccountDetailUrl,
  buildAccountListUrl,
  buildAccountRoleTabUrl,
  buildMentorCapAdjustSummary,
  buildMentorCapBreakdown,
  capAdjustBelowUsageWarning,
  capBreakdownMatchesUsed,
  capRemainingSeats,
  classifyCashLedgerEntry,
  formatCapBreakdownLine,
  formatCapNumber,
  isUuidLike,
  maskAccountNumber,
  mentorActivitySectionLabel,
  mentorPayoutRegistered,
  mentorPlanSectionSummary,
  mentorPlansMissing,
  parseCapLimitInput,
  planTierLabel,
  resolveAccountDetailTab,
  resolveAccountLastActivity,
  resolveAccountRoleTab,
  resolveAccountStatusFilter,
  resolveAccountVerifiedFilter,
  schoolVerificationSectionLabel,
  studentProfileWarnings,
  type MentorPlanSummaryRow,
} from "../accountDetailConsole.ts";
import { IDENTITY_UNVERIFIED_WARNING } from "../mentorIdentityReview.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const LIST_PAGE = "app/(admin)/admin/(console)/users/page.tsx";
const DETAIL_PAGE = "app/(admin)/admin/(console)/users/[id]/page.tsx";
const LEGACY_ROUTE = "app/(admin)/admin/(console)/mentor-approvals/[id]/page.tsx";
const LIST_TABLE = "components/admin/AccountListTable.tsx";
const HEADER = "components/admin/AccountDetailHeader.tsx";
const IDENTITY_BLOCK = "components/admin/IdentityReviewBlock.tsx";
const PR2_PANEL = "components/admin/MentorApprovalReviewPanel.tsx";
const ACTION_PANEL = "components/admin/AccountActionPanel.tsx";
const MENTOR_TAB = "components/admin/AccountMentorTab.tsx";
const STUDENT_TAB = "components/admin/AccountStudentTab.tsx";
const CAP_FORM = "components/admin/MentorCapAdjustForm.tsx";
const DATA_TABLE = "components/admin/AdminDataTable.tsx";
const CAP_ACTION = "lib/admin/mentorCapAdminActions.ts";
const ACCOUNT_ACTIONS = "lib/admin/accountStatusActions.ts";
const CONSOLE = "lib/admin/accountDetailConsole.ts";
const QUERY_MODULES = ["lib/admin/accountListQueries.ts", "lib/admin/accountDetailQueries.ts", "lib/admin/accountMentorQueries.ts", "lib/admin/accountStudentQueries.ts"];

const UUID = "11111111-1111-4111-8111-111111111111";

function spFrom(url: string): Record<string, string | string[] | undefined> {
  const u = new URL(url, "https://ssambership.local");
  const sp: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of u.searchParams.entries()) sp[k] = v;
  return sp;
}

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__contract__" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

// ── §4 목록: 역할 탭 · 필터 · 검색 · 행 링크 ────────────────────────────────

test("역할 탭은 전체·멘토·학생·관리자 4개(role 키) · 계정 상태(status)·본인인증(verified)은 선택 필터 · 모르는 값은 기본값", () => {
  assert.deepEqual([...ACCOUNT_ROLE_TAB_VALUES], ["all", "mentor", "student", "admin"]);
  assert.deepEqual(ACCOUNT_ROLE_TABS.map((t) => t.label), ["전체", "멘토", "학생", "관리자"]);
  assert.equal(ACCOUNT_ROLE_PARAM, "role");
  assert.equal(resolveAccountRoleTab("mentor"), "mentor");
  assert.equal(resolveAccountRoleTab("ADMIN"), "admin");
  assert.equal(resolveAccountRoleTab("weird"), "all");
  assert.equal(accountRoleTabFilter("all"), null);
  assert.equal(accountRoleTabFilter("student"), "student");
  assert.deepEqual([...ACCOUNT_STATUS_FILTER_VALUES], ["all", "active", "suspended", "banned"]);
  assert.equal(resolveAccountStatusFilter("suspended"), "suspended");
  assert.equal(resolveAccountStatusFilter("deleted"), "all", "사전 4값 중 탈퇴는 필터에 두지 않는다(목록에 없다)");
  assert.deepEqual([...ACCOUNT_VERIFIED_FILTER_VALUES], ["all", "yes", "no"]);
  assert.equal(resolveAccountVerifiedFilter("yes"), "yes");
  assert.equal(resolveAccountVerifiedFilter(""), "all");
  assert.equal(ACCOUNT_DEFAULT_STATUS, "all");
  assert.equal(ACCOUNT_DEFAULT_PAGE_SIZE, 25);
});

test("목록 링크: role·verified 는 extra 로 보존되고 전체 탭은 role 을 지운다 · 검색·필터 변경 시 page 리셋 · status=all 유지(공용 규칙)", () => {
  const opts = { defaultPageSize: ACCOUNT_DEFAULT_PAGE_SIZE, defaultStatus: ACCOUNT_DEFAULT_STATUS };
  const parsed = parseAdminListParams(spFrom(`${ACCOUNT_BASE_PATH}?role=mentor&verified=no&status=suspended&q=%EC%84%9C&page=3`), opts);
  assert.equal(parsed.extra[ACCOUNT_ROLE_PARAM], "mentor", "role 은 예약 키가 아니라 extra");
  assert.equal(parsed.extra[ACCOUNT_VERIFIED_PARAM], "no");
  const studentTab = buildAccountRoleTabUrl(parsed, "student");
  assert.ok(studentTab.includes("role=student") && studentTab.includes("verified=no") && studentTab.includes("status=suspended") && studentTab.includes("q="), studentTab);
  assert.ok(!studentTab.includes("page="), "탭 전환 시 page 리셋");
  const allTab = buildAccountRoleTabUrl(parsed, "all");
  assert.ok(!allTab.includes("role="), `전체 탭은 role 을 지운다: ${allTab}`);
  assert.ok(allTab.includes("verified=no"), "다른 필터는 유지");
  const reset = buildAccountListUrl(parsed, { search: "", status: "all", extra: { ...parsed.extra, [ACCOUNT_VERIFIED_PARAM]: "" } });
  assert.ok(reset.includes("status=all") && reset.includes("role=mentor") && !reset.includes("verified=") && !reset.includes("q="), reset);
  const page2 = buildAccountListUrl(parsed, { page: 2 });
  assert.ok(page2.includes("page=2") && page2.includes("role=mentor") && page2.includes("verified=no"), page2);
  assert.equal(isUuidLike(UUID), true);
  assert.equal(isUuidLike("not-a-uuid"), false);
});

test("최근 활동 = 이 사용자를 대상으로 한 마지막 감사 로그 vs users.updated_at 중 늦은 쪽 — 출처를 함께 돌려준다", () => {
  assert.deepEqual(resolveAccountLastActivity({ updatedAt: "2026-09-01T00:00:00Z", lastAdminLogAt: "2026-09-02T00:00:00Z" }), { at: "2026-09-02T00:00:00Z", source: "audit" });
  assert.deepEqual(resolveAccountLastActivity({ updatedAt: "2026-09-03T00:00:00Z", lastAdminLogAt: "2026-09-02T00:00:00Z" }), { at: "2026-09-03T00:00:00Z", source: "profile" });
  assert.deepEqual(resolveAccountLastActivity({ updatedAt: "2026-09-03T00:00:00Z", lastAdminLogAt: null }), { at: "2026-09-03T00:00:00Z", source: "profile" });
  assert.deepEqual(resolveAccountLastActivity({ updatedAt: null, lastAdminLogAt: null }), { at: null, source: null });
  const q = stripComments(read("lib/admin/accountListQueries.ts"));
  assert.ok(q.includes('.from("admin_action_logs")') && q.includes('.in("target_id", [...ids])'), "감사 로그 대상 시각 조회");
  assert.ok(q.includes("resolveAccountLastActivity({ updatedAt: strOrNull(row.updated_at)"), "updated_at 과 비교");
});

test("목록 화면: 행 이름 → 계정 상세 · 정지·차단·경고 폼 없음 · 역할 탭은 화면이 직접 그린다(AdminDataTable prop 추가 0) · 페이지네이션은 공용 조각", () => {
  const table = stripComments(read(LIST_TABLE));
  assert.ok(table.includes("href={accountDetailPath(item.id)}"), "행 링크");
  assert.ok(!/setUserStatusAction|issueUserWarningAction|formAction=/.test(table), "목록에서 정지·차단·경고 금지");
  assert.ok(table.includes("<AdminDataTable.Pagination") && !table.includes("<AdminDataTable.Tabs") && !table.includes("<AdminDataTable.Counts"), "Tabs/Counts 는 status·pending 키 전용이라 쓰지 않는다");
  assert.ok(table.includes("buildAccountRoleTabUrl(params, t.value)"), "역할 탭 링크");
  assert.ok(table.includes('name="status"') && table.includes("name={ACCOUNT_VERIFIED_PARAM}"), "선택 필터 2종(GET form)");
  const dataTable = stripComments(read(DATA_TABLE));
  assert.ok(!/\?:/.test(dataTable.replace(/\?\?/g, "")), "AdminDataTable 에 선택 prop 이 생기지 않았다");
  assert.ok(!dataTable.includes("role"), "AdminDataTable 은 role 키를 모른다(일반화 prop 추가 없음)");
  const page = stripComments(read(LIST_PAGE));
  assert.ok(page.includes("<AdminPageLayout") && !page.includes("PageScaffold") && !page.includes("AdminListToolbar"), "패턴 A 틀");
  assert.ok(page.includes("parseAdminListParams(sp, { defaultPageSize: ACCOUNT_DEFAULT_PAGE_SIZE, defaultStatus: ACCOUNT_DEFAULT_STATUS })"));
  assert.ok(page.includes("loadAccountList(params, { role: roleTab, verified: verifiedFilter })") && page.includes("countAccountRoleTabs()"), "서버 조회");
});

// ── §4 상세 헤더: 신원 블록 = PR-2 컴포넌트 · 상태축 둘 ─────────────────────

test("신원 블록은 PR-2 승인 패널과 계정 상세 헤더가 같은 컴포넌트(IdentityReviewBlock)를 쓴다 — 4상태 행·경고 마크업은 PR-2 그대로", () => {
  const block = read(IDENTITY_BLOCK);
  const code = stripComments(block);
  assert.ok(!block.startsWith('"use client"'), "Server Component");
  for (const label of ['label="가입 이름"', 'label="인증 실명"', 'label="전화번호"', 'label="생년월일"', 'label="인증 완료"']) assert.ok(code.includes(label), label);
  assert.ok(code.includes("data-identity-kind={identity.kind}") && code.includes('role="status"') && code.includes('role="alert"'), "PR-2 마크업 유지");
  assert.ok(code.includes("unverifiedWarning = IDENTITY_UNVERIFIED_WARNING"), "기본 문장은 PR-2 승인 문장");
  const panel = stripComments(read(PR2_PANEL));
  assert.ok(panel.includes("<IdentityReviewBlock identity={identity} identityError={identityError} />"), "PR-2 패널이 같은 컴포넌트를 쓴다(기본 문장 그대로)");
  assert.ok(!/label="가입 이름"|IDENTITY_UNVERIFIED_WARNING/.test(panel), "PR-2 패널에 인라인 신원 행이 남지 않았다");
  const header = stripComments(read(HEADER));
  assert.ok(header.includes("<IdentityReviewBlock identity={identity} identityError={identityError} unverifiedWarning={ACCOUNT_IDENTITY_UNVERIFIED_WARNING} />"), "헤더는 사실 문장만");
  assert.notEqual(ACCOUNT_IDENTITY_UNVERIFIED_WARNING, IDENTITY_UNVERIFIED_WARNING);
  assert.ok(!ACCOUNT_IDENTITY_UNVERIFIED_WARNING.includes("승인"), "계정 상세는 승인 안내 문장을 쓰지 않는다");
});

test("헤더 상태축은 계정·승인 둘(멘토) / 계정 하나(학생·관리자) — 학교 인증·활동은 섹션 라벨로만", () => {
  assert.deepEqual([...accountHeaderAxes("mentor")], ["account", "approval"]);
  assert.deepEqual([...accountHeaderAxes("student")], ["account"]);
  assert.deepEqual([...accountHeaderAxes("admin")], ["account"]);
  const header = stripComments(read(HEADER));
  assert.ok(header.includes("accountHeaderAxes(user.role)") && header.includes('axes.includes("approval")'), "축은 함수가 정한다");
  assert.ok(!/activity_status|schoolTier|mentorActivitySectionLabel|schoolVerificationSectionLabel/.test(header), "헤더에 학교 인증·활동 축 없음");
  assert.equal(schoolVerificationSectionLabel("confirmed"), "인증: 확정");
  assert.equal(schoolVerificationSectionLabel("auto"), "인증: 자동 판정 · 미확정");
  assert.equal(mentorActivitySectionLabel("paused"), "활동: 일시정지");
  assert.equal(mentorActivitySectionLabel("terminating"), "활동: 종료 예정");
  const mentorTab = stripComments(read(MENTOR_TAB));
  assert.ok(mentorTab.includes("schoolVerificationSectionLabel(") && mentorTab.includes("mentorActivitySectionLabel(activity.state)"), "라벨은 멘토 탭 섹션에");
});

test("상세 탭: 멘토=멘토·담당 학생·개별질문 답변 / 학생=학생·개별질문·구독 멘토 / 관리자=관리자 · 모르는 값은 첫 탭 · PR-8 자리표시자는 전부 열렸다", () => {
  assert.deepEqual(accountDetailTabsForRole("mentor").map((t) => t.value), ["mentor", "students", "answers"]);
  assert.deepEqual(accountDetailTabsForRole("student").map((t) => t.value), ["student", "individual", "mentors"]);
  assert.deepEqual(accountDetailTabsForRole("admin").map((t) => t.value), ["admin"]);
  assert.deepEqual(accountDetailTabsForRole("mentor").map((t) => t.label), ["멘토", "담당 학생", "개별질문 답변"]);
  assert.deepEqual(accountDetailTabsForRole("student").map((t) => t.label), ["학생", "개별질문", "구독 멘토"]);
  for (const t of [...accountDetailTabsForRole("mentor"), ...accountDetailTabsForRole("student")]) assert.ok(!("deferred" in t), `${t.value}: PR-8 자리(deferred) 없음`);
  assert.equal(resolveAccountDetailTab("mentor", "students"), "students");
  assert.equal(resolveAccountDetailTab("mentor", "answers"), "answers");
  assert.equal(resolveAccountDetailTab("mentor", "student"), "mentor", "다른 역할의 탭 값은 첫 탭");
  assert.equal(resolveAccountDetailTab("student", ""), "student");
  assert.equal(buildAccountDetailUrl(UUID, { tab: "mentor", capOk: true }), `/admin/users/${UUID}?tab=mentor&capOk=1`);
  assert.equal(accountDetailPath(UUID), `/admin/users/${UUID}`);
  assert.equal(ACCOUNT_DETAIL_TAB_PARAM, "tab");
  const page = stripComments(read(DETAIL_PAGE));
  assert.ok(!page.includes("AccountDeferredTabNotice") && !page.includes("PR-8에서 열립니다"), "PR-8 자리표시자 제거");
  assert.ok(page.includes("<AccountIndividualQuestionsTab variant={drilldownRole}") && page.includes("<AccountRoomsTab variant={drilldownRole}"), "PR-8 드릴다운 탭 배선");
  assert.ok(page.includes('(role === "student" && tab === "individual") || (role === "mentor" && tab === "answers")'), "개별질문 · 개별질문 답변은 같은 표(질문이 단위)");
  assert.ok(page.includes('(role === "student" && tab === "mentors") || (role === "mentor" && tab === "students")'), "구독 멘토 · 담당 학생은 같은 표(멘토별 화면으로, 방향만 반대)");
});

// ── §4 멘토 탭: 요금제 없음 경고 · 정원 RPC · 내역 합 = 사용량 · 정산 계좌 경고 · 자동 판정 배지 ──

// 픽스처 금액 = 카탈로그 표시가(라이트 29,900 · 스탠다드 84,900 · 프리미엄 174,900). 정본 모듈(`mentorPlanPricing.ts`)은 `@/` import 라 node 에서 못 읽는다.
const FIXTURE_CASH: Record<MentorPlanSummaryRow["tier"], number> = { limited: 29_900, standard: 84_900, premium: 174_900 };
const planRow = (tier: MentorPlanSummaryRow["tier"], over: Partial<MentorPlanSummaryRow> = {}): MentorPlanSummaryRow => ({
  tier,
  label: planTierLabel(tier),
  present: true,
  cashKrw: FIXTURE_CASH[tier],
  fallbackToRecommended: false,
  isActive: true,
  priceUpdatedAt: null,
  ...over,
});

test("요금제: mentor_plans 행이 없으면 `요금제 미설정 — 구독을 받을 수 없습니다` 경고가 섹션 요약·본문에 · 있으면 3종 현재가 요약", () => {
  assert.equal(MENTOR_PLAN_MISSING_WARNING, "요금제 미설정 — 구독을 받을 수 없습니다");
  const none = [planRow("limited", { present: false, cashKrw: null }), planRow("standard", { present: false, cashKrw: null }), planRow("premium", { present: false, cashKrw: null })];
  assert.equal(mentorPlansMissing(none), true);
  assert.equal(mentorPlanSectionSummary(none), MENTOR_PLAN_MISSING_WARNING);
  const all = [planRow("limited"), planRow("standard"), planRow("premium", { isActive: false })];
  assert.equal(mentorPlansMissing(all), false);
  assert.equal(mentorPlanSectionSummary(all), "라이트 29,900캐시 · 스탠다드 84,900캐시 · 프리미엄 174,900캐시(비활성)");
  assert.deepEqual([planTierLabel("limited"), planTierLabel("standard"), planTierLabel("premium")], ["라이트", "스탠다드", "프리미엄"], "표기는 카탈로그 잠금값");
  const tab = stripComments(read(MENTOR_TAB));
  assert.ok(tab.includes("{plansMissing ? (") && tab.includes("data-plan-missing-warning"), "경고 렌더");
  assert.ok(tab.includes("p.band.minCashKrw") && tab.includes("p.band.maxCashKrw"), "허용 범위는 정본 밴드 모듈 값");
  const q = stripComments(read("lib/admin/accountMentorQueries.ts"));
  assert.ok(q.includes('.from("mentor_plans")') && q.includes("mentorPlanCashKrw(row, tier)") && q.includes("mentorSubscriptionPriceRule(tier)"), "현재가·밴드는 정본 함수");
  assert.ok(!/29_900|84_900|174_900|29900|84900|174900/.test(stripComments(read(CONSOLE)) + q + tab), "요금제 금액 상수 사본 없음");
});

test("정원: 사용량·한도는 RPC 값 그대로(TS 계산 없음) · 요금제별 내역 = 활성 구독 수 × RPC 가중치 · 내역 합 = 사용량 · 프리미엄 기준 추가 수용 인원", () => {
  const weights = { limited: 1, standard: 2.5, premium: 4.5 };
  const breakdown = buildMentorCapBreakdown({ activeCountByTier: { limited: 3, standard: 2, premium: 1 }, capWeightByTier: weights });
  assert.ok(breakdown);
  assert.equal(breakdown!.total, 12.5);
  assert.deepEqual(breakdown!.rows.map((r) => [r.tier, r.count, r.weighted]), [["limited", 3, 3], ["standard", 2, 5], ["premium", 1, 4.5]]);
  assert.equal(formatCapBreakdownLine(breakdown!.rows), "라이트 3명(3) · 스탠다드 2명(5) · 프리미엄 1명(4.5)");
  assert.equal(capBreakdownMatchesUsed(breakdown!.total, 12.5), true, "요금제별 내역 합 = 사용량");
  assert.equal(capBreakdownMatchesUsed(breakdown!.total, 12), false);
  assert.equal(capBreakdownMatchesUsed(breakdown!.total, null), false, "사용량 미상이면 판정 불가");
  assert.equal(buildMentorCapBreakdown({ activeCountByTier: { limited: 1 }, capWeightByTier: null }), null, "가중치를 못 읽으면 내역을 지어내지 않는다");
  assert.equal(capRemainingSeats(28, 12.5, 4.5), 3, "프리미엄 기준 3명 더 수용 가능");
  assert.equal(capRemainingSeats(28, 0, 4.5), 6);
  assert.equal(capRemainingSeats(28, 28, 4.5), 0);
  assert.equal(capRemainingSeats(null, 12.5, 4.5), null);
  assert.equal(formatCapNumber(12.5), "12.5");
  assert.equal(formatCapNumber(28), "28");
  assert.equal(formatCapNumber(null), "—");
  const q = stripComments(read("lib/admin/accountMentorQueries.ts"));
  assert.ok(q.includes("loadMentorCapUsage(id)"), "정원은 PR-1b RPC 진입점");
  assert.ok(q.includes("capWeightByTier: cap.capWeightByTier") && q.includes('.ilike("status", "active")'), "가중치는 RPC 표 · 활성 구독은 서버 집계");
  const src = stripComments(read(CONSOLE)) + q + stripComments(read(MENTOR_TAB));
  assert.ok(!/CAP_WEIGHT_BY_TIER|MENTOR_CAP_LIMIT_DEFAULT|premium:\s*4\.5|standard:\s*2\.5/.test(src), "가중치·기본 한도 TS 상수 없음");
  const tab = stripComments(read(MENTOR_TAB));
  assert.ok(tab.includes("formatCapNumber(cap.usedCap)") && tab.includes("formatCapNumber(cap.capLimit)") && tab.includes("data-cap-breakdown-matches={breakdownMatches}"), "RPC 값·내역 일치 표시");
});

test("정산 계좌: 미등록이면 경고 · 계좌번호는 끝 4자리만 · 자동 판정 배지는 PR-2 와 같은 상수", () => {
  assert.equal(MENTOR_PAYOUT_MISSING_WARNING, "정산 계좌 미등록 — 지급이 보류됩니다");
  assert.equal(mentorPayoutRegistered("국민", "123456-01-234567"), true);
  assert.equal(mentorPayoutRegistered("국민", ""), false);
  assert.equal(mentorPayoutRegistered(null, "1234"), false);
  assert.equal(maskAccountNumber("123456-01-234567"), "********4567");
  assert.equal(maskAccountNumber("1234"), "1234");
  assert.equal(maskAccountNumber(""), null);
  const tab = stripComments(read(MENTOR_TAB));
  assert.ok(tab.includes("data-payout-missing-warning") && tab.includes("payout.registered ?"), "미등록 경고 렌더");
  assert.ok(tab.includes("SCHOOL_TIER_BADGE_AUTO") && tab.includes("SCHOOL_TIER_BADGE_CONFIRMED_PREFIX") && tab.includes("data-school-tier-mode={schoolTier.mode}"), "자동 판정·확정 배지");
  assert.ok(tab.includes("approveMentorSchoolVerificationAction") && tab.includes("disabled={!schoolTier.confirmable}") && tab.includes("schoolTierConfirmBlockerMessage("), "등급 확정 = PR-2 와 같은 RPC 액션 · 조건 미충족 잠금 + 이유");
  assert.ok(tab.includes("<DocumentViewer"), "서류는 PR-2 DocumentViewer");
  assert.ok(!/formAction=|setUserStatusAction|issueUserWarningAction/.test(tab.replace(/approveMentorSchoolVerificationAction|updateMentorCapLimitAction/g, "")), "활동 상태에 조치 버튼 없음");
});

// ── §4 정원 조정: 사용량 미만 경고 · 옛 라우트 리다이렉트 · 기존 액션 재사용 ──

test("정원 조정: 현재 사용량보다 낮게 설정하면 summary 에 경고 · 범위 밖 값은 확인 잠금 · stateChange + 사유 · 미도달 라우트의 액션을 그대로 재사용", () => {
  assert.equal(capAdjustBelowUsageWarning(10, 12.5), "새 한도 10 이(가) 현재 사용량 12.5 보다 낮습니다. 기존 구독은 유지되지만 한도를 넘긴 상태가 되어 새 구독을 받을 수 없습니다.");
  assert.equal(capAdjustBelowUsageWarning(12.5, 12.5), null);
  assert.equal(capAdjustBelowUsageWarning(30, 12.5), null);
  assert.equal(capAdjustBelowUsageWarning(10, null), null, "사용량 미상이면 경고를 지어내지 않는다");
  assert.ok(buildMentorCapAdjustSummary({ name: "김서연", currentLimit: 28, nextLimit: 10, usedCap: 12.5 }).includes("보다 낮습니다"));
  assert.equal(buildMentorCapAdjustSummary({ name: "김서연", currentLimit: 28, nextLimit: 30, usedCap: 12.5 }), "김서연 멘토의 정원 한도를 28 → 30 로 바꿉니다. 현재 사용량 12.5.");
  assert.equal(parseCapLimitInput("12.55"), 12.6);
  assert.equal(parseCapLimitInput("1001"), null);
  assert.equal(parseCapLimitInput("-1"), null);
  assert.equal(parseCapLimitInput(""), null);
  assert.deepEqual(MENTOR_CAP_ADJUST_FIELDS, { mentorUserId: "mentorUserId", capLimit: "capLimit", reason: "reason" });
  const action = stripComments(read(CAP_ACTION));
  for (const f of ["mentorUserId", "capLimit", "reason"]) assert.ok(action.includes(`formData.get("${f}")`), f);
  assert.ok(action.includes('actionType: "mentor_cap_limit_update"') && action.includes("detail: { capLimit, reason: reason || null }"), "감사 로그에 사유");
  assert.ok(action.includes('buildAccountDetailUrl(mentorUserId, { tab: "mentor", capOk: true })'), "복귀 = 계정 상세 멘토 탭");
  assert.ok(action.includes("parsed < 0 || parsed > 1000"), "검증 범위 불변");
  const form = stripComments(read(CAP_FORM));
  assert.ok(form.includes('import { updateMentorCapLimitAction } from "@/lib/admin/mentorCapAdminActions";') && form.includes("action={updateMentorCapLimitAction}"), "기존 액션 재사용(새 액션 없음)");
  assert.ok(form.includes('level="stateChange"') && /reasonRequired\s/.test(form) && form.includes("reasonFieldName={MENTOR_CAP_ADJUST_FIELDS.reason}"), "stateChange + 사유");
  assert.ok(form.includes("confirmBlockedMessage={next == null ? MENTOR_CAP_ADJUST_BLOCKED_MESSAGE : null}") && MENTOR_CAP_ADJUST_BLOCKED_MESSAGE.includes("0~1000"));
  assert.ok(form.includes("capAdjustBelowUsageWarning(next, usedCap)"), "사용량 미만 경고");
});

test("옛 라우트 /admin/mentor-approvals/[id] 는 계정 상세 멘토 탭으로 리다이렉트(정원 조정 플래시 이어 붙임) · 정원 조정 액션은 이제 그 라우트로 돌아가지 않는다", () => {
  const legacy = stripComments(read(LEGACY_ROUTE));
  assert.ok(legacy.includes('import { redirect } from "next/navigation";') && legacy.includes('redirect(buildAccountDetailUrl(id, { tab: "mentor", capOk: typeof sp.capOk === "string", capError }));'));
  assert.ok(!/PageScaffold|updateMentorCapLimitAction|loadMentorCapUsage|<form/.test(legacy), "옛 화면 본문 없음");
  assert.ok(!stripComments(read(CAP_ACTION)).includes("/admin/mentor-approvals"), "액션의 옛 경로 사본 없음(주석 제외)");
});

// ── §4 학생 탭 ───────────────────────────────────────────────────────────────

test("학생 탭 픽스처: 원장 분류(충전·차감·환불·보너스) · 생년월일 없음 경고 · 구독/캐시/사용량/신고·분쟁/결제 섹션 배선", () => {
  assert.equal(classifyCashLedgerEntry({ deltaCents: 2990000, reason: "cash_topup", refType: "topup" }), "charge");
  assert.equal(classifyCashLedgerEntry({ deltaCents: -8490000, reason: "subscription_payment", refType: "subscriptions" }), "debit");
  assert.equal(classifyCashLedgerEntry({ deltaCents: 8490000, reason: "refund_approved", refType: "refunds" }), "refund");
  assert.equal(classifyCashLedgerEntry({ deltaCents: 8490000, reason: "subscription_checkout_rollback", refType: "subscriptions" }), "refund");
  assert.equal(classifyCashLedgerEntry({ deltaCents: 500000, reason: "topup_bonus", refType: "topup" }), "bonus");
  assert.equal(STUDENT_BIRTH_DATE_MISSING_WARNING, "생년월일 미입력");
  assert.deepEqual(studentProfileWarnings({ birthDate: null }), [STUDENT_BIRTH_DATE_MISSING_WARNING]);
  assert.deepEqual(studentProfileWarnings({ birthDate: "2008-03-11" }), []);
  const tab = stripComments(read(STUDENT_TAB));
  for (const id of ['id="profile"', 'id="subscriptions"', 'id="cash"', 'id="usage"', 'id="cases"', 'id="payments"', 'id="logs"']) assert.ok(tab.includes(id), id);
  assert.ok(tab.includes("data-birth-date-missing") && tab.includes("data-student-pending-invoices") && tab.includes("data-student-free-usage"), "경고·무통장 대기·무료 질문권");
  assert.ok(tab.includes('<AdminStatusPill table="payments" column="status"') && tab.includes('<AdminStatusPill table="subscriptions" column="status"'), "상태는 사전(결제 완료 동의어 정규화)");
  assert.ok(tab.includes("hrefOf={contentReportDetailPath}") && tab.includes("hrefOf={disputeDetailPath}"), "신고·분쟁은 해당 화면 링크");
  const q = stripComments(read("lib/admin/accountStudentQueries.ts"));
  assert.ok(q.includes('.from("cash_wallets")') && q.includes('.from("cash_ledger")') && q.includes('.from("paysync_invoices")') && q.includes('.from("payments")') && q.includes('.from("subscriptions")'), "테이블");
  assert.ok(q.includes("fetchWeeklyQuestionUsagePairParty(db, studentId, mentorId)") && q.includes("countFreeQuestionsTotal(db, studentId)"), "사용량 = RPC get_weekly_question_usage · free_question_usage");
  assert.ok(q.includes("loadAuthorContentIds(db, userId)"), "신고당한 건 = PR-6 과 같은 수집");
});

// ── §4 조치: 경고·정지·차단 등급 · returnTo = 상세 ──────────────────────────

test("조치 3종 등급: 경고 stateChange+프리셋 필수 · 정지 critical(7일·30일·영구 + 사유) · 차단 = 이름 재입력(destructive) + 사유 — 필드는 기존 액션 것 그대로", () => {
  assert.equal(ACCOUNT_DETAIL_ACTIONS.warn.level, "stateChange");
  assert.equal(ACCOUNT_DETAIL_ACTIONS.suspend.level, "critical");
  assert.equal(ACCOUNT_DETAIL_ACTIONS.ban.level, "destructive");
  const warn = resolveAdminConfirmRequirements({ level: "stateChange", reasonRequired: true });
  assert.equal(evaluateAdminConfirm(warn, { reason: "", typedConfirmText: "" }).ok, false, "프리셋 없이 제출 불가");
  assert.equal(evaluateAdminConfirm(warn, { reason: ACCOUNT_WARNING_PRESETS[0], typedConfirmText: "" }).ok, true);
  assert.deepEqual([...ACCOUNT_WARNING_PRESETS], [...CONTENT_REPORT_WARNING_PRESETS], "PR-6 과 같은 프리셋");
  const suspend = resolveAdminConfirmRequirements({ level: "critical" });
  assert.equal(suspend.reasonRequired, true);
  assert.deepEqual([...ACCOUNT_SUSPEND_CODES], [...ACCOUNT_SANCTION_CODES]);
  assert.deepEqual(accountSuspendFields("7d"), { nextStatus: "suspended", durationDays: "7" });
  assert.deepEqual(accountSuspendFields("30d"), { nextStatus: "suspended", durationDays: "30" });
  assert.deepEqual(accountSuspendFields("permanent"), { nextStatus: "banned", durationDays: "" });
  assert.deepEqual(ACCOUNT_BAN_FIELDS, { nextStatus: "banned", durationDays: "" });
  const ban = resolveAdminConfirmRequirements({ level: "destructive", reasonRequired: true, confirmText: accountBanConfirmText("김 서연", UUID) });
  assert.equal(ban.confirmText, "김 서연", "대상 이름 재입력");
  assert.equal(evaluateAdminConfirm(ban, { reason: "반복 위반", typedConfirmText: "김서연" }).ok, false, "이름이 정확히 같아야 한다");
  assert.equal(evaluateAdminConfirm(ban, { reason: "", typedConfirmText: "김 서연" }).ok, false, "사유 필수");
  assert.equal(evaluateAdminConfirm(ban, { reason: "반복 위반", typedConfirmText: "김 서연" }).ok, true);
  assert.equal(accountBanConfirmText("  ", UUID), UUID.slice(0, 8), "이름이 없으면 id 앞 8자");
  assert.equal(ACCOUNT_USER_ID_FIELD, "userId");
  assert.equal(ACCOUNT_WARN_REASON_FIELD, "warnReason");
  assert.equal(ACCOUNT_WARN_SEVERITY_FIELD, "severity");
  assert.equal(ACCOUNT_SUSPEND_STATUS_FIELD, "nextStatus");
  assert.equal(ACCOUNT_SUSPEND_DURATION_FIELD, "durationDays");
  assert.equal(ACCOUNT_SUSPEND_REASON_FIELD, "reason");
  assert.equal(ACCOUNT_RETURN_TO_FIELD, "returnTo");
  const a = stripComments(read(ACCOUNT_ACTIONS));
  for (const f of ["userId", "warnReason", "severity", "nextStatus", "durationDays", "reason", "returnTo"]) assert.ok(a.includes(`formData.get("${f}")`), f);
  assert.equal(ACCOUNT_SUSPEND_BLOCKED_MESSAGE, "정지 기간(7일 · 30일 · 영구)을 선택해 주세요.");
});

test("정지 summary 는 PR-6 이 확인한 실제 동작 문장 그대로 · 멘토면 담당 학생 N명 · 차단 summary 는 영구 차단 문장", () => {
  const target = { name: "수학하는하늘", roleLabel: "멘토", role: "mentor", mentorRoomCount: 3 };
  const s = buildAccountDetailSuspendSummary(target, "7d", "2026.09.10");
  assert.ok(s.startsWith("수학하는하늘 멘토 계정을 7일 정지합니다. 2026.09.10까지 정지되며 그 뒤 자동 해제됩니다."), s);
  assert.ok(s.includes(ACCOUNT_SUSPENDED_BLOCKED_SENTENCE) && s.includes(ACCOUNT_SUSPENDED_NOT_BLOCKED_SENTENCE), "쓰기가 막힌다 · 로그인·구독·결제는 유지");
  assert.ok(s.includes("담당 학생 3명"), "멘토면 담당 학생 N명");
  const b = buildAccountDetailBanSummary({ name: "김OO", roleLabel: "학생", role: "student", mentorRoomCount: null });
  assert.ok(b.startsWith("김OO 학생 계정을 영구 차단합니다.") && !b.includes("담당 학생"));
});

test("조치 패널 배선: 폼 3개 · 액션 2개(accountStatusActions)만 · 등급 각각 · 세 폼 모두 returnTo = 이 상세 · 자체 모달 없음 · 상세 페이지는 관리자 계정에 패널을 두지 않는다", () => {
  const src = stripComments(read(ACTION_PANEL));
  assert.ok(src.startsWith('"use client"'));
  assert.ok(src.includes('import { issueUserWarningAction, setUserStatusAction } from "@/lib/admin/accountStatusActions";'), "계정 관리 액션 재사용");
  assert.equal((src.match(/<ConfirmSubmitButton\b/g) ?? []).length, 3);
  assert.equal((src.match(/level="stateChange"/g) ?? []).length, 1);
  assert.equal((src.match(/level="critical"/g) ?? []).length, 1);
  assert.equal((src.match(/level="destructive"/g) ?? []).length, 1);
  assert.ok(src.includes("confirmText={banConfirmText}"), "차단은 대상 이름 재입력");
  assert.ok(/level="destructive"[\s\S]*?reasonRequired\s/.test(src), "차단도 사유 필수");
  assert.ok(src.includes("reasonPresets={ACCOUNT_WARNING_PRESETS}") && src.includes("reasonFieldName={ACCOUNT_WARN_REASON_FIELD}"), "경고 프리셋 → warnReason");
  assert.ok(src.includes("confirmBlockedMessage={code ? null : ACCOUNT_SUSPEND_BLOCKED_MESSAGE}") && src.includes('type="radio"'), "정지 기간 라디오 + 미선택 잠금");
  assert.equal((src.match(/name=\{ACCOUNT_RETURN_TO_FIELD\} value=\{returnTo\}/g) ?? []).length, 3, "세 폼 모두 returnTo");
  assert.ok(src.includes("const returnTo = accountDetailPath(target.id);"), "returnTo = 이 상세");
  assert.ok(!src.includes("AdminConfirmDialog") && !/alert\(/.test(src) && !/style=\{/.test(src));
  assert.equal(accountDetailUserActionsAvailable("admin"), false);
  assert.equal(accountDetailUserActionsAvailable("mentor"), true);
  assert.equal(accountDetailUserActionsAvailable("student"), true);
  const page = stripComments(read(DETAIL_PAGE));
  assert.ok(page.includes("const actionsAvailable = accountDetailUserActionsAvailable(role);") && page.includes("{actionsAvailable ? (") && page.includes("<AccountActionPanel"), "관리자 계정은 패널 없음");
  assert.ok(page.includes('by: role === "admin" ? "admin" : "target"'), "관리자 계정은 실행한 조치 · 그 외는 대상인 조치");
  assert.ok(page.includes('await requireRole("admin");'), "상세 페이지 가드(레이아웃 가드와 중복)");
});

test("returnTo 허용 목록에 계정 상세(/admin/users/<uuid>)가 추가됐고 신고 상세·기본 경로·차단 값은 그대로", () => {
  assert.equal(resolveAccountStatusReturnPath(`/admin/users/${UUID}`), `/admin/users/${UUID}`);
  assert.equal(resolveAccountStatusReturnPath(accountDetailPath(UUID)), `/admin/users/${UUID}`, "패널이 싣는 경로 = 허용 형식");
  assert.equal(resolveAccountStatusReturnPath(`/admin/reports/${UUID}`), `/admin/reports/${UUID}`);
  assert.equal(resolveAccountStatusReturnPath("/admin/users"), "/admin/users");
  for (const bad of [`/admin/users/${UUID}?tab=mentor`, "/admin/users/not-a-uuid", `/admin/users/${UUID}/x`, "/admin/users/../reports", `https://evil.example/admin/users/${UUID}`, `/admin/refunds/${UUID}`]) {
    assert.equal(resolveAccountStatusReturnPath(bad), "/admin/users", bad);
  }
  assert.equal(accountDetailFlashOkMessage("warned:2"), "경고를 기록했습니다. (누적 2회)");
  assert.equal(accountDetailFlashOkMessage("warned_suspended:3"), "경고가 누적되어 계정을 7일 자동 정지했습니다. (누적 3회)");
  assert.equal(accountDetailFlashOkMessage("banned"), "계정을 영구 차단했습니다.");
  assert.equal(accountDetailFlashOkMessage("<script>"), null);
});

// ── 처리 이력 라벨 · DB 변경 0 · 조회 전용 · 금지어 ─────────────────────────

test("처리 이력: 액션 타입 라벨 · detail 사유 추출(액션마다 키가 다르다)", () => {
  assert.equal(accountActionLogLabel("account_status_change"), "계정 상태 변경");
  assert.equal(accountActionLogLabel("mentor_cap_limit_update"), "정원 조정");
  assert.equal(accountActionLogLabel("unknown_type"), "unknown_type");
  assert.equal(accountActionLogLabel(""), "처리");
  assert.equal(accountActionLogReason({ reason: "외부 연락처 유도", severity: "normal" }), "외부 연락처 유도");
  assert.equal(accountActionLogReason({ rejectionReason: "서류를 알아볼 수 없음" }), "서류를 알아볼 수 없음");
  assert.equal(accountActionLogReason({ status: "suspended", reason: "" }), "상태 suspended");
  assert.equal(accountActionLogReason({ capLimit: 30 }), "한도 30");
  assert.equal(accountActionLogReason(null), null);
});

test("DB·RPC 변경 0 · 조회 모듈은 읽기 전용(insert/update/delete 없음 · RPC 는 리뷰 통계·주간 사용량 읽기뿐) · 새 'use server' 없음 · 순수 모듈은 React·@/ import 없음", () => {
  for (const rel of QUERY_MODULES) {
    const q = stripComments(read(rel));
    assert.ok(q.startsWith('import "server-only";'), `${rel}: server-only`);
    assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(q), `${rel}: 쓰기 없음`);
    const rpcs = [...q.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
    for (const r of rpcs) assert.ok(["get_mentor_review_stats"].includes(r), `${rel}: 허용되지 않은 RPC ${r}`);
    assert.ok(!q.includes('"use server"'));
  }
  const pure = stripComments(read(CONSOLE));
  assert.ok(!/from "react"|from "@\//.test(pure), "순수 모듈");
  const newServerFiles = [...walk(join(ROOT, "lib", "admin"), []), ...walk(join(ROOT, "components", "admin"), [])]
    .filter((f) => /account(List|Detail|Mentor|Student)Queries|accountDetailConsole|Account[A-Z]\w+\.tsx$|IdentityReviewBlock|MentorCapAdjustForm/.test(f))
    .filter((f) => readFileSync(f, "utf8").includes('"use server"'));
  assert.deepEqual(newServerFiles, [], "PR-7 에 새 서버 액션 파일 없음(쓰기는 기존 액션만)");
});

test("이관된 화면의 사람 이름이 계정 상세로 링크된다(승인 패널 헤더 · 검수 목록 신고자 · 신고 상세 신고자·신고당한 사용자 · 분쟁 목록·상세 학생·멘토 · 환불 상세 요청자 · 학적 변경 패널 헤더)", () => {
  const expectations: Array<[string, string]> = [
    [PR2_PANEL, "href={accountDetailPath(detail.mentorUserId)}"],
    ["components/admin/ContentReportQueueList.tsx", "href={accountDetailPath(item.reporterId)}"],
    ["app/(admin)/admin/(console)/reports/[id]/page.tsx", "href={accountDetailPath(reporterId)}"],
    ["components/admin/ContentReportTargetUserPanel.tsx", "href={accountDetailPath(user.id)}"],
    ["components/admin/DisputeQueueTable.tsx", "href={accountDetailPath(item.studentId)}"],
    ["components/admin/DisputeQueueTable.tsx", "href={accountDetailPath(item.mentorId)}"],
    ["app/(admin)/admin/(console)/disputes/[id]/page.tsx", "href={accountDetailPath(student.id)}"],
    ["app/(admin)/admin/(console)/disputes/[id]/page.tsx", "href={accountDetailPath(mentor.id)}"],
    ["app/(admin)/admin/(console)/refunds/[id]/page.tsx", "href={accountDetailPath(detail.requesterId)}"],
    ["components/admin/AcademicRecordChangeReviewPanel.tsx", "href={accountDetailPath(detail.mentorId)}"],
  ];
  for (const [rel, needle] of expectations) assert.ok(stripComments(read(rel)).includes(needle), `${rel}: ${needle}`);
  // 행의 기본 링크가 이름인 목록(환불 목록·승인 큐·학적 목록)은 그대로 — 이름 링크를 바꾸면 그 행의 유일한 상세 경로가 사라진다.
  assert.ok(stripComments(read("components/admin/RefundQueueTable.tsx")).includes("href={refundDetailPath(item.id)}"));
  assert.ok(!stripComments(read("components/admin/RefundQueueTable.tsx")).includes("accountDetailPath"));
});

test("UI 카피 금지어 없음(선생님·강사님·수강생·과외·alert) · 인라인 style 없음", () => {
  const files = [LIST_PAGE, DETAIL_PAGE, LEGACY_ROUTE, LIST_TABLE, HEADER, IDENTITY_BLOCK, ACTION_PANEL, MENTOR_TAB, STUDENT_TAB, CAP_FORM, CONSOLE, "components/admin/AccountDetailTabs.tsx", "components/admin/AccountActionLogList.tsx", ...QUERY_MODULES];
  for (const rel of files) {
    const code = stripComments(read(rel));
    for (const banned of ["선생님", "강사님", "수강생", "과외", "커패니티", "웰버십", "쌤버쉽", "alert("]) assert.ok(!code.includes(banned), `${rel}: 금지 문구 ${banned}`);
    assert.ok(!/style=\{/.test(code), `${rel}: 인라인 style 금지`);
  }
});
