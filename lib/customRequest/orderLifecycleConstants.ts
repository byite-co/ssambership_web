/**
 * 맞춤의뢰 주문 상태 — 레포 내 출처만 명시 (Supabase migration / generated types 없음).
 *
 * DB에서 실제 enum/문자열을 확인할 때 (Supabase SQL Editor 예시):
 *   select distinct status, state, order_status from public.custom_request_orders;
 *
 * | 구간 | 값 | 출처 |
 * |------|-----|------|
 * | 주문 생성 직후 primary (`status`→`state`→…) | `pending` | `insertCustomRequestOrder` p1 `status`/`state` |
 * | 동일 insert의 `order_status` | `open` | `insertCustomRequestOrder` p1 |
 * | 동일 insert의 `payment_status` | `unpaid` | `insertCustomRequestOrder` p1 (primary 상태 키 후보 아님) |
 * | 멘토 작업 시작 후 primary 목표 | `open` | 주문 insert에 이미 쓰인 리터럴(`order_status`)과 동일 문자열 |
 * | 학생 납품 수락 후 primary | `completed` | `orderStudentActions` |
 * | 스레드 휴리스틱 종료류 | `done`, `resolved` 등 | `lib/home/threadStats.ts` (주문 row에 동일 문자열이 올 수 있으면 terminal 취급) |
 *
 * 납품·검토 대기 등은 insert에 없어 **legacy 집합**으로만 허용한다.
 */

const STATUS_KEYS = ["status", "state", "order_status", "stage"] as const;
export type OrderStatusColumnKey = (typeof STATUS_KEYS)[number];

/** `insertCustomRequestOrder` p1 — `customRequestMutations.ts` */
export const ORDER_INSERT_STATUS_PENDING = "pending" as const;
/** `insertCustomRequestOrder` p1 — `order_status` 컬럼 */
export const ORDER_INSERT_ORDER_STATUS_OPEN = "open" as const;
/** `insertCustomRequestOrder` p1 — `payment_status` (primary 상태 컬럼 후보 아님) */
export const ORDER_INSERT_PAYMENT_STATUS_UNPAID = "unpaid" as const;

/**
 * 멘토 작업 시작 시 primary 컬럼에 넣는 값(현재 `open`).
 * `insertCustomRequestOrder` 는 `status`/`state`=`pending` 과 동시에 `order_status`=`open` 를 넣으므로,
 * `open` 이 “멘토 착수”인지 “접수/오픈 주문”인지는 DB CHECK/enum·DDL 이 레포에 있을 때만 확정할 수 있음
 * (→ `orderSchemaGate` + `002_custom_request_orders_status.sql` 선행).
 */
export const ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS = ORDER_INSERT_ORDER_STATUS_OPEN;

/** `status`→`state`→`order_status`→`stage` 순으로 비어 있지 않은 첫 컬럼(표시·검증·갱신에 동일 사용). */
export function primaryOrderStatusColumnKey(row: Record<string, unknown>): OrderStatusColumnKey | null {
  for (const k of STATUS_KEYS) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) {
      return k;
    }
  }
  return null;
}

export function normalizedPrimaryOrderStatus(row: Record<string, unknown>): string {
  const k = primaryOrderStatusColumnKey(row);
  if (!k) {
    return "";
  }
  return String(row[k]).trim().toLowerCase();
}

/** 멘토 「작업 시작」직전 — insert 직후 primary만 허용 */
export const ORDER_STATUSES_MENTOR_START_WORK_ALLOWED = new Set<string>([ORDER_INSERT_STATUS_PENDING]);

/** 학생 직접 취소(예치 반환) — 멘토 작업 시작 전과 동일: primary `pending` + payment `escrowed` */
export function isOrderStatusBeforeMentorWorkStarted(norm: string): boolean {
  return ORDER_STATUSES_MENTOR_START_WORK_ALLOWED.has(String(norm ?? "").trim().toLowerCase());
}

