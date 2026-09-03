/**
 * 관리자 · 시스템 설정 화면(PR-10 §3)의 순수 규칙 — 섹션 4개(충전 패키지 · 요금제·수수료 · 정산 설정 · 앱 버전 정책) + 관리자 계정.
 *
 * - **편집은 충전 패키지 토글 하나뿐**(기존 액션 · `stateChange` 확인 — 학생에게 보이는 상품). 나머지는 읽기 전용이며 왜 읽기 전용인지 한 줄로 보인다.
 * - 요금제·수수료·정원은 **정본에서 읽어** 표시한다: 카탈로그·밴드는 `lib/subscribe/*`, 수수료 정책 요율은 `lib/payout/platformFeePolicy.ts`,
 *   정원 가중치·기본 한도는 DB 함수(`subscription_cap_weight` · `mentor_cap_limit` — `mentorCapUsageCore` 어댑터). **이 모듈에 숫자를 박지 않는다**
 *   (계약 테스트가 리터럴을 금지한다) — 화면이 정본 값을 인자로 넘기고 이 모듈은 문자열만 만든다.
 * - 앱 버전 정책(`mobile_app_version_policies`)은 정책 0개 `service_role` 전용이고 쓰기 경로가 없다 → 표시 + `store_url` NULL 경고만.
 * - 관리자 계정은 조회만. e2e 계정은 경고 배지(처리는 오너).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */

export const SETTINGS_BASE_PATH = "/admin/settings";

export const SETTINGS_READ_ONLY_NOTE = "이 값은 코드와 DB 함수에서 관리됩니다. 변경은 개발 배포로 합니다.";
export const SETTINGS_SCHEDULER_NOTE = "자동 정산은 오너 결정으로 꺼져 있습니다. 정산은 관리자가 정산 화면에서 수동 실행합니다.";
export const SETTINGS_APP_VERSION_NOTE = "이 표는 앱 연결 배치에서 채웁니다(정책 0개 · 서비스 롤 전용). 이 화면에는 편집이 없습니다.";
export const SETTINGS_STORE_URL_WARNING = "스토어 URL이 비어 있으면 강제 업데이트 시 사용자가 스토어로 이동할 수 없습니다.";
export const SETTINGS_ADMIN_ACCOUNTS_NOTE = "관리자 추가·삭제는 이 화면에서 하지 않습니다.";
export const SETTINGS_TEST_ACCOUNT_WARNING = "테스트 계정 — 운영에 남아 있음";
export const SETTINGS_EMPTY_LABEL = "비어 있음";

// ── 충전 패키지 ────────────────────────────────────────────────────────────────

export type TopupPackageRow = {
  id: string;
  label: string | null;
  amountCents: number | null;
  priceCents: number | null;
  displayOrder: number | null;
  active: boolean;
};

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function parseTopupPackageRow(row: Row | null | undefined): TopupPackageRow | null {
  if (!row) return null;
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    label: str(row.label) || null,
    amountCents: numOrNull(row.amount_cents),
    priceCents: numOrNull(row.price_cents),
    displayOrder: numOrNull(row.display_order),
    active: row.active === true,
  };
}

/** minor(원×100) → `30,000원` */
export function formatPackageWon(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return `${Math.round(cents / 100).toLocaleString("ko-KR")}원`;
}

/** 패키지 표시 이름 — 라벨이 없으면 결제 금액으로 */
export function topupPackageDisplayName(pkg: Pick<TopupPackageRow, "label" | "priceCents" | "amountCents">): string {
  if (pkg.label) return pkg.label;
  const won = formatPackageWon(pkg.priceCents ?? pkg.amountCents);
  return won === "—" ? "이름 없는 패키지" : `${won} 패키지`;
}

