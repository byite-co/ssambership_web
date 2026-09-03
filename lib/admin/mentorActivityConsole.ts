/**
 * 관리자 · 멘토 활동 화면(PR-11 §4)의 순수 규칙 — 멘토 목록(상태 탭 · 닉네임 검색 · 미답변 경보 · 이탈 의심 탭) · 정렬 · 조치(기존 3경로) · 빈 상태.
 *
 * - 행 = 승인된 멘토(`mentor_profiles.verification_status = approved`). 담당 학생 = `mentor_student_rooms` 수 · 미답변 = 그 멘토 방들의
 *   `question_threads` 중 `first_answered_at IS NULL` · 최장 미답변 = 그중 가장 오래된 `created_at` 경과(24시간 초과 주의 · 48시간 초과 위험).
 * - **미답변이 오래된 멘토가 위**(`compareMentorActivityItems`) — 계산값 정렬이라 서버 range 페이징 대신 상한(`MENTOR_ACTIVITY_ROW_LIMIT`) 안에서
 *   메모리 정렬 후 페이지를 자른다(멘토 74명).
 * - 활동 상태 사전: 활동 중 · 일시정지(`pause_until` 까지 — 지나면 활동 중) · 종료 예정(`termination_effective_at`) · 종료 — 판정은
 *   `lib/mentor/mentorActivity.mentorActivityState` 그대로, 라벨은 계정 상세 멘토 탭(`MENTOR_ACTIVITY_LABELS`)과 같다.
 * - `이탈 의심` = `abandonment_flagged_at IS NOT NULL` — 별도 탭.
 * - 조치(§0-C 실측): 기존 경로는 `mentorActivityAdminActions` 의 셋뿐이다 — 이탈 정산 보류 확정(stateChange) · 구제/보류 해제(critical — 정산
 *   항목이 지급 대기로 복원되는 자금 조치) · 유예 만료 정리(critical — 환불 생성). **멘토에게 알림 보내기 · 활동 강제 정지 경로는 없다**(만들지 않는다).
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import type { AdminListParams } from "./adminListParams.ts";
import { buildAdminDataTableUrl, type AdminDataTableTab } from "./adminDataTable.ts";
import { MENTOR_ACTIVITY_LABELS, buildAccountDetailUrl, type MentorActivityLabelState } from "./accountDetailConsole.ts";
import { mentorActivityState, type MentorActivityState } from "../mentor/mentorActivity.ts";

export const MENTOR_ACTIVITY_BASE_PATH = "/admin/mentor-activity";
export const MENTOR_ACTIVITY_DEFAULT_PAGE_SIZE = 25;
/** 메모리 정렬 상한 — 이 수를 넘으면 서버 페이징으로 전환해야 한다(지금 74명). */
export const MENTOR_ACTIVITY_ROW_LIMIT = 500;

// ── 탭 — 쿼리 키는 `status` 하나 ─────────────────────────────────────────────

export const MENTOR_ACTIVITY_TAB_VALUES = ["active", "paused", "terminating", "abandoned", "all"] as const;
export type MentorActivityTab = (typeof MENTOR_ACTIVITY_TAB_VALUES)[number];
export const MENTOR_ACTIVITY_DEFAULT_TAB: MentorActivityTab = "all";

export const MENTOR_ACTIVITY_ABANDONED_TAB_LABEL = "이탈 의심";
export const MENTOR_ACTIVITY_ALL_TAB_LABEL = "전체";

/** 활동 상태 라벨은 계정 상세 멘토 탭과 같은 사전(`MENTOR_ACTIVITY_LABELS`) · 이탈 의심·전체만 화면 고유 */
export const MENTOR_ACTIVITY_TABS: readonly AdminDataTableTab<MentorActivityTab>[] = [
  { value: "active", label: MENTOR_ACTIVITY_LABELS.active },
  { value: "paused", label: MENTOR_ACTIVITY_LABELS.paused },
  { value: "terminating", label: MENTOR_ACTIVITY_LABELS.terminating },
  { value: "abandoned", label: MENTOR_ACTIVITY_ABANDONED_TAB_LABEL },
  { value: "all", label: MENTOR_ACTIVITY_ALL_TAB_LABEL },
];

