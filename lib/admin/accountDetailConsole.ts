/**
 * 계정 목록(`/admin/users`) · 계정 상세(`/admin/users/[id]`)의 순수 규칙(PR-7).
 *
 * - 목록(패턴 A): 탭은 **역할**(`role` 키 — `extra` 파라미터)이고, 계정 상태(`status`)·본인인증(`verified`)은 툴바의 선택 필터다.
 *   공용 `AdminDataTable.Tabs` 는 `status` 키 하나만 다루므로 역할 탭에 그대로 쓸 수 없다 — prop 을 더하지 않고(지시서 §1)
 *   화면이 역할 탭을 직접 그린다(링크는 아래 `buildAccountRoleTabUrl`). 페이지네이션은 공용 조각(`AdminDataTable.Pagination`)이
 *   `extra` 를 보존하므로 그대로 쓴다.
 * - 상세(패턴 B): 헤더 상태축은 계정·승인 둘만(§2-1). 학교 인증·활동 상태는 각 섹션 라벨(`인증: …` · `활동: …`)로만 보인다.
 * - 조치 3종(§2-2): 경고 = stateChange + 프리셋 필수 · 정지(7일·30일·영구) = critical · 차단 = 대상 이름 재입력 + 사유(`destructive` 등급 —
 *   `adminConfirmPolicy` 에서 이름 재입력을 요구하는 유일한 등급이며 사유는 `reasonRequired` 로 격상한다. 정책·부품에 prop 을 더하지 않는다).
 *   세 조치 모두 계정 관리 화면의 기존 서버 액션(`accountStatusActions`)을 그대로 쓰고 `returnTo` 로 이 상세에 돌아온다.
 * - 정원(§2-3): 사용량·한도·가중치는 DB RPC 값(`loadMentorCapUsage`)이다. 요금제별 내역은 활성 구독을 요금제별로 센 뒤
 *   RPC 가중치(`subscription_cap_weight`)를 곱한다 — 가중치·한도 TS 상수 없음(PR-1b). 정원 조정은 미도달 라우트의 기존 액션
 *   (`updateMentorCapLimitAction`)을 재사용한다.
 * - 요금제(§2-3): 현재가·활성 여부·최종 변경일은 `mentor_plans` 행 값이다. 허용 범위(밴드)는 DB 에 정본이 없어(SQL 121 은 1회성
 *   클램프 스크립트) 저장 시 서버가 강제하는 정본 모듈 `lib/subscribe/mentorPlanPricing.ts` 를 그대로 읽는다 — 새 상수를 두지 않는다.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { buildAdminDataTableUrl, type AdminDataTableTab } from "./adminDataTable.ts";
import type { AdminListParams } from "./adminListParams.ts";
import {
  ACCOUNT_SANCTION_CODES,
  ACCOUNT_SANCTION_LABELS,
  ACCOUNT_SANCTION_TO_STATUS,
  ACCOUNT_STATUS_RETURN_TO_FIELD,
  ACCOUNT_WARNING_AUTO_SUSPEND_DAYS,
  buildAccountSanctionSummary,
  buildAccountWarningSummary,
  type AccountSanctionCode,
} from "./accountSanctionPolicy.ts";
import { CONTENT_REPORT_CUSTOM_REASON_LABEL, CONTENT_REPORT_WARNING_PRESETS } from "./contentReportSanctionConsole.ts";
import { getSubscribeCatalogPlan } from "../subscribe/subscribePlanCatalog.ts";
import type { CapWeightByTier } from "../subscribe/mentorCapUsageCore.ts";
import type { SubscribePlanTier } from "../subscribe/subscribePageQueries.ts";

// ── 경로 ─────────────────────────────────────────────────────────────────────

export const ACCOUNT_BASE_PATH = "/admin/users";
export const ACCOUNT_DEFAULT_PAGE_SIZE = 25;
/** 목록 기본 상태 필터 — 전체(필터 없음). 공용 파서의 `defaultStatus` 로 넘긴다. */
export const ACCOUNT_DEFAULT_STATUS = "all";

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuidLike(value: string | null | undefined): boolean {
  return UUID_PATTERN.test(String(value ?? "").trim());
}

