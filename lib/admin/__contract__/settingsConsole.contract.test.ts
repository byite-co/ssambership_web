// 계약 테스트: 관리자 시스템 설정(PR-10 §3) — 읽기 전용 값이 코드 정본·DB 함수와 일치 · store_url NULL 경고 · e2e 계정 경고 · 충전 패키지 토글 stateChange.
// 실행: node --test --experimental-strip-types lib/admin/__contract__/settingsConsole.contract.test.ts
//
// 고정하는 것(지시서 §4):
//   ① 요금제·밴드는 `lib/subscribe/*` 정본, 수수료는 `mentorPayoutsConstants`, 정원은 DB 함수(SQL 190) — 순수 모듈에 숫자 리터럴 없음(소스 트립와이어)
//   ② `store_url` NULL → 경고 · 정책 행 없음 → 경고 · 스케줄러 켜짐 → 경고
//   ③ e2e 계정 판정 · 관리자 계정 조치 없음(조회만)
//   ④ 충전 패키지 토글은 ConfirmSubmitButton stateChange + summary(`30,000원 패키지를 비활성화합니다. 충전 화면에서 사라집니다.`) · 그 외 편집 UI 0
//   ⑤ 조회 모듈은 select/RPC 어댑터만 · 앱 버전 정책·payout_settings 쓰기 0

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SETTINGS_CAP_PROBE_MENTOR_ID,
  SETTINGS_READ_ONLY_NOTE,
  SETTINGS_SCHEDULER_LABELS,
  SETTINGS_STORE_URL_WARNING,
  SETTINGS_TEST_ACCOUNT_WARNING,
  adminAccountDisplayName,
  adminAccountReviewLabel,
  appPlatformLabel,
  appVersionPolicyWarnings,
  buildCapLine,
  buildFeeLine,
  buildSettingsPlanRows,
  buildTopupPackageToggleSummary,
  formatCapWeight,
  formatFeeRateLabel,
  formatPackageWon,
  formatPlanBandLine,
  isTestAdminAccount,
  parseAppVersionPolicyRow,
  parseTopupPackageRow,
  schedulerStateLabel,
  schedulerWarning,
  topupPackageDisplayName,
} from "../settingsConsole.ts";
import { SUBSCRIBE_PLAN_CATALOG } from "../../subscribe/subscribePlanCatalog.ts";
import { ADMIN_CONSOLE_NAV } from "../../../components/admin/adminConsoleNavConfig.ts";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PURE = "lib/admin/settingsConsole.ts";
const QUERIES = "lib/admin/settingsQueries.ts";
const PAGE = "app/(admin)/admin/(console)/settings/page.tsx";
const PACKAGES = "components/admin/SettingsTopupPackageTable.tsx";
const POLICY = "components/admin/SettingsPolicyCards.tsx";
const APP_VERSION = "components/admin/SettingsAppVersionTable.tsx";
const ADMINS = "components/admin/SettingsAdminAccountList.tsx";

/** `mentorPlanPricing.ts` 는 `@/` import 라 node 에서 못 읽는다 — 소스에서 밴드 숫자를 뽑는다(정본 대조). */
function bandsFromSource(): Record<string, { minCashKrw: number; recommendedCashKrw: number; maxCashKrw: number }> {
  const src = stripComments(read("lib/subscribe/mentorPlanPricing.ts"));
  const block = src.slice(src.indexOf("export const MENTOR_SUBSCRIPTION_PRICE_RULES"), src.indexOf("export const SUBSCRIBE_PLAN_TIERS"));
  const out: Record<string, { minCashKrw: number; recommendedCashKrw: number; maxCashKrw: number }> = {};
  for (const m of block.matchAll(/(limited|standard|premium):\s*\{\s*minCashKrw:\s*([\d_]+),\s*recommendedCashKrw:\s*([\d_]+),\s*maxCashKrw:\s*([\d_]+),?\s*\}/g)) {
    out[m[1]] = { minCashKrw: Number(m[2].replace(/_/g, "")), recommendedCashKrw: Number(m[3].replace(/_/g, "")), maxCashKrw: Number(m[4].replace(/_/g, "")) };
  }
  return out;
}

