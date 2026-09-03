/**
 * 관리자 · 충전 관리 화면(PR-9 §2)의 순수 규칙 — 무통장입금(페이싱크) 주문 목록. **조회 전용.**
 *
 * §0 확인 결과(지시서 §11 보고):
 * - 캐시 적립은 `paysync_invoices` 로컬 정본 대조 → 페이싱크 재조회(paid 확인) → F11 `record_cash_topup_v2`(멱등키 = ledger_order_ref)
 *   한 경로뿐이다(`lib/paysync/paysyncTopupCore.ts`). 웹훅 · 보정 크론 · 학생의 "입금 재확인" 버튼이 **같은 코어**를 쓴다.
 * - `paid_trigger` 는 페이싱크가 준 값(AUTOMATIC_MATCHING · MANUAL_MATCHING · MANUAL_APPROVE · API_CALL) 또는 우리 경로 표시
 *   (RECONCILE_CRON · MANUAL_REFRESH) — 로직 분기 없이 감사용이다. 수동 매칭·수동 승인은 **페이싱크 대시보드**에서 이루어지고,
 *   그 결과가 웹훅으로 들어와 자동 적립된다.
 * - 관리자가 통장을 보고 캐시를 직접 지급하는 RPC·액션은 **없다.** `record_cash_topup` 은 `CASH_TOPUP_ALLOW_TEST_CHARGE` 로 잠긴
 *   테스트 충전 전용이고, 페이싱크 대조를 건너뛰는 지급 경로는 새로 만들지 않는다(지시서 §0·§6) → 이 화면은 조회 전용이다.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import type { AdminListParams } from "./adminListParams.ts";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminDataTableUrl, normalizeAdminListSearchTerm, type AdminDataTableTab } from "./adminDataTable.ts";
import { resolveAdminStatus } from "./adminStatusDictionary.ts";
import { PAYSYNC_PAID_TRIGGERS } from "../paysync/paysyncWebhookEvent.ts";

export const TOPUP_BASE_PATH = "/admin/topups";
export const TOPUP_DEFAULT_PAGE_SIZE = 25;

// ── 탭 — 상태 사전 `paysync_invoices.status` 4값 + 전체 ───────────────────────

export const TOPUP_TAB_VALUES = ["pending", "paid", "expired", "canceled", "all"] as const;
export type TopupTab = (typeof TOPUP_TAB_VALUES)[number];
export const TOPUP_DEFAULT_TAB: TopupTab = "pending";

/** 탭 라벨은 상태 사전 라벨 그대로(대기 · 완료 · 만료 · 취소) */
export const TOPUP_TABS: readonly AdminDataTableTab<TopupTab>[] = [
  ...(["pending", "paid", "expired", "canceled"] as const).map((value) => ({
    value,
    label: resolveAdminStatus("paysync_invoices", "status", value).label,
  })),
  { value: "all", label: "전체" },
];

export function resolveTopupTab(raw: string | null | undefined): TopupTab {
  const v = String(raw ?? "").trim();
  return (TOPUP_TAB_VALUES as readonly string[]).includes(v) ? (v as TopupTab) : TOPUP_DEFAULT_TAB;
}

/** 탭 → 서버 필터 상태(전체는 null) */
export function topupTabStatus(tab: TopupTab): string | null {
  return tab === "all" ? null : tab;
}

export function buildTopupListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(TOPUP_BASE_PATH, params, overrides);
}

// ── 검색 · 정렬 ───────────────────────────────────────────────────────────────

export const TOPUP_SEARCH_USER_ID_LIMIT = ADMIN_LIST_SEARCH_USER_ID_LIMIT;

export function normalizeTopupSearchTerm(raw: string | null | undefined): string {
  return normalizeAdminListSearchTerm(raw);
}

/** 입금자명 부분일치 + 요청자(users 검색으로 뽑은 id) — PostgREST `.or()` 인자 */
export function buildTopupSearchOr(term: string, userIds: readonly string[]): string {
  const parts = [`depositor_name.ilike.%${term}%`];
  if (userIds.length) parts.push(`user_id.in.(${userIds.join(",")})`);
  return parts.join(",");
}

export type TopupListOrder = { column: "expires_at" | "issued_at"; ascending: boolean; nullsFirst: boolean };

/** 정렬 기본값: 대기 탭은 **만료 임박순**(expires_at 오름차순 · 만료 없음은 뒤) · 나머지는 발행 최신순 */
export function topupListOrder(tab: TopupTab): TopupListOrder {
  if (tab === "pending") return { column: "expires_at", ascending: true, nullsFirst: false };
  return { column: "issued_at", ascending: false, nullsFirst: false };
}

// ── 만료까지 ─────────────────────────────────────────────────────────────────

/** 6시간 미만이면 주의색 */
export const TOPUP_EXPIRY_WARN_MS = 6 * 60 * 60 * 1000;

export type TopupExpiryKind = "none" | "expired" | "soon" | "ok";
export type TopupExpiryState = { kind: TopupExpiryKind; remainingMs: number | null };

/**
 * 만료 판정 — 대기(pending) 행만 남은 시간을 센다. 만료된 행(expired 상태 또는 시각 경과)은 `expired`,
 * 완료·취소 행은 `none`. 경계값(정확히 만료 시각)은 보정 크론(`paysyncReconcileCore`)과 같이 아직 만료가 아니다.
 */
export function topupExpiryState(input: { status: string; expiresAt: string | null }, nowIso: string): TopupExpiryState {
  const status = String(input.status ?? "").trim().toLowerCase();
  if (status === "expired") return { kind: "expired", remainingMs: null };
  if (status !== "pending") return { kind: "none", remainingMs: null };
  if (!input.expiresAt) return { kind: "none", remainingMs: null };
  const exp = Date.parse(input.expiresAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(exp) || !Number.isFinite(now)) return { kind: "none", remainingMs: null };
  const remaining = exp - now;
  if (remaining < 0) return { kind: "expired", remainingMs: 0 };
  return { kind: remaining < TOPUP_EXPIRY_WARN_MS ? "soon" : "ok", remainingMs: remaining };
}

