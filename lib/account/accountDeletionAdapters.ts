import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeletionDeps, SessionRevokeAdapter } from "@/lib/account/accountDeletionWorker";
import { storageObjectKey, type StorageObjectRef } from "@/lib/account/accountDeletionPurgePlan";

/**
 * 계정 삭제 saga worker 의 실제 어댑터 — **service role 전용**.
 *
 * 실측 전제(staging lbeqxarxothkmzqvpudy):
 *   - 관련 RPC 는 전부 `service_role` 에만 EXECUTE 가 있다
 *     (account_deletion_claim / _advance / _record_error / _reclaim_expired /
 *      _forfeit_and_anonymize). authenticated·anon 은 false.
 *   - `account_deletion_jobs` 는 RLS on + 정책 0 + anon/authenticated 테이블 권한 없음
 *     → service role 이 아니면 아무것도 못 읽는다.
 *   - 상태 컬럼 이름은 `state` 다(`status` 아님).
 *
 * ★ removeObjects 반환 규약(치명적): 워커는 반환값을 `purgeResidue` 에서
 *   `storageObjectKey(ref)` = `"{bucket}/{path}"` 와 대조한다. 버킷 접두 없는
 *   맨 경로를 반환하면 전건이 잔여로 잡혀 job 이 계속 실패한다.
 */

/** 151 account_deletion_advance — 전이 성공 여부. 반복 호출은 false(멱등). */
export function makeAdvance(admin: SupabaseClient): DeletionDeps["advance"] {
  return async (userId, from, to) => {
    const { data, error } = await admin.rpc("account_deletion_advance", {
      p_user_id: userId,
      p_from: from,
      p_to: to,
    });
    if (error) throw new Error(`advance ${from}->${to} failed: ${error.message}`);
    return data === true;
  };
}

/** 151 account_deletion_record_error — attempts 증가 + backoff, 한도 초과 시 failed. */
export function makeRecordError(admin: SupabaseClient): DeletionDeps["recordError"] {
  return async (userId, err) => {
    // 오류 문자열에 비밀·토큰이 섞이지 않도록 상한만 두고 그대로 넘긴다(서버가 1000자로 자른다).
    const { error } = await admin.rpc("account_deletion_record_error", {
      p_user_id: userId,
      p_error: err.slice(0, 500),
    });
    if (error) throw new Error(`record_error failed: ${error.message}`);
  };
}

/**
 * GoTrue 전 세션 revoke. 저장소에 선례가 없는 net-new 기능이라,
 * 지원되지 않는 SDK 에서는 **성공으로 위장하지 않고** ok:false 를 돌려준다
 * (워커는 이때 purge 로 진행하지 않는다 — INV-5).
 */
export function makeRevokeSessions(admin: SupabaseClient): SessionRevokeAdapter {
  return async (userId) => {
    const adminApi = (admin.auth as unknown as {
      admin?: { signOut?: (userId: string, scope?: string) => Promise<{ error: { message: string } | null }> };
    }).admin;

    if (!adminApi || typeof adminApi.signOut !== "function") {
      return { ok: false, error: "session_revoke_unsupported" };
    }
    try {
      const { error } = await adminApi.signOut(userId, "global");
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : "session_revoke_failed" };
    }
  };
}

/** DB 에 기록된 사용자 Storage 참조 수집기 — (테이블, 사용자 컬럼, 경로 컬럼, 버킷) 매핑. */
export type DbRefSource = {
  table: string;
  userColumn: string;
  pathColumn: string;
  bucket: string;
};

/**
 * 사용자 소유 객체를 **직접** 가리키는 (테이블, 사용자 컬럼) 조합.
 *
 * ★ 현재 비어 있다. 실측 결과 후보 테이블에 사용자 컬럼이 없었다 —
 *   `individual_question_attachments` 의 컬럼은
 *   (id, question_id, message_id, storage_path, file_name, mime_type, created_at)
 *   뿐이고 uploader/user 컬럼이 없다(소유는 question_id → 질문 당사자로 간접 결정).
 *   검증하지 않은 매핑을 넣으면 gatherDbRefs 가 매 실행 throw 하거나, 더 나쁘게는
 *   빈 결과를 정상으로 오해해 '지웠다'고 오판한다. 그래서 **추측으로 채우지 않는다**.
 *   간접 소유(question/post/order → 당사자) 매핑은 W4 잔여 과제다(보고서 참조).
 */
export const ACCOUNT_DELETION_DB_REF_SOURCES: readonly DbRefSource[] = [];