/** 계정 상세 경로 — 콘솔 어디서든 사람 이름은 여기로 온다(§3). */
export function accountDetailPath(userId: string): string {
  return `${ACCOUNT_BASE_PATH}/${encodeURIComponent(String(userId ?? "").trim())}`;
}

/** 상세 링크 + 탭·정원 조정 플래시. 옛 라우트(`/admin/mentor-approvals/[id]`)의 리다이렉트가 플래시를 이어 붙일 때도 쓴다. */
export function buildAccountDetailUrl(
  userId: string,
  opts: { tab?: AccountDetailTab | null; capOk?: boolean; capError?: string | null; logs?: string | null } = {}
): string {
  const usp = new URLSearchParams();
  if (opts.tab) usp.set(ACCOUNT_DETAIL_TAB_PARAM, opts.tab);
  if (opts.capOk) usp.set("capOk", "1");
  if (opts.capError) usp.set("capError", opts.capError);
  if (opts.logs) usp.set(ACCOUNT_ACTION_LOG_MORE_PARAM, opts.logs);
  const qs = usp.toString();
  return qs ? `${accountDetailPath(userId)}?${qs}` : accountDetailPath(userId);
}

// ── 목록: 역할 탭 · 필터 ─────────────────────────────────────────────────────

export const ACCOUNT_ROLE_PARAM = "role";
export const ACCOUNT_ROLE_TAB_VALUES = ["all", "mentor", "student", "admin"] as const;
export type AccountRoleTab = (typeof ACCOUNT_ROLE_TAB_VALUES)[number];
export const ACCOUNT_ROLE_TABS: readonly AdminDataTableTab<AccountRoleTab>[] = [
  { value: "all", label: "전체" },
  { value: "mentor", label: "멘토" },
  { value: "student", label: "학생" },
  { value: "admin", label: "관리자" },
];
export const ACCOUNT_DEFAULT_ROLE_TAB: AccountRoleTab = "all";

export function resolveAccountRoleTab(raw: string | null | undefined): AccountRoleTab {
  const s = String(raw ?? "").trim().toLowerCase();
  return (ACCOUNT_ROLE_TAB_VALUES as readonly string[]).includes(s) ? (s as AccountRoleTab) : ACCOUNT_DEFAULT_ROLE_TAB;
}

/** 탭 → `users.role` 서버 필터 값. 전체 탭은 필터 없음(null). */
export function accountRoleTabFilter(tab: AccountRoleTab): string | null {
  return tab === "all" ? null : tab;
}

export const ACCOUNT_STATUS_FILTER_VALUES = ["all", "active", "suspended", "banned"] as const;
export type AccountStatusFilter = (typeof ACCOUNT_STATUS_FILTER_VALUES)[number];
export const ACCOUNT_STATUS_FILTER_LABELS: Readonly<Record<AccountStatusFilter, string>> = {
  all: "계정 상태 전체",
  active: "정상",
  suspended: "일시 정지",
  banned: "영구 차단",
};

export function resolveAccountStatusFilter(raw: string | null | undefined): AccountStatusFilter {
  const s = String(raw ?? "").trim().toLowerCase();
  return (ACCOUNT_STATUS_FILTER_VALUES as readonly string[]).includes(s) ? (s as AccountStatusFilter) : "all";
}

export const ACCOUNT_VERIFIED_PARAM = "verified";
export const ACCOUNT_VERIFIED_FILTER_VALUES = ["all", "yes", "no"] as const;
export type AccountVerifiedFilter = (typeof ACCOUNT_VERIFIED_FILTER_VALUES)[number];
/** 필터는 `users.identity_verified_at` 의 유무(서버 컬럼). 표시 배지는 `identity_verifications` 판정(4상태)이다. */
export const ACCOUNT_VERIFIED_FILTER_LABELS: Readonly<Record<AccountVerifiedFilter, string>> = {
  all: "본인인증 전체",
  yes: "인증 완료",
  no: "미인증",
};

