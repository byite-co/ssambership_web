/**
 * 관리자 · 분쟁 화면(PR-6 §2)의 순수 규칙 — 목록·상세·확인 모달·일괄 처리가 함께 쓴다.
 *
 * - 상태 9종은 상태 사전(`disputes.status` = CHECK `disputes_status_check`)에서 온다. 탭은 그중 제재 3종(sanction_7d·30d·permanent)을
 *   `sanction` 탭 하나로 묶고 배지는 사전 라벨 그대로다. 탭 라벨은 사전 라벨을 파생한다(전체·제재 탭만 화면 고유).
 * - 오래된 분쟁이 위(`created_at asc`). 종결(resolved·dismissed·sanction_permanent)이 아닌 건의 경과가 24시간을 넘으면 주의색, 48시간 초과 위험색.
 * - **상태 전이 규칙은 화면이 정하지 않는다** — 서버 액션의 상태 게이트(`statusIn` · `SANCTIONABLE_STATUSES` · bulk `.in("status", …)`)와
 *   분배 RPC(`record_custom_order_dispute_split`)의 disputes 갱신 조건을 그대로 옮긴 표가 `DISPUTE_*_FROM` 이다. 계약 테스트가 액션 소스와 대조한다.
 *   `escalated`(상위 이관)로 바꾸는 쓰기 경로는 코드에 없어 버튼을 두지 않는다(보고).
 * - 조치 등급: 검토 시작·보류·기각·해결 = stateChange · 학생 전액 환불·예치금 분할·멘토 지급·제재 = critical(금액·대상 재표시).
 *   자금 조치 3종은 모두 같은 RPC 한 경로(`applyCustomOrderDisputeSplitAdminAction`)이며 금액만 다르다 — 전액 환불 = (멘토 0, 학생 예치금) ·
 *   멘토 지급 = (멘토 예치금, 학생 0). 분할 미리보기 산식은 RPC 와 같은 floor(gross × 요율)이고 요율은 DB 정산 행 값만 쓴다(PR-1b V-4).
 * - 서버 액션이 읽는 필드명(`disputeId` · `sanction` · `target` · `note` · `orderId` · `mentorGrossWon` · `studentRefundWon` · `ids` · `bulkStatus`)은 바꾸지 않는다.
 *   사유(PR-6 2번째 커밋 · 오너 승인): 기각·해결·분배·일괄 액션이 선택적 `reason` 을 읽어 `admin_action_logs.detail` 에 남긴다(액션 파일 최소 수정).
 *   분배(자금)는 서버에서도 사유 필수. 제재·보류·보류 건 완료는 기존 `note`(admin_note·케이스 노트·감사 로그).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import type { AdminListParams } from "./adminListParams.ts";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminDataTableUrl } from "./adminDataTable.ts";
import { resolveAdminStatus } from "./adminStatusDictionary.ts";
import { ADMIN_CONFIRM_REASON_MIN_LENGTH } from "./adminConfirmPolicy.ts";
import { settlementFeeRateLabel } from "../payout/settlementFeeRate.ts";
import {
  ACCOUNT_SANCTION_CODES,
  ACCOUNT_SANCTION_LABELS,
  buildAccountSanctionSummary,
  type AccountSanctionCode,
} from "./accountSanctionPolicy.ts";

export const DISPUTE_BASE_PATH = "/admin/disputes";
export const DISPUTE_DEFAULT_PAGE_SIZE = 25;

// ── 상태 · 탭 — 쿼리 키는 `status` 하나 ─────────────────────────────────────

/** CHECK `disputes_status_check`(SQL 120) 9종 — 상태 사전 `disputes.status` 와 같은 집합(계약 테스트 고정). */
export const DISPUTE_STATUS_VALUES = [
  "open",
  "under_review",
  "escalated",
  "on_hold",
  "resolved",
  "dismissed",
  "sanction_7d",
  "sanction_30d",
  "sanction_permanent",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUS_VALUES)[number];

export const DISPUTE_SANCTION_STATUSES = ["sanction_7d", "sanction_30d", "sanction_permanent"] as const;
/** 종말 상태 — 어떤 액션도 여기서 나가지 못한다(adminDisputeSanctionActions D-AD-2 주석 그대로). */
export const DISPUTE_TERMINAL_STATUSES = ["resolved", "dismissed", "sanction_permanent"] as const;

export const DISPUTE_TAB_VALUES = ["open", "under_review", "on_hold", "escalated", "resolved", "dismissed", "sanction", "all"] as const;
export type DisputeTab = (typeof DISPUTE_TAB_VALUES)[number];
export const DISPUTE_DEFAULT_TAB: DisputeTab = "open";
export const DISPUTE_SANCTION_TAB_LABEL = "제재";
export const DISPUTE_ALL_TAB_LABEL = "전체";

