/**
 * 관리자 · 탈퇴 요청 현황(PR-13 §1)의 순수 규칙 — `account_deletion_jobs` 파이프라인 감시. **조회 전용.**
 *
 * §1-1 실측(2026-09-03 · 스테이징 DB):
 * - 처리기는 Vercel Cron 이 매시 정각 `GET /api/cron/account-deletion` 을 호출한다(`vercel.json`). pg_cron 에는 탈퇴 job 이 없다.
 *   실삭제(claim → 단계 전이)는 `ACCOUNT_DELETION_WORKER_ENABLED` + `ACCOUNT_DELETION_SCHEDULED_REAL_RUN` 두 env 가 켜져야만 시작된다
 *   (`lib/account/accountDeletionCronRoute.ts`). 꺼져 있으면 disabled/dry-run 으로 응답하며 job 행을 건드리지 않는다.
 * - 2건은 `pending · attempts 0 · lease 없음 · last_error 없음 · updated_at = requested_at` — 한 번도 claim 되지 않았다(claim 은 lease·updated_at 을 쓴다).
 *   그리고 `cancelable_until` 이 요청일 + **30일**(hotfix 20260808 · 사용자 취소 유예)이라, 처리기가 켜져 있어도 `account_deletion_begin_locked` 가
 *   `CANCEL_WINDOW_OPEN` 으로 정상 대기시킨다. 즉 "4일째 pending" 은 정체가 아니라 **취소 유예 구간**이다.
 * - 관리자가 밀어줄 RPC 는 없다(§1-1-B): `account_deletion_advance` 는 from→to 전이 함수(재시도 아님 · pending→locked 는 176 이후 거부)이고,
 *   `next_attempt_at`/lease 를 되돌리는 RPC 가 없다. 새 쓰기 경로를 만들지 않으므로 이 화면은 **조회 전용**이다(재시도·건너뛰기·직접 삭제 버튼 없음).
 *
 * 정체 판정(§1-2 · §1-4): 종료 상태(completed·canceled)는 세지 않는다. `pending` 이면서 취소 유예가 남아 있으면 정체가 아니다(처리기가 손댈 수 없는 구간).
 * 그 외는 "지금 − 마지막 단계 변경 시각"(pending 은 취소 유예 종료 시각 이후부터)이 24h 이상이면 주의 · 72h 이상이면 위험이고, 24h 이상이 대시보드 `탈퇴 멈춤` 이다.
 * `failed` 는 `state NOT IN (completed, canceled)` 규칙 그대로 포함한다 — 자동 재시도 경로가 없어 운영자가 봐야 하는 건이다.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { ACCOUNT_DELETION_ACTIVE_STATES, ACCOUNT_DELETION_TERMINAL_STATES } from "../account/accountDeletionJobStates.ts";
import { accountRoleLabel } from "./accountSanctionPolicy.ts";
import { buildAdminDataTableUrl, type AdminDataTableTab } from "./adminDataTable.ts";
import type { AdminListParams } from "./adminListParams.ts";
import { resolveAdminStatus } from "./adminStatusDictionary.ts";
import { formatDurationKo, timeOf, type ElapsedTone } from "./questionDrilldownConsole.ts";

export const ACCOUNT_DELETION_BASE_PATH = "/admin/deletions";
export const ACCOUNT_DELETION_DEFAULT_PAGE_SIZE = 25;

// ── 탭 ───────────────────────────────────────────────────────────────────────

export const ACCOUNT_DELETION_TAB_VALUES = ["active", "completed", "failed", "canceled"] as const;
export type AccountDeletionTab = (typeof ACCOUNT_DELETION_TAB_VALUES)[number];
export const ACCOUNT_DELETION_DEFAULT_TAB: AccountDeletionTab = "active";

export function accountDeletionStateLabel(state: unknown): string {
  return resolveAdminStatus("account_deletion_jobs", "state", state).label;
}

/** 진행 중(활성 6단계) · 완료 · 실패 · 취소 — 종료 3탭 라벨은 상태 사전 그대로 */
export const ACCOUNT_DELETION_TABS: readonly AdminDataTableTab<AccountDeletionTab>[] = [
  { value: "active", label: "진행 중" },
  { value: "completed", label: accountDeletionStateLabel("completed") },
  { value: "failed", label: accountDeletionStateLabel("failed") },
  { value: "canceled", label: accountDeletionStateLabel("canceled") },
];

