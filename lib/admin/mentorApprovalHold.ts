/**
 * 멘토 승인 작업대 — 보류 · 승인 취소 · 되돌리기의 순수 규칙(PR-2b §1 · §3).
 *
 * - 보류(`on_hold`)는 **관리자 내부 상태**다. 멘토에게 알리지 않고, 대기 탭·다음 대기 건 이동·대시보드 대기 건수에서 빠진다.
 *   `mentor_profiles.verification_status` 에는 CHECK 가 없어 PR-1 상태 사전(`adminStatusDictionary`)이 유일한 허용 목록이다 —
 *   `on_hold` 는 거기에 등재돼 있다(라벨 `보류`).
 * - 메모는 `admin_action_logs.detail` 에 남는다(`note` · `reason` 두 키 — 감사 로그 화면의 사유 추출 키와 같다). 지시서가 가리킨
 *   `admin_case_notes` 는 CHECK `num_nonnulls(dispute_id, report_id) = 1` 때문에 멘토 대상을 받지 않고, DB 변경은 이 PR 의 범위 밖이다.
 * - 승인 취소는 `approved → pending` 한 줄 UPDATE 다(critical · 사유 필수). 학교 인증 행·요금제 행은 건드리지 않는다 — 재승인 시
 *   `trg_auto_school_verification` 은 `NOT EXISTS(pending·approved)` 로, `trg_mp_seed_default_plans` 는 `ON CONFLICT DO NOTHING` 으로
 *   중복을 만들지 않는다(SQL 192 · 166/190).
 * - 활성 구독이 있으면 승인 취소를 막는다(버튼 비활성 + 서버 재검사). 구독 수를 확인하지 못했으면 **막는다**(fail-closed).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { MENTOR_DECISION_ACTION_TYPES, mentorDecisionResultLabel } from "./mentorApprovalDecision.ts";

export const MENTOR_HOLD_STATUS = "on_hold";
/** 보류에서 해제되면 돌아가는 상태 · 승인 취소·반려 되돌리기가 돌아가는 상태 */
export const MENTOR_HOLD_RELEASE_TARGET_STATUS = "pending";

export const MENTOR_HOLD_REASON_PRESETS: readonly string[] = ["서류 재확인 필요", "학교 확인 필요", "동업자 상의"];

/** 새 서버 액션이 읽는 폼 필드명 — 화면과 액션이 공유한다. */
export const MENTOR_HOLD_REASON_FIELD = "holdNote";
export const MENTOR_HOLD_RELEASE_NOTE_FIELD = "releaseNote";
export const MENTOR_REVOKE_REASON_FIELD = "revokeReason";
export const MENTOR_REVERT_REASON_FIELD = "revertReason";

/** 감사 로그 action_type — `adminActionTypeLabels.ts` 에 등재돼 있다. */
export const MENTOR_HOLD_ACTION_TYPE = "mentor_hold";
export const MENTOR_HOLD_RELEASE_ACTION_TYPE = "mentor_hold_release";
export const MENTOR_APPROVAL_REVOKED_ACTION_TYPE = "mentor_approval_revoked";
export const MENTOR_REJECTION_REVERTED_ACTION_TYPE = "mentor_rejection_reverted";

/** 승인 화면이 "마지막 처리" 로 보는 action_type 전부(결정 3종 + 보류 2종 + 되돌리기 2종). */
export const MENTOR_APPROVAL_HISTORY_ACTION_TYPES: readonly string[] = [
  ...MENTOR_DECISION_ACTION_TYPES,
  MENTOR_HOLD_ACTION_TYPE,
  MENTOR_HOLD_RELEASE_ACTION_TYPE,
  MENTOR_APPROVAL_REVOKED_ACTION_TYPE,
  MENTOR_REJECTION_REVERTED_ACTION_TYPE,
];

export type MentorHoldControlKind = "hold" | "release" | "revoke" | "revert";

/** 단축키 H 가 click 하는 보류 버튼 id · 되돌리기 계열 버튼 id */
export const MENTOR_HOLD_BUTTON_IDS: Readonly<Record<MentorHoldControlKind, string>> = {
  hold: "mentor-approval-decision-hold",
  release: "mentor-approval-hold-release",
  revoke: "mentor-approval-revoke",
  revert: "mentor-approval-reject-revert",
};

export const MENTOR_HOLD_LABELS: Readonly<Record<MentorHoldControlKind, string>> = {
  hold: "보류",
  release: "보류 해제",
  revoke: "승인 취소",
  revert: "반려 되돌리기",
};

/** 멘토 화면에는 "보류" 라는 말을 쓰지 않는다 — 멘토에게는 `검토 중` 으로 보인다(§1-1). */
export const MENTOR_HOLD_MENTOR_FACING_LABEL = "검토 중";

