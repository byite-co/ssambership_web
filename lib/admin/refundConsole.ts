/**
 * 관리자 · 환불 화면(PR-3)의 순수 규칙 — 목록·상세·확인 모달·일괄 처리가 함께 쓴다.
 *
 * 화면이 다루는 값의 출처(§0 확인 결과):
 * - **금액은 요청 시점 저장값** `refunds.amount_cents`(minor, 원×100) 다. RPC `approve_refund_request_admin` 은
 *   `r.amount_cents` 를 그대로 원장에 넣고 재계산하지 않는다 → 모달·목록·총액은 전부 `refundAmountWon()` 한 함수로만 변환한다.
 * - **사유**는 RPC 의 `p_admin_note` 파라미터로 들어가 `refunds.admin_note` 에 남고, 액션이 `admin_action_logs.detail.note` 에도 남긴다.
 *   기존 액션이 읽는 필드명(`adminNote`)을 그대로 쓴다.
 * - **일괄 승인은 별도 RPC 가 없다** — 액션이 건별로 RPC 를 반복 호출한다 → 부분 실패 결과를 건별로 돌려주고, 성공 건은 되돌리지 않는다.
 * - **환불 기준 계산은 학생 화면 함수(`computeProratedRefundEstimate`)를 그대로 호출**한다(관리자용 재작성 금지). 이 모듈은 그 결과를
 *   표시용으로 옮기기만 한다(`describeRefundBasis`).
 * - 승인 시 `sync_subscription_refunded_from_refund` 트리거는 `request_type='subscription_prorated'` + `subscription_id` 가 있을 때만
 *   구독을 '환불됨'으로 바꾼다. 멘토 중단 환불은 구독이 이미 해지된 상태라 캐시만 돌아간다 → 모달 문장이 종류별로 다르다.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { buildAdminListUrl, type AdminListParams } from "./adminListParams.ts";
import { ADMIN_CONFIRM_REASON_MIN_LENGTH } from "./adminConfirmPolicy.ts";
import {
  refundBracketLabelKo,
  type ProratedRefundEstimate,
  type RefundBracketReason,
  type RefundMode,
} from "../subscribe/subscriptionRefundProration.ts";

export const REFUND_BASE_PATH = "/admin/refunds";
export const REFUND_DEFAULT_PAGE_SIZE = 25;

// ── 탭 — 쿼리 키는 `status` 하나 ─────────────────────────────────────────────

export const REFUND_TAB_VALUES = ["pending", "succeeded", "rejected", "canceled", "all"] as const;
export type RefundTab = (typeof REFUND_TAB_VALUES)[number];
export const REFUND_DEFAULT_TAB: RefundTab = "pending";

/** 탭 라벨은 상태 사전(`refunds.status`)과 같은 표기 — 대기 · 완료 · 반려 · 취소 */
export const REFUND_TABS: readonly { value: RefundTab; label: string }[] = [
  { value: "pending", label: "대기" },
  { value: "succeeded", label: "완료" },
  { value: "rejected", label: "반려" },
  { value: "canceled", label: "취소" },
  { value: "all", label: "전체" },
];

export function isRefundTab(value: string): value is RefundTab {
  return (REFUND_TAB_VALUES as readonly string[]).includes(value);
}

/** `status` 파라미터 → 탭. 비어 있거나 모르는 값은 기본 탭(대기). */
export function resolveRefundTab(status: string | null | undefined): RefundTab {
  const s = typeof status === "string" ? status.trim() : "";
  return isRefundTab(s) ? s : REFUND_DEFAULT_TAB;
}

/** 탭이 필터하는 `refunds.status` 값. `all` 은 null(필터 없음). */
export function refundTabStatus(tab: RefundTab): string | null {
  return tab === "all" ? null : tab;
}

/**
 * 이 화면의 목록 링크 빌더 — 공용 `buildAdminListUrl` 은 `status=all` 을 "필터 없음" 으로 보고 지운다.
 * 기본 탭이 대기라서 전체 탭 링크가 status 를 잃으면 재파싱 시 대기 탭으로 튄다(PR-2 와 같은 처리).
 */