export function resolveAccountDeletionTab(raw: string | null | undefined): AccountDeletionTab {
  const v = String(raw ?? "").trim().toLowerCase();
  return (ACCOUNT_DELETION_TAB_VALUES as readonly string[]).includes(v) ? (v as AccountDeletionTab) : ACCOUNT_DELETION_DEFAULT_TAB;
}

/** 탭 → `state in (...)` 서버 필터. 진행 중 = SQL 175 활성 상태 미러(`accountDeletionJobStates.ts`). */
export function accountDeletionTabStates(tab: AccountDeletionTab): readonly string[] {
  if (tab === "active") return ACCOUNT_DELETION_ACTIVE_STATES;
  return [tab];
}

export function buildAccountDeletionListUrl(params: AdminListParams, overrides: Partial<AdminListParams> = {}): string {
  return buildAdminDataTableUrl(ACCOUNT_DELETION_BASE_PATH, params, overrides);
}

export function accountDeletionJobPath(jobId: string): string {
  return `${ACCOUNT_DELETION_BASE_PATH}/${encodeURIComponent(String(jobId ?? "").trim())}`;
}

// ── 행 ───────────────────────────────────────────────────────────────────────

export type AccountDeletionJobRow = {
  id: string;
  userId: string;
  state: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  cancelableUntil: string | null;
  dryRun: boolean;
  requestedAt: string | null;
  lockedAt: string | null;
  purgingAt: string | null;
  storagePurgedAt: string | null;
  finalizedAt: string | null;
  authSoftDeletedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  failedAt: string | null;
  updatedAt: string | null;
  leaseOwner: string | null;
  leasedUntil: string | null;
  forfeitConsentAt: string | null;
  /** 잔액 포기 동의 금액(cents = 원×100) */
  consentedBalanceCents: number;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}

function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

function intOf(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}

export function parseAccountDeletionJobRow(row: Record<string, unknown>): AccountDeletionJobRow | null {
  const id = str(row.id);
  const userId = str(row.user_id);
  const state = str(row.state);
  if (!id || !userId || !state) return null;
  return {
    id,
    userId,
    state,
    attempts: intOf(row.attempts),
    lastError: strOrNull(row.last_error),
    nextAttemptAt: strOrNull(row.next_attempt_at),
    cancelableUntil: strOrNull(row.cancelable_until),
    dryRun: row.dry_run === true,
    requestedAt: strOrNull(row.requested_at),
    lockedAt: strOrNull(row.locked_at),
    purgingAt: strOrNull(row.purging_at),
    storagePurgedAt: strOrNull(row.storage_purged_at),
    finalizedAt: strOrNull(row.finalized_at),
    authSoftDeletedAt: strOrNull(row.auth_soft_deleted_at),
    completedAt: strOrNull(row.completed_at),
    canceledAt: strOrNull(row.canceled_at),
    failedAt: strOrNull(row.failed_at),
    updatedAt: strOrNull(row.updated_at),
    leaseOwner: strOrNull(row.lease_owner),
    leasedUntil: strOrNull(row.leased_until),
    forfeitConsentAt: strOrNull(row.forfeit_consent_at),
    consentedBalanceCents: intOf(row.consented_balance_cents),
  };
}

// ── 9단계 타임라인 ───────────────────────────────────────────────────────────

export type AccountDeletionTimelineStep = { state: string; at: keyof AccountDeletionJobRow };

/** 9단계 = 상태 사전 9값 · 각 단계의 `*_at` 컬럼(pending 은 `requested_at`). 순서는 saga 전이표(151/175) 그대로, 종료 3종은 뒤에. */
export const ACCOUNT_DELETION_TIMELINE_STEPS: readonly AccountDeletionTimelineStep[] = [
  { state: "pending", at: "requestedAt" },
  { state: "locked", at: "lockedAt" },
  { state: "purging", at: "purgingAt" },
  { state: "storage_purged", at: "storagePurgedAt" },
  { state: "finalized", at: "finalizedAt" },
  { state: "auth_soft_deleted", at: "authSoftDeletedAt" },
  { state: "completed", at: "completedAt" },
  { state: "canceled", at: "canceledAt" },
  { state: "failed", at: "failedAt" },
];

/** 현재 단계에 들어간 시각 — 그 단계의 `*_at`, 없으면 `updated_at`, 그것도 없으면 `requested_at`. */
export function accountDeletionStateChangedAt(job: AccountDeletionJobRow): string | null {
  const step = ACCOUNT_DELETION_TIMELINE_STEPS.find((s) => s.state === job.state);
  const at = step ? job[step.at] : null;
  return (typeof at === "string" && at) || job.updatedAt || job.requestedAt;
}