export function isMentorOnHold(status: string | null | undefined): boolean {
  return typeof status === "string" && status.trim() === MENTOR_HOLD_STATUS;
}

function who(name: string): string {
  return name.trim() || "이름 없음";
}

export function buildMentorHoldSummary(name: string): string {
  return `${who(name)} 멘토 신청을 보류합니다. 대기 목록에서 빠지고 멘토에게는 알리지 않습니다. 메모를 남겨 주세요.`;
}

export function buildMentorHoldReleaseSummary(name: string): string {
  return `${who(name)} 멘토의 보류를 해제합니다. 대기 상태로 돌아갑니다.`;
}

/** 지시서 §3-2 원문 */
export function buildMentorRevokeSummary(name: string): string {
  return `${who(name)} 멘토의 승인을 취소합니다. 멘토 목록에서 사라지고 대기 상태로 돌아갑니다. 학교 등급 확정은 유지됩니다. 요금제는 유지됩니다.`;
}

export function buildMentorRejectRevertSummary(name: string): string {
  return `${who(name)} 멘토의 반려를 되돌립니다. 대기 상태로 돌아가 다시 심사할 수 있습니다.`;
}

// ── 승인 취소 차단(활성 구독) ────────────────────────────────────────────────

/** 승인 취소를 막는 구독 상태 — 끝나지 않은 구독 전부(SQL 158 의 활성 구독자 집합과 같다). */
export const REVOKE_BLOCKING_SUBSCRIPTION_STATUSES: readonly string[] = ["active", "cancel_scheduled", "past_due"];

export const REVOKE_INDETERMINATE_MESSAGE = "구독 여부를 확인하지 못했습니다 — 확인될 때까지 취소할 수 없습니다";

/**
 * 승인 취소 버튼을 잠그는 이유 문구. null 이면 취소 가능.
 * - 활성 구독 N ≥ 1 → `구독 중인 학생 N명 — 구독이 끝나야 취소할 수 있습니다`
 * - 집계 실패(null) → 판정 불가 문구(막는다 · 0 으로 위장하지 않는다)
 */
export function revokeBlockedMessage(activeSubscriptionCount: number | null | undefined): string | null {
  if (typeof activeSubscriptionCount !== "number" || !Number.isFinite(activeSubscriptionCount)) return REVOKE_INDETERMINATE_MESSAGE;
  if (activeSubscriptionCount > 0) return `구독 중인 학생 ${activeSubscriptionCount}명 — 구독이 끝나야 취소할 수 있습니다`;
  return null;
}