const ORDER_PAYMENT_ESCROWED_FOR_REFUND = new Set(["escrowed"]);

/** 학생 직접 취소 가능한 결제 상태(예치 완료, 아직 환불·지급 전) */
export function isOrderPaymentEscrowedForStudentCancel(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) {
    return false;
  }
  for (const k of ["payment_status", "payment_state", "pay_status"] as const) {
    const v = row[k];
    if (v == null) {
      continue;
    }
    const s = String(v).trim().toLowerCase();
    if (s && ORDER_PAYMENT_ESCROWED_FOR_REFUND.has(s)) {
      return true;
    }
  }
  return false;
}

/**
 * 학생 납품 수락 직전 — `insertCustomRequestOrder`에는 납품 후 상태가 없음.
 * 운영 DB·이전 스텁에서만 쓰이던 값은 legacy로 유지한다.
 */
export const ORDER_STATUSES_ALLOWING_STUDENT_ACCEPT_LEGACY = new Set<string>([
  "delivered",
  "delivered_pending_review",
  "waiting_review",
  "pending_review",
  "redelivered",
  "delivery_submitted",
  "in_review",
]);

export function isOrderStatusAllowingStudentAccept(norm: string): boolean {
  return ORDER_STATUSES_ALLOWING_STUDENT_ACCEPT_LEGACY.has(norm);
}

export const ORDER_STATUSES_ALLOWING_STUDENT_DELIVERABLE_DOWNLOAD = new Set<string>([
  "completed",
  "accepted",
  "finished",
]);

const ORDER_STATUSES_BLOCKING_STUDENT_DELIVERABLE_DOWNLOAD = new Set<string>([
  "cancelled",
  "canceled",
  "refunded",
  "rejected",
  "disputed",
  "dispute_resolved",
]);

export function studentCanDownloadDeliverable(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) {
    return false;
  }
  const norm = normalizedPrimaryOrderStatus(row);
  if (ORDER_STATUSES_BLOCKING_STUDENT_DELIVERABLE_DOWNLOAD.has(norm)) {
    return false;
  }
  if (ORDER_STATUSES_ALLOWING_STUDENT_DELIVERABLE_DOWNLOAD.has(norm)) {
    return true;
  }
  if (ORDER_STATUSES_ALLOWING_STUDENT_ACCEPT_LEGACY.has(norm) || norm === "paid") {
    return false;
  }
  for (const k of ["completed_at", "accepted_at"] as const) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") {
      return true;
    }
  }
  return false;
}

/** 종료·취소 등 — `orderStudentActions` + 흔한 취소류 + `threadStats` 종료 패턴 일부 */
export const ORDER_TERMINAL_STATUSES = new Set<string>([
  "completed",
  "accepted",
  "closed",
  "finished",
  "cancelled",
  "canceled",
  "refunded",
  "rejected",
  "done",
  "resolved",
  "dispute_resolved",
]);

export function isOrderStatusTerminal(norm: string): boolean {
  return ORDER_TERMINAL_STATUSES.has(norm);
}

const ORDER_STATE_COLUMN_KEYS = ["status", "state", "order_status", "stage"] as const;

/**
 * `status` / `state` / `order_status` / `stage` 중 하나라도 종료값이면 true.
 * primary 컬럼만 보면 놓칠 수 있는 불일치(예: 한 컬럼만 completed)에 대비한다.
 */
export function isOrderRowTerminalForActions(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) {
    return false;
  }
  for (const k of ORDER_STATE_COLUMN_KEYS) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) {
      if (isOrderStatusTerminal(v.trim().toLowerCase())) {
        return true;
      }
    }
  }
  for (const k of ["completed_at", "closed_at", "finished_at"] as const) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") {
      return true;
    }
  }
  return false;
}

/**
 * 주문 행이 종료·완료로 더 이상 진행 액션(수락·수정·분쟁·작업 시작·납품 등)을 허용하지 않는지.
 * `primary` 한 컬럼만 보면 놓치는 불일치에 대비해 `isOrderRowTerminalForActions`를 쓴다.
 */
