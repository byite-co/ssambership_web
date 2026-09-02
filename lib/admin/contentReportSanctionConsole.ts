/**
 * 신고 상세 — 신고당한 사용자에게 내리는 경고·계정 정지(PR-6 §1)의 순수 규칙.
 *
 * - 두 조치 모두 **계정 관리 화면(`/admin/users`)의 기존 서버 액션을 그대로 재사용**한다(새 액션 없음):
 *   경고 = `issueUserWarningAction`(`userId` · `warnReason` · `severity`) → RPC `admin_issue_user_warning`
 *   정지 = `setUserStatusAction`(`userId` · `nextStatus` · `durationDays` · `reason`) → `users` 행 갱신.
 *   두 액션은 `returnTo`(PR-6 2번째 커밋 · 오너 승인)를 받아 신고 상세(`/admin/reports/<id>`)로 돌아온다 — 결과·실패는 신고 상세 상단 플래시.
 * - 등급: 경고 = stateChange + 사유 프리셋 필수 · 계정 정지 = critical(기간 7일·30일·영구 선택 + 사유 필수).
 * - 정지 기간 → 계정 상태는 분쟁 제재와 같은 표(`accountSanctionPolicy.ACCOUNT_SANCTION_TO_STATUS`).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import {
  ACCOUNT_SANCTION_CODES,
  ACCOUNT_SANCTION_LABELS,
  ACCOUNT_SANCTION_TO_STATUS,
  ACCOUNT_STATUS_RETURN_TO_FIELD,
  ACCOUNT_WARNING_AUTO_SUSPEND_DAYS,
  accountRoleLabel,
  buildAccountSanctionSummary,
  buildAccountWarningSummary,
  type AccountSanctionCode,
} from "./accountSanctionPolicy.ts";

// ── 서버 액션이 읽는 필드명(바꾸지 않는다) ────────────────────────────────────

export const CONTENT_REPORT_USER_ID_FIELD = "userId";
export const CONTENT_REPORT_WARN_REASON_FIELD = "warnReason";
export const CONTENT_REPORT_WARN_SEVERITY_FIELD = "severity";
export const CONTENT_REPORT_WARN_SEVERITY_DEFAULT = "normal";
export const CONTENT_REPORT_SUSPEND_STATUS_FIELD = "nextStatus";
export const CONTENT_REPORT_SUSPEND_DURATION_FIELD = "durationDays";
export const CONTENT_REPORT_SUSPEND_REASON_FIELD = "reason";
export const CONTENT_REPORT_RETURN_TO_FIELD = ACCOUNT_STATUS_RETURN_TO_FIELD;

/** 두 액션에 실어 보내는 복귀 경로 — 액션 쪽 `resolveAccountStatusReturnPath` 허용 목록(`/admin/reports/<uuid>`)과 같은 형식 */
export function contentReportUserActionReturnPath(reportId: string): string {
  return `/admin/reports/${encodeURIComponent(reportId)}`;
}

// ── 경고 ─────────────────────────────────────────────────────────────────────

export const CONTENT_REPORT_WARNING_PRESETS: readonly string[] = ["외부 연락처 유도", "대필 요청", "부적절한 언어", "커뮤니티 가이드라인 위반"];
export const CONTENT_REPORT_CUSTOM_REASON_LABEL = "직접 입력";

// ── 정지 ─────────────────────────────────────────────────────────────────────

export const CONTENT_REPORT_SUSPEND_CODES = ACCOUNT_SANCTION_CODES;
export const CONTENT_REPORT_SUSPEND_CODE_LABELS = ACCOUNT_SANCTION_LABELS;
export type ContentReportSuspendCode = AccountSanctionCode;

/** 기간 코드 → `setUserStatusAction` 필드 값(`nextStatus` · `durationDays`) */
export function contentReportSuspendFields(code: ContentReportSuspendCode): { nextStatus: "suspended" | "banned"; durationDays: string } {
  const m = ACCOUNT_SANCTION_TO_STATUS[code];
  return { nextStatus: m.nextStatus, durationDays: m.durationDays == null ? "" : String(m.durationDays) };
}

