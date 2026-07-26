// 회원탈퇴 saga worker 오케스트레이터 — 어댑터 주입(테스트/실제 분리), dry-run 기본.
// ⚠️ 실제 사용자·객체 삭제는 기능 플래그 ON + dryRun=false + 실제 어댑터 배선 시에만.
// 상태 전이는 151/175 RPC 로만 — Storage 성공(빈 상태 재검증) 전 finalized 금지.
//
// W5 보정:
//   §3-1 dry-run 은 **read-only planner** 다. claim·advance·revoke·remove 0회.
//        구 구현은 dryRun 가드가 purging 단계에서야 처음 등장해, dry-run 이
//        취소 창을 닫고(pending→locked) 세션까지 폐기했다.
//   §3-2 pending→locked 는 raw advance 가 아니라 **동의·잔액 검증과 한 트랜잭션인**
//        beginLocked(176 account_deletion_begin_locked)로만 간다(TOCTOU 0).
//   §3-4 수집 경로가 없는 버킷이 남아 있으면 real-run 시작 0 · storage_purged 전이 0.

import {
  buildDeletionPlan,
  emptyStateSatisfied,
  purgeResidue,
  storageObjectKey,
  type StorageObjectRef,
  type StoragePurgePlan,
} from "./accountDeletionPurgePlan.ts";

export type DeletionJob = { userId: string; state: string; dryRun: boolean };

/**
 * GoTrue 세션 폐기 어댑터 — locked 진입 직후 전 세션 revoke. 실제 호출 transport 는 interface 분리.
 * 기본은 dry-run(mock). production adapter 는 명시적 설정이 있을 때만 주입한다.
 * 취소해도 기존 세션은 복원하지 않는다(재로그인 요구) — 그 계약은 앱/미들웨어가 강제.
 */
export type SessionRevokeAdapter = (userId: string) => Promise<{ ok: boolean; error?: string }>;
export const dryRunSessionRevoke: SessionRevokeAdapter = async () => ({ ok: true });

export type BeginLockedResult = { ok: boolean; code?: string };

export type DeletionDeps = {
  /**
   * 176 account_deletion_begin_locked — 동의·잔액·취소창 검증과 `pending→locked` 전이를
   * **단일 DB 트랜잭션**으로 수행한다. 워커가 잔액을 따로 SELECT 한 뒤 advance 하는
   * 구현은 금지다(그 사이 충전이 끼어드는 TOCTOU 창이 생긴다 — §3-5-A(d)).
   */
  beginLocked: (userId: string) => Promise<BeginLockedResult>;
  /** 175 account_deletion_advance(from→to) 래퍼. 전이 성공 여부. pending→locked 는 거부된다. */
  advance: (userId: string, from: string, to: string) => Promise<boolean>;
  /** 오류 기록 + backoff(175 account_deletion_record_error). */
  recordError: (userId: string, err: string) => Promise<void>;
  /** GoTrue 전 세션 revoke(dry-run 기본). locked 직후 호출, 성공 전 다음 단계 금지. */
  revokeSessions: SessionRevokeAdapter;
  /** DB 에 기록된 유저 Storage refs(소유자 조인 기반). */
  gatherDbRefs: (userId: string) => Promise<StorageObjectRef[]>;
  /** 버킷 인벤토리(유저 prefix, 페이지네이션 완료본). */
  listInventory: (userId: string) => Promise<StorageObjectRef[]>;
  /** 수집 경로가 없어 계획에 담을 수 없는 버킷. 비어 있지 않으면 real-run 금지(§3-4). */
  uncoveredBuckets: () => Promise<readonly string[]>;
  /** 실제 삭제 — 삭제된 객체 key 목록 반환. */
  removeObjects: (refs: StorageObjectRef[]) => Promise<string[]>;
  /** 지갑 forfeit 원장+0원 + 익명화(원자 경계 RPC). */
  forfeitWalletAndAnonymize: (userId: string) => Promise<void>;
  /** auth soft-delete(실패 시 예외 → 재시도). */
  authSoftDelete: (userId: string) => Promise<void>;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
};

export type DeletionRunResult = {
  ok: boolean;
  userId: string;
  finalState: string;
  dryRun: boolean;
  plan?: StorageObjectRef[];
  uncoveredBuckets?: string[];
  stopped?: string;
};

function log(deps: DeletionDeps, msg: string, meta?: Record<string, unknown>) {
  deps.log?.(msg, meta);
}

/**
 * 삭제 계획 산출 — **read-only**. 상태를 읽고 계획만 만든다.
 * dry-run 경로와 real-run 경로가 이 함수 하나를 공유한다(§3-1 계약 6):
 * 계획과 실제 삭제 대상이 갈라지면 dry-run 이 아무것도 증명하지 못한다.
 */
export async function planAccountDeletion(
  userId: string,
  deps: DeletionDeps
): Promise<StoragePurgePlan> {
  const [dbRefs, inventory, uncoveredBuckets] = await Promise.all([
    deps.gatherDbRefs(userId),
    deps.listInventory(userId),
    deps.uncoveredBuckets(),
  ]);
  return buildDeletionPlan({ dbRefs, inventory, uncoveredBuckets });
}

/**
 * dry-run 전용 진입점 — job 을 claim 하지 않고, 어떤 상태 전이도 일으키지 않으며,
 * 세션도 폐기하지 않는다. pending·locked·purging 어느 상태에서 불러도 부수효과 0(§3-1 계약 7).
 */