export function buildRefundListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  const url = buildAdminListUrl(REFUND_BASE_PATH, params, overrides);
  const status = overrides.status !== undefined ? overrides.status : params.status;
  if (status !== "all") return url;
  const [path, qs = ""] = url.split("?");
  const usp = new URLSearchParams(qs);
  usp.set("status", "all");
  return `${path}?${usp.toString()}`;
}

/** 상세 경로 */
export function refundDetailPath(refundId: string): string {
  return `${REFUND_BASE_PATH}/${encodeURIComponent(refundId)}`;
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * 서버 액션이 돌아갈 경로 — 목록 또는 상세만 허용한다(open redirect 방지). 그 외 값은 목록으로.
 */
export function resolveRefundReturnPath(raw: string | null | undefined): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s === REFUND_BASE_PATH) return REFUND_BASE_PATH;
  const m = /^\/admin\/refunds\/([^/?#]+)$/.exec(s);
  if (m && UUID_PATTERN.test(decodeURIComponent(m[1]))) return `${REFUND_BASE_PATH}/${decodeURIComponent(m[1])}`;
  return REFUND_BASE_PATH;
}

// ── 종류 ─────────────────────────────────────────────────────────────────────

export type RefundKind = "subscription_student" | "subscription_mentor_suspended" | "custom_order" | "individual_question" | "other";

export const REFUND_KIND_LABELS: Readonly<Record<RefundKind, string>> = {
  subscription_student: "구독 환불(학생 요청)",
  subscription_mentor_suspended: "구독 환불(멘토 중단)",
  custom_order: "맞춤의뢰 예치금",
  individual_question: "개별 질문",
  other: "기타",
};

/** 목록 칸용 짧은 표기 */
export const REFUND_KIND_SHORT_LABELS: Readonly<Record<RefundKind, string>> = {
  subscription_student: "구독(학생)",
  subscription_mentor_suspended: "구독(멘토 중단)",
  custom_order: "맞춤의뢰",
  individual_question: "개별 질문",
  other: "기타",
};

export function resolveRefundKind(row: {
  request_type?: unknown;
  custom_request_order_id?: unknown;
  subscription_id?: unknown;
}): RefundKind {
  const type = typeof row.request_type === "string" ? row.request_type.trim().toLowerCase() : "";
  if (type === "subscription_prorated") return "subscription_student";
  if (type === "subscription_mentor_suspended") return "subscription_mentor_suspended";
  if (row.custom_request_order_id) return "custom_order";
  if (type === "iq" || type.startsWith("individual_question")) return "individual_question";
  if (type === "order" || type.startsWith("custom_order")) return "custom_order";
  if (row.subscription_id) return "subscription_student";
  return "other";
}

/** 학생 화면 계산 함수에 넘길 모드. 구독 환불이 아니면 null(기준 계산 없음). */
export function refundModeForKind(kind: RefundKind): RefundMode | null {
  if (kind === "subscription_student") return "student_voluntary";
  if (kind === "subscription_mentor_suspended") return "mentor_suspended";
  return null;
}

// ── 금액 — refunds.amount_cents(minor) 한 출처 ────────────────────────────────

/** 저장값(minor, 원×100) → 원. null/NaN 은 null(금액 미설정 — RPC 도 자동 승인을 거절한다). */
export function refundAmountWon(amountCents: unknown): number | null {
  const n = typeof amountCents === "number" ? amountCents : typeof amountCents === "string" && amountCents.trim() ? Number(amountCents) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.floor(Math.max(0, n) / 100);
}

export const REFUND_AMOUNT_UNSET_LABEL = "금액 미설정";

export function formatRefundWon(won: number | null | undefined): string {
  if (typeof won !== "number" || !Number.isFinite(won)) return REFUND_AMOUNT_UNSET_LABEL;
  return `${Math.round(won).toLocaleString("ko-KR")}원`;
}

export function sumRefundWon(items: readonly { amountWon: number | null }[]): number {
  return items.reduce((acc, it) => acc + (typeof it.amountWon === "number" && Number.isFinite(it.amountWon) ? it.amountWon : 0), 0);
}

// ── 환불 기준(학원법) — 학생 화면 계산 결과를 표시용으로만 옮긴다 ──────────────

export type RefundBasis = {
  mode: RefundMode;
  bracketReason: RefundBracketReason;
  /** 학생 화면과 같은 문구(`refundBracketLabelKo`) */
  bracketLabel: string;
  /** 기준상 환불액(요청 시점 재계산, minor) */
  estimatedCents: number;
  estimatedWon: number;
  totalDays: number;
  /** 요청 시점 경과 일수(총 − 잔여) */
  elapsedDays: number;
  /** 요청 시점 경과율 0~1 */
  elapsedRatio: number;
  periodStart: string | null;
  periodEnd: string | null;
  /** 이용 개시(첫 질문) 여부 — 멘토 중단 모드는 판정 안 함(null) */
  usageStarted: boolean | null;
  /** 결제액(청구 이벤트 amount_cents, minor) */
  paidAmountCents: number | null;
};

/**
 * `computeProratedRefundEstimate` 결과 → 표시 모델. 계산은 하지 않는다 — estimate 의 수치를 옮기고 경과 일수만 뺄셈으로 얻는다.
 */
export function describeRefundBasis(
  estimate: ProratedRefundEstimate,
  args: { periodStart: string | null; periodEnd: string | null; usageStarted: boolean | null; paidAmountCents: number | null }
): RefundBasis {
  const totalDays = Math.max(0, Math.trunc(estimate.totalDays));
  const remaining = Math.max(0, Math.min(totalDays, Math.trunc(estimate.remainingDays)));
  const elapsedDays = Math.max(0, totalDays - remaining);
  const elapsedRatio = Math.min(1, Math.max(0, 1 - estimate.remainingRatio));
  return {
    mode: estimate.mode,
    bracketReason: estimate.bracketReason,
    bracketLabel: refundBracketLabelKo(estimate.bracketReason),
    estimatedCents: Math.max(0, Math.trunc(estimate.amountCents)),
    estimatedWon: refundAmountWon(estimate.amountCents) ?? 0,
    totalDays,
    elapsedDays,
    elapsedRatio,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    usageStarted: estimate.mode === "mentor_suspended" ? null : args.usageStarted,
    paidAmountCents: args.paidAmountCents,
  };
}

/** 모달 행·목록용 짧은 기준 표기 */
export function refundBasisShortLabel(basis: RefundBasis | null | undefined): string {
  if (!basis) return "기준 계산 대상 아님";
  switch (basis.bracketReason) {
    case "before_usage":
      return "이용 개시 전 · 전액";
    case "lt_1_3":
      return "1/3 경과 전 · 2/3";
    case "lt_1_2":
      return "1/2 경과 전 · 1/2";
    case "ge_1_2":
      return "1/2 경과 후 · 환불 없음";
    case "mentor_remaining":
      return "멘토 중단 · 잔여 일할";
    case "invalid":
    default:
      return "계산 불가";
  }
}

/** 경과 표시 `20일 / 31일 (65%)` */
export function formatRefundElapsed(basis: RefundBasis): string {
  if (basis.totalDays <= 0) return "기간 정보 없음";
  return `${basis.elapsedDays}일 / ${basis.totalDays}일 (${Math.round(basis.elapsedRatio * 100)}%)`;
}

/** 기준상 환불액이 0원인데 요청이 들어온 경우 — 상세·모달 경고 대상 */
export function isZeroBasisRefund(basis: RefundBasis | null | undefined): boolean {
  return Boolean(basis) && basis!.bracketReason !== "invalid" && basis!.estimatedCents <= 0;
}

/** 저장된 실지급액과 기준상 재계산액이 다른가(요청 시점 저장값이 정본 — 다르면 경고만) */
export function refundBasisMismatch(basis: RefundBasis | null | undefined, storedAmountCents: number | null | undefined): boolean {
  if (!basis || basis.bracketReason === "invalid") return false;
  if (typeof storedAmountCents !== "number" || !Number.isFinite(storedAmountCents)) return false;
  return Math.trunc(storedAmountCents) !== basis.estimatedCents;
}

export const REFUND_ZERO_BASIS_WARNING = "기준상 환불액 0원입니다.";

// ── 화면 모델(서버 조회 결과 → 클라이언트 표) ─────────────────────────────────

export type RefundSlaBadge = { label: string; tone: "ok" | "soon" | "over" };

/** 목록 한 행 — `refundConsoleQueries.loadRefundQueue` 가 만든다. 클라이언트 표가 그대로 받는다(직렬화 가능 값만). */
export type RefundQueueItem = {
  id: string;
  status: string;
  pending: boolean;
  kind: RefundKind;
  kindLabel: string;
  requestType: string | null;
  requesterId: string;
  requesterName: string;
  requesterEmail: string | null;
  /** 저장값(minor) — 실지급액 */
  amountCents: number | null;
  /** 저장값 → 원 */
  amountWon: number | null;
  reason: string | null;
  adminNote: string | null;
  createdAt: string | null;
  /** KST 표시 문자열 — 서버에서 만들어 넘긴다(클라이언트 표에서 다시 포맷하지 않는다 → hydration 불일치 방지) */
  createdAtLabel: string;
  processedAt: string | null;
  processedAtLabel: string;
  processedById: string | null;
  processorName: string | null;
  subscriptionId: string | null;
  paymentId: string | null;
  customRequestOrderId: string | null;
  planTier: string | null;
  planLabel: string | null;
  /** 요청 시점 기준 재계산(학생 함수) — 구독 환불이 아니거나 입력이 없으면 null */
  basis: RefundBasis | null;
  basisLabel: string;
  /** 멘토 중단 환불 대기 건의 5일 SLA — 서버에서 계산해 넘긴다(hydration 불일치 방지) */
  sla: RefundSlaBadge | null;
};

/** 승인·반려 버튼이 필요로 하는 최소 정보 — 목록 행·상세가 모두 만족한다 */
export type RefundDecisionTarget = Pick<
  RefundQueueItem,
  "id" | "requesterName" | "amountWon" | "kind" | "planLabel" | "basis" | "subscriptionId"
>;

export function approveSummaryInputFor(target: RefundDecisionTarget): RefundApproveSummaryInput {
  return {
    requesterName: target.requesterName,
    amountWon: target.amountWon,
    kind: target.kind,
    planLabel: target.planLabel,
    basis: target.basis,
    hasSubscription: Boolean(target.subscriptionId),
  };
}
export const REFUND_BASIS_MISMATCH_WARNING = "요청 시점 저장 금액과 기준 재계산액이 다릅니다. 실제 지급은 저장 금액으로 이루어집니다.";

// ── 승인 확인(critical) — summary 는 방향을 문장으로 ─────────────────────────

export type RefundApproveSummaryInput = {
  requesterName: string;
  /** 실지급 금액(원) — `refundAmountWon(refunds.amount_cents)` */
  amountWon: number | null;
  kind: RefundKind;
  /** 라이트/스탠다드/프리미엄 — 구독 환불이 아니면 null */
  planLabel: string | null;
  basis: RefundBasis | null;
  hasSubscription: boolean;
};

/** 승인 후 구독·주문이 어떻게 되는지 — 트리거·RPC 동작 그대로(§0 5번) */
export function refundStatusAfterApprovalSentence(kind: RefundKind, hasSubscription: boolean): string {
  switch (kind) {
    case "subscription_student":
      return hasSubscription
        ? "승인 후 구독은 '환불됨' 상태가 됩니다."
        : "연결된 구독 정보가 없어 결제 기준으로만 해지 처리됩니다.";
    case "subscription_mentor_suspended":
      return "구독은 멘토 활동 종료로 이미 해지된 상태이며, 승인 시 캐시만 환불됩니다.";
    case "custom_order":
      return "맞춤의뢰 예치금이 학생 캐시로 환불되고, 주문 정산은 취소됩니다.";
    case "individual_question":
    case "other":
    default:
      return "승인 시 캐시로 환불됩니다. 연결된 결제·구독이 있으면 해지 처리됩니다.";
  }
}

function nameOrFallback(name: string): string {
  return name.trim() || "이름 없음";
}

/**
 * 승인 모달 summary — 줄바꿈(\n)으로 3문장. 다이얼로그가 `whitespace-pre-line` 으로 그린다.
 *   김OO 학생에게 84,900원을 캐시로 환불합니다.
 *   스탠다드 구독 · 이용 개시 전 — 전액 환불
 *   승인 후 구독은 '환불됨' 상태가 됩니다.
 * 금액이 없으면(저장값 null) 그 사실을 문장에 드러낸다 — RPC 도 자동 승인을 거절하므로 모달과 실제가 어긋나지 않는다.
 */
export function buildRefundApproveSummary(input: RefundApproveSummaryInput): string {
  const who = nameOrFallback(input.requesterName);
  const amount =
    input.amountWon === null
      ? `${who} 학생의 환불 금액이 설정되지 않았습니다. 승인하면 자동 처리가 거절됩니다.`
      : input.kind === "custom_order"
        ? `${who} 학생에게 맞춤의뢰 예치금 ${formatRefundWon(input.amountWon)}을 캐시로 환불합니다.`
        : `${who} 학생에게 ${formatRefundWon(input.amountWon)}을 캐시로 환불합니다.`;
  const kindPart = input.planLabel ? `${input.planLabel} 구독` : REFUND_KIND_LABELS[input.kind];
  const basisPart = input.basis ? basisSentence(input.basis) : null;
  const middle = basisPart ? `${kindPart} · ${basisPart}` : kindPart;
  const lines = [amount, middle, refundStatusAfterApprovalSentence(input.kind, input.hasSubscription)];
  if (isZeroBasisRefund(input.basis)) lines.push(`⚠ ${REFUND_ZERO_BASIS_WARNING}`);
  return lines.join("\n");
}

function basisSentence(basis: RefundBasis): string {
  if (basis.bracketReason === "invalid") return "환불 기준 계산 불가";
  return basis.bracketLabel;
}

export type RefundConfirmDetail = { label: string; value: string };

/** 승인 모달 금액 재표시 행 — 첫 행이 실지급 금액(저장값) */
export function buildRefundApproveDetails(input: RefundApproveSummaryInput): RefundConfirmDetail[] {
  const rows: RefundConfirmDetail[] = [
    { label: "실지급 금액(저장값)", value: formatRefundWon(input.amountWon) },
    { label: "요청자", value: nameOrFallback(input.requesterName) },
    { label: "종류", value: input.planLabel ? `${REFUND_KIND_LABELS[input.kind]} · ${input.planLabel}` : REFUND_KIND_LABELS[input.kind] },
  ];
  if (input.basis) {
    rows.push({ label: "환불 기준", value: refundBasisShortLabel(input.basis) });
    rows.push({ label: "기준상 환불액", value: formatRefundWon(input.basis.estimatedWon) });
  }
  return rows;
}

// ── 반려(stateChange + 프리셋) ─────────────────────────────────────────────────

export const REFUND_REJECT_REASON_PRESETS: readonly string[] = ["기준 미충족 (이용 기간 1/2 경과)", "중복 요청", "사유 불충분"];
export const REFUND_CUSTOM_REASON_LABEL = "직접 입력";

export function buildRefundRejectSummary(requesterName: string, amountWon: number | null): string {
  const who = nameOrFallback(requesterName);
  return amountWon === null
    ? `${who} 학생의 환불 요청을 반려합니다. 캐시는 이동하지 않습니다.`
    : `${who} 학생의 ${formatRefundWon(amountWon)} 환불 요청을 반려합니다. 캐시는 이동하지 않습니다.`;
}

// ── 사유 — 기존 액션이 읽는 필드명 그대로(→ RPC p_admin_note + admin_action_logs.detail.note) ──

export const REFUND_REASON_FIELD = "adminNote";
export const REFUND_RETURN_TO_FIELD = "returnTo";
export const REFUND_APPROVE_REASON_REQUIRED_MESSAGE = "승인 사유를 입력해 주세요.";
export const REFUND_REJECT_REASON_REQUIRED_MESSAGE = "반려 사유를 선택하거나 입력해 주세요.";

/** 다이얼로그와 같은 기준(trim 후 최소 길이) — 서버 액션이 한 번 더 검사한다. */
export function isRefundReasonValid(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.trim().length >= ADMIN_CONFIRM_REASON_MIN_LENGTH;
}

// ── 일괄 처리 — 건별 RPC 반복(§0 3번) · 부분 실패 · 성공 건 유지 ──────────────

export type RefundBulkDecision = "approve" | "reject";

export const REFUND_BULK_DECISION_FIELD = "bulkDecision";
export const REFUND_BULK_IDS_FIELD = "ids";
/** 한 번에 처리할 상한 — 페이지 크기와 같다(체크박스는 현재 페이지 대기 건에만 있다) */
export const REFUND_BULK_MAX_IDS = REFUND_DEFAULT_PAGE_SIZE;

export const REFUND_BULK_DECISION_LABELS: Readonly<Record<RefundBulkDecision, string>> = {
  approve: "승인",
  reject: "반려",
};

export function isRefundBulkDecision(value: string | null | undefined): value is RefundBulkDecision {
  return value === "approve" || value === "reject";
}

export type RefundBulkCandidate = {
  id: string;
  requesterName: string;
  planLabel: string | null;
  amountWon: number | null;
  basisLabel: string;
  kind: RefundKind;
};

/** 모달 안 체크 목록의 현재 선택 → 건수·총액 */
export function bulkSelectionSummary<T extends { id: string; amountWon: number | null }>(
  candidates: readonly T[],
  selectedIds: readonly string[]
): { count: number; totalWon: number; selected: T[] } {
  const set = new Set(selectedIds);
  const selected = candidates.filter((c) => set.has(c.id));
  return { count: selected.length, totalWon: sumRefundWon(selected), selected };
}

/** "선택한 3건을 승인합니다 · 총 254,700원" */
export function buildRefundBulkSummary(decision: RefundBulkDecision, count: number, totalWon: number): string {
  if (count <= 0) return "선택된 건이 없습니다. 모달 안에서 항목을 다시 선택해 주세요.";
  const verb = REFUND_BULK_DECISION_LABELS[decision];
  const tail =
    decision === "approve"
      ? `총 ${totalWon.toLocaleString("ko-KR")}원을 캐시로 환불합니다. 사유는 전체에 같은 값으로 적용됩니다.`
      : `총 ${totalWon.toLocaleString("ko-KR")}원의 요청을 반려합니다. 캐시는 이동하지 않으며 사유는 전체에 같은 값으로 적용됩니다.`;
  return `선택한 ${count}건을 ${verb}합니다 · 총 ${totalWon.toLocaleString("ko-KR")}원\n${tail}`;
}

export function refundBulkConfirmLabel(decision: RefundBulkDecision, count: number): string {
  return `${Math.max(0, count)}건 ${REFUND_BULK_DECISION_LABELS[decision]}`;
}

export type RefundBulkItemResult = {
  refundId: string;
  ok: boolean;
  /** 이미 처리된 건(RPC noop) — ok 로 세되 표시 문구가 다르다 */
  noop: boolean;
  message: string | null;
};

export type RefundBulkResultState = {
  decision: RefundBulkDecision;
  requested: number;
  succeeded: number;
  failed: number;
  results: RefundBulkItemResult[];
  /** 전체 거절(사유 누락·선택 없음 등) — results 없이 한 줄 안내 */
  error: string | null;
  at: string;
} | null;

/** 액션 결과 → 상태. 성공 건은 이미 자금이 이동했으므로 되돌리지 않고 그대로 성공으로 남긴다. */
export function summarizeRefundBulkResults(
  decision: RefundBulkDecision,
  results: readonly RefundBulkItemResult[],
  at: string = new Date().toISOString()
): NonNullable<RefundBulkResultState> {
  const succeeded = results.filter((r) => r.ok).length;
  return { decision, requested: results.length, succeeded, failed: results.length - succeeded, results: [...results], error: null, at };
}

export function refundBulkErrorState(decision: RefundBulkDecision, error: string, at: string = new Date().toISOString()): NonNullable<RefundBulkResultState> {
  return { decision, requested: 0, succeeded: 0, failed: 0, results: [], error, at };
}

export function failedRefundIds(state: RefundBulkResultState): string[] {
  return state ? state.results.filter((r) => !r.ok).map((r) => r.refundId) : [];
}

/** "2건 성공 · 1건 실패" */
export function formatRefundBulkResultLine(state: NonNullable<RefundBulkResultState>): string {
  const verb = REFUND_BULK_DECISION_LABELS[state.decision];
  if (state.error) return `일괄 ${verb} 실패 — ${state.error}`;
  if (state.failed === 0) return `일괄 ${verb}: ${state.succeeded}건 성공`;
  return `일괄 ${verb}: ${state.succeeded}건 성공 · ${state.failed}건 실패`;
}

// ── 목록 검색 — 요청자 이름·이메일(users) ─────────────────────────────────────

export const REFUND_SEARCH_TERM_MAX_LENGTH = 80;
export const REFUND_SEARCH_USER_ID_LIMIT = 100;

export function normalizeRefundSearchTerm(raw: string | null | undefined): string {
  const s = typeof raw === "string" ? raw : "";
  return s.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim().slice(0, REFUND_SEARCH_TERM_MAX_LENGTH);
}

/** users 에서 이름·닉네임·이메일 부분일치 — PostgREST `.or()` 인자 */
export function buildRefundUserSearchOr(term: string): string {
  return [`full_name.ilike.%${term}%`, `nickname.ilike.%${term}%`, `email.ilike.%${term}%`].join(",");
}

/**
 * refunds 에서의 검색 조건 — users 검색으로 얻은 user_id 집합 + 사유 부분일치 (+ UUID 앞부분이면 환불 ID).
 * user 가 하나도 안 잡히고 사유도 안 맞으면 자연히 0건이다.
 */
export function buildRefundSearchOr(term: string, userIds: readonly string[]): string {
  const parts = [`reason.ilike.%${term}%`];
  const ids = userIds.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id)).slice(0, REFUND_SEARCH_USER_ID_LIMIT);
  if (ids.length) parts.push(`user_id.in.(${ids.join(",")})`);
  if (/^[0-9a-fA-F-]{4,36}$/.test(term)) parts.push(`id.ilike.${term}%`);
  return parts.join(",");
}