export type AccountDeletionTimelineItem = { state: string; label: string; at: string | null; reached: boolean; current: boolean };

/** 상세의 타임라인 — 9단계 전부 그린다(`*_at` 이 있으면 도달, 현재 상태는 표시). */
export function accountDeletionTimeline(job: AccountDeletionJobRow): AccountDeletionTimelineItem[] {
  return ACCOUNT_DELETION_TIMELINE_STEPS.map((step) => {
    const at = job[step.at];
    const atIso = typeof at === "string" && at ? at : null;
    return { state: step.state, label: accountDeletionStateLabel(step.state), at: atIso, reached: Boolean(atIso) || job.state === step.state, current: job.state === step.state };
  });
}

// ── 정체 판정(24h 주의 · 72h 위험) ───────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000;
export const ACCOUNT_DELETION_STALL_WARNING_HOURS = 24;
export const ACCOUNT_DELETION_STALL_DANGER_HOURS = 72;

export function isAccountDeletionTerminalState(state: string | null | undefined): boolean {
  return (ACCOUNT_DELETION_TERMINAL_STATES as readonly string[]).includes(String(state ?? "").trim());
}

/** 대시보드 `탈퇴 멈춤` 대상 상태 — `state NOT IN (completed, canceled)` = 활성 6 + failed. */
export const ACCOUNT_DELETION_STALL_STATES: readonly string[] = [...ACCOUNT_DELETION_ACTIVE_STATES, "failed"];

export type AccountDeletionStallKind = "terminal" | "cancel_window" | "running";

export type AccountDeletionStall = {
  kind: AccountDeletionStallKind;
  /** 세는 기준 시각(ISO) — running 만 */
  sinceIso: string | null;
  elapsedMs: number | null;
  tone: ElapsedTone;
  /** 24h 이상 같은 단계 — 대시보드 `탈퇴 멈춤` 이 세는 값 */
  stalled: boolean;
};

export function accountDeletionElapsedTone(ms: number | null | undefined): ElapsedTone {
  if (ms == null || !Number.isFinite(ms)) return "neutral";
  if (ms >= ACCOUNT_DELETION_STALL_DANGER_HOURS * HOUR_MS) return "danger";
  if (ms >= ACCOUNT_DELETION_STALL_WARNING_HOURS * HOUR_MS) return "warning";
  return "neutral";
}

/** 사용자가 아직 취소할 수 있는가 — pending 이면서 `cancelable_until` 이 미래. */
export function accountDeletionCancelWindowOpen(job: Pick<AccountDeletionJobRow, "state" | "cancelableUntil">, nowIso: string): boolean {
  if (job.state !== "pending") return false;
  const until = timeOf(job.cancelableUntil);
  const now = timeOf(nowIso);
  if (until == null || now == null) return false;
  return now < until;
}

/**
 * 정체 판정. 종료 상태는 세지 않는다. pending 은 취소 유예가 열려 있으면 정체가 아니고, 닫힌 뒤에는 유예 종료 시각부터 센다
 * (처리기가 `CANCEL_WINDOW_OPEN` 으로 정상 대기하는 구간을 "멈춤" 으로 세지 않기 위해서다). 그 외 단계는 그 단계에 들어간 시각부터.
 */
export function accountDeletionStallState(job: AccountDeletionJobRow, nowIso: string): AccountDeletionStall {
  if (isAccountDeletionTerminalState(job.state) && job.state !== "failed") {
    return { kind: "terminal", sinceIso: null, elapsedMs: null, tone: "neutral", stalled: false };
  }
  if (accountDeletionCancelWindowOpen(job, nowIso)) {
    return { kind: "cancel_window", sinceIso: job.requestedAt, elapsedMs: null, tone: "neutral", stalled: false };
  }
  const changedAt = accountDeletionStateChangedAt(job);
  let since = timeOf(changedAt);
  if (job.state === "pending") {
    const until = timeOf(job.cancelableUntil);
    if (until != null && (since == null || until > since)) since = until;
  }
  const now = timeOf(nowIso);
  if (since == null || now == null) return { kind: "running", sinceIso: changedAt, elapsedMs: null, tone: "neutral", stalled: false };
  const elapsedMs = Math.max(0, now - since);
  return {
    kind: "running",
    sinceIso: new Date(since).toISOString(),
    elapsedMs,
    tone: accountDeletionElapsedTone(elapsedMs),
    stalled: elapsedMs >= ACCOUNT_DELETION_STALL_WARNING_HOURS * HOUR_MS,
  };
}