/** `mentorPayoutsConstants.ts` 도 `@/` import — 플랫폼 몫 3종을 소스에서 뽑는다. */
function feesFromSource(): { subscription: number; individualQuestion: number; customRequest: number } {
  const src = stripComments(read("lib/mentor/mentorPayoutsConstants.ts"));
  const pick = (name: string) => Number(src.match(new RegExp(`export const ${name} = ([\\d.]+) as const;`))?.[1]);
  return {
    subscription: pick("MENTOR_SUBSCRIPTION_PLATFORM_SHARE"),
    individualQuestion: pick("MENTOR_INDIVIDUAL_QUESTION_PLATFORM_SHARE"),
    customRequest: pick("MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE"),
  };
}

/** 정원 정본은 DB 함수(SQL 190) — 가중치·행 부재 폴백을 SQL 원문에서 뽑는다. */
function capFromSql(): { weights: { limited: number; standard: number; premium: number }; defaultLimit: number } {
  const sql = read("supabase/sql/190_cap_structure_limit_50_weights.sql");
  const w = (tier: string) => Number(sql.match(new RegExp(`when '${tier}' then ([\\d.]+)`))?.[1]);
  const limitFn = sql.slice(sql.indexOf("create or replace function public.mentor_cap_limit"));
  const defaultLimit = Number(limitFn.match(/coalesce\(\s*\(select mp\.cap_limit[^)]*\),\s*(\d+)\s*\)/)?.[1]);
  return { weights: { limited: w("limited"), standard: w("standard"), premium: w("premium") }, defaultLimit };
}

// ── ① 정본 일치 ───────────────────────────────────────────────────────────────

test("요금제: 행은 카탈로그 표시가 + 멘토 밴드(정본 소스) 그대로 · 한 줄 표기 = CLAUDE.md 잠금값", () => {
  const bands = bandsFromSource();
  assert.deepEqual(Object.keys(bands).sort(), ["limited", "premium", "standard"]);
  const rows = buildSettingsPlanRows(SUBSCRIBE_PLAN_CATALOG, bands);
  assert.deepEqual(rows.map((r) => r.tier), ["limited", "standard", "premium"]);
  assert.deepEqual(rows.map((r) => r.catalogCashKrw), SUBSCRIBE_PLAN_CATALOG.map((c) => c.cashKrw));
  assert.deepEqual(rows.map((r) => [r.minCashKrw, r.recommendedCashKrw, r.maxCashKrw]), ["limited", "standard", "premium"].map((t) => [bands[t].minCashKrw, bands[t].recommendedCashKrw, bands[t].maxCashKrw]));
  assert.equal(rows.find((r) => r.tier === "standard")?.recommend, true);
  assert.equal(formatPlanBandLine(rows), "라이트 29,900~69,900 · 스탠다드 84,900~149,900 · 프리미엄 174,900~329,900");
  // 밴드가 없는 tier 는 카탈로그 표시가로 폴백(표가 비지 않게)
  const fallback = buildSettingsPlanRows(SUBSCRIBE_PLAN_CATALOG, {});
  assert.equal(fallback[0].minCashKrw, SUBSCRIBE_PLAN_CATALOG[0].cashKrw);
});

test("수수료: 플랫폼 몫 상수(정본 소스) → `구독 15% · 개별질문 15% · 맞춤의뢰 5%` · 정원: DB 함수(SQL 190) 값 → `한도 50 · 가중치 1.0 / 2.25 / 4.75`", () => {
  const fees = feesFromSource();
  assert.ok(Number.isFinite(fees.subscription) && Number.isFinite(fees.individualQuestion) && Number.isFinite(fees.customRequest));
  assert.equal(buildFeeLine(fees), "구독 15% · 개별질문 15% · 맞춤의뢰 5%");
  assert.equal(formatFeeRateLabel(0.033), "3.3%");
  assert.equal(formatFeeRateLabel(NaN), "—");
  const cap = capFromSql();
  assert.equal(buildCapLine(cap), "한도 50 · 가중치 1.0 / 2.25 / 4.75");
  assert.equal(formatCapWeight(1), "1.0");
  assert.equal(formatCapWeight(2.25), "2.25");
  assert.equal(buildCapLine({ weights: null, defaultLimit: null }), "한도 — · 가중치 —", "판정 불가는 지어내지 않는다");
  assert.equal(SETTINGS_CAP_PROBE_MENTOR_ID, "00000000-0000-0000-0000-000000000000", "행 부재 폴백을 읽는 존재하지 않는 id");
  assert.equal(SETTINGS_READ_ONLY_NOTE, "이 값은 코드와 DB 함수에서 관리됩니다. 변경은 개발 배포로 합니다.");
});

