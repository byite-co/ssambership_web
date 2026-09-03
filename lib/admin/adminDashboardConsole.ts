/**
 * 관리자 대시보드(PR-12 §1)의 순수 규칙 — "오늘 할 일" 8칸 · 현황 · 최근 활동.
 *
 * - **건수 로직을 새로 쓰지 않는다.** 8칸의 숫자는 각 화면이 이미 쓰는 조회 모듈의 건수 함수 결과를 그대로 받는다
 *   (`AdminTodoCountsInput` 의 필드가 그 함수의 반환 형태다). 이 모듈은 그 숫자를 칸(라벨·목적지·톤)에 붙이기만 한다.
 *   대시보드 숫자와 그 화면 탭 숫자가 같아야 하므로 계약 테스트가 입력 → 칸 매핑을 고정한다.
 * - 0 은 정상 상태다. 0 이면 숫자만 회색(`quiet`), 1 이상이면 굵게 + 주의색 테두리(`attention`). `없음` 이라고 쓰지 않는다.
 * - 목적지는 그 화면의 실제 키다 — 멘토 활동의 탭 키는 `status`(지시서 표기 `tab=abandoned` 는 그 화면이 읽지 않는다).
 * - 현황(멘토·학생·활성 구독·이번 주 신규 가입·계좌 미등록 멘토)은 화면 탭이 없는 값이라 조회 모듈이 head count 로 센다(조회 실패 = `—`).
 * - 최근 활동은 감사 로그 화면(PR-10)의 조회·사전을 그대로 쓰고 `question_body_viewed` 제외가 **기본 켜짐**이다.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { AUDIT_LOG_EMPTY_STATE, type AuditLogFilters } from "./auditLogConsole.ts";
import { kstDayString } from "../utils/kstTime.ts";

export const ADMIN_DASHBOARD_PATH = "/admin/dashboard";
/** `?showViews=1` 이면 열람 기록(`question_body_viewed`)을 포함한다 — 기본은 제외. */
export const ADMIN_DASHBOARD_SHOW_VIEWS_PARAM = "showViews";
export const ADMIN_DASHBOARD_ACTIVITY_LIMIT = 10;

export const ADMIN_DASHBOARD_TITLES = {
  todo: "오늘 할 일",
  status: "현황",
  activity: "최근 활동",
} as const;

export const ADMIN_DASHBOARD_HIDE_VIEWS_LABEL = "열람 기록 제외";

// ── 오늘 할 일 9칸(PR-12 8칸 + PR-13 탈퇴 멈춤) ──────────────────────────────

export const ADMIN_TODO_KEYS = [
  "mentor_approval",
  "school_tier_unconfirmed",
  "unanswered_questions",
  "content_reports",
  "refunds",
  "disputes",
  "topups",
  "abandonment",
  "deletion_stalled",
] as const;
export type AdminTodoKey = (typeof ADMIN_TODO_KEYS)[number];

/**
 * 9칸이 받는 입력 — 각 화면 조회 모듈의 건수 함수 반환 형태 그대로.
 * 필드 주석의 함수가 정본이며, 조회 모듈(`adminDashboardQueries.ts`)은 그 함수를 호출해 이 형태로 넘긴다.
 */
export type AdminTodoCountsInput = {
  /** `countMentorApprovalTabs(supabase)` — 멘토 승인 대기 탭 */
  mentorApproval: { pending: number };
  /** `mentor_school_verifications` `status = pending AND reviewed_by IS NULL` head count (화면 탭 없음 — 지시서 §1-2 표) */
  schoolTierUnconfirmed: number;
  /** `loadMentorActivityList({ tab: "all" })` — 행의 `unansweredCount` 합 · `counts.abandoned` */
  mentorActivity: { unansweredTotal: number; counts: { abandoned: number } };
  /** `countContentReportTabs(supabase)` — 검수 대기 탭 */
  contentReport: { pending: number };
  /** `countRefundTabs(supabase)` — 환불 대기 탭 */
  refund: { pending: number };
  /** `countDisputeTabs(supabase)` — 접수 + 검토 중 탭 */
  dispute: { open: number; under_review: number };
  /** `countTopupTabs()` — 충전 대기 탭(status = pending · 만료 탭은 별도) */
  topup: { pending: number };
  /** `countAccountDeletionStalled(nowIso)` — 탈퇴 요청 화면의 `멈춤`(state NOT IN (completed, canceled) · 24h 이상 같은 단계 · 취소 유예 중 pending 제외) — PR-13 §1-4 */
  accountDeletion: { stalled: number };
};