export async function planAccountDeletionJob(
  job: DeletionJob,
  deps: DeletionDeps
): Promise<DeletionRunResult> {
  const plan = await planAccountDeletion(job.userId, deps);
  log(deps, "purge_plan", {
    count: plan.refs.length,
    uncovered: plan.uncoveredBuckets.length,
    dryRun: true,
  });
  return {
    ok: true,
    userId: job.userId,
    finalState: job.state,
    dryRun: true,
    plan: plan.refs,
    uncoveredBuckets: plan.uncoveredBuckets,
    stopped: "dry_run",
  };
}

/**
 * 단일 job 을 현재 state 에서 가능한 만큼 진행한다(resumable).
 * dryRun 이면 **파괴 단계는 물론 상태 전이·세션 폐기까지 하지 않고** 계획만 돌려준다.
 */
export async function runAccountDeletionJob(job: DeletionJob, deps: DeletionDeps): Promise<DeletionRunResult> {
  const { userId } = job;
  let state = job.state;
  const dryRun = job.dryRun;

  // ── §3-1: dry-run 은 read-only planner 다. 아래 어떤 전이·폐기 코드에도 닿지 않는다. ──
  if (dryRun) return planAccountDeletionJob(job, deps);

  try {
    // ── §3-4 계약 1: 수집 경로가 없는 버킷이 하나라도 남아 있으면 real-run 을 시작하지 않는다. ──
    //    "cron 응답에 표시했다"로 대체하지 않는다 — 상태기계에 실제로 배선한다.
    const uncoveredAtStart = [...(await deps.uncoveredBuckets())];
    if (uncoveredAtStart.length > 0) {
      await deps.recordError(userId, `uncovered_buckets: ${uncoveredAtStart.join(",")}`);
      return {
        ok: false,
        userId,
        finalState: state,
        dryRun,
        uncoveredBuckets: uncoveredAtStart,
        stopped: "uncovered_buckets",
      };
    }

    // pending → locked: 동의·잔액·취소창 검증과 같은 트랜잭션(§3-5-A(d)).
    if (state === "pending") {
      const begun = await deps.beginLocked(userId);
      if (!begun.ok) {
        const code = begun.code ?? "not_locked";
        // 취소창 미경과는 정상 대기다 — 오류로 기록하지 않는다.
        if (code !== "CANCEL_WINDOW_OPEN") await deps.recordError(userId, `begin_locked: ${code}`);
        return { ok: code === "CANCEL_WINDOW_OPEN", userId, finalState: "pending", dryRun, stopped: code };
      }
      state = "locked";
    }

    // locked 진입 직후: GoTrue 전 세션 revoke(성공 전 다음 단계 금지). 실패 시 재시도로 남긴다.
    if (state === "locked") {
      const rev = await deps.revokeSessions(userId);
      if (!rev.ok) {
        await deps.recordError(userId, `session_revoke_failed: ${rev.error ?? "unknown"}`);
        return { ok: false, userId, finalState: "locked", dryRun, stopped: "session_revoke" };
      }
      // locked → purging (조건부 원자).
      if (await deps.advance(userId, "locked", "purging")) state = "purging";
    }

    // purging: 삭제 계획 = DB refs ∪ 인벤토리(실행·계획 공용 산출 함수).
    if (state === "purging") {
      const planned = await planAccountDeletion(userId, deps);
      const plan = planned.refs;
      log(deps, "purge_plan", { count: plan.length, dryRun });

      const removed = await deps.removeObjects(plan);
      const residue = purgeResidue(plan, removed);
      if (residue.length > 0) {
        await deps.recordError(userId, `storage residue ${residue.length}`);
        return { ok: false, userId, finalState: "purging", dryRun, plan, stopped: "residue" };
      }

      // 빈 상태 재검증 — 커버 버킷만이 아니라 **수집 대상 전 버킷**을 다시 조회한다(§3-4 계약 5).
      const recheck = await planAccountDeletion(userId, deps);
      if (recheck.uncoveredBuckets.length > 0) {
        await deps.recordError(userId, `uncovered_buckets: ${recheck.uncoveredBuckets.join(",")}`);
        return {
          ok: false,
          userId,
          finalState: "purging",
          dryRun,
          plan,
          uncoveredBuckets: recheck.uncoveredBuckets,
          stopped: "uncovered_buckets",
        };
      }
      if (!emptyStateSatisfied(recheck.refs)) {
        await deps.recordError(userId, `not empty after purge: ${recheck.refs.map(storageObjectKey).join(",")}`);
        return { ok: false, userId, finalState: "purging", dryRun, plan, stopped: "not_empty" };
      }
      if (await deps.advance(userId, "purging", "storage_purged")) state = "storage_purged";
    }

    // storage_purged → finalized: 지갑 forfeit + 익명화 원자 경계.
    if (state === "storage_purged") {
      await deps.forfeitWalletAndAnonymize(userId);
      if (await deps.advance(userId, "storage_purged", "finalized")) state = "finalized";
    }

    // finalized → auth_soft_deleted: auth soft-delete(실패 예외 → 재시도).
    if (state === "finalized") {
      await deps.authSoftDelete(userId);
      if (await deps.advance(userId, "finalized", "auth_soft_deleted")) state = "auth_soft_deleted";
    }

    // auth_soft_deleted → completed.
    if (state === "auth_soft_deleted") {
      if (await deps.advance(userId, "auth_soft_deleted", "completed")) state = "completed";
    }

    return { ok: true, userId, finalState: state, dryRun };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await deps.recordError(userId, msg);
    return { ok: false, userId, finalState: state, dryRun, stopped: "error" };
  }
}
