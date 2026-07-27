// 계정 삭제 job 상태 상수 — 순수 모듈(서버·클라·계약 테스트 공용, 부수효과 0).
//
// 정본은 SQL 175 `account_deletion_active_states()` 이며 이 파일은 그 미러다.
// 활성 = 아직 진행 중이라 사용자당 1행만 존재해야 하는 상태(부분 UNIQUE `uq_adj_active_user` 대상).
// 종료(completed·canceled·failed)는 이력으로 여러 행 남을 수 있다.

export const ACCOUNT_DELETION_ACTIVE_STATES = [
  "pending",
  "locked",
  "purging",
  "storage_purged",
  "finalized",
  "auth_soft_deleted",
] as const;

export type AccountDeletionActiveState = (typeof ACCOUNT_DELETION_ACTIVE_STATES)[number];

export const ACCOUNT_DELETION_TERMINAL_STATES = ["completed", "canceled", "failed"] as const;

/** 151/154 write gate 가 차단하는 상태 — pending 은 취소 가능 구간이라 차단 대상이 아니다. */
export const ACCOUNT_DELETION_WRITE_BLOCKED_STATES = [
  "locked",
  "purging",
  "storage_purged",
  "finalized",
  "auth_soft_deleted",
] as const;

export function isAccountDeletionActiveState(state: string | null | undefined): boolean {
  return (ACCOUNT_DELETION_ACTIVE_STATES as readonly string[]).includes(state ?? "");
}

/** 취소 가능 여부 — pending 이면서 취소 창이 남아 있을 때만. */
export function canCancelAccountDeletion(
  state: string | null | undefined,
  cancelableUntil: string | null | undefined,
  now: Date
): boolean {
  if (state !== "pending") return false;
  if (!cancelableUntil) return true;
  const until = new Date(cancelableUntil);
  if (Number.isNaN(until.getTime())) return false;
  return now.getTime() <= until.getTime();
}