export function resolveAccountVerifiedFilter(raw: string | null | undefined): AccountVerifiedFilter {
  const s = String(raw ?? "").trim().toLowerCase();
  return (ACCOUNT_VERIFIED_FILTER_VALUES as readonly string[]).includes(s) ? (s as AccountVerifiedFilter) : "all";
}

/** 목록 링크 — 공용 규칙(`buildAdminDataTableUrl`: `status=all` 되살림 · `extra`(role·verified) 보존). */
export function buildAccountListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(ACCOUNT_BASE_PATH, params, overrides);
}

/** 역할 탭 링크 — `role` 은 extra 파라미터라 전체 탭은 빈 값으로 지운다(공용 빌더가 빈 값을 제거로 해석한다). */
export function buildAccountRoleTabUrl(params: AdminListParams, tab: AccountRoleTab): string {
  return buildAccountListUrl(params, { extra: { ...params.extra, [ACCOUNT_ROLE_PARAM]: tab === "all" ? "" : tab } });
}

// ── 목록: 최근 활동 ───────────────────────────────────────────────────────────

export type AccountLastActivitySource = "audit" | "profile";
export const ACCOUNT_LAST_ACTIVITY_SOURCE_LABELS: Readonly<Record<AccountLastActivitySource, string>> = {
  audit: "관리자 조치(감사 로그) 기준",
  profile: "계정 행 갱신(updated_at) 기준",
};

function timeOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * "최근 활동" — 이 사용자를 대상으로 한 마지막 감사 로그(`admin_action_logs.created_at`)와 `users.updated_at` 중 늦은 쪽.
 * 둘 다 없으면 null. 출처를 함께 돌려줘 화면이 툴팁으로 드러낸다(§1 — 데이터 출처 명시).
 */
export function resolveAccountLastActivity(input: { updatedAt: string | null; lastAdminLogAt: string | null }): {
  at: string | null;
  source: AccountLastActivitySource | null;
} {
  const profile = timeOf(input.updatedAt);
  const audit = timeOf(input.lastAdminLogAt);
  if (!profile && !audit) return { at: null, source: null };
  if (audit > profile) return { at: input.lastAdminLogAt, source: "audit" };
  return { at: input.updatedAt, source: "profile" };
}

// ── 상세: 탭 · 헤더 상태축 ───────────────────────────────────────────────────

export const ACCOUNT_DETAIL_TAB_PARAM = "tab";

export type AccountDetailTab = "mentor" | "students" | "answers" | "student" | "individual" | "mentors" | "admin";
export type AccountDetailTabDef = { value: AccountDetailTab; label: string };

/**
 * 역할별 탭 — PR-7 이 자리만 만들어 둔 탭은 PR-8 에서 열렸다(질문 · 연결노트 드릴다운, `questionDrilldownConsole.ts`):
 * 학생 [개별질문]·[구독 멘토] / 멘토 [담당 학생]·[개별질문 답변]. 멘토의 [담당 학생]·학생의 [구독 멘토]는 같은 멘토별 화면
 * (`/admin/question-rooms/<roomId>`)으로 이어진다 — 방향만 반대. [개별질문]·[개별질문 답변]은 같은 표(질문이 단위)다.
 */
const MENTOR_TABS: readonly AccountDetailTabDef[] = [
  { value: "mentor", label: "멘토" },
  { value: "students", label: "담당 학생" },
  { value: "answers", label: "개별질문 답변" },
];
const STUDENT_TABS: readonly AccountDetailTabDef[] = [
  { value: "student", label: "학생" },
  { value: "individual", label: "개별질문" },
  { value: "mentors", label: "구독 멘토" },
];
const ADMIN_TABS: readonly AccountDetailTabDef[] = [{ value: "admin", label: "관리자" }];