test("순수 모듈에 요금제·수수료·정원 숫자 리터럴이 없다(값은 정본에서 인자로) · 화면은 정본 모듈을 import 해 넘긴다 · 정원은 mentorCapUsageCore 어댑터", () => {
  const pure = stripComments(read(PURE));
  assert.ok(!/\b(29_?900|84_?900|174_?900|69_?900|149_?900|329_?900)\b/.test(pure), "요금제 숫자 사본 금지");
  assert.ok(!/\b0\.(15|05|033)\b/.test(pure), "수수료 사본 금지");
  assert.ok(!/\b(2\.25|4\.75)\b/.test(pure) && !/(cap_?limit|CAP_?LIMIT|defaultLimit)\w*\s*(?:=|\?\?|\|\||:)\s*(28|50)\b/i.test(pure), "정원 사본 금지");
  assert.ok(!/from "@\//.test(pure) && !/from "react"/.test(pure), "순수 모듈");
  const page = stripComments(read(PAGE));
  assert.ok(page.includes('import { SUBSCRIBE_PLAN_CATALOG } from "@/lib/subscribe/subscribePlanCatalog";'));
  assert.ok(page.includes('import { MENTOR_SUBSCRIPTION_PRICE_RULES } from "@/lib/subscribe/mentorPlanPricing";'));
  assert.ok(page.includes("buildSettingsPlanRows(SUBSCRIBE_PLAN_CATALOG, MENTOR_SUBSCRIPTION_PRICE_RULES)"));
  for (const c of ["MENTOR_SUBSCRIPTION_PLATFORM_SHARE", "MENTOR_INDIVIDUAL_QUESTION_PLATFORM_SHARE", "MENTOR_CUSTOM_REQUEST_PLATFORM_SHARE", "PAYOUT_DAY_LABEL"]) {
    assert.ok(page.includes(c), `${c} 정본 import`);
  }
  assert.ok(page.includes("payoutDayLabel={PAYOUT_DAY_LABEL}"), "지급일은 payoutComputation 정본");
  const queries = stripComments(read(QUERIES));
  assert.ok(queries.includes("createSupabaseMentorCapDataSource(db)") && queries.includes("loadCapWeightByTier(source)") && queries.includes("source.capLimit(SETTINGS_CAP_PROBE_MENTOR_ID)"), "정원은 DB 함수 어댑터");
  assert.ok(!/rpc\(/.test(queries), "RPC 이름은 mentorCapUsageCore 한 곳에만");
});

// ── ② 경고 ───────────────────────────────────────────────────────────────────

test("앱 버전 정책: 행 파싱 · store_url NULL 이면 플랫폼별 경고(현행 android·ios 둘 다 NULL) · 행 없음 경고 · URL 이 있으면 경고 없음", () => {
  const android = parseAppVersionPolicyRow({ platform: "android", min_supported_build: 9, latest_build: 16, minimum_version_name: "1.0.0", store_url: null, message: null, updated_at: "2026-08-06T03:39:26Z" })!;
  const ios = parseAppVersionPolicyRow({ platform: "ios", min_supported_build: "1", latest_build: 16, minimum_version_name: "1.0.0", store_url: null, message: null, updated_at: null })!;
  assert.equal(android.minSupportedBuild, 9);
  assert.equal(ios.minSupportedBuild, 1);
  assert.equal(android.storeUrl, null);
  assert.equal(appPlatformLabel("android"), "Android");
  assert.equal(appPlatformLabel("ios"), "iOS");
  const warnings = appVersionPolicyWarnings([android, ios]);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].startsWith("Android · iOS 스토어 URL이 비어 있습니다.") && warnings[0].includes(SETTINGS_STORE_URL_WARNING));
  assert.equal(SETTINGS_STORE_URL_WARNING, "스토어 URL이 비어 있으면 강제 업데이트 시 사용자가 스토어로 이동할 수 없습니다.");
  assert.deepEqual(appVersionPolicyWarnings([{ ...android, storeUrl: "https://play.google.com/store/apps/details?id=com.ssambership.app" }, { ...ios, storeUrl: "https://apps.apple.com/app/id1" }]), []);
  assert.equal(appVersionPolicyWarnings([]).length, 1);
  assert.equal(parseAppVersionPolicyRow({ platform: "" }), null);
});