/** 탭 라벨은 상태 사전(`disputes.status`)에서 온다 — 사전 라벨이 바뀌면 탭도 따라간다. 제재·전체 탭만 화면 고유 라벨. */
export const DISPUTE_TABS: readonly { value: DisputeTab; label: string }[] = DISPUTE_TAB_VALUES.map((value) => ({
  value,
  label:
    value === "all"
      ? DISPUTE_ALL_TAB_LABEL
      : value === "sanction"
        ? DISPUTE_SANCTION_TAB_LABEL
        : resolveAdminStatus("disputes", "status", value).label,
}));

export function isDisputeTab(value: string): value is DisputeTab {
  return (DISPUTE_TAB_VALUES as readonly string[]).includes(value);
}

/** `status` 파라미터 → 탭. 비어 있거나 모르는 값은 기본 탭(open). */
export function resolveDisputeTab(status: string | null | undefined): DisputeTab {
  const s = typeof status === "string" ? status.trim() : "";
  return isDisputeTab(s) ? s : DISPUTE_DEFAULT_TAB;
}

/** 탭이 필터하는 `disputes.status` 값들. `all` 은 null(필터 없음) · `sanction` 은 3종. */
export function disputeTabStatuses(tab: DisputeTab): readonly string[] | null {
  if (tab === "all") return null;
  if (tab === "sanction") return DISPUTE_SANCTION_STATUSES;
  return [tab];
}

/** 이 화면의 목록 링크 빌더 — 공용 정본 `buildAdminDataTableUrl`(PR-4) 에 경로를 묶은 것. 전체 탭은 `status=all` 을 잃지 않는다. */
export function buildDisputeListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(DISPUTE_BASE_PATH, params, overrides);
}

export function disputeDetailPath(disputeId: string): string {
  return `${DISPUTE_BASE_PATH}/${encodeURIComponent(disputeId)}`;
}

export function disputeStatusLabel(status: string | null | undefined): string {
  return resolveAdminStatus("disputes", "status", status).label;
}

// ── 검색 — 당사자 이름(users) · 접수 내용 ────────────────────────────────────

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * disputes 검색 `.or()` 인자 — 접수 내용·운영 메모 부분일치 + (users 검색으로 얻은) 당사자 id 집합(학생·멘토 양쪽).
 * uuid 컬럼에는 `ilike` 를 걸 수 없다(PostgREST 가 캐스팅하지 않는다) — 검색어가 완전한 UUID 일 때만 분쟁 id·주문 id 를 `eq` 로 잇는다.
 */
export function buildDisputeSearchOr(term: string, partyIds: readonly string[]): string {
  const parts = [`body.ilike.%${term}%`, `admin_note.ilike.%${term}%`];
  if (UUID_RE.test(term)) parts.push(`id.eq.${term}`, `custom_request_order_id.eq.${term}`);
  const ids = partyIds.filter((id) => UUID_RE.test(id)).slice(0, ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  if (ids.length) {
    const list = ids.join(",");
    parts.push(`student_id.in.(${list})`, `mentor_id.in.(${list})`);
  }
  return parts.join(",");
}

// ── 유형 — disputes 의 FK 로 판정(별도 type 컬럼 없음) ───────────────────────

export type DisputeKind = "custom_order" | "subscription" | "payment" | "other";

export const DISPUTE_KIND_LABELS: Readonly<Record<DisputeKind, string>> = {
  custom_order: "맞춤의뢰",
  subscription: "구독",
  payment: "결제",
  other: "기타",
};

export function resolveDisputeKind(row: { custom_request_order_id?: unknown; subscription_id?: unknown; payment_id?: unknown }): DisputeKind {
  if (typeof row.custom_request_order_id === "string" && row.custom_request_order_id.trim()) return "custom_order";
  if (typeof row.subscription_id === "string" && row.subscription_id.trim()) return "subscription";
  if (typeof row.payment_id === "string" && row.payment_id.trim()) return "payment";
  return "other";
}

/** 목록·제목용 짧은 참조 — UUID 는 `#` + 끝 6자(대문자). 빈 값은 "". */
export function disputeShortRef(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (UUID_RE.test(s)) return `#${s.slice(-6).toUpperCase()}`;
  return s.length > 18 ? `#${s.slice(0, 8).toUpperCase()}` : s;
}

// ── 경과 ─────────────────────────────────────────────────────────────────────

export const DISPUTE_ELAPSED_WARNING_HOURS = 24;
export const DISPUTE_ELAPSED_DANGER_HOURS = 48;

export type DisputeElapsedTone = "ok" | "warning" | "danger" | "none";
export type DisputeElapsed = { hours: number | null; label: string; tone: DisputeElapsedTone };

export function disputeIsTerminal(status: string | null | undefined): boolean {
  return (DISPUTE_TERMINAL_STATUSES as readonly string[]).includes(String(status ?? "").trim().toLowerCase());
}

/** 종결이 아닌 건만 경과를 센다 — 종결 건은 '—'. 24시간 초과 주의 · 48시간 초과 위험(정각은 아직 아님). */
export function disputeElapsed(createdAt: string | null | undefined, status: string | null | undefined, now: number = Date.now()): DisputeElapsed {
  if (disputeIsTerminal(status)) return { hours: null, label: "—", tone: "none" };
  const t = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(t)) return { hours: null, label: "—", tone: "none" };
  const elapsedMs = Math.max(0, now - t);
  const hours = Math.floor(elapsedMs / 3_600_000);
  const tone: DisputeElapsedTone =
    elapsedMs > DISPUTE_ELAPSED_DANGER_HOURS * 3_600_000 ? "danger" : elapsedMs > DISPUTE_ELAPSED_WARNING_HOURS * 3_600_000 ? "warning" : "ok";
  let label: string;
  if (hours < 1) label = "1시간 미만";
  else if (hours < 24) label = `${hours}시간`;
  else {
    const days = Math.floor(hours / 24);
    const rest = hours % 24;
    label = rest ? `${days}일 ${rest}시간` : `${days}일`;
  }
  return { hours, label, tone };
}