export function resolveMentorActivityTab(raw: string | null | undefined): MentorActivityTab {
  const v = String(raw ?? "").trim();
  return (MENTOR_ACTIVITY_TAB_VALUES as readonly string[]).includes(v) ? (v as MentorActivityTab) : MENTOR_ACTIVITY_DEFAULT_TAB;
}

// ── 활동 상태 ──────────────────────────────────────────────────────────────────

export type MentorActivityRowInput = {
  activityStatus: string | null;
  pauseUntil: string | null;
  terminationEffectiveAt: string | null;
};

/** `mentorActivityState` 그대로 — 복귀 예정일이 지난 일시정지는 활동 중. */
export function mentorActivityRowState(input: MentorActivityRowInput, now: Date): MentorActivityState {
  return mentorActivityState(
    { activity_status: input.activityStatus, pause_until: input.pauseUntil, termination_effective_at: input.terminationEffectiveAt },
    now
  );
}

export function mentorActivityStateLabel(state: MentorActivityState): string {
  return MENTOR_ACTIVITY_LABELS[state as MentorActivityLabelState] ?? state;
}

export type MentorActivityStateTone = "success" | "warning" | "danger" | "neutral";

export function mentorActivityStateTone(state: MentorActivityState): MentorActivityStateTone {
  if (state === "active") return "success";
  if (state === "paused") return "warning";
  if (state === "terminating") return "danger";
  return "neutral";
}

export function mentorActivityMatchesTab(tab: MentorActivityTab, state: MentorActivityState, abandonmentFlaggedAt: string | null): boolean {
  if (tab === "all") return true;
  if (tab === "abandoned") return Boolean(abandonmentFlaggedAt);
  return state === tab;
}

// ── 미답변 경과 ────────────────────────────────────────────────────────────────

export const MENTOR_UNANSWERED_WARNING_HOURS = 24;
export const MENTOR_UNANSWERED_DANGER_HOURS = 48;

export type MentorUnansweredTone = "ok" | "warning" | "danger" | "none";
export type MentorUnansweredElapsed = { hours: number | null; label: string; tone: MentorUnansweredTone };