export function accountDetailTabsForRole(role: string | null | undefined): readonly AccountDetailTabDef[] {
  const r = String(role ?? "").trim().toLowerCase();
  if (r === "mentor") return MENTOR_TABS;
  if (r === "admin") return ADMIN_TABS;
  return STUDENT_TABS;
}

export function resolveAccountDetailTab(role: string | null | undefined, raw: string | null | undefined): AccountDetailTab {
  const tabs = accountDetailTabsForRole(role);
  const s = String(raw ?? "").trim().toLowerCase();
  return tabs.find((t) => t.value === s)?.value ?? tabs[0].value;
}

export type AccountHeaderAxis = "account" | "approval";
/** 헤더 상태축 — 멘토는 계정·승인 둘, 그 외는 계정 하나. 학교 인증·활동은 헤더에 오지 않는다(§2-1). */
export function accountHeaderAxes(role: string | null | undefined): readonly AccountHeaderAxis[] {
  return String(role ?? "").trim().toLowerCase() === "mentor" ? ["account", "approval"] : ["account"];
}

/** 헤더 신원 블록의 미인증 문장 — PR-2 의 "승인 후 인증 안내가 발송됩니다" 는 승인 화면 전용이라 여기서는 사실만 적는다. */
export const ACCOUNT_IDENTITY_UNVERIFIED_WARNING = "본인인증이 완료되지 않았습니다.";

// ── 멘토 탭: 섹션 라벨·경고 ──────────────────────────────────────────────────

export const MENTOR_PLAN_MISSING_WARNING = "요금제 미설정 — 구독을 받을 수 없습니다";
export const MENTOR_PAYOUT_MISSING_WARNING = "정산 계좌 미등록 — 지급이 보류됩니다";
export const STUDENT_BIRTH_DATE_MISSING_WARNING = "생년월일 미입력";

export type SchoolVerificationMode = "none" | "auto" | "confirmed";
export function schoolVerificationSectionLabel(mode: SchoolVerificationMode): string {
  if (mode === "confirmed") return "인증: 확정";
  if (mode === "auto") return "인증: 자동 판정 · 미확정";
  return "인증: 행 없음";
}

export type MentorActivityLabelState = "active" | "paused" | "terminating" | "terminated";
export const MENTOR_ACTIVITY_LABELS: Readonly<Record<MentorActivityLabelState, string>> = {
  active: "활동 중",
  paused: "일시정지",
  terminating: "종료 예정",
  terminated: "종료",
};
export function mentorActivitySectionLabel(state: MentorActivityLabelState): string {
  return `활동: ${MENTOR_ACTIVITY_LABELS[state] ?? state}`;
}

/** 계좌번호 마스킹 — 숫자 끝 4자리만 남긴다. 비어 있으면 null. */
export function maskAccountNumber(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const tail = digits.slice(-4);
  return `${"*".repeat(Math.max(0, Math.min(8, digits.length - tail.length)))}${tail}`;
}

export function mentorPayoutRegistered(bankName: string | null | undefined, accountNumber: string | null | undefined): boolean {
  return String(bankName ?? "").trim().length > 0 && String(accountNumber ?? "").trim().length > 0;
}

// ── 멘토 탭: 요금제 ──────────────────────────────────────────────────────────

export const ACCOUNT_PLAN_TIERS: readonly SubscribePlanTier[] = ["limited", "standard", "premium"];

export type MentorPlanSummaryRow = {
  tier: SubscribePlanTier;
  label: string;
  /** `mentor_plans` 행이 있는가 */
  present: boolean;
  /** 실차감 기준 현재가(캐시) — 행이 없으면 null */
  cashKrw: number | null;
  /** `amount_cents` 가 비어 권장가로 낙하하는 행인가 */
  fallbackToRecommended: boolean;
  isActive: boolean | null;
  priceUpdatedAt: string | null;
};

export function planTierLabel(tier: SubscribePlanTier): string {
  return getSubscribeCatalogPlan(tier).label;
}