export function disputeElapsedToneClass(tone: DisputeElapsedTone): string {
  switch (tone) {
    case "danger":
      return "border-red-200 bg-red-50 text-red-700";
    case "warning":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "ok":
      return "border-slate-200 bg-slate-50 text-slate-600";
    default:
      return "border-transparent text-slate-400";
  }
}

// ── 상태 전이 — 서버 액션의 게이트를 그대로 옮긴 표(정본은 액션 파일 · 계약 테스트가 대조) ──

/** `setDisputeUnderReviewAction` — `runDisputeUpdate(…, ["open", "escalated"])` */
export const DISPUTE_REVIEW_FROM = ["open", "escalated"] as const;
/** `resolveDisputeAction` · `dismissDisputeAction` — statusIn 5종(종말 3종 + on_hold 제외) */
export const DISPUTE_CLOSE_FROM = ["open", "under_review", "escalated", "sanction_7d", "sanction_30d"] as const;
/** `applyDisputeSanctionAction` — `SANCTIONABLE_STATUSES`(hold · complete · 7d · 30d · permanent 공통 게이트) */
export const DISPUTE_SANCTION_FROM = ["open", "under_review", "escalated", "on_hold", "sanction_7d", "sanction_30d"] as const;
/** RPC `record_custom_order_dispute_split` 가 분쟁을 resolved 로 바꾸는 조건 — `d.status in ('open','under_review','escalated')` */
export const DISPUTE_FUNDS_FROM = ["open", "under_review", "escalated"] as const;
/** `bulkUpdateDisputesAction` — `.in("status", [...])` */
export const DISPUTE_BULK_FROM = ["open", "under_review", "escalated", "sanction_7d", "sanction_30d"] as const;

export type DisputeActionKey = "review" | "hold" | "dismiss" | "resolve" | "refund_student" | "split" | "payout_mentor" | "sanction";
export type DisputeActionLevel = "stateChange" | "critical";

export const DISPUTE_ACTIONS: Readonly<
  Record<DisputeActionKey, { level: DisputeActionLevel; label: string; dialogTitle: string; confirmLabel: string; pendingLabel: string }>
> = {
  review: { level: "stateChange", label: "검토 시작", dialogTitle: "검토 시작", confirmLabel: "검토 중으로", pendingLabel: "처리 중…" },
  hold: { level: "stateChange", label: "보류", dialogTitle: "분쟁 보류", confirmLabel: "보류", pendingLabel: "처리 중…" },
  dismiss: { level: "stateChange", label: "기각", dialogTitle: "분쟁 기각", confirmLabel: "기각", pendingLabel: "처리 중…" },
  resolve: { level: "stateChange", label: "해결(종결)", dialogTitle: "분쟁 해결(종결)", confirmLabel: "해결로 종결", pendingLabel: "처리 중…" },
  refund_student: { level: "critical", label: "학생 전액 환불", dialogTitle: "학생 전액 환불 — 실행 전 확인", confirmLabel: "전액 환불 실행", pendingLabel: "환불 중…" },
  split: { level: "critical", label: "예치금 분할", dialogTitle: "예치금 분할 — 실행 전 확인", confirmLabel: "분할 실행", pendingLabel: "분배 중…" },
  payout_mentor: { level: "critical", label: "멘토 지급", dialogTitle: "멘토 지급 — 실행 전 확인", confirmLabel: "멘토 지급 실행", pendingLabel: "지급 중…" },
  sanction: { level: "critical", label: "제재", dialogTitle: "계정 제재 — 실행 전 확인", confirmLabel: "제재 실행", pendingLabel: "제재 중…" },
};

export const DISPUTE_FUND_ACTION_KEYS = ["refund_student", "split", "payout_mentor"] as const;

function normStatus(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase();
}