/** stateChange 확인 문구 — `30,000원 패키지를 비활성화합니다. 충전 화면에서 사라집니다.` */
export function buildTopupPackageToggleSummary(pkg: Pick<TopupPackageRow, "label" | "priceCents" | "amountCents">, nextActive: boolean): string {
  const name = topupPackageDisplayName(pkg);
  return nextActive ? `${name}를 활성화합니다. 충전 화면에 다시 표시됩니다.` : `${name}를 비활성화합니다. 충전 화면에서 사라집니다.`;
}

// ── 요금제 · 수수료 · 정원(정본 값은 인자로) ─────────────────────────────────────

export type SettingsPlanCatalogInput = { tier: string; label: string; cashKrw: number; weeklyLabel: string; recommend?: boolean };
export type SettingsPlanBandInput = { minCashKrw: number; recommendedCashKrw: number; maxCashKrw: number };

export type SettingsPlanRow = {
  tier: string;
  label: string;
  weeklyLabel: string;
  recommend: boolean;
  catalogCashKrw: number;
  minCashKrw: number;
  recommendedCashKrw: number;
  maxCashKrw: number;
};

export function buildSettingsPlanRows(catalog: readonly SettingsPlanCatalogInput[], bands: Readonly<Record<string, SettingsPlanBandInput>>): SettingsPlanRow[] {
  return catalog.map((c) => {
    const band = bands[c.tier];
    return {
      tier: c.tier,
      label: c.label,
      weeklyLabel: c.weeklyLabel,
      recommend: c.recommend === true,
      catalogCashKrw: c.cashKrw,
      minCashKrw: band ? band.minCashKrw : c.cashKrw,
      recommendedCashKrw: band ? band.recommendedCashKrw : c.cashKrw,
      maxCashKrw: band ? band.maxCashKrw : c.cashKrw,
    };
  });
}

export function formatCash(cashKrw: number): string {
  return `${cashKrw.toLocaleString("ko-KR")}`;
}

/** `라이트 29,900~69,900 · 스탠다드 84,900~149,900 · 프리미엄 174,900~329,900` */
export function formatPlanBandLine(rows: readonly SettingsPlanRow[]): string {
  return rows.map((r) => `${r.label} ${formatCash(r.minCashKrw)}~${formatCash(r.maxCashKrw)}`).join(" · ");
}

/** 플랫폼 몫 비율(0.15) → `15%` */
export function formatFeeRateLabel(platformShare: number): string {
  if (!Number.isFinite(platformShare)) return "—";
  const pct = Math.round(platformShare * 1000) / 10;
  return `${pct}%`;
}

export type SettingsFeeInput = { subscription: number; individualQuestion: number; customRequest: number };

/** `구독 15% · 개별질문 15% · 맞춤의뢰 5%` */
export function buildFeeLine(fees: SettingsFeeInput): string {
  return `구독 ${formatFeeRateLabel(fees.subscription)} · 개별질문 ${formatFeeRateLabel(fees.individualQuestion)} · 맞춤의뢰 ${formatFeeRateLabel(fees.customRequest)}`;
}

export function formatCapWeight(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}