export function makeGatherDbRefs(
  admin: SupabaseClient,
  sources: readonly DbRefSource[] = ACCOUNT_DELETION_DB_REF_SOURCES
): DeletionDeps["gatherDbRefs"] {
  return async (userId) => {
    const refs: StorageObjectRef[] = [];
    for (const source of sources) {
      const { data, error } = await admin
        .from(source.table)
        .select(source.pathColumn)
        .eq(source.userColumn, userId);
      if (error) {
        // 참조를 못 읽은 채로 계획을 세우면 '지웠다'고 오판할 수 있다 — 실패시킨다.
        throw new Error(`gatherDbRefs(${source.table}) failed: ${error.message}`);
      }
      for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const path = row[source.pathColumn];
        if (typeof path === "string" && path.trim() !== "") {
          refs.push({ bucket: source.bucket, path });
        }
      }
    }
    return refs;
  };
}

/**
 * `{userId}/` prefix 스캔으로 **실제로 사용자 객체를 찾을 수 있는** 버킷만 넣는다.
 *
 * 실측(2026-07-26 staging, 객체가 존재하는 8개 버킷의 첫 세그먼트 판정):
 *   student-id-images 1/1 · profile-avatars 1/1  → 첫 세그먼트가 **사용자 uuid**
 *   individual-question-attachments 0/5(질문 uuid) · question-room-attachments 0/7
 *   custom-order-deliverables 0/2 · custom-request-post-attachments 0/2
 *   custom-request-application-attachments 0/2 · community-post-images 4/64(대부분 글 uuid)
 *
 * ★ 그래서 아래 목록에 없는 버킷은 사용자 prefix 스캔으로 **찾히지 않는다**.
 *   그 버킷들까지 목록에 넣으면 인벤토리가 늘 비어서 `emptyStateSatisfied` 가
 *   **공허하게 참**이 되고, 파일이 남은 채로 finalized 로 넘어간다(거짓 완료).
 *   덜 지우더라도 '다 지웠다'고 잘못 말하지 않는 쪽을 택한다. 간접 소유 버킷의
 *   수집은 DB 매핑(위 DbRefSource)이 갖춰진 뒤에 추가한다.
 */
export const ACCOUNT_DELETION_BUCKETS: readonly string[] = [
  "student-id-images",
  "profile-avatars",
];

/**
 * 사용자 prefix 로 커버되지 않는 버킷 — 러너가 응답에 실어 '미커버'를 드러낸다.
 * 조용히 빠뜨리지 않기 위한 목록이며, 삭제 대상에서 제외된다는 뜻이 아니라
 * **아직 이 경로로는 찾지 못한다**는 뜻이다.
 */
export const ACCOUNT_DELETION_UNCOVERED_BUCKETS: readonly string[] = [
  "individual-question-attachments",
  "question-room-attachments",
  "community-post-images",
  "custom-request-application-attachments",
  "custom-request-post-attachments",
  "custom-order-message-attachments",
  "custom-order-deliverables",
  "shortform-videos",
  "shortform-thumbnails",
  "connection-note-ink",
];

const INVENTORY_PAGE_SIZE = 100;

/**
 * 버킷 인벤토리 — **페이지네이션 완료본**이어야 한다.
 * Supabase storage list 는 한 번에 limit 개만 주고 재귀하지 않으므로,
 * 사용자 prefix 를 BFS 로 훑으며 폴더를 따라 내려간다.
 */
export function makeListInventory(
  admin: SupabaseClient,
  buckets: readonly string[] = ACCOUNT_DELETION_BUCKETS
): DeletionDeps["listInventory"] {
  return async (userId) => {
    const found: StorageObjectRef[] = [];
    for (const bucket of buckets) {
      const queue: string[] = [userId];
      while (queue.length > 0) {
        const prefix = queue.shift() as string;
        let offset = 0;
        for (;;) {
          const { data, error } = await admin.storage
            .from(bucket)
            .list(prefix, { limit: INVENTORY_PAGE_SIZE, offset });
          if (error) {
            throw new Error(`listInventory(${bucket}) failed: ${error.message}`);
          }
          const entries = data ?? [];
          for (const entry of entries) {
            const name = entry.name;
            if (!name) continue;
            const full = `${prefix}/${name}`;
            // id 가 없으면 파일이 아니라 폴더(prefix) — 한 단계 더 내려간다.
            if ((entry as { id?: string | null }).id) {
              found.push({ bucket, path: full });
            } else {
              queue.push(full);
            }
          }
          if (entries.length < INVENTORY_PAGE_SIZE) break;
          offset += INVENTORY_PAGE_SIZE;
        }
      }
    }
    return found;
  };
}