/**
 * 현재 상태에서 가능한 조치만 — 각 액션의 게이트 표에서 읽는다. 순서 = 화면 버튼 순서.
 * - `hold` 는 이미 on_hold 면 뺀다(게이트는 통과하지만 무의미한 재보류).
 * - `resolve` 는 on_hold 도 포함한다 — resolve 액션 게이트 밖이지만 제재 액션의 `complete` 코드로 해결할 수 있다(`disputeResolveRoute`).
 * - 자금 조치 3종은 RPC 의 분쟁 갱신 조건(open·under_review·escalated)일 때만 — 예치 상태(패널 state)는 화면이 따로 본다.
 */
export function disputeAllowedActions(status: string | null | undefined): DisputeActionKey[] {
  const s = normStatus(status);
  const out: DisputeActionKey[] = [];
  if ((DISPUTE_REVIEW_FROM as readonly string[]).includes(s)) out.push("review");
  if ((DISPUTE_SANCTION_FROM as readonly string[]).includes(s) && s !== "on_hold") out.push("hold");
  if ((DISPUTE_CLOSE_FROM as readonly string[]).includes(s)) out.push("dismiss");
  if ((DISPUTE_CLOSE_FROM as readonly string[]).includes(s) || s === "on_hold") out.push("resolve");
  if ((DISPUTE_FUNDS_FROM as readonly string[]).includes(s)) out.push(...DISPUTE_FUND_ACTION_KEYS);
  if ((DISPUTE_SANCTION_FROM as readonly string[]).includes(s)) out.push("sanction");
  return out;
}

export type DisputeResolveRoute = "resolve_action" | "sanction_complete";

/**
 * 해결 조치가 타는 서버 액션 — resolve 게이트 안이면 `resolveDisputeAction`(resolved_at·resolved_by 기록),
 * on_hold 는 그 게이트 밖이라 `applyDisputeSanctionAction` 의 `complete` 코드(status 만 resolved, note → admin_note·케이스 노트)로만 해결된다.
 */
export function disputeResolveRoute(status: string | null | undefined): DisputeResolveRoute | null {
  const s = normStatus(status);
  if ((DISPUTE_CLOSE_FROM as readonly string[]).includes(s)) return "resolve_action";
  if (s === "on_hold") return "sanction_complete";
  return null;
}

export function disputeIsBulkEligible(status: string | null | undefined): boolean {
  return (DISPUTE_BULK_FROM as readonly string[]).includes(normStatus(status));
}

// ── 서버 액션이 읽는 필드명·코드 (바꾸지 않는다) ─────────────────────────────

export const DISPUTE_ID_FIELD = "disputeId";
export const DISPUTE_SANCTION_FIELD = "sanction";
export const DISPUTE_SANCTION_TARGET_FIELD = "target";
export const DISPUTE_SANCTION_NOTE_FIELD = "note";
export const DISPUTE_SPLIT_ORDER_ID_FIELD = "orderId";
export const DISPUTE_SPLIT_MENTOR_GROSS_FIELD = "mentorGrossWon";
export const DISPUTE_SPLIT_STUDENT_REFUND_FIELD = "studentRefundWon";
export const DISPUTE_BULK_IDS_FIELD = "ids";
export const DISPUTE_BULK_STATUS_FIELD = "bulkStatus";
/** 기각·해결·분배·일괄 액션이 읽는 사유 필드 — `admin_action_logs.detail.reason` 에 남는다. 제재·보류·보류 건 완료는 `note`. */
export const DISPUTE_REASON_FIELD = "reason";
export const DISPUTE_CUSTOM_REASON_LABEL = "직접 입력";
export const DISPUTE_DISMISS_REASON_PRESETS: readonly string[] = ["근거 부족", "중복 접수", "당사자 취하"];
export const DISPUTE_RESOLVE_REASON_PRESETS: readonly string[] = ["예치금 처리 완료", "당사자 합의", "제재로 종결"];
export const DISPUTE_FUNDS_REASON_REQUIRED_MESSAGE = "예치금 조치 사유를 입력해 주세요.";

/** 다이얼로그와 같은 기준(trim 후 최소 길이) — 분배(자금) 액션이 서버에서 한 번 더 검사한다(확인 모달을 우회한 제출 차단). */
export function isDisputeReasonValid(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.trim().length >= ADMIN_CONFIRM_REASON_MIN_LENGTH;
}

/** `applyDisputeSanctionAction` 의 코드 — 계정 반영 3종 + 보류·완료 */
export const DISPUTE_SANCTION_CODES = ACCOUNT_SANCTION_CODES;
export const DISPUTE_SANCTION_CODE_LABELS = ACCOUNT_SANCTION_LABELS;
export const DISPUTE_HOLD_CODE = "hold";
export const DISPUTE_COMPLETE_CODE = "complete";
export type DisputeSanctionCode = AccountSanctionCode;

/** 제재 코드 → 분쟁 상태(`applyDisputeSanctionAction` 의 statusMap 그대로) */
export function disputeSanctionStatus(code: DisputeSanctionCode): string {
  return `sanction_${code}`;
}