// ── 이미 처리됨(동시 심사 §2-3) ──────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** instant → KST `MM-DD HH:mm`(예: `09-03 14:20`). 파싱 실패는 원문. */
export function formatKstShortDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const s = new Date(d.getTime() + KST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(s.getUTCMonth() + 1)}-${p(s.getUTCDate())} ${p(s.getUTCHours())}:${p(s.getUTCMinutes())}`;
}

/** action_type → 결과 라벨(결정 3종은 PR-2 의 라벨 그대로 · 보류·되돌리기 계열 추가). */
export function mentorApprovalHistoryLabel(actionType: string | null | undefined): string {
  switch (actionType) {
    case MENTOR_HOLD_ACTION_TYPE:
      return MENTOR_HOLD_LABELS.hold;
    case MENTOR_HOLD_RELEASE_ACTION_TYPE:
      return MENTOR_HOLD_LABELS.release;
    case MENTOR_APPROVAL_REVOKED_ACTION_TYPE:
      return MENTOR_HOLD_LABELS.revoke;
    case MENTOR_REJECTION_REVERTED_ACTION_TYPE:
      return MENTOR_HOLD_LABELS.revert;
    default:
      return mentorDecisionResultLabel(actionType);
  }
}

export type MentorAlreadyProcessedInput = {
  createdAt: string;
  adminName: string | null;
  actionType: string;
};

/** `.in(pending)` 게이트에 걸려 거절될 때 보이는 한 줄 — `09-03 14:20 박운영 승인`. */
export function buildAlreadyProcessedText(input: MentorAlreadyProcessedInput): string {
  return `${formatKstShortDateTime(input.createdAt)} ${input.adminName?.trim() || "관리자 미상"} ${mentorApprovalHistoryLabel(input.actionType)}`;
}

export const ALREADY_PROCESSED_PREFIX = "이미 처리됨";

/** URL `already` 파라미터 상한 — 액션이 만든 문장만 실린다. */
export const ALREADY_PROCESSED_PARAM = "already";
export const ALREADY_PROCESSED_PARAM_MAX_LENGTH = 120;

export function sanitizeAlreadyProcessedParam(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\r\n\t]+/g, " ").trim();
  if (!t) return null;
  return t.length > ALREADY_PROCESSED_PARAM_MAX_LENGTH ? t.slice(0, ALREADY_PROCESSED_PARAM_MAX_LENGTH) : t;
}

// ── 승인 취소됨 배지 ─────────────────────────────────────────────────────────

export const MENTOR_APPROVAL_REVOKED_BADGE = "승인 취소됨";

/**
 * 대기 탭 행에 `승인 취소됨` 배지를 다는가 — 현재 `pending` 이고 마지막 처리가 승인 취소일 때만.
 * (보류·반려 되돌리기 등 다른 처리가 뒤에 오면 배지는 사라진다 — 마지막 처리 기준.)
 */
export function isMentorApprovalRevoked(input: { status: string | null | undefined; lastActionType: string | null | undefined }): boolean {
  const s = typeof input.status === "string" ? input.status.trim() : "";
  return s === MENTOR_HOLD_RELEASE_TARGET_STATUS && input.lastActionType === MENTOR_APPROVAL_REVOKED_ACTION_TYPE;
}

// ── 오늘 내가 처리한 건(§3-3) ─────────────────────────────────────────────────

export type MentorDecisionTodayKind = "approve" | "reject" | "resubmit" | "hold" | "release" | "revoke" | "revert";

export const MENTOR_DECISION_TODAY_KIND_LABELS: Readonly<Record<MentorDecisionTodayKind, string>> = {
  approve: "승인",
  reject: "반려",
  resubmit: "재제출",
  hold: "보류",
  release: "보류 해제",
  revoke: "승인 취소",
  revert: "반려 되돌리기",
};

export function mentorDecisionTodayKind(actionType: string | null | undefined): MentorDecisionTodayKind | null {
  switch (actionType) {
    case "mentor_approve":
      return "approve";
    case "mentor_reject":
      return "reject";
    case "mentor_request_documents":
      return "resubmit";
    case MENTOR_HOLD_ACTION_TYPE:
      return "hold";
    case MENTOR_HOLD_RELEASE_ACTION_TYPE:
      return "release";
    case MENTOR_APPROVAL_REVOKED_ACTION_TYPE:
      return "revoke";
    case MENTOR_REJECTION_REVERTED_ACTION_TYPE:
      return "revert";
    default:
      return null;
  }
}

export type MentorDecisionsTodaySummary = Record<MentorDecisionTodayKind, number> & { total: number };

/** 감사 로그 행(action_type)들을 종류별로 센다 — 건수 = 감사 로그 집계(§4). 모르는 action_type 은 세지 않는다. */
export function summarizeMentorDecisionsToday(rows: readonly { actionType: string | null | undefined }[]): MentorDecisionsTodaySummary {
  const out: MentorDecisionsTodaySummary = { approve: 0, reject: 0, resubmit: 0, hold: 0, release: 0, revoke: 0, revert: 0, total: 0 };
  for (const row of rows) {
    const kind = mentorDecisionTodayKind(row.actionType);
    if (!kind) continue;
    out[kind] += 1;
    out.total += 1;
  }
  return out;
}

/** `오늘 내가 처리한 건 12 (승인 10 · 반려 1 · 보류 1)` — 승인·반려·보류는 항상, 나머지는 1건 이상일 때만 뒤에 붙인다. */
export function formatMentorDecisionsTodayHeading(summary: MentorDecisionsTodaySummary): string {
  const parts = [`승인 ${summary.approve}`, `반려 ${summary.reject}`, `보류 ${summary.hold}`];
  for (const kind of ["resubmit", "release", "revoke", "revert"] as const) {
    if (summary[kind] > 0) parts.push(`${MENTOR_DECISION_TODAY_KIND_LABELS[kind]} ${summary[kind]}`);
  }
  return `오늘 내가 처리한 건 ${summary.total} (${parts.join(" · ")})`;
}

export type MentorDecisionUndoKind = Exclude<MentorHoldControlKind, "hold">;

/**
 * 오늘 처리 목록 행의 `되돌리기` 종류 — 그 처리가 만든 상태에 멘토가 **아직 그대로 있을 때만**.
 * 승인 → 승인 취소(approved) · 반려 → 반려 되돌리기(rejected) · 보류 → 보류 해제(on_hold). 그 외(재제출·되돌리기 자체)는 없음.
 */
export function mentorDecisionUndoKind(actionType: string | null | undefined, currentStatus: string | null | undefined): MentorDecisionUndoKind | null {
  const s = typeof currentStatus === "string" ? currentStatus.trim() : "";
  const kind = mentorDecisionTodayKind(actionType);
  if (kind === "approve" && s === "approved") return "revoke";
  if (kind === "reject" && s === "rejected") return "revert";
  if (kind === "hold" && s === MENTOR_HOLD_STATUS) return "release";
  return null;
}
