// 회원탈퇴 saga worker 오케스트레이터 — 어댑터 주입(테스트/실제 분리), dry-run 기본.
// ⚠️ 실제 사용자·객체 삭제는 기능 플래그 ON + dryRun=false + 실제 어댑터 배선 시에만.
// 상태 전이는 151 RPC(account_deletion_advance)로만 — Storage 성공(빈 상태 재검증) 전 finalized 금지.

import {
  buildStoragePurgePlan,
  emptyStateSatisfied,
  purgeResidue,
  storageObjectKey,
  type StorageObjectRef,
} from "@/lib/account/accountDeletionPurgePlan";

export type DeletionJob = { userId: string; state: string; dryRun: boolean };

/**
 * GoTrue 세션 폐기 어댑터 — locked 진입 직후 전 세션 revoke. 실제 호출 transport 는 interface 분리.
 * 기본은 dry-run(mock). production adapter 는 명시적 설정이 있을 때만 주입한다.
 * 취소해도 기존 세션은 복원하지 않는다(재로그인 요구) — 그 계약은 앱/미들웨어가 강제.
 */
export type SessionRevokeAdapter = (userId: string) => Promise<{ ok: boolean; error?: string }>;
export const dryRunSessionRevoke: SessionRevokeAdapter = async () => ({ ok: true });

export type DeletionDeps = {
  /** 151 account_deletion_advance(from→to) 래퍼. 전이 성공 여부. */
  advance: (userId: string, from: string, to: string) => Promise<boolean>;
  /** 오류 기록 + backoff(151 account_deletion_record_error). */
  recordError: (userId: string, err: string) => Promise<void>;
  /** GoTrue 전 세션 revoke(dry-run 기본). locked 직후 호출, 성공 전 다음 단계 금지. */
  revokeSessions: SessionRevokeAdapter;
  /** DB 에 기록된 유저 Storage refs. */
  gatherDbRefs: (userId: string) => Promise<StorageObjectRef[]>;
  /** 버킷 인벤토리(유저 prefix, 페이지네이션 완료본). */
  listInventory: (userId: string) => Promise<StorageObjectRef[]>;
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
  stopped?: string;
};

function log(deps: DeletionDeps, msg: string, meta?: Record<string, unknown>) {
  deps.log?.(msg, meta);
}

/**
 * 단일 job 을 현재 state 에서 가능한 만큼 진행한다(resumable). dryRun 이면 purging 계획까지만 산출하고
 * 파괴적 단계 전에 멈춘다(실삭제·익명화·auth 삭제 없음).
 */
export async function runAccountDeletionJob(job: DeletionJob, deps: DeletionDeps): Promise<DeletionRunResult> {
  const { userId } = job;
  let state = job.state;
  const dryRun = job.dryRun;

  try {
    // pending → locked (cancelable_until 경과 시에만 RPC 가 전이).
    if (state === "pending") {
      const locked = await deps.advance(userId, "pending", "locked");
      if (!locked) return { ok: true, userId, finalState: "pending", dryRun, stopped: "cancel_window" };
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

    // purging: 삭제 계획 = DB refs ∪ 인벤토리.
    if (state === "purging") {
      const [dbRefs, inventory] = await Promise.all([deps.gatherDbRefs(userId), deps.listInventory(userId)]);
      const plan = buildStoragePurgePlan(dbRefs, inventory);
      log(deps, "purge_plan", { userId, count: plan.length, dryRun });

      if (dryRun) {
        // dry-run: 계획만 산출, 파괴적 단계 전 정지.
        return { ok: true, userId, finalState: "purging", dryRun, plan, stopped: "dry_run" };
      }

      const removed = await deps.removeObjects(plan);
      const residue = purgeResidue(plan, removed);
      if (residue.length > 0) {
        await deps.recordError(userId, `storage residue ${residue.length}`);
        return { ok: false, userId, finalState: "purging", dryRun, plan, stopped: "residue" };
      }
      // 빈 상태 재검증 — 남은 객체 있으면 finalized 로 못 간다(재시도).
      const reinv = await deps.listInventory(userId);
      if (!emptyStateSatisfied(reinv)) {
        await deps.recordError(userId, `not empty after purge: ${reinv.map(storageObjectKey).join(",")}`);
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