test("정산 설정: 스케줄러 false → '꺼짐 (관리자가 정산 화면에서 수동 실행)' · true → 켜짐 + 경고 · null → 확인 불가 + 경고", () => {
  assert.equal(schedulerStateLabel(false), SETTINGS_SCHEDULER_LABELS.off);
  assert.equal(SETTINGS_SCHEDULER_LABELS.off, "꺼짐 (관리자가 정산 화면에서 수동 실행)");
  assert.equal(schedulerWarning(false), null);
  assert.equal(schedulerStateLabel(true), "켜짐");
  assert.ok(schedulerWarning(true)?.includes("오너 결정"));
  assert.equal(schedulerStateLabel(null), "확인 불가");
  assert.ok(schedulerWarning(null));
});

// ── ③ 관리자 계정 ─────────────────────────────────────────────────────────────

test("e2e 계정 판정: .test 도메인 · 로컬파트 e2e 토큰 → 경고 · 운영 계정 2곳은 아님 · 표시명·조치 건수", () => {
  assert.equal(isTestAdminAccount("admin-e2e-test@ssambership.test"), true);
  assert.equal(isTestAdminAccount("e2e@example.com"), true);
  assert.equal(isTestAdminAccount("byite1226@gmail.com"), false);
  assert.equal(isTestAdminAccount("hello@byite.co.kr"), false);
  assert.equal(isTestAdminAccount("see2ed@byite.co.kr"), false, "e2e 부분 문자열은 아님");
  assert.equal(isTestAdminAccount(null), false);
  assert.equal(SETTINGS_TEST_ACCOUNT_WARNING, "테스트 계정 — 운영에 남아 있음");
  assert.equal(adminAccountDisplayName({ id: "970f7278-14e2-435c-86e5-3d0d19a7f459", fullName: "쌤버십 운영자", nickname: null, email: "hello@byite.co.kr" }), "쌤버십 운영자");
  assert.equal(adminAccountDisplayName({ id: "e2e00000-0000-4000-8000-000000000001", fullName: null, nickname: null, email: "admin-e2e-test@ssambership.test" }), "admin-e2e-test@ssambership.test");
  assert.equal(adminAccountReviewLabel(116), "조치 116건");
  assert.equal(adminAccountReviewLabel(null), "조치 건수 확인 불가");
});

// ── ④ 충전 패키지 ────────────────────────────────────────────────────────────

test("충전 패키지: 행 파싱 · 이름(라벨 없으면 결제 금액) · stateChange summary 문구 2방향", () => {
  const p = parseTopupPackageRow({ id: "p1", label: null, amount_cents: 3_000_000, price_cents: 3_000_000, display_order: 1, active: true })!;
  assert.equal(formatPackageWon(p.priceCents), "30,000원");
  assert.equal(topupPackageDisplayName(p), "30,000원 패키지");
  assert.equal(buildTopupPackageToggleSummary(p, false), "30,000원 패키지를 비활성화합니다. 충전 화면에서 사라집니다.");
  assert.equal(buildTopupPackageToggleSummary(p, true), "30,000원 패키지를 활성화합니다. 충전 화면에 다시 표시됩니다.");
  const labeled = parseTopupPackageRow({ id: "e2e00000-0000-4000-8000-000000000004", label: "검증용 테스트 패키지", amount_cents: 1000000, price_cents: 1000000, display_order: 999, active: true })!;
  assert.equal(topupPackageDisplayName(labeled), "검증용 테스트 패키지");
  assert.equal(parseTopupPackageRow({ label: "id 없음" }), null);
  assert.equal(formatPackageWon(null), "—");
});

