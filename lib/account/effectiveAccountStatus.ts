// P2-22 effective account status — 순수 결정 함수(시각 주입, node:test 검증 가능).
//
// 요구:
//   * suspended_until 기반 effective status(만료된 정지는 active).
//   * role 조회 실패(시스템 오류)를 active 와 분리 — 실패를 active 로 폴백하지 않는다(접근 오부여 방지).
//   * retry 가능한 오류 상태 구분(transient).
//   * account_deletion locked/purging(이상) 계정은 별도 UI 상태(deletion_in_progress),
//     완료/auth_soft_deleted 는 deleted.
//   * canLogin: 세션 보유·재로그인 가부 계약.

export type RawAccountStatusInput = {
  /** users.status 원값(active/suspended/banned/deleted 등). */
  status?: string | null;
  /** users.suspended_until ISO. 미래면 정지 유효. */
  suspendedUntil?: string | null;
  /** account_deletion_jobs.state (없으면 null). */
  deletionState?: string | null;
  /** role 조회 성공 여부. false = 시스템 오류(active 로 폴백 금지). */
  roleResolved: boolean;
  /** 판정 기준 시각 ISO(주입). */
  nowIso: string;
};

export type EffectiveAccountStatusKind =
  | "active"
  | "suspended"
  | "banned"
  | "deleted"
  | "deletion_in_progress"
  | "error";

export type EffectiveAccountStatus = {
  effective: EffectiveAccountStatusKind;
  /** transient 시스템 오류 → 재시도 가능. */
  retryable: boolean;
  /** 세션 보유/재로그인 허용 여부. */
  canLogin: boolean;
  reason: string;
};

const DELETION_IN_PROGRESS = new Set([
  "locked",
  "purging",
  "storage_purged",
  "finalized",
]);
const DELETION_DONE = new Set(["auth_soft_deleted", "completed"]);

export function resolveEffectiveAccountStatus(input: RawAccountStatusInput): EffectiveAccountStatus {
  const status = (input.status ?? "").trim().toLowerCase();
  const del = (input.deletionState ?? "").trim().toLowerCase();

  // 1) 삭제 saga 우선(가장 강한 종료 상태).
  if (DELETION_DONE.has(del) || status === "deleted") {
    return { effective: "deleted", retryable: false, canLogin: false, reason: "account_deleted" };
  }
  if (DELETION_IN_PROGRESS.has(del)) {
    return {
      effective: "deletion_in_progress",
      retryable: false,
      canLogin: false,
      reason: "account_deletion_in_progress",
    };
  }

  // 2) 밴은 상태 해석 없이 즉시 거부.
  if (status === "banned") {
    return { effective: "banned", retryable: false, canLogin: false, reason: "account_banned" };
  }

  // 3) role 조회 실패는 active 로 폴백하지 않는다 — transient 오류로 격리(재시도 가능).
  if (!input.roleResolved) {
    return { effective: "error", retryable: true, canLogin: false, reason: "role_unresolved" };
  }

  // 4) 정지: suspended_until 미래면 유효, 과거/없음이면 만료 → active.
  if (status === "suspended") {
    const until = input.suspendedUntil ? Date.parse(input.suspendedUntil) : NaN;
    const now = Date.parse(input.nowIso);
    const stillSuspended = Number.isNaN(until) ? true : until > now;
    if (stillSuspended) {
      return { effective: "suspended", retryable: false, canLogin: false, reason: "account_suspended" };
    }
    // 만료된 정지 → active(자동 해제).
    return { effective: "active", retryable: false, canLogin: true, reason: "suspension_expired" };
  }

  // 5) 기본 active.
  return { effective: "active", retryable: false, canLogin: true, reason: "active" };
}