/** 가장 오래된 미답변 질문의 경과 — 없으면 `—`. 24시간을 넘으면 주의 · 48시간을 넘으면 위험(정각은 아직 아님). */
export function mentorUnansweredElapsed(oldestCreatedAt: string | null | undefined, now: number = Date.now()): MentorUnansweredElapsed {
  const t = oldestCreatedAt ? new Date(oldestCreatedAt).getTime() : NaN;
  if (!Number.isFinite(t)) return { hours: null, label: "—", tone: "none" };
  const elapsedMs = Math.max(0, now - t);
  const hours = Math.floor(elapsedMs / 3_600_000);
  const tone: MentorUnansweredTone =
    elapsedMs > MENTOR_UNANSWERED_DANGER_HOURS * 3_600_000 ? "danger" : elapsedMs > MENTOR_UNANSWERED_WARNING_HOURS * 3_600_000 ? "warning" : "ok";
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

export function mentorUnansweredToneClass(tone: MentorUnansweredTone): string {
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

// ── 목록 행 · 정렬 ─────────────────────────────────────────────────────────────

export type MentorPendingEvent = { id: string; eventType: string; reason: string | null; createdAt: string | null };

export type MentorActivityLastSource = "answer" | "profile";
export const MENTOR_ACTIVITY_LAST_SOURCE_LABELS: Readonly<Record<MentorActivityLastSource, string>> = {
  answer: "마지막 답변(question_threads.first_answered_at) 기준",
  profile: "프로필 행 갱신(updated_at) 기준",
};

export type MentorActivityListItem = {
  mentorId: string;
  name: string;
  email: string | null;
  studentCount: number;
  unansweredCount: number;
  oldestUnansweredAt: string | null;
  elapsed: MentorUnansweredElapsed;
  state: MentorActivityState;
  activityStatusRaw: string | null;
  pauseUntil: string | null;
  terminationEffectiveAt: string | null;
  abandonmentFlaggedAt: string | null;
  lastActivityAt: string | null;
  lastActivitySource: MentorActivityLastSource | null;
  /** 검토 대기(pending_review) 이벤트 — 조치 버튼의 대상 */
  pendingEvents: MentorPendingEvent[];
};

function timeOf(iso: string | null | undefined): number {
  if (!iso) return NaN;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * 미답변이 오래된 멘토가 위: ① 가장 오래된 미답변이 있는 멘토가 먼저, 그 안에서 더 오래된 순 ② 미답변 건수 많은 순 ③ 이탈 의심 먼저 ④ 이름.
 */
export function compareMentorActivityItems(a: MentorActivityListItem, b: MentorActivityListItem): number {
  const ta = timeOf(a.oldestUnansweredAt);
  const tb = timeOf(b.oldestUnansweredAt);
  const hasA = Number.isFinite(ta);
  const hasB = Number.isFinite(tb);
  if (hasA && hasB && ta !== tb) return ta - tb;
  if (hasA !== hasB) return hasA ? -1 : 1;
  if (a.unansweredCount !== b.unansweredCount) return b.unansweredCount - a.unansweredCount;
  const fa = Boolean(a.abandonmentFlaggedAt);
  const fb = Boolean(b.abandonmentFlaggedAt);
  if (fa !== fb) return fa ? -1 : 1;
  return a.name.localeCompare(b.name, "ko");
}

/** 상태 옆 한 줄 — 복귀 예정 · 종료 예정 · 종료. 활동 중은 빈 문자열. */
export function mentorActivityStateDetail(item: Pick<MentorActivityListItem, "state" | "pauseUntil" | "terminationEffectiveAt">, formatDate: (iso: string | null) => string): string {
  if (item.state === "paused") return `복귀 예정 ${formatDate(item.pauseUntil)}`;
  if (item.state === "terminating") return `종료 예정 ${formatDate(item.terminationEffectiveAt)}`;
  if (item.state === "terminated") return "활동 종료";
  return "";
}

/** 최근 활동 = 마지막 답변 시각이 있으면 그것, 없으면 프로필 갱신 시각. */
export function resolveMentorLastActivity(lastAnswerAt: string | null, profileUpdatedAt: string | null): { at: string | null; source: MentorActivityLastSource | null } {
  if (lastAnswerAt && Number.isFinite(timeOf(lastAnswerAt))) return { at: lastAnswerAt, source: "answer" };
  if (profileUpdatedAt && Number.isFinite(timeOf(profileUpdatedAt))) return { at: profileUpdatedAt, source: "profile" };
  return { at: null, source: null };
}

// ── 조치 — 기존 서버 액션 3종만(§0-C) ──────────────────────────────────────────

export const MENTOR_ACTIVITY_EVENT_ID_FIELD = "eventId";
export const MENTOR_ACTIVITY_MENTOR_ID_FIELD = "mentorId";
export const MENTOR_ACTIVITY_REASON_FIELD = "reason";

export const MENTOR_ABANDONMENT_EVENT_TYPE = "abandonment_suspected";

export type MentorActivityActionKey = "hold_approve" | "hold_release" | "termination_finalize";
export type MentorActivityActionLevel = "stateChange" | "critical";

export const MENTOR_ACTIVITY_ACTIONS: Readonly<
  Record<MentorActivityActionKey, { level: MentorActivityActionLevel; label: string; dialogTitle: string; confirmLabel: string; pendingLabel: string }>
> = {
  hold_approve: { level: "stateChange", label: "보류 확정", dialogTitle: "정산 보류 확정", confirmLabel: "보류 확정", pendingLabel: "처리 중…" },
  hold_release: { level: "critical", label: "구제(보류 해제)", dialogTitle: "정산 보류 해제 — 자금 복원", confirmLabel: "보류 해제", pendingLabel: "해제 중…" },
  termination_finalize: {
    level: "critical",
    label: "유예 만료 정리(환불 생성)",
    dialogTitle: "활동 종료 정리 — 환불 생성",
    confirmLabel: "정리 실행",
    pendingLabel: "정리 중…",
  },
};

export function buildMentorHoldApproveSummary(name: string): string {
  return `${name} 멘토의 정산 보류를 확정합니다. 보류된 정산 항목은 지급되지 않으며, 나중에 구제(보류 해제)로 되돌릴 수 있습니다.`;
}

export function buildMentorHoldReleaseSummary(name: string): string {
  return `${name} 멘토의 정산 보류를 해제합니다. 보류 중이던 정산 항목이 지급 대기로 복원되어 다음 정산에 지급됩니다.`;
}

export function buildMentorTerminationFinalizeSummary(name: string): string {
  return `${name} 멘토의 활동 종료를 정리합니다. 활성 구독의 잔여 기간이 학생별 환불로 생성됩니다.`;
}

export type MentorActivityAvailableAction = { key: MentorActivityActionKey; eventId: string | null };

/**
 * 행에서 가능한 조치 — 검토 대기 중인 이탈 의심 이벤트가 있으면 보류 확정·구제, 종료 예정 멘토의 유예가 끝났으면 정리.
 * (서비스 함수 `finalizeMentorTermination` 이 유예 만료 전에는 거절하므로 버튼도 그때만 보인다.)
 */
export function mentorActivityAvailableActions(item: Pick<MentorActivityListItem, "state" | "terminationEffectiveAt" | "pendingEvents">, now: number = Date.now()): MentorActivityAvailableAction[] {
  const out: MentorActivityAvailableAction[] = [];
  for (const ev of item.pendingEvents) {
    if (ev.eventType !== MENTOR_ABANDONMENT_EVENT_TYPE) continue;
    out.push({ key: "hold_approve", eventId: ev.id }, { key: "hold_release", eventId: ev.id });
  }
  if (item.state === "terminating") {
    const t = timeOf(item.terminationEffectiveAt);
    if (Number.isFinite(t) && t <= now) out.push({ key: "termination_finalize", eventId: null });
  }
  return out;
}

export const MENTOR_ACTIVITY_MISSING_ACTIONS_NOTE =
  "알림 보내기 · 활동 강제 정지는 기존 서버 경로가 없어 이 화면에 없습니다. 계정 정지는 계정 상세에서 합니다(활동 정지와 다른 조치).";

// ── 링크 · 빈 상태 ─────────────────────────────────────────────────────────────

export function buildMentorActivityListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(MENTOR_ACTIVITY_BASE_PATH, params, overrides);
}

/** 멘토 이름 → 계정 상세(멘토 탭) */
export function mentorActivityAccountUrl(mentorId: string): string {
  return buildAccountDetailUrl(mentorId, { tab: "mentor" });
}

export const MENTOR_ACTIVITY_EMPTY_STATES: Readonly<Record<MentorActivityTab, { title: string; description: string }>> = {
  all: { title: "등록된 멘토가 없습니다", description: "승인된 멘토가 생기면 여기에 보입니다." },
  active: { title: "활동 중인 멘토가 없습니다", description: "일시정지·종료 예정 탭을 확인해 주세요." },
  paused: { title: "일시정지 중인 멘토가 없습니다", description: "복귀 예정일이 지난 멘토는 활동 중으로 돌아갑니다." },
  terminating: { title: "종료 예정인 멘토가 없습니다", description: "활동 종료를 신청한 멘토가 2주 유예 동안 여기에 보입니다." },
  abandoned: { title: "이탈 의심 멘토가 없습니다", description: "무단 이탈 플래그(abandonment_flagged_at)가 기록된 멘토가 없습니다." },
};

export function mentorActivityEmptyState(tab: MentorActivityTab, search: string): { title: string; description: string } {
  if (search.trim()) return { title: "조건에 맞는 멘토가 없습니다", description: `'${search.trim()}' 검색 결과가 없습니다. 검색어를 바꾸거나 초기화해 주세요.` };
  return MENTOR_ACTIVITY_EMPTY_STATES[tab];
}