export const DISPUTE_SANCTION_TARGETS = ["student", "mentor"] as const;
export type DisputeSanctionTarget = (typeof DISPUTE_SANCTION_TARGETS)[number];
export const DISPUTE_SANCTION_TARGET_LABELS: Readonly<Record<DisputeSanctionTarget, string>> = { student: "학생", mentor: "멘토" };

/** UI 에 노출하는 일괄 상태 2종 — 액션은 dismissed 도 받지만 구 화면과 같이 두 개만 둔다. */
export const DISPUTE_BULK_STATUSES = ["under_review", "resolved"] as const;
export type DisputeBulkStatus = (typeof DISPUTE_BULK_STATUSES)[number];

// ── 확인 summary ──────────────────────────────────────────────────────────────

function nameOrFallback(name: string | null | undefined): string {
  const s = typeof name === "string" ? name.trim() : "";
  return s || "이름 없음";
}

function won(n: number): string {
  return `${Math.round(n).toLocaleString("ko-KR")}원`;
}

/** 사유를 받지 않는 조치(검토 시작·보류)에 붙이는 안내 — 없는 저장을 약속하지 않는다. */
export const DISPUTE_NO_REASON_STORED_NOTE = "이 조치는 사유를 받지 않습니다. 근거가 필요하면 케이스 노트에 남겨 주세요.";
/** 사유를 감사 로그에만 남기는 조치(기각·해결·자금·일괄)에 붙이는 안내 — PR-2·3 과 같은 처리. */
export const DISPUTE_REASON_LOGGED_NOTE = "사유는 감사 로그(admin_action_logs)에 남습니다.";
/** 보류 건 해결(제재 액션 complete)의 사유는 note 로 들어가 세 곳에 남는다. */
export const DISPUTE_NOTE_STORED_NOTE = "사유는 운영 메모·케이스 노트·감사 로그에 남습니다.";
export const DISPUTE_FUNDS_NOT_MOVED_NOTE = "예치금은 이동하지 않습니다.";

export function buildDisputeStatusSummary(action: "review" | "hold" | "dismiss" | "resolve", route?: DisputeResolveRoute | null): string {
  switch (action) {
    case "review":
      return `이 분쟁을 '검토 중'으로 표시합니다. ${DISPUTE_FUNDS_NOT_MOVED_NOTE}\n${DISPUTE_NO_REASON_STORED_NOTE}`;
    case "hold":
      return `이 분쟁을 '보류'로 표시합니다. 보류 상태에서는 해결(종결)과 제재만 가능합니다(재검토 전이는 코드에 없음). ${DISPUTE_FUNDS_NOT_MOVED_NOTE}\n${DISPUTE_NO_REASON_STORED_NOTE}`;
    case "dismiss":
      return `이 분쟁을 기각합니다(종결). ${DISPUTE_FUNDS_NOT_MOVED_NOTE} 맞춤의뢰 예치금이 걸린 건은 먼저 환불·분할·지급으로 처리하세요.\n${DISPUTE_REASON_LOGGED_NOTE}`;
    case "resolve":
    default:
      return route === "sanction_complete"
        ? `보류 중인 분쟁을 '해결'로 종결합니다. 보류 상태에서는 제재 액션의 완료 코드로만 해결되며 해결 시각·처리자는 기록되지 않습니다(기존 동작). ${DISPUTE_FUNDS_NOT_MOVED_NOTE}\n${DISPUTE_NOTE_STORED_NOTE}`
        : `이 분쟁을 '해결'로 종결합니다. ${DISPUTE_FUNDS_NOT_MOVED_NOTE} 맞춤의뢰 예치금이 걸린 건은 먼저 환불·분할·지급으로 처리하세요.\n${DISPUTE_REASON_LOGGED_NOTE}`;
  }
}

export type DisputeSanctionSummaryInput = {
  targetName: string;
  target: DisputeSanctionTarget;
  code: DisputeSanctionCode;
  untilLabel: string | null;
  mentorRoomCount: number | null;
};

/** 제재 summary — 계정 정지 문장(공용) + 분쟁 상태 전이 + 사유 저장 위치 */
export function buildDisputeSanctionSummary(input: DisputeSanctionSummaryInput): string {
  const account = buildAccountSanctionSummary({
    name: input.targetName,
    roleLabel: DISPUTE_SANCTION_TARGET_LABELS[input.target],
    code: input.code,
    untilLabel: input.untilLabel,
    mentorRoomCount: input.mentorRoomCount,
    isMentor: input.target === "mentor",
  });
  return `${account}\n분쟁 상태가 '${disputeStatusLabel(disputeSanctionStatus(input.code))}'(으)로 바뀝니다. 사유는 계정 상태 사유·케이스 노트·감사 로그에 남습니다.`;
}