export function formatPlanCash(cashKrw: number | null): string {
  if (cashKrw == null || !Number.isFinite(cashKrw)) return "—";
  return `${Math.round(cashKrw).toLocaleString("ko-KR")}캐시`;
}

/** 요금제 섹션 요약 한 줄 — 행이 하나도 없으면 경고 문장, 있으면 `라이트 29,900캐시 · 스탠다드 … · 프리미엄 …`. */
export function mentorPlanSectionSummary(rows: readonly MentorPlanSummaryRow[]): string {
  if (!rows.some((r) => r.present)) return MENTOR_PLAN_MISSING_WARNING;
  return rows.map((r) => `${r.label} ${r.present ? formatPlanCash(r.cashKrw) : "미설정"}${r.present && r.isActive === false ? "(비활성)" : ""}`).join(" · ");
}

export function mentorPlansMissing(rows: readonly MentorPlanSummaryRow[]): boolean {
  return !rows.some((r) => r.present);
}

// ── 멘토 탭: 정원 ────────────────────────────────────────────────────────────

export type MentorCapTierBreakdown = {
  tier: SubscribePlanTier;
  label: string;
  count: number;
  /** DB subscription_cap_weight(tier) */
  weight: number;
  /** count × weight */
  weighted: number;
};

/**
 * 요금제별 인원 내역 — 활성 구독 수(요금제별) × RPC 가중치. 가중치 표를 못 읽었으면(null) 내역을 지어내지 않고 null.
 */
export function buildMentorCapBreakdown(input: {
  activeCountByTier: Readonly<Partial<Record<SubscribePlanTier, number>>>;
  capWeightByTier: CapWeightByTier | null;
}): { rows: MentorCapTierBreakdown[]; total: number } | null {
  if (!input.capWeightByTier) return null;
  const rows = ACCOUNT_PLAN_TIERS.map((tier) => {
    const count = Math.max(0, Math.trunc(input.activeCountByTier[tier] ?? 0));
    const weight = input.capWeightByTier![tier];
    return { tier, label: planTierLabel(tier), count, weight, weighted: count * weight };
  });
  const total = rows.reduce((sum, r) => sum + r.weighted, 0);
  return { rows, total: Math.round(total * 10) / 10 };
}

/** 내역 합이 RPC 사용량과 같은가(소수 1자리 반올림 오차 허용). 사용량이 null 이면 판정 불가 → false. */
export function capBreakdownMatchesUsed(total: number, usedCap: number | null): boolean {
  if (usedCap == null || !Number.isFinite(usedCap)) return false;
  return Math.abs(total - usedCap) < 0.05;
}

/** 남은 한도로 더 받을 수 있는 인원(기준 요금제 가중치) — 판정 불가면 null. */
export function capRemainingSeats(capLimit: number | null, usedCap: number | null, weight: number | null): number | null {
  if (capLimit == null || usedCap == null || weight == null || !(weight > 0)) return null;
  return Math.max(0, Math.floor((capLimit - usedCap + 1e-9) / weight));
}

/** cap 수치 표시 — RPC 값 그대로. 판정 불가(null)는 '—'. (PR-2 `formatCapValue` 와 같은 규칙) */
export function formatCapNumber(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatCapBreakdownLine(rows: readonly MentorCapTierBreakdown[]): string {
  return rows.map((r) => `${r.label} ${r.count}명(${formatCapNumber(r.weighted)})`).join(" · ");
}

// ── 멘토 탭: 정원 조정(미도달 라우트의 액션 재사용) ─────────────────────────

/** `updateMentorCapLimitAction` 이 읽는 필드명 — 바꾸지 않는다. `reason` 은 PR-7 에서 액션에 더한 선택 필드(감사 로그 detail). */
export const MENTOR_CAP_ADJUST_FIELDS = {
  mentorUserId: "mentorUserId",
  capLimit: "capLimit",
  reason: "reason",
} as const;
/** 액션의 검증 범위(0~1000 · 소수 1자리)와 같다. */
export const MENTOR_CAP_ADJUST_MIN = 0;
export const MENTOR_CAP_ADJUST_MAX = 1000;
export const MENTOR_CAP_ADJUST_STEP = 0.5;

export function parseCapLimitInput(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < MENTOR_CAP_ADJUST_MIN || n > MENTOR_CAP_ADJUST_MAX) return null;
  return Math.round(n * 10) / 10;
}