export function formatCapLimit(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export type SettingsCapInput = { weights: Readonly<Record<"limited" | "standard" | "premium", number>> | null; defaultLimit: number | null };

/** `한도 50 · 가중치 1.0 / 2.25 / 4.75` — DB 함수 값 그대로(판정 불가는 `—`) */
export function buildCapLine(cap: SettingsCapInput): string {
  const w = cap.weights;
  const weights = w ? `${formatCapWeight(w.limited)} / ${formatCapWeight(w.standard)} / ${formatCapWeight(w.premium)}` : "—";
  return `한도 ${formatCapLimit(cap.defaultLimit)} · 가중치 ${weights}`;
}

/** `mentor_cap_limit(p_mentor_id)` 의 행 부재 폴백(= 기본 한도)을 읽기 위한 존재하지 않는 id */
export const SETTINGS_CAP_PROBE_MENTOR_ID = "00000000-0000-0000-0000-000000000000";

// ── 정산 설정 ─────────────────────────────────────────────────────────────────

export const SETTINGS_SCHEDULER_LABELS = {
  off: "꺼짐 (관리자가 정산 화면에서 수동 실행)",
  on: "켜짐",
  unknown: "확인 불가",
} as const;

export function schedulerStateLabel(enabled: boolean | null): string {
  if (enabled === null) return SETTINGS_SCHEDULER_LABELS.unknown;
  return enabled ? SETTINGS_SCHEDULER_LABELS.on : SETTINGS_SCHEDULER_LABELS.off;
}

/** 오너 결정(항상 false)과 다르면 경고 한 줄 */
export function schedulerWarning(enabled: boolean | null): string | null {
  if (enabled === true) return "자동 정산 스케줄러가 켜져 있습니다 — 오너 결정(수동 실행만)과 다릅니다. 확인이 필요합니다.";
  if (enabled === null) return "정산 설정을 읽지 못했습니다(서비스 키 없음 또는 조회 실패).";
  return null;
}

// ── 앱 버전 정책 ─────────────────────────────────────────────────────────────

export type AppVersionPolicyRow = {
  platform: string;
  minSupportedBuild: number | null;
  latestBuild: number | null;
  minimumVersionName: string | null;
  storeUrl: string | null;
  message: string | null;
  updatedAt: string | null;
};

export function parseAppVersionPolicyRow(row: Row | null | undefined): AppVersionPolicyRow | null {
  if (!row) return null;
  const platform = str(row.platform).toLowerCase();
  if (!platform) return null;
  return {
    platform,
    minSupportedBuild: numOrNull(row.min_supported_build),
    latestBuild: numOrNull(row.latest_build),
    minimumVersionName: str(row.minimum_version_name) || null,
    storeUrl: str(row.store_url) || null,
    message: str(row.message) || null,
    updatedAt: str(row.updated_at) || null,
  };
}

export function appPlatformLabel(platform: string): string {
  const p = String(platform ?? "").trim().toLowerCase();
  if (p === "android") return "Android";
  if (p === "ios") return "iOS";
  return p || "—";
}

/** 플랫폼별 `store_url` NULL 경고 + 행 부재 경고 */
export function appVersionPolicyWarnings(rows: readonly AppVersionPolicyRow[]): string[] {
  const warnings: string[] = [];
  if (rows.length === 0) {
    warnings.push("앱 버전 정책 행이 없습니다(RPC 는 차단하지 않는 기본값을 돌려줍니다).");
    return warnings;
  }
  const missing = rows.filter((r) => !r.storeUrl).map((r) => appPlatformLabel(r.platform));
  if (missing.length) warnings.push(`${missing.join(" · ")} 스토어 URL이 비어 있습니다. ${SETTINGS_STORE_URL_WARNING}`);
  return warnings;
}

// ── 관리자 계정 ────────────────────────────────────────────────────────────────

export type AdminAccountRow = {
  id: string;
  email: string | null;
  fullName: string | null;
  nickname: string | null;
  createdAt: string | null;
  /** 이 관리자가 실행한 감사 로그 건수(조회 실패면 null) */
  logCount: number | null;
};

export function adminAccountDisplayName(row: Pick<AdminAccountRow, "fullName" | "nickname" | "email" | "id">): string {
  return row.fullName || row.nickname || row.email || `${row.id.slice(0, 8)}…`;
}

/** e2e·테스트 계정 판정 — `.test` 도메인 또는 로컬파트에 `e2e` 토큰. 처리는 오너(경고 배지만). */
export function isTestAdminAccount(email: string | null | undefined): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e.includes("@")) return false;
  const [local, domain] = e.split("@");
  if (/\.test$/.test(domain)) return true;
  return /(^|[-_.])e2e([-_.]|$)/.test(local);
}

export function adminAccountReviewLabel(logCount: number | null): string {
  if (logCount === null) return "조치 건수 확인 불가";
  return `조치 ${logCount.toLocaleString("ko-KR")}건`;
}
