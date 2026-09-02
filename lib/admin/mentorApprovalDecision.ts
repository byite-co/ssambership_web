/**
 * 멘토 승인 작업대 — ④ 결정 영역·단축키의 순수 규칙(PR-2 §7·§8).
 *
 * - 세 결정(승인·반려·재제출 요청)은 모두 `ConfirmSubmitButton`(stateChange) 확인 절차를 거친다.
 *   반려·재제출은 사유 프리셋 한 번 클릭으로 끝난다(프리셋 선택 = 확인). "직접 입력" 만 텍스트 필드.
 * - 사유는 기존 서버 액션이 읽는 필드명(`rejectionReason` / `adminNote`)으로 실려 `admin_action_logs.detail` 에 남는다.
 *   DB 쓰기 동작은 바꾸지 않는다.
 * - 단축키: 입력 요소에 포커스가 있으면 **전부** 끈다(핸들러 첫 줄). 단일키 이동(J/K)·전체화면(F)·다음 대기건(N).
 *   승인·반려·재제출 키(A/R/D)는 **확인 모달을 열 뿐** 실행하지 않는다(트리거 버튼 click → 다이얼로그 open).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { IDENTITY_UNVERIFIED_WARNING, type MentorIdentityReviewKind, isIdentityUnverified } from "./mentorIdentityReview.ts";

export type MentorDecisionKind = "approve" | "reject" | "resubmit";

export const MENTOR_DECISION_REASON_PRESETS: readonly string[] = ["서류를 알아볼 수 없음", "정보가 일치하지 않음", "자격 미달"];
export const MENTOR_DECISION_CUSTOM_REASON_LABEL = "직접 입력";

/** 기존 서버 액션이 읽는 사유 필드명 — 바꾸지 않는다(mentorApprovalActions.ts). */
export const MENTOR_DECISION_REASON_FIELD: Readonly<Record<Exclude<MentorDecisionKind, "approve">, string>> = {
  reject: "rejectionReason",
  resubmit: "adminNote",
};

export const MENTOR_DECISION_LABELS: Readonly<Record<MentorDecisionKind, string>> = {
  approve: "승인",
  reject: "반려",
  resubmit: "재제출 요청",
};

/** 버튼 아래 한 줄 설명 */
export const MENTOR_DECISION_DESCRIPTIONS: Readonly<Record<Exclude<MentorDecisionKind, "approve">, string>> = {
  reject: "자격 미달 — 다시 지원할 수 없음",
  resubmit: "서류 문제 — 고쳐서 다시 낼 수 있음",
};

/** 단축키(A/R/D)가 click 으로 다이얼로그를 여는 트리거 버튼 id */
export const MENTOR_DECISION_BUTTON_IDS: Readonly<Record<MentorDecisionKind, string>> = {
  approve: "mentor-approval-decision-approve",
  reject: "mentor-approval-decision-reject",
  resubmit: "mentor-approval-decision-resubmit",
};

export type MentorApproveSummaryInput = {
  name: string;
  university: string;
  department: string;
  /** null = 학교 인증 행 없음 */
  tierConfirmed: boolean | null;
  tierLabel: string;
  identityKind: MentorIdentityReviewKind;
};

/** 승인 확인 모달 summary — 이름·대학·등급 확정 여부·본인인증 여부를 문장으로. 미인증이면 §4 경고 문장 포함. */
export function buildMentorApproveSummary(input: MentorApproveSummaryInput): string {
  const who = input.name.trim() || "이름 없음";
  const school = [input.university.trim(), input.department.trim()].filter(Boolean).join(" ") || "학교 미입력";
  const tier =
    input.tierConfirmed === null
      ? "학교 등급 행 없음"
      : input.tierConfirmed
        ? `학교 등급 ${input.tierLabel} 확정됨`
        : `학교 등급 ${input.tierLabel} 자동 판정(미확정)`;
  const identity =
    input.identityKind === "match"
      ? "본인인증 완료(이름 일치)"
      : input.identityKind === "mismatch"
        ? "본인인증 완료(이름 불일치 — 확인 필요)"
        : "본인인증 미완료";
  const sentence = `${who}(${school}) 멘토를 승인합니다. ${tier} · ${identity}.`;
  return isIdentityUnverified(input.identityKind) ? `${sentence} ${IDENTITY_UNVERIFIED_WARNING}` : sentence;
}