/** 현재 사용량보다 낮게 설정하려 하면 경고 문장(§2-3). 값이 없거나 사용량 미상이면 null. */
export function capAdjustBelowUsageWarning(nextLimit: number | null, usedCap: number | null): string | null {
  if (nextLimit == null || usedCap == null) return null;
  if (nextLimit + 1e-9 >= usedCap) return null;
  return `새 한도 ${formatCapNumber(nextLimit)} 이(가) 현재 사용량 ${formatCapNumber(usedCap)} 보다 낮습니다. 기존 구독은 유지되지만 한도를 넘긴 상태가 되어 새 구독을 받을 수 없습니다.`;
}

export function buildMentorCapAdjustSummary(input: { name: string; currentLimit: number | null; nextLimit: number | null; usedCap: number | null }): string {
  const who = input.name.trim() || "이름 없음";
  const next = input.nextLimit == null ? "(미입력)" : formatCapNumber(input.nextLimit);
  const lines = [`${who} 멘토의 정원 한도를 ${formatCapNumber(input.currentLimit)} → ${next} 로 바꿉니다. 현재 사용량 ${formatCapNumber(input.usedCap)}.`];
  const warning = capAdjustBelowUsageWarning(input.nextLimit, input.usedCap);
  if (warning) lines.push(warning);
  return lines.join("\n");
}

export const MENTOR_CAP_ADJUST_BLOCKED_MESSAGE = `한도는 ${MENTOR_CAP_ADJUST_MIN}~${MENTOR_CAP_ADJUST_MAX} 사이 숫자(소수 1자리)여야 합니다.`;

// ── 조치 패널(§2-2) ──────────────────────────────────────────────────────────

export type AccountDetailActionKey = "warn" | "suspend" | "ban";
export type AccountDetailActionLevel = "stateChange" | "critical" | "destructive";

export const ACCOUNT_DETAIL_ACTIONS: Readonly<
  Record<AccountDetailActionKey, { level: AccountDetailActionLevel; label: string; dialogTitle: string; confirmLabel: string; pendingLabel: string }>
> = {
  warn: { level: "stateChange", label: "경고", dialogTitle: "경고 기록 — 사유 선택", confirmLabel: "경고 기록", pendingLabel: "기록 중…" },
  suspend: { level: "critical", label: "정지", dialogTitle: "계정 정지 — 실행 전 확인", confirmLabel: "정지 실행", pendingLabel: "정지 중…" },
  ban: { level: "destructive", label: "차단", dialogTitle: "영구 차단 — 대상 이름 재입력", confirmLabel: "영구 차단", pendingLabel: "차단 중…" },
};

/** 서버 액션이 읽는 필드명(바꾸지 않는다) — `accountStatusActions.ts` */
export const ACCOUNT_USER_ID_FIELD = "userId";
export const ACCOUNT_WARN_REASON_FIELD = "warnReason";
export const ACCOUNT_WARN_SEVERITY_FIELD = "severity";
export const ACCOUNT_WARN_SEVERITY_DEFAULT = "normal";
export const ACCOUNT_SUSPEND_STATUS_FIELD = "nextStatus";
export const ACCOUNT_SUSPEND_DURATION_FIELD = "durationDays";
export const ACCOUNT_SUSPEND_REASON_FIELD = "reason";
export const ACCOUNT_RETURN_TO_FIELD = ACCOUNT_STATUS_RETURN_TO_FIELD;

/** 경고 프리셋 — PR-6 신고 상세와 같은 4종 + 직접 입력 */
export const ACCOUNT_WARNING_PRESETS = CONTENT_REPORT_WARNING_PRESETS;
export const ACCOUNT_CUSTOM_REASON_LABEL = CONTENT_REPORT_CUSTOM_REASON_LABEL;