export type AdminTodoTone = "quiet" | "attention";

export type AdminTodoDefinition = {
  key: AdminTodoKey;
  label: string;
  href: string;
  /** 재사용한 건수 함수 — 툴팁·PR 설명용 */
  source: string;
};

export const ADMIN_TODO_DEFINITIONS: readonly AdminTodoDefinition[] = [
  { key: "mentor_approval", label: "승인 대기", href: "/admin/mentor-approval?status=pending", source: "countMentorApprovalTabs().pending" },
  { key: "school_tier_unconfirmed", label: "미확정 등급", href: "/admin/mentor-approval", source: "mentor_school_verifications pending · reviewed_by NULL" },
  { key: "unanswered_questions", label: "미답변 질문", href: "/admin/mentor-activity", source: "loadMentorActivityList(all) unansweredCount 합" },
  { key: "content_reports", label: "미처리 신고", href: "/admin/moderation?status=pending", source: "countContentReportTabs().pending" },
  { key: "refunds", label: "환불 요청", href: "/admin/refunds?status=pending", source: "countRefundTabs().pending" },
  { key: "disputes", label: "분쟁", href: "/admin/disputes", source: "countDisputeTabs().open + under_review" },
  { key: "topups", label: "충전 대기", href: "/admin/topups?status=pending", source: "countTopupTabs().pending" },
  { key: "abandonment", label: "이탈 의심", href: "/admin/mentor-activity?status=abandoned", source: "loadMentorActivityList(all) counts.abandoned" },
  // PR-13 §1-4 — 탈퇴 요청 화면(진행 중 탭)과 같은 판정 함수
  { key: "deletion_stalled", label: "탈퇴 멈춤", href: "/admin/deletions", source: "countAccountDeletionStalled() — 24h 이상 같은 단계(취소 유예 제외)" },
];

export type AdminTodoCard = AdminTodoDefinition & { count: number; tone: AdminTodoTone };

export function adminTodoTone(count: number): AdminTodoTone {
  return count > 0 ? "attention" : "quiet";
}