export function buildMentorRejectSummary(name: string): string {
  return `${name.trim() || "이름 없음"} 멘토 신청을 반려합니다. 반려된 지원자는 다시 지원할 수 없습니다.`;
}

export function buildMentorResubmitSummary(name: string): string {
  return `${name.trim() || "이름 없음"} 멘토에게 서류 재제출을 요청합니다. 고쳐서 다시 낼 수 있습니다.`;
}

// ── 단축키 ──────────────────────────────────────────────────────────────────

export type MentorApprovalShortcutAction =
  | "next"
  | "prev"
  | "nextPending"
  | "fullscreen"
  | "openApprove"
  | "openReject"
  | "openResubmit";

export const MENTOR_APPROVAL_SHORTCUTS: readonly { key: string; action: MentorApprovalShortcutAction; label: string }[] = [
  { key: "J", action: "next", label: "다음 지원자" },
  { key: "K", action: "prev", label: "이전 지원자" },
  { key: "N", action: "nextPending", label: "다음 대기 건" },
  { key: "F", action: "fullscreen", label: "서류 전체화면" },
  { key: "A", action: "openApprove", label: "승인 확인 열기" },
  { key: "R", action: "openReject", label: "반려 사유 열기" },
  { key: "D", action: "openResubmit", label: "재제출 사유 열기" },
];

/** 확인 모달만 여는(실행하지 않는) 액션 */
export const MENTOR_APPROVAL_DIALOG_ONLY_ACTIONS: readonly MentorApprovalShortcutAction[] = ["openApprove", "openReject", "openResubmit"];

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * 단축키를 무시해야 하는가 — 핸들러 첫 줄에서 호출한다.
 * - 입력 요소(input·textarea·select·contenteditable)에 포커스 → 무시
 * - Ctrl/Alt/Meta 조합 → 무시(브라우저 단축키 보존)
 * - 확인 다이얼로그가 열려 있음 → 무시(모달 위에서 목록이 움직이면 안 된다)
 * - IME 조합 중 → 무시
 */
export function shouldIgnoreMentorApprovalShortcut(input: {
  tagName: string | null | undefined;
  isContentEditable?: boolean;
  hasModifier?: boolean;
  dialogOpen?: boolean;
  isComposing?: boolean;
}): boolean {
  const tag = String(input.tagName ?? "").toUpperCase();
  if (EDITABLE_TAGS.has(tag)) return true;
  if (input.isContentEditable) return true;
  if (input.hasModifier) return true;
  if (input.dialogOpen) return true;
  if (input.isComposing) return true;
  return false;
}

/** 키 → 액션. 대소문자 무관. 모르는 키는 null. */
export function resolveMentorApprovalShortcut(key: string | null | undefined): MentorApprovalShortcutAction | null {
  const k = String(key ?? "").toUpperCase();
  if (k.length !== 1) return null;
  return MENTOR_APPROVAL_SHORTCUTS.find((s) => s.key === k)?.action ?? null;
}

/** "이미 처리됨" 배너용 — admin_action_logs.action_type → 결과 라벨 */
export function mentorDecisionResultLabel(actionType: string | null | undefined): string {
  switch (actionType) {
    case "mentor_approve":
      return "승인";
    case "mentor_reject":
      return "반려";
    case "mentor_request_documents":
      return "재제출 요청";
    default:
      return "처리";
  }
}

export const MENTOR_DECISION_ACTION_TYPES: readonly string[] = ["mentor_approve", "mentor_reject", "mentor_request_documents"];

// ── ② 자격 블록 표시 ─────────────────────────────────────────────────────────

/**
 * 정원(cap) 수치 표시 — DB RPC 값 그대로(가중치 합 · 단위 없음). 판정 불가(null)는 지어내지 않고 '—'.
 * 계산은 하지 않는다(PR-1b: cap 은 DB RPC 정본, TS 계산 복원 금지).
 */
export function formatCapValue(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 같은 대학 당일 가입 경고 임계(§5) */
export const SAME_SCHOOL_TODAY_WARNING_THRESHOLD = 5;

export function sameSchoolTodayWarning(count: number | null | undefined): string | null {
  if (typeof count !== "number" || count < SAME_SCHOOL_TODAY_WARNING_THRESHOLD) return null;
  return `같은 학교에서 오늘 ${count}명 지원`;
}