export const ACCOUNT_SUSPEND_CODES = ACCOUNT_SANCTION_CODES;
export const ACCOUNT_SUSPEND_CODE_LABELS = ACCOUNT_SANCTION_LABELS;
export type AccountSuspendCode = AccountSanctionCode;
export const ACCOUNT_SUSPEND_BLOCKED_MESSAGE = "정지 기간(7일 · 30일 · 영구)을 선택해 주세요.";

/** 기간 코드 → `setUserStatusAction` 필드 값 — PR-6 과 같은 표(`accountStatusCore.sanctionToAccountStatus`). */
export function accountSuspendFields(code: AccountSuspendCode): { nextStatus: "suspended" | "banned"; durationDays: string } {
  const m = ACCOUNT_SANCTION_TO_STATUS[code];
  return { nextStatus: m.nextStatus, durationDays: m.durationDays == null ? "" : String(m.durationDays) };
}

/** 차단 = `banned`(기간 없음). 정지 모달의 '영구' 와 같은 값이지만 이름 재입력 게이트를 거친다. */
export const ACCOUNT_BAN_FIELDS = { nextStatus: "banned", durationDays: "" } as const;

/** 차단 모달의 재입력 문자열 — 표시 이름(공백 정리). 이름이 없으면 id 앞 8자. */
export function accountBanConfirmText(name: string, userId: string): string {
  const n = String(name ?? "").trim().replace(/\s+/g, " ");
  return n || String(userId ?? "").slice(0, 8);
}

export const ACCOUNT_DETAIL_RESULT_NOTE = "처리 결과는 이 계정 상세 상단에 표시됩니다.";

export type AccountDetailActionTarget = {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  activeWarningCount: number | null;
  /** 멘토일 때 담당 학생 수 — 학생·조회 실패면 null */
  mentorRoomCount: number | null;
};

export function buildAccountDetailWarningSummary(target: Pick<AccountDetailActionTarget, "name" | "activeWarningCount">): string {
  return buildAccountWarningSummary({ name: target.name, activeWarningCount: target.activeWarningCount });
}

export function buildAccountDetailSuspendSummary(
  target: Pick<AccountDetailActionTarget, "name" | "roleLabel" | "role" | "mentorRoomCount">,
  code: AccountSuspendCode,
  untilLabel: string | null
): string {
  return buildAccountSanctionSummary({
    name: target.name,
    roleLabel: target.roleLabel,
    code,
    untilLabel,
    mentorRoomCount: target.mentorRoomCount,
    isMentor: target.role === "mentor",
  });
}

export function buildAccountDetailBanSummary(target: Pick<AccountDetailActionTarget, "name" | "roleLabel" | "role" | "mentorRoomCount">): string {
  return buildAccountDetailSuspendSummary(target, "permanent", null);
}

/** 관리자 계정은 서버가 두 액션 모두 거부한다 — 조치 패널을 두지 않는다(§2-5). */
export function accountDetailUserActionsAvailable(role: string | null | undefined): boolean {
  return String(role ?? "").trim().toLowerCase() !== "admin";
}

/**
 * 상세 `?ok=` 플래시 — 경고·정지 액션의 redirect 키(`warned:N` · `warned_suspended:N` · 계정 상태값). 모르는 값은 null.
 * 정원 조정은 `?capOk=1` · `?capError=` 를 따로 쓴다(액션이 그 키로 돌아온다).
 */