export function isOrderRowClosedForLifecycleActions(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) {
    return false;
  }
  return isOrderRowTerminalForActions(row);
}

/** 주문방: 종료 주문에서 진행 버튼 대신 표시(공통) */
export const ORDER_ROOM_TERMINAL_ACTIONS_NOTICE =
  "이 주문은 완료되어 추가 작업이 제한됩니다. 납품물과 진행 기록은 아래에서 확인할 수 있어요.";

/** 학생 뷰 — 터미널 안내 */
export const ORDER_ROOM_TERMINAL_STUDENT_NOTICE =
  "완료된 주문입니다. 납품물과 진행 기록을 확인할 수 있어요.";

/** 멘토 뷰 — 터미널 안내 */
export const ORDER_ROOM_TERMINAL_MENTOR_NOTICE =
  "완료된 주문입니다. 추가 납품이나 상태 변경은 할 수 없어요.";

// —— 주문방 UI: DB 토큰·ISO를 사용자 문구로만 변환(로직 판정에는 사용하지 않음)

const ORDER_STATUS_LABEL_MAP: Readonly<Record<string, string>> = {
  pending: "작업 대기",
  open: "작업 중",
  in_progress: "작업 중",
  completed: "완료",
  delivered: "납품 대기",
  submitted: "작업 중",
  closed: "종료됨",
  cancelled: "종료됨",
  canceled: "종료됨",
  unpaid: "작업 대기",
  paid: "수락됨",
  in_review: "납품 대기",
  waiting_review: "납품 대기",
  delivered_pending_review: "납품 대기",
  pending_review: "납품 대기",
  redelivered: "납품 대기",
  delivery_submitted: "납품 대기",
  accepted: "완료",
  revision_requested: "수정 요청",
  disputed: "종료됨",
  refunded: "종료됨",
  done: "종료됨",
  resolved: "종료됨",
  rejected: "종료됨",
  finished: "완료",
};

/** `custom_request_orders`·납품 등에서 읽은 상태 문자열 */
export function orderStatusLabelForUi(raw: string): string {
  const s = String(raw).trim().toLowerCase();
  if (!s || s === "—") {
    return "—";
  }
  return ORDER_STATUS_LABEL_MAP[s] ?? String(raw).trim();
}

/** 주문 상태 배지·톤(표시 전용) — `normalizedPrimaryOrderStatus` 등 */
export type OrderStatusUiTone = "gray" | "blue" | "amber" | "green" | "orange" | "red";

export function orderStatusUiToneForNorm(norm: string): OrderStatusUiTone {
  const s = String(norm).trim().toLowerCase();
  if (!s) {
    return "gray";
  }
  const toneByStatus: Readonly<Record<string, OrderStatusUiTone>> = {
    pending: "gray",
    open: "blue",
    in_progress: "blue",
    delivered: "amber",
    completed: "green",
    accepted: "green",
    revision_requested: "orange",
    disputed: "red",
    cancelled: "gray",
    canceled: "gray",
    refunded: "gray",
    closed: "gray",
    in_review: "blue",
    waiting_review: "blue",
    delivered_pending_review: "amber",
    pending_review: "blue",
    redelivered: "amber",
    delivery_submitted: "amber",
    submitted: "blue",
    unpaid: "gray",
    paid: "green",
    done: "green",
    resolved: "green",
    rejected: "red",
    finished: "green",
  };
  return toneByStatus[s] ?? "gray";
}

/**
 * 주문방 배지 전용: 알려진 상태만 `orderStatusLabelForUi`와 동일, 미매핑은 raw 노출 대신 통일 문구
 */