export const DISPUTE_SANCTION_BLOCKED_MESSAGE = "제재 대상과 기간을 모두 선택해 주세요.";

// ── 자금 조치 — RPC record_custom_order_dispute_split 한 경로, 금액만 다르다 ──

/** RPC 와 같은 산식: fee = floor(gross × 요율), net = gross − fee. 요율은 DB 정산 행 값만(없으면 null → 계산하지 않는다). */
export function disputeMentorNetFromGrossWon(grossWon: number, feeRate: number | null): { feeWon: number | null; netWon: number | null } {
  if (feeRate == null || !Number.isFinite(feeRate)) return { feeWon: null, netWon: null };
  const g = Math.max(0, Math.floor(grossWon));
  const feeWon = Math.floor(g * feeRate);
  return { feeWon, netWon: g - feeWon };
}

export type DisputeSplitPreview = {
  holdWon: number;
  studentWon: number;
  mentorGrossWon: number;
  feeRate: number | null;
  feeWon: number | null;
  mentorNetWon: number | null;
  sumWon: number;
  /** 세 숫자(학생 몫 + 멘토 실수령 + 수수료 = 학생 몫 + 멘토 gross)가 예치금과 같은가 */
  sumOk: boolean;
  problem: "none" | "not_integer" | "negative" | "mismatch";
};

/** 분할 미리보기 — 입력은 원 단위 정수여야 하고 합이 예치금과 같아야 실행 가능. */
export function buildDisputeSplitPreview(input: { holdWon: number; studentWon: number; mentorGrossWon: number; feeRate: number | null }): DisputeSplitPreview {
  const holdWon = Math.max(0, Math.trunc(input.holdWon));
  const s = input.studentWon;
  const m = input.mentorGrossWon;
  const notInteger = !Number.isInteger(s) || !Number.isInteger(m);
  const negative = !notInteger && (s < 0 || m < 0);
  const studentWon = Number.isFinite(s) ? Math.trunc(s) : 0;
  const mentorGrossWon = Number.isFinite(m) ? Math.trunc(m) : 0;
  const { feeWon, netWon } = disputeMentorNetFromGrossWon(Math.max(0, mentorGrossWon), input.feeRate);
  const sumWon = studentWon + mentorGrossWon;
  const problem: DisputeSplitPreview["problem"] = notInteger ? "not_integer" : negative ? "negative" : sumWon !== holdWon ? "mismatch" : "none";
  return {
    holdWon,
    studentWon,
    mentorGrossWon,
    feeRate: input.feeRate,
    feeWon,
    mentorNetWon: netWon,
    sumWon,
    sumOk: problem === "none",
    problem,
  };
}

export function disputeSplitBlockedMessage(preview: DisputeSplitPreview): string | null {
  switch (preview.problem) {
    case "not_integer":
      return "금액은 원 단위 정수로 입력해 주세요.";
    case "negative":
      return "금액은 0 이상이어야 합니다.";
    case "mismatch":
      return `학생 몫 + 멘토 몫(실수령 + 수수료) 합계 ${won(preview.sumWon)}이 예치금 ${won(preview.holdWon)}과 다릅니다. 금액을 맞춰야 실행할 수 있습니다.`;
    default:
      return null;
  }
}

const SPLIT_AFTER_SENTENCE = "실행 후 분쟁은 '해결', 주문은 '분쟁 해결' 상태가 되고 정산 행은 취소됩니다. 되돌릴 수 없습니다.";

function mentorShareSentence(preview: DisputeSplitPreview): string {
  if (preview.mentorGrossWon <= 0) return "멘토 지급 0원.";
  if (preview.feeWon == null || preview.mentorNetWon == null) {
    return `멘토 몫 ${won(preview.mentorGrossWon)} — 정산 행에 수수료율이 없어(요율 미설정) 실수령 예상액을 계산하지 않습니다. 실제 공제는 RPC 가 DB 요율로 집행합니다.`;
  }
  return `멘토 몫 ${won(preview.mentorGrossWon)}(수수료 ${settlementFeeRateLabel(preview.feeRate)} ${won(preview.feeWon)} 공제 후 실수령 ${won(preview.mentorNetWon)}).`;
}

/**
 * 분할 summary — 줄바꿈 3문장: 누구에게 얼마 · 합계 = 예치금 · 실행 후 상태.
 *   김OO 학생에게 30,000원을 캐시로 환불합니다. 멘토 몫 25,000원(수수료 5% 1,250원 공제 후 실수령 23,750원).
 *   합계 55,000원 = 예치금 55,000원.
 *   실행 후 …
 */