export function isAccountDeletionStalled(job: AccountDeletionJobRow, nowIso: string): boolean {
  return ACCOUNT_DELETION_STALL_STATES.includes(job.state) && accountDeletionStallState(job, nowIso).stalled;
}

/** 대시보드 `탈퇴 멈춤` 건수 = 이 화면이 경고색으로 그리는 행 수(같은 함수). */
export function countStalledAccountDeletionJobs(jobs: readonly AccountDeletionJobRow[], nowIso: string): number {
  return jobs.filter((job) => isAccountDeletionStalled(job, nowIso)).length;
}

// ── 시간 표기 ────────────────────────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** "08-30 20:54"(KST) — 목록 칸. 없으면 `—`. */
export function formatKstShort(iso: string | null | undefined): string {
  const t = timeOf(iso);
  if (t == null) return "—";
  const d = new Date(t + KST_OFFSET_MS);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 경과 칸 — running `4일 21시간` · 취소 유예 중 `취소 유예 · 09-29 20:54까지` · 종료 `—` */
export function formatAccountDeletionElapsed(stall: AccountDeletionStall, job: Pick<AccountDeletionJobRow, "cancelableUntil">): string {
  if (stall.kind === "terminal") return "—";
  if (stall.kind === "cancel_window") return `취소 유예 · ${formatKstShort(job.cancelableUntil)}까지`;
  return stall.elapsedMs == null ? "—" : formatDurationKo(stall.elapsedMs);
}

/** 사용자 취소 가능 기간이 남았으면 `D-26 · 09-29 20:54`, 아니면 null. */
export function formatAccountDeletionCancelWindow(job: Pick<AccountDeletionJobRow, "state" | "cancelableUntil">, nowIso: string): string | null {
  if (!accountDeletionCancelWindowOpen(job, nowIso)) return null;
  const until = timeOf(job.cancelableUntil)!;
  const now = timeOf(nowIso)!;
  const days = Math.ceil((until - now) / (24 * HOUR_MS));
  return `D-${Math.max(0, days)} · ${formatKstShort(job.cancelableUntil)}`;
}

/** 오류 문구 — 실패·오류 건은 `last_error` 그대로(잘라 보이는 건 화면 몫). 없으면 `—`. */
export function accountDeletionLastErrorLabel(lastError: string | null | undefined): string {
  const s = String(lastError ?? "").trim();
  return s || "—";
}

// ── 요청자 표시(개인정보 삭제 대상) ──────────────────────────────────────────

export type AccountDeletionRequester = {
  id: string;
  role: string | null;
  status: string | null;
  fullName: string | null;
  nickname: string | null;
  email: string | null;
};

export const ACCOUNT_DELETION_REQUESTER_DELETED_LABEL = "(삭제 처리됨)";

/** 익명화 흔적 — SQL 115 `anonymize_user_for_deletion` 이 남기는 값(`탈퇴회원` · `탈퇴회원_xxxxxxxx` · `deleted_…@removed.invalid` · status deleted). */
export function isAnonymizedRequester(user: AccountDeletionRequester | null | undefined): boolean {
  if (!user) return true;
  if (String(user.status ?? "").trim().toLowerCase() === "deleted") return true;
  if (String(user.fullName ?? "").trim() === "탈퇴회원") return true;
  if (String(user.nickname ?? "").trim().startsWith("탈퇴회원_")) return true;
  if (String(user.email ?? "").trim().toLowerCase().endsWith("@removed.invalid")) return true;
  return false;
}

/** `users` 행이 남아 있으면 이름(실명 → 닉네임 → 이메일 → id 앞 8자), 익명화됐거나 행이 없으면 `(삭제 처리됨)`. */
export function accountDeletionRequesterLabel(user: AccountDeletionRequester | null | undefined, fallbackId: string): string {
  if (isAnonymizedRequester(user)) return ACCOUNT_DELETION_REQUESTER_DELETED_LABEL;
  const u = user!;
  const name = String(u.fullName ?? "").trim() || String(u.nickname ?? "").trim() || String(u.email ?? "").trim();
  return name || `${String(fallbackId ?? "").slice(0, 8)}…`;
}

export function accountDeletionRequesterRoleLabel(user: AccountDeletionRequester | null | undefined): string {
  const r = String(user?.role ?? "").trim();
  return r ? accountRoleLabel(r) : "—";
}

// ── 목록 항목 ────────────────────────────────────────────────────────────────

export type AccountDeletionListItem = {
  job: AccountDeletionJobRow;
  requesterLabel: string;
  requesterRoleLabel: string;
  requesterDeleted: boolean;
  stateLabel: string;
  stall: AccountDeletionStall;
  elapsedLabel: string;
  /** 사용자 취소 가능 기간이 남았으면 표시 */
  cancelWindowLabel: string | null;
  lastErrorLabel: string;
};

export function buildAccountDeletionListItem(job: AccountDeletionJobRow, requester: AccountDeletionRequester | null, nowIso: string): AccountDeletionListItem {
  const stall = accountDeletionStallState(job, nowIso);
  return {
    job,
    requesterLabel: accountDeletionRequesterLabel(requester, job.userId),
    requesterRoleLabel: accountDeletionRequesterRoleLabel(requester),
    requesterDeleted: isAnonymizedRequester(requester),
    stateLabel: accountDeletionStateLabel(job.state),
    stall,
    elapsedLabel: formatAccountDeletionElapsed(stall, job),
    cancelWindowLabel: formatAccountDeletionCancelWindow(job, nowIso),
    lastErrorLabel: accountDeletionLastErrorLabel(job.lastError),
  };
}

/** 경과 칸 톤 클래스 — 24h 주의색 · 72h 위험색 */
export function accountDeletionElapsedClass(tone: ElapsedTone): string {
  if (tone === "danger") return "font-extrabold text-red-700";
  if (tone === "warning") return "font-extrabold text-amber-700";
  return "text-slate-600";
}

// ── 조치(§1-1-B) · 문구 ─────────────────────────────────────────────────────

/** 관리자가 밀어줄 경로 — 없다. 기존 RPC 중 재시도(next_attempt_at·lease 초기화)를 하는 것이 없고, 새 쓰기 경로는 만들지 않는다. */
export const ACCOUNT_DELETION_ADMIN_RETRY_AVAILABLE = false as const;

export const ACCOUNT_DELETION_PIPELINE_NOTICE = "탈퇴는 9단계 자동 절차입니다. 24시간 넘게 같은 단계면 처리기를 확인하세요";

export const ACCOUNT_DELETION_WORKER_NOTE =
  "처리기는 Vercel Cron 이 매시 정각 GET /api/cron/account-deletion 으로 실행합니다. 실삭제는 ACCOUNT_DELETION_WORKER_ENABLED 와 ACCOUNT_DELETION_SCHEDULED_REAL_RUN 이 모두 켜져야 시작되며, 꺼져 있으면 job 행을 건드리지 않습니다(attempts·lease 변화 없음).";

export const ACCOUNT_DELETION_CANCEL_WINDOW_NOTE =
  "요청 후 30일은 사용자 취소 유예 기간입니다. 이 기간의 대기(pending)는 처리기가 CANCEL_WINDOW_OPEN 으로 정상 대기하는 것이며 정체로 세지 않습니다.";

export const ACCOUNT_DELETION_RETRY_UNAVAILABLE_NOTE =
  "관리자 재시도 경로가 없어 이 화면은 조회 전용입니다. 재시도는 처리기가 next_attempt_at·lease 규칙으로 자동 수행하고, 단계 건너뛰기·직접 삭제 버튼은 두지 않습니다.";

export const ACCOUNT_DELETION_EMPTY_STATE = {
  title: "진행 중인 탈퇴 요청이 없습니다",
  description: "사용자가 회원 탈퇴를 요청하면 여기에 쌓입니다. 요청 후 30일 취소 유예가 지나면 처리기가 자동으로 단계를 진행합니다.",
} as const;

export function accountDeletionEmptyState(tab: AccountDeletionTab): { title: string; description: string } {
  if (tab === "active") return ACCOUNT_DELETION_EMPTY_STATE;
  const label = ACCOUNT_DELETION_TABS.find((t) => t.value === tab)?.label ?? tab;
  return { title: `'${label}' 상태의 탈퇴 요청이 없습니다`, description: "다른 탭에서 확인할 수 있습니다." };
}

/** 상단 건수 줄 `진행 중 N · 멈춤 S · 전체 M` 의 재료 */
export type AccountDeletionSummary = { active: number; stalled: number | null; all: number };