function nonNegative(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** 입력 → 9칸(PR-12 8칸 + PR-13 탈퇴 멈춤). 순서는 `ADMIN_TODO_DEFINITIONS`(4열 그리드) 그대로. */
export function adminTodoCount(key: AdminTodoKey, input: AdminTodoCountsInput): number {
  switch (key) {
    case "mentor_approval":
      return nonNegative(input.mentorApproval.pending);
    case "school_tier_unconfirmed":
      return nonNegative(input.schoolTierUnconfirmed);
    case "unanswered_questions":
      return nonNegative(input.mentorActivity.unansweredTotal);
    case "content_reports":
      return nonNegative(input.contentReport.pending);
    case "refunds":
      return nonNegative(input.refund.pending);
    case "disputes":
      return nonNegative(input.dispute.open) + nonNegative(input.dispute.under_review);
    case "topups":
      return nonNegative(input.topup.pending);
    case "abandonment":
      return nonNegative(input.mentorActivity.counts.abandoned);
    case "deletion_stalled":
      return nonNegative(input.accountDeletion.stalled);
  }
}

export function buildAdminTodoCards(input: AdminTodoCountsInput): AdminTodoCard[] {
  return ADMIN_TODO_DEFINITIONS.map((def) => {
    const count = adminTodoCount(def.key, input);
    return { ...def, count, tone: adminTodoTone(count) };
  });
}

/** 카드 테두리 — 0 은 중립, 1 이상은 주의색 */
export function adminTodoCardClass(tone: AdminTodoTone): string {
  return tone === "attention" ? "border-amber-300 bg-amber-50/40 hover:border-amber-400" : "border-slate-200 bg-white hover:border-blue-500/30";
}

/** 숫자 — 0 은 회색 보통 굵기, 1 이상은 굵게 */
export function adminTodoCountClass(tone: AdminTodoTone): string {
  return tone === "attention" ? "font-black text-slate-900" : "font-semibold text-slate-400";
}

// ── 현황 ─────────────────────────────────────────────────────────────────────

export type AdminStatusInput = {
  /** `countAccountRoleTabs().mentor` */
  mentorCount: number | null;
  /** `countAccountRoleTabs().student` */
  studentCount: number | null;
  /** `subscriptions.status = active` head count */
  activeSubscriptionCount: number | null;
  /** `users.created_at >= 이번 주 월요일 00:00 KST` head count */
  weeklySignupCount: number | null;
  /** 승인 멘토 중 정산 계좌 미등록(`payout_account_number` 비어 있음) */
  mentorsWithoutPayoutAccount: number | null;
};

export const ADMIN_STATUS_KEYS = ["mentors", "students", "active_subscriptions", "weekly_signups", "payout_missing"] as const;
export type AdminStatusKey = (typeof ADMIN_STATUS_KEYS)[number];

export type AdminStatusItem = { key: AdminStatusKey; label: string; value: string; href: string | null; tone: "neutral" | "attention" };

/** 계좌 미등록 멘토는 계정 목록(멘토 탭)으로 — 첫 정산 때 이월될 인원을 미리 보여야 한다(지시서 §1-2). */
export const ADMIN_STATUS_LINKS: Readonly<Record<AdminStatusKey, string | null>> = {
  mentors: "/admin/users?role=mentor",
  students: "/admin/users?role=student",
  active_subscriptions: null,
  weekly_signups: "/admin/users",
  payout_missing: "/admin/users?role=mentor",
};

export const ADMIN_STATUS_LABELS: Readonly<Record<AdminStatusKey, string>> = {
  mentors: "멘토",
  students: "학생",
  active_subscriptions: "활성 구독",
  weekly_signups: "이번 주 신규 가입",
  payout_missing: "계좌 미등록 멘토",
};

/** 조회 실패(null)는 0 으로 위장하지 않고 `—` */
export function formatAdminStatusCount(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return Math.max(0, Math.trunc(n)).toLocaleString("ko-KR");
}

export function buildAdminStatusItems(input: AdminStatusInput): AdminStatusItem[] {
  const values: Record<AdminStatusKey, number | null> = {
    mentors: input.mentorCount,
    students: input.studentCount,
    active_subscriptions: input.activeSubscriptionCount,
    weekly_signups: input.weeklySignupCount,
    payout_missing: input.mentorsWithoutPayoutAccount,
  };
  return ADMIN_STATUS_KEYS.map((key) => ({
    key,
    label: ADMIN_STATUS_LABELS[key],
    value: formatAdminStatusCount(values[key]),
    href: ADMIN_STATUS_LINKS[key],
    tone: key === "payout_missing" && (values[key] ?? 0) > 0 ? "attention" : "neutral",
  }));
}

/** 이번 주 시작 — KST 월요일 00:00 의 instant(ISO). 일요일은 지난 월요일. */
export function kstWeekStartIso(now: Date): string {
  const day = kstDayString(now);
  const kstMidnightUtcMs = Date.parse(`${day}T00:00:00+09:00`);
  // KST 달력 요일: `day` 를 UTC 로 해석한 요일과 같다(날짜 문자열만 쓰므로 오프셋 무관).
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = 일
  const daysSinceMonday = (weekday + 6) % 7;
  return new Date(kstMidnightUtcMs - daysSinceMonday * 86_400_000).toISOString();
}

/**
 * 정산 계좌 등록 판정 — 정산 실행 RPC 와 같은 규칙: `coalesce(nullif(trim(payout_account_number), ''), '') <> ''`(은행명은 보지 않는다).
 * `settlementConsoleQueries.loadMentorInfos` 의 판정과 같다 — 대시보드 "계좌 미등록 멘토" 가 정산 미리보기의 미등록 묶음과 어긋나지 않게.
 */
export function payoutAccountRegisteredForSettlement(accountNumber: unknown): boolean {
  return typeof accountNumber === "string" && accountNumber.trim().length > 0;
}

// ── 최근 활동 ─────────────────────────────────────────────────────────────────

export function resolveAdminDashboardShowViews(raw: string | string[] | null | undefined): boolean {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return String(v ?? "").trim() === "1";
}

/** 감사 로그 조회에 넘길 필터 — 실행자·계열·기간 없음, 열람 제외는 기본 켜짐(`showViews` 가 아니면 hideViews). */
export function adminDashboardActivityFilters(showViews: boolean): AuditLogFilters {
  return { actor: null, group: null, period: "all", hideViews: !showViews };
}

export function buildAdminDashboardUrl(showViews: boolean): string {
  return showViews ? `${ADMIN_DASHBOARD_PATH}?${ADMIN_DASHBOARD_SHOW_VIEWS_PARAM}=1` : ADMIN_DASHBOARD_PATH;
}

export const ADMIN_DASHBOARD_ACTIVITY_EMPTY = AUDIT_LOG_EMPTY_STATE.none;
export const ADMIN_DASHBOARD_ACTIVITY_MORE_HREF = "/admin/audit-logs";