/**
 * 실제 삭제. 버킷별로 묶어 remove 하고 **삭제된 key 를 `bucket/path` 형태로** 돌려준다.
 * 반환 형식이 어긋나면 워커가 전건을 잔여로 판정한다(위 규약 참조).
 */
export function makeRemoveObjects(admin: SupabaseClient): DeletionDeps["removeObjects"] {
  return async (refs) => {
    const byBucket = new Map<string, string[]>();
    for (const ref of refs) {
      const list = byBucket.get(ref.bucket) ?? [];
      list.push(ref.path);
      byBucket.set(ref.bucket, list);
    }

    const removed: string[] = [];
    for (const [bucket, paths] of byBucket) {
      const { data, error } = await admin.storage.from(bucket).remove(paths);
      if (error) {
        // 일부 실패는 잔여로 드러나야 하므로 여기서 throw 하지 않는다
        // (워커가 residue 로 판정해 backoff 재시도한다).
        continue;
      }
      for (const entry of data ?? []) {
        const name = (entry as { name?: string }).name;
        if (typeof name === "string" && name !== "") {
          removed.push(storageObjectKey({ bucket, path: name }));
        }
      }
    }
    return removed;
  };
}

/** 154 account_deletion_forfeit_and_anonymize — state='storage_purged' 에서만 동작. */
export function makeForfeitWalletAndAnonymize(
  admin: SupabaseClient
): DeletionDeps["forfeitWalletAndAnonymize"] {
  return async (userId) => {
    const { data, error } = await admin.rpc("account_deletion_forfeit_and_anonymize", {
      p_user_id: userId,
    });
    if (error) throw new Error(`forfeit_and_anonymize failed: ${error.message}`);
    const row = (data ?? {}) as { ok?: boolean; code?: string };
    if (row.ok !== true) {
      throw new Error(`forfeit_and_anonymize rejected: ${row.code ?? "unknown"}`);
    }
  };
}

/** auth soft-delete(두 번째 인자 true). 실패는 예외 → 워커가 backoff 재시도. */
export function makeAuthSoftDelete(admin: SupabaseClient): DeletionDeps["authSoftDelete"] {
  return async (userId) => {
    const { error } = await admin.auth.admin.deleteUser(userId, true);
    if (error) throw new Error(`auth soft delete failed: ${error.message}`);
  };
}

/** 워커에 주입할 실제 의존성 묶음. */
export function buildDeletionDeps(
  admin: SupabaseClient,
  log?: DeletionDeps["log"]
): DeletionDeps {
  return {
    advance: makeAdvance(admin),
    recordError: makeRecordError(admin),
    revokeSessions: makeRevokeSessions(admin),
    gatherDbRefs: makeGatherDbRefs(admin),
    listInventory: makeListInventory(admin),
    removeObjects: makeRemoveObjects(admin),
    forfeitWalletAndAnonymize: makeForfeitWalletAndAnonymize(admin),
    authSoftDelete: makeAuthSoftDelete(admin),
    log,
  };
}

export type ClaimedDeletionJob = { userId: string; state: string; dryRun: boolean };

/**
 * 154 account_deletion_claim — lease(owner + leased_until) + FOR UPDATE SKIP LOCKED.
 * ★ 151 의 account_deletion_worker_claim 은 lease 를 읽지도 쓰지도 않으므로
 *   **사용하지 않는다**(중복 처리 방지가 깨진다). 러너는 반드시 이 경로만 쓴다.
 */
export async function claimDeletionJobs(
  admin: SupabaseClient,
  owner: string,
  limit: number,
  leaseSeconds: number
): Promise<ClaimedDeletionJob[]> {
  const { data, error } = await admin.rpc("account_deletion_claim", {
    p_owner: owner,
    p_limit: limit,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`claim failed: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      userId: typeof row.user_id === "string" ? row.user_id : "",
      state: typeof row.state === "string" ? row.state : "",
      dryRun: row.dry_run !== false,
    }))
    .filter((job) => job.userId !== "" && job.state !== "");
}

/** 만료 lease 회수 — 죽은 러너가 잡고 있던 job 을 다시 집을 수 있게 한다. */
export async function reclaimExpiredDeletionLeases(admin: SupabaseClient): Promise<number> {
  const { data, error } = await admin.rpc("account_deletion_reclaim_expired");
  if (error) throw new Error(`reclaim_expired failed: ${error.message}`);
  return typeof data === "number" ? data : 0;
}