export function orderStatusBadgeLabelForNorm(norm: string): string {
  const s = String(norm).trim().toLowerCase();
  if (!s || s === "—") {
    return "—";
  }
  if (Object.prototype.hasOwnProperty.call(ORDER_STATUS_LABEL_MAP, s)) {
    const label = ORDER_STATUS_LABEL_MAP[s];
    if (label) return label;
  }
  return "준비 중";
}

const PAYMENT_STATUS_LABEL_MAP: Readonly<Record<string, string>> = {
  unpaid: "결제 확인 대기",
  pending: "결제 확인 대기",
  paid: "결제 완료",
  completed: "결제 완료",
  failed: "결제 실패",
  refunded: "환불됨",
  dispute_resolved: "분쟁 분배 완료",
  partial_refund: "부분 환불",
  cancelled: "결제 취소",
  canceled: "결제 취소",
  escrowed: "에스크로",
  succeeded: "결제 완료",
};

export type PaymentStatusUiTone = "gray" | "blue" | "green" | "amber" | "red";

export function paymentStatusLabelForUi(raw: string): string {
  const s = String(raw).trim().toLowerCase();
  if (!s || s === "—") {
    return "—";
  }
  return PAYMENT_STATUS_LABEL_MAP[s] ?? String(raw).trim();
}

export function paymentStatusUiToneForRaw(raw: string): PaymentStatusUiTone {
  const s = String(raw).trim().toLowerCase();
  if (!s) {
    return "gray";
  }
  if (s === "paid" || s === "completed" || s === "succeeded" || s === "escrowed") {
    return "green";
  }
  if (s === "unpaid" || s === "pending" || s === "processing") {
    return "gray";
  }
  if (s === "failed") {
    return "red";
  }
  if (s === "refunded" || s === "partial_refund" || s === "dispute_resolved") {
    return "gray";
  }
  if (s === "cancelled" || s === "canceled") {
    return "red";
  }
  return "amber";
}

/** 결제 배지(표시): 미매핑 토큰 raw 노출 방지 */
export function paymentStatusBadgeLabelForRaw(raw: string): string {
  const s = String(raw).trim().toLowerCase();
  if (!s || s === "—") {
    return "—";
  }
  if (Object.prototype.hasOwnProperty.call(PAYMENT_STATUS_LABEL_MAP, s)) {
    const label = PAYMENT_STATUS_LABEL_MAP[s];
    if (label) return label;
  }
  return "준비 중";
}

const ORDER_PAYMENT_CONFIRMED_FOR_WORK = new Set([
  "paid",
  "succeeded",
  "escrowed",
  "completed",
  "complete",
  "success",
  "captured",
  "paid_out",
]);

/**
 * 주문 행에서 결제가 확정된 것으로 볼 수 있는지 (`orderPaymentPolicy.isCustomOrderPaymentConfirmed` 와 동일 토큰 집합).
 * UI(RSC/클라)에서도 사용 가능하도록 `server-only` 모듈에 의존하지 않는다.
 */
export function isOrderRowPaymentConfirmedForMentorWork(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) {
    return false;
  }
  for (const k of ["payment_status", "payment_state", "pg_payment_status"] as const) {
    const v = row[k];
    if (v == null) {
      continue;
    }
    const s = String(v).trim().toLowerCase();
    if (s && ORDER_PAYMENT_CONFIRMED_FOR_WORK.has(s)) {
      return true;
    }
  }
  return false;
}

