/**
 * 관리자 · 맞춤의뢰 주문 화면(PR-5 §3)의 순수 규칙. 기능이 꺼져 있어 **이관 + 비활성 표시만** 한다.
 *
 * - 탭 값·라벨은 이관 전 화면 그대로(기본 탭 `all`). 조치 버튼은 원래 없다(읽기 전용).
 * - `custom_request_orders` 에는 학생 컬럼 6개·멘토 컬럼 4개·상태 컬럼 4개·금액 컬럼 4개가 동의어로 있다(데이터 정본 §8-3).
 *   **현재 화면이 읽는 컬럼 순서를 그대로 유지**한다 — 정본 컬럼을 새로 고르지 않는다(별도 정리).
 * - 상태 표시는 `AdminStatusPill(custom_request_orders.status)` 를 거친다. 이 컬럼은 CHECK 가 없고 상태 사전에도 없어
 *   **neutral 톤 + 원시 값**으로 보인다(사전에 추가하지 않고 보고 — 지시서 공통 작업).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import type { AdminListParams } from "./adminListParams.ts";
import { buildAdminDataTableUrl } from "./adminDataTable.ts";

export const CUSTOM_REQUEST_ORDER_BASE_PATH = "/admin/custom-request-orders";
export const CUSTOM_REQUEST_ORDER_DEFAULT_PAGE_SIZE = 25;

export const CUSTOM_REQUEST_ORDER_TAB_VALUES = [
  "all",
  "pending",
  "open",
  "delivered",
  "revision_requested",
  "completed",
  "disputed",
  "cancelled",
  "refunded",
] as const;
export type CustomRequestOrderTab = (typeof CUSTOM_REQUEST_ORDER_TAB_VALUES)[number];
export const CUSTOM_REQUEST_ORDER_DEFAULT_TAB: CustomRequestOrderTab = "all";

export const CUSTOM_REQUEST_ORDER_TABS: readonly { value: CustomRequestOrderTab; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "pending", label: "대기" },
  { value: "open", label: "작업 중" },
  { value: "delivered", label: "납품 대기" },
  { value: "revision_requested", label: "수정 요청" },
  { value: "completed", label: "완료" },
  { value: "disputed", label: "분쟁" },
  { value: "cancelled", label: "취소" },
  { value: "refunded", label: "환불" },
];

export function isCustomRequestOrderTab(value: string): value is CustomRequestOrderTab {
  return (CUSTOM_REQUEST_ORDER_TAB_VALUES as readonly string[]).includes(value);
}

export function resolveCustomRequestOrderTab(status: string | null | undefined): CustomRequestOrderTab {
  const s = typeof status === "string" ? status.trim() : "";
  return isCustomRequestOrderTab(s) ? s : CUSTOM_REQUEST_ORDER_DEFAULT_TAB;
}

export function customRequestOrderTabStatus(tab: CustomRequestOrderTab): string | null {
  return tab === "all" ? null : tab;
}

export function buildCustomRequestOrderListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(CUSTOM_REQUEST_ORDER_BASE_PATH, params, overrides);
}

/** 상단 상시 배너(지시서 §3-1 원문) */
export const CUSTOM_REQUEST_ORDER_DISABLED_BANNER = "맞춤의뢰는 현재 비활성 상태입니다. 기능이 열리면 이 화면으로 주문이 들어옵니다.";

/**
 * 현재 화면이 읽는 동의어 컬럼 — 이관 전 `custom-request-orders/page.tsx` 의 키 목록 그대로(순서 포함).
 * 정본 컬럼 선택은 별도 정리(데이터 정본 §8-3) — 여기서 바꾸지 않는다.
 */
export const CUSTOM_REQUEST_ORDER_ROW_KEYS = {
  postId: ["post_id", "custom_request_post_id"],
  studentId: ["student_id", "buyer_id", "client_id", "user_id"],
  mentorId: ["mentor_id", "selected_mentor_id", "assigned_mentor_id"],
  status: ["status", "state", "order_status"],
  amount: ["agreed_price", "price", "amount", "total_amount"],
} as const;

export type CustomRequestOrderRow = Record<string, unknown>;

/** 동의어 컬럼 중 첫 비어 있지 않은 문자열(숫자는 문자열화). 없으면 fallback. */
export function customRequestOrderText(row: CustomRequestOrderRow, keys: readonly string[], fallback = "—"): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

/** 금액 표기 — 이관 전 화면의 `money()` 그대로(첫 유효 금액 컬럼 · 원 단위 반올림) */
export function customRequestOrderMoney(row: CustomRequestOrderRow): string {
  for (const key of CUSTOM_REQUEST_ORDER_ROW_KEYS.amount) {
    const raw = row[key];
    if (raw === null || raw === undefined) continue;
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    return Number.isFinite(n) ? `${Math.round(n).toLocaleString("ko-KR")}원` : "—";
  }
  return "—";
}

export const CUSTOM_REQUEST_ORDER_EMPTY_STATE = {
  title: "아직 들어온 맞춤의뢰 주문이 없습니다",
  description: "맞춤의뢰 기능이 열리면 학생이 결제한 주문이 이 화면에 쌓입니다. 지금은 비어 있는 것이 정상입니다.",
} as const;

export type CustomRequestOrderEmptyVariant = "first" | "tab" | "search";

export function customRequestOrderEmptyVariant(search: string, allCount: number): CustomRequestOrderEmptyVariant {
  if (search.trim()) return "search";
  if (allCount <= 0) return "first";
  return "tab";
}