test("충전 패키지 표: 기존 토글 액션 + ConfirmSubmitButton stateChange(summary = buildTopupPackageToggleSummary) · Server Component", () => {
  const src = read(PACKAGES);
  const code = stripComments(src);
  assert.ok(!src.startsWith('"use client"'));
  assert.ok(code.includes("action={toggleCashTopupPackageActiveAction}"), "기존 액션");
  assert.ok(code.includes('level="stateChange"') && code.includes("summary={buildTopupPackageToggleSummary(p, nextActive)}"), "stateChange 확인");
  assert.ok(!code.includes('level="immediate"') && !code.includes('level="critical"'));
});

// ── ⑤ 편집 UI 0 · 조회 전용 ─────────────────────────────────────────────────

test("읽기 전용 섹션 3곳(요금제·수수료·정산 · 앱 버전 · 관리자 계정)에는 form/input/button 이 없다 · 앱 버전은 경고 배지 · e2e 배지", () => {
  for (const rel of [POLICY, APP_VERSION, ADMINS]) {
    const code = stripComments(read(rel));
    assert.ok(!/<form\b|<input\b|<button\b|<select\b|<textarea\b|ConfirmSubmitButton|action=/.test(code), `${rel}: 편집 UI 없음`);
    assert.ok(!read(rel).startsWith('"use client"'), `${rel}: Server Component`);
    assert.ok(code.includes("읽기 전용"), `${rel}: 읽기 전용 표기`);
  }
  const appVersion = stripComments(read(APP_VERSION));
  assert.ok(appVersion.includes("appVersionPolicyWarnings(rows)") && appVersion.includes("data-settings-app-version-warnings") && appVersion.includes("<EmptyCell warn />"), "store_url 경고");
  const admins = stripComments(read(ADMINS));
  assert.ok(admins.includes("isTestAdminAccount(r.email)") && admins.includes("data-settings-test-badge"), "e2e 경고 배지");
  const policy = stripComments(read(POLICY));
  const page = stripComments(read(PAGE));
  assert.ok(policy.includes("data-settings-plan-band-line") && policy.includes("data-settings-fee-line") && policy.includes("data-settings-cap-line") && policy.includes("schedulerStateLabel(schedulerEnabled)"));
  assert.ok(page.includes("formatPlanBandLine(planRows)"), "밴드 한 줄 요약은 순수 규칙에서");
});

test("조회 모듈: insert/update/upsert/delete 없음 · payout_settings·mobile_app_version_policies·users 는 select 만 · 페이지는 AdminPageLayout · 나브 '시스템 설정'", () => {
  const queries = stripComments(read(QUERIES));
  assert.ok(queries.includes('import "server-only"'));
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(queries), "쓰기 없음");
  assert.ok(queries.includes('.from("payout_settings").select("scheduler_enabled")'), "스케줄러는 읽기만");
  assert.ok(!/scheduler_enabled\s*[=:]\s*true/.test(queries), "스케줄러 켜기 금지");
  assert.ok(queries.includes('.from("mobile_app_version_policies")') && queries.includes('.eq("role", "admin")'));
  const page = stripComments(read(PAGE));
  assert.ok(page.includes("<AdminPageLayout") && !page.includes("PageScaffold"));
  assert.ok(page.includes("<SettingsTopupPackageTable") && page.includes("<SettingsPolicyCards") && page.includes("<SettingsAppVersionTable") && page.includes("<SettingsAdminAccountList"), "섹션 4 + 관리자 계정");
  assert.ok(!/mobile_app_version_policies|payout_settings/.test(page), "페이지는 테이블에 직접 닿지 않는다");
  assert.equal(ADMIN_CONSOLE_NAV.find((n) => n.href === "/admin/settings")?.label, "시스템 설정");
});