export function orderEventKindLabelForUi(raw: string): string {
  const s = String(raw).trim().toLowerCase();
  if (!s) {
    return "기록";
  }
  if (/^[0-9a-f-]{36}$/i.test(s)) {
    return "기록";
  }
  const map: Record<string, string> = {
    order_started: "작업 시작",
    deliverable_submitted: "납품 등록",
    deliverable_accepted: "납품 수락",
    settlement_item_created: "정산 항목 생성",
    message_created: "메시지 작성",
    revision_requested: "수정 요청",
    dispute_opened: "해결 요청",
    dispute_split_applied: "분쟁 분배 완료",
    payment_confirmed: "결제 확인",
    order_cancelled: "주문 취소",
  };
  return map[s] ?? orderStatusLabelForUi(s);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// TZ-FIX R3 #22·#24: 로컬 getter 표기를 KST 벽시계로 고정 (P-B — epoch+9h 후 UTC getter,
// 화면 문구에 박힌 YYYY.MM.DD (HH:mm) 포맷 유지, SSR/CSR 동일 결과).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstYmd(d: Date): string {
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}.${pad2(k.getUTCMonth() + 1)}.${pad2(k.getUTCDate())}`;
}

/** 날짜만: 2026.05.02 */
export function formatOrderRoomDate(v: unknown): string {
  if (v == null) {
    return "—";
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) {
      return "—";
    }
    return kstYmd(v);
  }
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v.trim());
    if (!Number.isNaN(d.getTime())) {
      return kstYmd(d);
    }
  }
  return "—";
}

/** 2026.04.29 16:06 */
export function formatOrderRoomDateTime(v: unknown): string {
  if (v == null) {
    return "—";
  }
  const d =
    v instanceof Date
      ? v
      : typeof v === "string" && v.trim()
        ? new Date(v.trim())
        : null;
  if (!d || Number.isNaN(d.getTime())) {
    return "—";
  }
  const k = new Date(d.getTime() + KST_OFFSET_MS);
  return `${kstYmd(d)} ${pad2(k.getUTCHours())}:${pad2(k.getUTCMinutes())}`;
}

export function deliverableVersionLabelKorean(version: unknown, zeroBasedIndex: number): string {
  const n = typeof version === "number" && Number.isFinite(version) ? version : Number.parseInt(String(version ?? ""), 10);
  const step = Number.isFinite(n) && n > 0 ? n : zeroBasedIndex + 1;
  return `${step}차 납품`;
}

/** 주문방 좌측 타임라인 5단계 */
export const ORDER_ROOM_TIMELINE_STEPS = [
  { id: "waiting", title: "작업 대기", desc: "멘토 작업 시작을 기다리고 있어요." },
  { id: "in_progress", title: "작업 중", desc: "멘토가 작업을 진행하고 있어요." },
  { id: "delivered", title: "납품 대기", desc: "납품 파일을 확인해 주세요." },
  { id: "revision", title: "수정 요청", desc: "수정 요청이 접수되었어요." },
  { id: "completed", title: "완료", desc: "주문이 완료되었어요." },
] as const;

export const ORDER_WORKSPACE_STEP_LABELS = ORDER_ROOM_TIMELINE_STEPS.map((s) => s.title);

export function orderWorkspaceCurrentStepIndex(
  norm: string,
  isTerminal: boolean,
  hasDeliverable: boolean
): number {
  const n = String(norm ?? "").trim().toLowerCase();
  if (isTerminal || isOrderStatusTerminal(n)) {
    return 4;
  }

  if (n === "revision_requested") {
    return 3;
  }

  if (
    isOrderStatusAllowingStudentAccept(n) ||
    n === "in_review" ||
    n === "waiting_review" ||
    n === "delivered_pending_review" ||
    n === "pending_review" ||
    n === "delivered" ||
    n === "redelivered" ||
    n === "delivery_submitted" ||
    hasDeliverable
  ) {
    return 2;
  }

  if (n === ORDER_INSERT_STATUS_PENDING || n === "unpaid") {
    return 0;
  }

  if (
    n === ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS ||
    n === "in_progress" ||
    n === "open" ||
    n === "submitted"
  ) {
    return 1;
  }

  return 0;
}

// —— W19 주문방: 앱형 작업공간 표시용(도메인 로직 없음)

export const ORDER_ROOM_APP_SURFACE_CLASS = "bg-white";

export const ORDER_ROOM_CONTENT_MAX = "mx-auto w-full max-w-7xl";

export const ORDER_ROOM_CARD_CLASS =
  "rounded-[20px] border border-slate-200/70 bg-white/95 p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-5";