export function buildDisputeSplitSummary(preview: DisputeSplitPreview, names: { studentName: string; mentorName: string }): string {
  const student = preview.studentWon > 0 ? `${nameOrFallback(names.studentName)} 학생에게 ${won(preview.studentWon)}을 캐시로 환불합니다.` : "학생 환불 0원.";
  const mentor = mentorShareSentence(preview).replace(/^멘토 몫/, `${nameOrFallback(names.mentorName)} 멘토 몫`);
  const sum = preview.sumOk ? `합계 ${won(preview.sumWon)} = 예치금 ${won(preview.holdWon)}.` : `합계 ${won(preview.sumWon)} ≠ 예치금 ${won(preview.holdWon)} — 확인이 잠깁니다.`;
  return [`${student} ${mentor}`, sum, SPLIT_AFTER_SENTENCE].join("\n");
}

export function buildDisputeRefundStudentSummary(preview: DisputeSplitPreview, studentName: string): string {
  return [
    `${nameOrFallback(studentName)} 학생에게 예치금 ${won(preview.holdWon)} 전액을 캐시로 환불합니다. 멘토 지급 0원.`,
    SPLIT_AFTER_SENTENCE,
  ].join("\n");
}

export function buildDisputePayoutMentorSummary(preview: DisputeSplitPreview, mentorName: string): string {
  const share = mentorShareSentence(preview).replace(/^멘토 몫/, `${nameOrFallback(mentorName)} 멘토에게 예치금`).replace(/^([^\n]*?)\./, "$1을 지급합니다.");
  return [`${share} 학생 환불 0원.`, SPLIT_AFTER_SENTENCE].join("\n");
}

export type DisputeConfirmDetail = { label: string; value: string };

/** 자금 모달 금액 재표시 행 — 예치금 · 학생 몫 · 멘토 gross · 수수료 · 멘토 실수령 */
export function buildDisputeSplitDetails(preview: DisputeSplitPreview): DisputeConfirmDetail[] {
  return [
    { label: "예치금(hold)", value: won(preview.holdWon) },
    { label: "학생 몫(환불)", value: won(preview.studentWon) },
    { label: "멘토 몫(gross)", value: won(preview.mentorGrossWon) },
    { label: `수수료(${settlementFeeRateLabel(preview.feeRate)})`, value: preview.feeWon == null ? "계산 안 함" : won(preview.feeWon) },
    { label: "멘토 실수령", value: preview.mentorNetWon == null ? "RPC 가 DB 요율로 계산" : won(preview.mentorNetWon) },
  ];
}

// ── 일괄 처리(상태 변경만 — 자금 일괄 없음) ─────────────────────────────────

export const DISPUTE_BULK_STATUS_LABELS: Readonly<Record<DisputeBulkStatus, string>> = {
  under_review: disputeStatusLabel("under_review"),
  resolved: disputeStatusLabel("resolved"),
};

export const DISPUTE_BULK_BLOCKED_MESSAGE = "선택된 건이 없습니다. 목록에서 한 건 이상 선택해 주세요.";

/** "선택한 3건을 '검토 중'으로 바꿉니다" + 예치금 불변·사유 미저장 안내 */
export function buildDisputeBulkSummary(nextStatus: DisputeBulkStatus, count: number): string {
  if (count <= 0) return "선택된 건이 없습니다. 모달 안에서 항목을 다시 선택해 주세요.";
  const label = DISPUTE_BULK_STATUS_LABELS[nextStatus];
  const head = nextStatus === "resolved" ? `선택한 ${count}건을 '${label}'로 종결합니다.` : `선택한 ${count}건을 '${label}'으로 바꿉니다.`;
  const tail =
    nextStatus === "resolved"
      ? `${DISPUTE_FUNDS_NOT_MOVED_NOTE} 맞춤의뢰 예치금이 걸린 건은 상세에서 환불·분할·지급으로 처리하세요.`
      : DISPUTE_FUNDS_NOT_MOVED_NOTE;
  return [head, tail, `${DISPUTE_REASON_LOGGED_NOTE} 사유는 전체에 같은 값으로 적용됩니다.`].join("\n");
}

export function disputeBulkConfirmLabel(nextStatus: DisputeBulkStatus, count: number): string {
  return `${Math.max(0, count)}건 ${DISPUTE_BULK_STATUS_LABELS[nextStatus]}으로`;
}

// ── 빈 상태(지시서 §2-5 원문) · 플래시 ──────────────────────────────────────

export const DISPUTE_EMPTY_STATE = {
  title: "아직 접수된 분쟁이 없습니다",
  description: "개별질문·맞춤의뢰에서 '문제 해결 요청'이 들어오면 여기에 쌓입니다.",
  stepsTitle: "분쟁이 들어오면 이렇게 처리합니다",
  steps: ["양측 주장과 주문·결제 이력을 확인합니다", "환불 · 분할 · 지급 중 하나로 예치금을 처리합니다", "필요하면 제재를 함께 결정합니다"],
} as const;

export type DisputeEmptyVariant = "first" | "tab" | "search";

export function disputeEmptyVariant(search: string, allCount: number): DisputeEmptyVariant {
  if (search.trim()) return "search";
  if (allCount <= 0) return "first";
  return "tab";
}