export function accountDetailFlashOkMessage(ok: string | null | undefined): string | null {
  const s = String(ok ?? "").trim();
  if (!s) return null;
  const count = (prefix: string) => {
    const n = s.slice(prefix.length);
    return /^\d+$/.test(n) ? ` (누적 ${n}회)` : "";
  };
  if (s.startsWith("warned_suspended:")) return `경고가 누적되어 계정을 ${ACCOUNT_WARNING_AUTO_SUSPEND_DAYS}일 자동 정지했습니다.${count("warned_suspended:")}`;
  if (s.startsWith("warned:")) return `경고를 기록했습니다.${count("warned:")}`;
  if (s === "suspended") return "계정을 일시 정지했습니다.";
  if (s === "banned") return "계정을 영구 차단했습니다.";
  if (s === "active") return "계정을 정상으로 되돌렸습니다.";
  return null;
}

export const ACCOUNT_CAP_OK_MESSAGE = "정원 한도를 저장했습니다.";

// ── 학생 탭 ──────────────────────────────────────────────────────────────────

export type CashLedgerKind = "charge" | "debit" | "refund" | "bonus";
export const CASH_LEDGER_KIND_LABELS: Readonly<Record<CashLedgerKind, string>> = {
  charge: "충전",
  debit: "차감",
  refund: "환불",
  bonus: "보너스",
};

/**
 * 원장 행 분류(충전·차감·환불·보너스) — `reason`/`ref_type` 에 bonus → 보너스, refund·rollback → 환불, 그 외는 부호(+ 충전 · − 차감).
 */
export function classifyCashLedgerEntry(input: { deltaCents: number; reason: string | null; refType: string | null }): CashLedgerKind {
  const blob = `${String(input.reason ?? "")} ${String(input.refType ?? "")}`.toLowerCase();
  if (/bonus/.test(blob)) return "bonus";
  if (/refund|rollback/.test(blob)) return "refund";
  return input.deltaCents < 0 ? "debit" : "charge";
}

export function studentProfileWarnings(input: { birthDate: string | null }): string[] {
  const out: string[] = [];
  if (!String(input.birthDate ?? "").trim()) out.push(STUDENT_BIRTH_DATE_MISSING_WARNING);
  return out;
}

/** 구독 현황에 보이는 상태 집합 — 활성·해지 예정(만료 예정)·만료(+해지). 결제 대기 등은 제외한다(§2-4). */
export const STUDENT_SUBSCRIPTION_VISIBLE_STATUSES: readonly string[] = ["active", "cancel_scheduled", "past_due", "canceled", "expired"];

// ── 처리 이력 ────────────────────────────────────────────────────────────────

export const ACCOUNT_ACTION_LOG_PAGE = 20;
export const ACCOUNT_ACTION_LOG_MORE = 100;
export const ACCOUNT_ACTION_LOG_MORE_PARAM = "logs";

const ACCOUNT_ACTION_LOG_LABELS: Readonly<Record<string, string>> = {
  account_status_change: "계정 상태 변경",
  user_warning_issued: "경고 발급",
  mentor_cap_limit_update: "정원 조정",
  mentor_approve: "멘토 승인",
  mentor_reject: "멘토 반려",
  mentor_request_documents: "서류 재제출 요청",
  mentor_termination_finalized: "멘토 활동 종료 확정",
  mentor_abandonment_hold_approved: "이탈 정산 보류 승인",
  mentor_settlement_hold_released: "정산 보류 해제",
  refund_approve: "환불 승인",
  refund_reject: "환불 반려",
  question_body_viewed: "질문 본문 열람",
};

export function accountActionLogLabel(actionType: string | null | undefined): string {
  const a = String(actionType ?? "").trim();
  if (!a) return "처리";
  return ACCOUNT_ACTION_LOG_LABELS[a] ?? a;
}

/** 감사 로그 detail 에서 사유로 볼 만한 값 하나 — 액션마다 키가 다르다(reason · rejectionReason · adminNote · note). */
export function accountActionLogReason(detail: unknown): string | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const d = detail as Record<string, unknown>;
  for (const key of ["reason", "rejectionReason", "adminNote", "note", "status", "capLimit"]) {
    const v = d[key];
    if (typeof v === "string" && v.trim()) return key === "status" ? `상태 ${v.trim()}` : v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return key === "capLimit" ? `한도 ${v}` : String(v);
  }
  return null;
}
