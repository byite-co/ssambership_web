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
//
// W5-c §3-3-b (owner_id 채움률 실측 > 0 → 분기 b):
//   수집 = DB 조인 refs ∪ (storage.objects.owner_id = 대상 uid, 전 버킷) ∪ prefix 인벤토리.
//   OWNERSHIP_CONFLICT / UNATTRIBUTABLE ≥ 1 이면 미커버 버킷과 **동일 관문**에서
//   real-run 시작 0 · purging→storage_purged 전이 0 · record_error.

import {
  buildDeletionPlan,
  buildStoragePurgePlan,
  emptyStateSatisfied,
  purgeResidue,
  storageObjectKey,
  type ObjectOwnership,
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

/**
 * record_error 결과 — 이번 오류 기록으로 job 이 **실패 종결(state='failed')** 되었는지.
 * 175 account_deletion_record_error 는 attempts 가 한도를 넘으면 state='failed' 로 종결하고
 * `{ ok:true, state:'failed', … }` 를 돌려준다. 그 신호를 워커까지 전달해 unban 보상을 건다(D-AU-4).
 */
export type RecordErrorOutcome = { concludedFailed?: boolean } | void;

export type DeletionDeps = {
  /**
   * 176 account_deletion_begin_locked — 동의·잔액·취소창 검증과 `pending→locked` 전이를
   * **단일 DB 트랜잭션**으로 수행한다. 워커가 잔액을 따로 SELECT 한 뒤 advance 하는
   * 구현은 금지다(그 사이 충전이 끼어드는 TOCTOU 창이 생긴다 — §3-5-A(d)).
   */
  beginLocked: (userId: string) => Promise<BeginLockedResult>;
  /** 175 account_deletion_advance(from→to) 래퍼. 전이 성공 여부. pending→locked 는 거부된다. */
  advance: (userId: string, from: string, to: string) => Promise<boolean>;
  /**
   * 오류 기록 + backoff(175 account_deletion_record_error).
   * attempts 한도 초과로 job 이 실패 종결되면 `{ concludedFailed:true }` 를 돌려준다
   * (구 구현은 void 였다 — 실패 종결 신호가 워커에 닿지 않아 unban 보상을 걸 수 없었다: D-AU-4).
   */
  recordError: (userId: string, err: string) => Promise<RecordErrorOutcome>;
  /**
   * job 실패 종결(state='failed') 시 GoTrue 밴 해제(`ban_duration:'none'`) 보상(D-AU-4).
   * locked 진입 시 100년 밴을 걸지만 job 이 영구 실패하면 계정이 삭제되지도 복구되지도 않은 채
   * 로그인 영구 차단으로 남는다. 실패 종결 시 밴을 풀어 사용자가 (익명화 전 커밋 상태의)
   * 계정으로 다시 로그인할 수 있게 한다. 미주입 시 no-op(테스트/dry-run). 보상 실패는 원 오류를 가리지 않는다.
   */
  unbanOnFailure?: (userId: string) => Promise<void>;
  /** GoTrue 전 세션 revoke(dry-run 기본). locked 직후 호출, 성공 전 다음 단계 금지. */
  revokeSessions: SessionRevokeAdapter;
  /** DB 에 기록된 유저 Storage refs(소유자 조인 기반). */
  gatherDbRefs: (userId: string) => Promise<StorageObjectRef[]>;
  /** 버킷 인벤토리(유저 prefix, 페이지네이션 완료본). */
  listInventory: (userId: string) => Promise<StorageObjectRef[]>;
  /**
   * storage.objects.owner_id 실측(§3-3-b): 대상 uid 소유 객체 전수 + owner 맵.
   * 실어댑터는 181 RPC(소유 전수)에 더해 refs 인자(수집 합집합) 전건을 183 RPC
   * `account_deletion_verify_object_owners` 로 배치 검증해 'target'/'other'/'none'
   * verdict 를 owner 맵에 싣는다(W5-f F1 — 타인-owner 이상치의 OWNERSHIP_CONFLICT
   * 감지 복원, ObjectOwnership 타입 주석 참조). 실패는 예외 → 워커가 fail-closed 로
   * 정지한다.
   */
  resolveObjectOwners: (
    userId: string,
    refs: readonly StorageObjectRef[]
  ) => Promise<ObjectOwnership>;
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
  ownershipConflicts?: StorageObjectRef[];
  unattributable?: StorageObjectRef[];
  stopped?: string;
};

function log(deps: DeletionDeps, msg: string, meta?: Record<string, unknown>) {
  deps.log?.(msg, meta);
}

/**
 * 오류 기록 래퍼(D-AU-4) — record_error 를 호출하고, 그 호출로 job 이 **실패 종결**되면
 * unban 보상을 건다. 모든 recordError 경로가 이 함수를 거쳐야 실패 종결 시 밴 해제가 보장된다.
 * 보상(unban) 실패는 원래의 정지·오류 경로를 가리지 않되, **무음으로 삼키지 않고** 반드시
 * 로그 1건을 남긴다 — state='failed' 는 claim 가능 집합 밖이라 워커가 다시 집지 않으므로
 * (자동 재시도 경로 없음) 이 로그가 유일한 흔적이고, 운영자가 보고 수동으로 밴을 해제해야 한다.
 */
async function noteError(deps: DeletionDeps, userId: string, err: string): Promise<void> {
  const outcome = await deps.recordError(userId, err);
  if (outcome && outcome.concludedFailed === true && deps.unbanOnFailure) {
    try {
      await deps.unbanOnFailure(userId);
    } catch (cause) {
      // 식별 가능한 요약만 싣는다(오류 원문 전체 금지 — record_error 상한 관행과 동일하게 절단).
      const reason = (cause instanceof Error ? cause.message : String(cause)).slice(0, 200);
      // 기존 로깅 채널(deps.log) 우선 — cron 배선처럼 log 미주입이면 console.error 로 남긴다.
      // marker+userId+요약만 실어 Storage 경로·시크릿이 섞일 여지를 없앤다.
      if (deps.log) {
        log(deps, "unban_on_failure_failed", { userId, reason });
      } else {
        console.error("[account-deletion-worker] unban_on_failure_failed", { userId, reason });
      }
    }
  }
}

/**
 * §3-3-b · §3-4 공용 차단 관문: 미커버 버킷 → 소유 충돌 → 귀속 불능 순으로 판정한다.
 * 하나라도 걸리면 real-run 시작 0 · storage_purged 전이 0 (호출부가 record_error 후 정지).
 */
function planBlockReason(plan: StoragePurgePlan): { stopped: string; detail: string } | null {
  if (plan.uncoveredBuckets.length > 0) {
    return { stopped: "uncovered_buckets", detail: `uncovered_buckets: ${plan.uncoveredBuckets.join(",")}` };
  }
  if (plan.ownershipConflicts.length > 0) {
    return {
      stopped: "ownership_conflict",
      detail: `ownership_conflict ${plan.ownershipConflicts.length}: ${plan.ownershipConflicts
        .map(storageObjectKey)
        .join(",")}`,
    };
  }
  if (plan.unattributable.length > 0) {
    return {
      stopped: "unattributable",
      detail: `unattributable ${plan.unattributable.length}: ${plan.unattributable
        .map(storageObjectKey)
        .join(",")}`,
    };
  }
  return null;
}

function blockedResult(
  userId: string,
  finalState: string,
  dryRun: boolean,
  plan: StoragePurgePlan,
  stopped: string
): DeletionRunResult {
  return {
    ok: false,
    userId,
    finalState,
    dryRun,
    uncoveredBuckets: plan.uncoveredBuckets,
    ownershipConflicts: plan.ownershipConflicts,
    unattributable: plan.unattributable,
    stopped,
  };
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
  // §3-3-b: 수집 합집합(DB refs ∪ prefix 인벤토리)의 owner 실측 + 대상 uid 소유 전 버킷 객체.
  const ownership = await deps.resolveObjectOwners(
    userId,
    buildStoragePurgePlan(dbRefs, inventory)
  );
  return buildDeletionPlan({ userId, dbRefs, inventory, ownership, uncoveredBuckets });
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
    conflicts: plan.ownershipConflicts.length,
    unattributable: plan.unattributable.length,
    dryRun: true,
  });
  return {
    ok: true,
    userId: job.userId,
    finalState: job.state,
    dryRun: true,
    plan: plan.refs,
    uncoveredBuckets: plan.uncoveredBuckets,
    ownershipConflicts: plan.ownershipConflicts,
    unattributable: plan.unattributable,
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
    // ── §3-4 계약 1 + §3-3-b: 미커버 버킷·소유 충돌·귀속 불능이 하나라도 있으면
    //    real-run 을 시작하지 않는다. "cron 응답에 표시했다"로 대체하지 않는다 —
    //    상태기계에 실제로 배선한다(계획 산출은 read-only 라 시작 게이트에서 안전하다).
    const planAtStart = await planAccountDeletion(userId, deps);
    const blockAtStart = planBlockReason(planAtStart);
    if (blockAtStart) {
      await noteError(deps, userId, blockAtStart.detail);
      return blockedResult(userId, state, dryRun, planAtStart, blockAtStart.stopped);
    }

    // pending → locked: 동의·잔액·취소창 검증과 같은 트랜잭션(§3-5-A(d)).
    if (state === "pending") {
      const begun = await deps.beginLocked(userId);
      if (!begun.ok) {
        const code = begun.code ?? "not_locked";
        // 취소창 미경과는 정상 대기다 — 오류로 기록하지 않는다.
        if (code !== "CANCEL_WINDOW_OPEN") await noteError(deps, userId, `begin_locked: ${code}`);
        return { ok: code === "CANCEL_WINDOW_OPEN", userId, finalState: "pending", dryRun, stopped: code };
      }
      state = "locked";
    }

    // locked 진입 직후: GoTrue 전 세션 revoke(성공 전 다음 단계 금지). 실패 시 재시도로 남긴다.
    if (state === "locked") {
      const rev = await deps.revokeSessions(userId);
      if (!rev.ok) {
        await noteError(deps, userId, `session_revoke_failed: ${rev.error ?? "unknown"}`);
        return { ok: false, userId, finalState: "locked", dryRun, stopped: "session_revoke" };
      }
      // locked → purging (조건부 원자).
      if (await deps.advance(userId, "locked", "purging")) state = "purging";
    }

    // purging: 삭제 계획 = DB refs ∪ owner 귀속 ∪ 인벤토리(실행·계획 공용 산출 함수).
    if (state === "purging") {
      const planned = await planAccountDeletion(userId, deps);
      // §3-3-b: 시작 게이트 이후 나타난 충돌·귀속 불능도 삭제 전에 다시 막는다.
      const blockBeforeRemove = planBlockReason(planned);
      if (blockBeforeRemove) {
        await noteError(deps, userId, blockBeforeRemove.detail);
        return blockedResult(userId, "purging", dryRun, planned, blockBeforeRemove.stopped);
      }
      const plan = planned.refs;
      log(deps, "purge_plan", {
        count: plan.length,
        ownerAttributed: planned.ownerAttributed.length,
        dryRun,
      });

      const removed = await deps.removeObjects(plan);
      const residue = purgeResidue(plan, removed);
      if (residue.length > 0) {
        await noteError(deps, userId, `storage residue ${residue.length}`);
        return { ok: false, userId, finalState: "purging", dryRun, plan, stopped: "residue" };
      }

      // 빈 상태 재검증 — 커버 버킷만이 아니라 **수집 대상 전 버킷**을 다시 조회한다(§3-4 계약 5).
      // §3-3-b: 재검증 시점의 미커버·충돌·귀속 불능도 storage_purged 전이를 막는다.
      const recheck = await planAccountDeletion(userId, deps);
      const blockAtRecheck = planBlockReason(recheck);
      if (blockAtRecheck) {
        await noteError(deps, userId, blockAtRecheck.detail);
        return { ...blockedResult(userId, "purging", dryRun, recheck, blockAtRecheck.stopped), plan };
      }
      if (!emptyStateSatisfied(recheck.refs)) {
        await noteError(deps, userId, `not empty after purge: ${recheck.refs.map(storageObjectKey).join(",")}`);
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
    await noteError(deps, userId, msg);
    return { ok: false, userId, finalState: state, dryRun, stopped: "error" };
  }
}