const BULK_OK_RE = /^\d+건을 일괄 처리했습니다\((under_review|resolved|dismissed)\)\.$/;

/** 목록 `?ok=` — 제재·보류 액션은 `sanction`, 일괄 액션은 문장을 그대로 싣는다(형식이 맞을 때만 표시). */
export function disputeListFlashOkMessage(ok: string | null | undefined): string | null {
  const s = String(ok ?? "").trim();
  if (!s) return null;
  if (s === "sanction") return "조치를 기록했습니다.";
  if (BULK_OK_RE.test(s)) return s;
  return null;
}

/** 상세 `?ok=` — 검토·해결·기각·메모·분배 액션의 redirect 키 */
export function disputeDetailFlashOkMessage(ok: string | null | undefined): string | null {
  switch (String(ok ?? "").trim()) {
    case "reviewing":
      return "검토 중으로 변경했습니다.";
    case "resolved":
      return "해결 처리했습니다.";
    case "dismissed":
      return "기각 처리했습니다.";
    case "note":
      return "케이스 노트를 저장했습니다.";
    case "dispute_split":
      return "예치금을 분배했습니다. 분쟁·주문 상태가 갱신되었습니다.";
    default:
      return null;
  }
}

// ── 상세 표시 ────────────────────────────────────────────────────────────────

/** 상세 제목 `주문 #CR0412 · 김OO ↔ 수학하는하늘` — 주문이 없으면 `분쟁 #… · …` */
export function buildDisputeDetailTitle(input: { orderRef: string; disputeRef: string; studentName: string; mentorName: string }): string {
  const head = input.orderRef ? `주문 ${input.orderRef}` : `분쟁 ${input.disputeRef}`;
  return `${head} · ${nameOrFallback(input.studentName)} ↔ ${nameOrFallback(input.mentorName)}`;
}

/** `order_events.event` → 표기(주문방 액션이 쓰는 값). 모르는 값은 원시 값. */
export const DISPUTE_ORDER_EVENT_LABELS: Readonly<Record<string, string>> = {
  order_started: "작업 시작",
  deliverable_submitted: "납품",
  deliverable_accepted: "납품 수락",
  revision_requested: "수정 요청",
  dispute_opened: "분쟁 제기",
  order_cancelled: "주문 취소",
  message_created: "메시지",
};

export function disputeOrderEventLabel(event: string | null | undefined): string {
  const e = String(event ?? "").trim();
  if (!e) return "이벤트";
  return DISPUTE_ORDER_EVENT_LABELS[e] ?? e;
}

/** `cash_ledger.reason` → 표기(맞춤의뢰 예치 흐름). 모르는 값은 원시 값. */
export const DISPUTE_LEDGER_REASON_LABELS: Readonly<Record<string, string>> = {
  custom_order_escrow_hold: "예치",
  custom_order_escrow_payout: "멘토 지급",
  custom_order_escrow_refund: "학생 환불",
  custom_order_dispute_payout: "분쟁 분배 · 멘토 지급",
  custom_order_dispute_refund: "분쟁 분배 · 학생 환불",
};

export function disputeLedgerReasonLabel(reason: string | null | undefined): string {
  const r = String(reason ?? "").trim();
  if (!r) return "원장";
  return DISPUTE_LEDGER_REASON_LABELS[r] ?? r;
}

/** 원장 delta(minor, 원×100) → 부호 있는 원 표기 `+55,000원` / `-55,000원` */
export function formatDisputeLedgerDelta(deltaCents: unknown): string {
  const n = typeof deltaCents === "number" ? deltaCents : typeof deltaCents === "string" ? Number(deltaCents) : NaN;
  if (!Number.isFinite(n)) return "—";
  const wonValue = Math.trunc(Math.abs(n) / 100);
  return `${n < 0 ? "-" : "+"}${wonValue.toLocaleString("ko-KR")}원`;
}

/** `admin_action_logs.action_type` → 처리 이력 표기(분쟁 액션이 남기는 값). 모르는 값은 원시 값. */
export const DISPUTE_ACTION_LOG_LABELS: Readonly<Record<string, string>> = {
  dispute_under_review: "검토 시작",
  dispute_resolved: "해결(종결)",
  dispute_dismissed: "기각",
  dispute_note_created: "케이스 노트",
  dispute_custom_order_split: "예치금 분배",
  dispute_hold: "보류",
  dispute_complete: "해결(보류 건 완료)",
  dispute_7d: `제재 · ${disputeStatusLabel("sanction_7d")}`,
  dispute_30d: `제재 · ${disputeStatusLabel("sanction_30d")}`,
  dispute_permanent: `제재 · ${disputeStatusLabel("sanction_permanent")}`,
  dispute_bulk_status: "일괄 상태 변경",
};

export function disputeActionLogLabel(actionType: string | null | undefined): string {
  const a = String(actionType ?? "").trim();
  if (!a) return "처리";
  return DISPUTE_ACTION_LOG_LABELS[a] ?? a;
}