/** "만료됨" · "5시간 12분" · "48분" · "1일 3시간" · "—" */
export function formatTopupRemaining(state: TopupExpiryState): string {
  if (state.kind === "expired") return "만료됨";
  if (state.kind === "none" || state.remainingMs == null) return "—";
  const totalMinutes = Math.floor(state.remainingMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

// ── 입금자명 ≠ 요청자 실명 (부모 이름으로 입금) ──────────────────────────────

function compactName(v: string | null | undefined): string {
  return String(v ?? "").replace(/\s+/g, "").trim();
}

/** 요청자 실명을 모르면(빈 값) 다르다고 표시하지 않는다 */
export function depositorDiffersFromRequester(depositorName: string, requesterName: string | null | undefined): boolean {
  const d = compactName(depositorName);
  const r = compactName(requesterName);
  if (!d || !r) return false;
  return d !== r;
}

// ── paid_trigger ─────────────────────────────────────────────────────────────

/** 우리 경로가 넣는 trigger 값 — 웹훅 밖에서 적립됐다는 표시(paysyncTopupServer 호출부와 같은 문자열) */
export const TOPUP_LOCAL_TRIGGERS = ["RECONCILE_CRON", "MANUAL_REFRESH"] as const;

export const TOPUP_TRIGGER_LABELS: Readonly<Record<string, string>> = {
  AUTOMATIC_MATCHING: "자동 매칭",
  MANUAL_MATCHING: "수동 매칭(페이싱크)",
  MANUAL_APPROVE: "수동 승인(페이싱크)",
  API_CALL: "API 호출",
  RECONCILE_CRON: "보정 크론",
  MANUAL_REFRESH: "학생 재확인",
};

/** 사전에 없는 값은 원시 값 그대로(감사용 컬럼 — 값이 늘어도 화면이 깨지면 안 된다). 비어 있으면 "—" */
export function topupTriggerLabel(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  return TOPUP_TRIGGER_LABELS[s] ?? s;
}

/** 페이싱크 대시보드에서 사람이 매칭·승인한 건인가 */
export function isTopupTriggerManual(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  return s === "MANUAL_MATCHING" || s === "MANUAL_APPROVE";
}

/** 페이싱크 문서의 trigger 4종이 전부 라벨을 갖는지 — 계약 테스트가 고정한다 */
export const TOPUP_KNOWN_PAYSYNC_TRIGGERS: readonly string[] = PAYSYNC_PAID_TRIGGERS;

// ── 행 ───────────────────────────────────────────────────────────────────────

export type TopupListItem = {
  id: string;
  userId: string;
  paysyncInvoiceId: string;
  depositorName: string;
  /** 요청자 실명(users.full_name). 모르면 null */
  requesterName: string | null;
  requesterNickname: string | null;
  /** 원(KRW) — paysync_invoices 는 원 단위로 보관한다 */
  payKrw: number;
  cashKrw: number;
  bonusKrw: number;
  status: string;
  issuedAt: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  paidTrigger: string | null;
  depositorDiffers: boolean;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

function intOf(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

export function parseTopupRow(
  row: Record<string, unknown>,
  requester: { fullName: string | null; nickname: string | null } | null
): TopupListItem | null {
  const id = str(row.id);
  const userId = str(row.user_id);
  if (!id || !userId) return null;
  const depositorName = str(row.depositor_name);
  return {
    id,
    userId,
    paysyncInvoiceId: str(row.paysync_invoice_id),
    depositorName,
    requesterName: requester?.fullName || null,
    requesterNickname: requester?.nickname || null,
    payKrw: intOf(row.pay_krw),
    cashKrw: intOf(row.cash_krw),
    bonusKrw: intOf(row.bonus_krw),
    status: str(row.status) || "pending",
    issuedAt: str(row.issued_at) || null,
    expiresAt: str(row.expires_at) || null,
    paidAt: str(row.paid_at) || null,
    paidTrigger: str(row.paid_trigger) || null,
    depositorDiffers: depositorDiffersFromRequester(depositorName, requester?.fullName ?? null),
  };
}

/** "30,000원" */
export function formatTopupWon(won: number): string {
  return `${Math.trunc(won).toLocaleString("ko-KR")}원`;
}

// ── 문구 ─────────────────────────────────────────────────────────────────────

export const TOPUP_READ_ONLY_NOTICE = "입금은 자동으로 감지됩니다. 감지가 안 된 건은 고객센터로 처리합니다.";

export const TOPUP_EMPTY_STATE = {
  title: "대기 중인 충전 요청이 없습니다",
  description: "학생이 계좌이체 충전을 요청하면 여기에 쌓입니다. 요청서는 발행 후 24시간 뒤 만료됩니다.",
} as const;

export function topupEmptyState(tab: TopupTab, search: string): { title: string; description: string } {
  if (search) {
    return { title: "조건에 맞는 충전 요청이 없습니다", description: `'${search}' 검색 결과가 없습니다. 검색어를 바꾸거나 초기화해 주세요.` };
  }
  if (tab === "pending") return TOPUP_EMPTY_STATE;
  if (tab === "all") return { title: "충전 요청이 아직 없습니다", description: TOPUP_EMPTY_STATE.description };
  const label = TOPUP_TABS.find((t) => t.value === tab)?.label ?? tab;
  return { title: `'${label}' 상태의 충전 요청이 없습니다`, description: "다른 탭에서 확인할 수 있습니다." };
}