export const CONTENT_REPORT_SUSPEND_BLOCKED_MESSAGE = "정지 기간(7일 · 30일 · 영구)을 선택해 주세요.";

// ── 조치 목록·등급 ───────────────────────────────────────────────────────────

export type ContentReportUserActionKey = "warn" | "suspend";
export type ContentReportUserActionLevel = "stateChange" | "critical";

export const CONTENT_REPORT_USER_ACTIONS: Readonly<
  Record<ContentReportUserActionKey, { level: ContentReportUserActionLevel; label: string; dialogTitle: string; confirmLabel: string; pendingLabel: string }>
> = {
  warn: { level: "stateChange", label: "경고", dialogTitle: "경고 기록 — 사유 선택", confirmLabel: "경고 기록", pendingLabel: "기록 중…" },
  suspend: { level: "critical", label: "계정 정지", dialogTitle: "계정 정지 — 실행 전 확인", confirmLabel: "정지 실행", pendingLabel: "정지 중…" },
};

/** 확인 모달 마지막 줄 — 결과가 어디에 보이는지 */
export const CONTENT_REPORT_USER_ACTION_RESULT_NOTE = "처리 결과는 이 신고 상세 상단에 표시됩니다.";

/**
 * 신고 상세 `?ok=` — 경고·정지 액션의 redirect 키(`warned:N` · `warned_suspended:N` · 계정 상태값)와 운영 메모 액션의 `note`.
 * 계정 관리 화면(`users/page.tsx`)과 같은 문장. 모르는 값은 null(표시 안 함).
 */
export function contentReportDetailFlashOkMessage(ok: string | null | undefined): string | null {
  const s = String(ok ?? "").trim();
  if (!s) return null;
  if (s === "note") return "운영 메모를 저장했습니다.";
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

// ── 신고당한 사용자 블록 ─────────────────────────────────────────────────────

/** 서버 조회 결과 → 클라이언트 부품이 받는 직렬화 가능 모델 */
export type ContentReportTargetUser = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  roleLabel: string;
  createdAt: string | null;
  /** `users.status` 원시 값 */
  status: string;
  /** suspended_until 을 반영한 현재 상태 */
  effectiveStatus: "active" | "suspended" | "banned";
  suspendedUntil: string | null;
  statusReason: string | null;
  /** `user_warnings` 활성 경고 수 — 못 읽었으면 null */
  activeWarningCount: number | null;
  /** 이 사용자의 글·숏폼·댓글을 대상으로 한 다른 신고 수(이번 신고 제외) — 못 읽었으면 null */
  previousReportCount: number | null;
  /** 멘토일 때 담당 학생 수(`mentor_student_rooms`) — 학생·조회 실패면 null */
  mentorRoomCount: number | null;
};

export { accountRoleLabel as contentReportUserRoleLabel };

export function buildContentReportWarningSummary(user: Pick<ContentReportTargetUser, "name" | "activeWarningCount">): string {
  return buildAccountWarningSummary({ name: user.name, activeWarningCount: user.activeWarningCount });
}

export function buildContentReportSuspendSummary(
  user: Pick<ContentReportTargetUser, "name" | "roleLabel" | "role" | "mentorRoomCount">,
  code: ContentReportSuspendCode,
  untilLabel: string | null
): string {
  return buildAccountSanctionSummary({
    name: user.name,
    roleLabel: user.roleLabel,
    code,
    untilLabel,
    mentorRoomCount: user.mentorRoomCount,
    isMentor: user.role === "mentor",
  });
}

/** 관리자 계정은 두 액션 모두 서버가 거부한다 — 버튼을 두지 않는다 */
export function contentReportUserActionsAvailable(user: ContentReportTargetUser | null): boolean {
  return Boolean(user) && user!.role !== "admin";
}