// ── 표시 문구 ─────────────────────────────────────────────────────────────────

export const REFUND_PG_MANUAL_WARNING = "실제 카드 취소는 PG사에서 수동으로 처리해야 합니다. 이 화면의 승인은 학생 캐시 잔액으로만 환불합니다.";

export const REFUND_EMPTY_STATE = {
  title: "아직 환불 요청이 없습니다",
  description: "학생 모집이 시작되면 구독 환불 요청이 이 화면으로 들어옵니다.",
  stepsTitle: "환불이 들어오면 이렇게 처리합니다",
  steps: [
    "환불 기준(학원법)과 예상 환불액을 확인합니다",
    "승인하면 캐시로 즉시 환불되고 구독은 '환불됨'이 됩니다",
    "카드 결제 건은 PG사에서 수동으로 취소해야 합니다",
  ],
} as const;

/** 목록 하단 진행 표시 `N / 전체` 의 구간 — 표시용 1-based (PR-2 와 같은 규칙, PR-4 추출 대상) */
export function refundQueueProgressRange(page: number, pageSize: number, rowsOnPage: number, totalCount: number): { first: number; last: number } {
  if (totalCount <= 0 || rowsOnPage <= 0) return { first: 0, last: 0 };
  const first = (Math.max(1, page) - 1) * Math.max(1, pageSize) + 1;
  return { first, last: first + rowsOnPage - 1 };
}

/** 상세 제목 `김OO · 84,900원 환불 요청` */
export function buildRefundDetailTitle(requesterName: string, amountWon: number | null): string {
  const who = nameOrFallback(requesterName);
  return amountWon === null ? `${who} · 환불 요청(금액 미설정)` : `${who} · ${formatRefundWon(amountWon)} 환불 요청`;
}

/** 사유 요약(목록 칸) — 한 줄, 상한 */
export function summarizeRefundReason(reason: string | null | undefined, max = 40): string {
  const s = typeof reason === "string" ? reason.replace(/\s+/g, " ").trim() : "";
  if (!s) return "—";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
