import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeletionDeps, SessionRevokeAdapter } from "@/lib/account/accountDeletionWorker";
import {
  normalizeStoredObjectPath,
  storageObjectKey,
  type StorageObjectRef,
  type StorageOwnerEvidence,
} from "@/lib/account/accountDeletionPurgePlan";
import {
  ACCOUNT_DELETION_ALL_BUCKETS,
  ACCOUNT_DELETION_DB_REF_SOURCES,
  ACCOUNT_DELETION_JOINED_BUCKETS,
  ACCOUNT_DELETION_PREFIX_BUCKETS,
  ACCOUNT_DELETION_UNCOVERED_BUCKETS,
  ACCOUNT_DELETION_UNDETERMINABLE_BUCKETS,
  computeUncoveredBuckets,
  type DbRefSource,
} from "@/lib/account/accountDeletionBucketCoverage";

/**
 * 계정 삭제 saga worker 의 실제 어댑터 — **service role 전용**.
 *
 * 실측 전제(staging lbeqxarxothkmzqvpudy, 2026-07-26 재확인):
 *   - 관련 RPC 는 전부 `service_role` 에만 EXECUTE 가 있다
 *     (account_deletion_claim / _advance / _record_error / _reclaim_expired /
 *      _forfeit_and_anonymize / _begin_locked / _revoke_sessions).
 *   - `account_deletion_jobs` 는 RLS on + 정책 0 + anon/authenticated 테이블 권한 없음
 *     → service role 이 아니면 아무것도 못 읽는다.
 *   - 상태 컬럼 이름은 `state` 다(`status` 아님).
 *
 * ★ removeObjects 반환 규약(치명적): 워커는 반환값을 `purgeResidue` 에서
 *   `storageObjectKey(ref)` = `"{bucket}/{path}"` 와 대조한다. 버킷 접두 없는
 *   맨 경로를 반환하면 전건이 잔여로 잡혀 job 이 계속 실패한다.
 */

export {
  ACCOUNT_DELETION_ALL_BUCKETS,
  ACCOUNT_DELETION_DB_REF_SOURCES,
  ACCOUNT_DELETION_JOINED_BUCKETS,
  ACCOUNT_DELETION_PREFIX_BUCKETS,
  ACCOUNT_DELETION_UNCOVERED_BUCKETS,
  ACCOUNT_DELETION_UNDETERMINABLE_BUCKETS,
};
export type { DbRefSource };

/** 175 account_deletion_advance — 전이 성공 여부. 반복 호출은 false(멱등). */
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

/**
 * 176 account_deletion_begin_locked — 동의·잔액·취소창 검증과 `pending→locked` 를
 * **한 트랜잭션**에서 수행한다. 워커가 잔액을 따로 읽고 advance 하는 경로는 없다(TOCTOU 0).
 * 반환 code: CANCEL_WINDOW_OPEN · FORFEIT_CONSENT_REQUIRED · FORFEIT_CONSENT_STALE · NOT_PENDING · JOB_NOT_FOUND.
 */
export function makeBeginLocked(admin: SupabaseClient): DeletionDeps["beginLocked"] {
  return async (userId) => {
    const { data, error } = await admin.rpc("account_deletion_begin_locked", { p_user_id: userId });
    if (error) throw new Error(`begin_locked failed: ${error.message}`);
    const row = (data ?? {}) as { ok?: boolean; code?: string };
    return { ok: row.ok === true, code: typeof row.code === "string" ? row.code : undefined };
  };
}

/** 175 account_deletion_record_error — attempts 증가 + backoff, 한도 초과 시 failed. */
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
 * 계정 삭제 중 밴 기간 — GoTrue 가 밴 사용자의 토큰 발급·갱신을 거절한다.
 * 100년(876000h). 소프트 삭제(finalized 단계)까지의 창을 덮는다.
 */
export const ACCOUNT_DELETION_BAN_DURATION = "876000h";

/**
 * 세션 폐기. **uid 만으로 전 세션을 끊는 admin 메서드는 설치된 SDK 에 없다**
 * (`@supabase/auth-js` 2.104.1 의 `GoTrueAdminApi.signOut(jwt, scope)` 는 첫 인자가
 * 로그인된 사용자의 **JWT** 이며 worker 는 그 JWT 를 갖고 있지 않다). 구 구현은 거기에
 * userId 를 넘기고 있었다 — 타입 캐스팅으로 가려져 tsc 를 통과했을 뿐 계약 위반이다.
 *
 * 실현 가능한 수단 둘을 **모두** 쓴다(둘은 서로 다른 계약을 만족한다):
 *   ① `updateUserById(uid, { ban_duration })` — uid 기반 실제 시그니처. 신규 로그인·
 *      refresh 토큰 교환을 Auth 단계에서 거절시킨다.
 *   ② `account_deletion_revoke_sessions(uid)` (177, SECURITY DEFINER, service_role 전용)
 *      — `auth.sessions` · `auth.refresh_tokens` 행을 실제로 지운다.
 *
 * ★ 어느 쪽도 **이미 발급된 access token 자체를 무효화하지는 못한다**(JWT 는 무상태라
 *   PostgREST/Storage 가 만료 전까지 서명만 보고 통과시킨다). 그 구간은 151/154 의
 *   write gate(`account_deletion_write_blocked`)가 fail-closed 로 막는다.
 *   "세션 폐기"와 "재로그인 차단"과 "기존 토큰 무효화"는 서로 다른 계약이다 — 합치지 않는다.
 *
 * 실패는 **성공으로 위장하지 않고** ok:false 를 돌려준다(워커는 purge 로 진행하지 않는다 — INV-5).
 * 토큰·시크릿·세션 식별자는 어떤 경로로도 로그·반환값에 싣지 않는다.
 */
export function makeRevokeSessions(admin: SupabaseClient): SessionRevokeAdapter {
  return async (userId) => {
    try {
      // ① Auth 단계 재로그인·갱신 차단 (실제 SDK 시그니처 — 캐스팅 우회 없음).
      const banned = await admin.auth.admin.updateUserById(userId, {
        ban_duration: ACCOUNT_DELETION_BAN_DURATION,
      });
      if (banned.error) return { ok: false, error: `ban_failed: ${banned.error.message}` };

      // ② 기존 세션·refresh token 실폐기.
      const { data, error } = await admin.rpc("account_deletion_revoke_sessions", {
        p_user_id: userId,
      });
      if (error) return { ok: false, error: `session_purge_failed: ${error.message}` };
      const row = (data ?? {}) as { ok?: boolean };
      if (row.ok !== true) return { ok: false, error: "session_purge_rejected" };

      return { ok: true };
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : "session_revoke_failed" };
    }
  };
}

const DB_PAGE_SIZE = 500;

/** 한 테이블에서 소유자 조건으로 페이지네이션 완주하며 경로 컬럼을 긁는다. */
async function selectOwnedRows(
  admin: SupabaseClient,
  source: DbRefSource,
  userId: string
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  const columns = source.pathColumns.join(", ");
  for (let offset = 0; ; offset += DB_PAGE_SIZE) {
    const { data, error } = await admin
      .from(source.table)
      .select(columns)
      .eq(source.ownerColumn, userId)
      .range(offset, offset + DB_PAGE_SIZE - 1);
    if (error) {
      // 참조를 못 읽은 채로 계획을 세우면 '지웠다'고 오판할 수 있다 — 실패시킨다.
      throw new Error(`gatherDbRefs(${source.table}) failed: ${error.message}`);
    }
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < DB_PAGE_SIZE) break;
  }
  return rows;
}

/** 문자열 · 문자열 배열 두 형태를 모두 흡수해 버킷 내부 경로로 정규화한다. */
function pushNormalized(out: StorageObjectRef[], bucket: string, value: unknown): void {
  const candidates: unknown[] = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const path = normalizeStoredObjectPath(bucket, candidate);
    if (path) out.push({ bucket, path });
  }
}

/**
 * 소유자를 **직접** 가리키는 (테이블, 소유자 컬럼) 조합의 수집기.
 * prefix 스캔으로는 찾을 수 없는 버킷(질문/글/주문 uuid 로 키잉된 버킷)이 여기로 커버된다.
 */
export function makeGatherDbRefs(
  admin: SupabaseClient,
  sources: readonly DbRefSource[] = ACCOUNT_DELETION_DB_REF_SOURCES
): DeletionDeps["gatherDbRefs"] {
  return async (userId) => {
    const refs: StorageObjectRef[] = [];
    for (const source of sources) {
      const rows = await selectOwnedRows(admin, source, userId);
      for (const row of rows) {
        for (const column of source.pathColumns) pushNormalized(refs, source.bucket, row[column]);
      }
    }
    refs.push(...(await gatherIndividualQuestionAttachmentRefs(admin, userId)));
    return refs;
  };
}

export const INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET = "individual-question-attachments";

/** `.in()` 인자 폭주를 막기 위한 청크 크기. */
const IN_CHUNK = 200;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function selectIds(
  admin: SupabaseClient,
  table: string,
  idColumn: string,
  filterColumn: string,
  userId: string
): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += DB_PAGE_SIZE) {
    const { data, error } = await admin
      .from(table)
      .select(idColumn)
      .eq(filterColumn, userId)
      .range(offset, offset + DB_PAGE_SIZE - 1);
    if (error) throw new Error(`gatherDbRefs(${table}) failed: ${error.message}`);
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    for (const row of page) {
      const value = row[idColumn];
      if (typeof value === "string" && value !== "") ids.push(value);
    }
    if (page.length < DB_PAGE_SIZE) break;
  }
  return ids;
}

/**
 * `individual-question-attachments` 소유자 조인 — 이 버킷만 2단계다.
 *
 * 실측: `individual_question_attachments` 컬럼은
 * (id, question_id, message_id, storage_path, file_name, mime_type, created_at) — 업로더 컬럼이 없다.
 * 소유는 두 경로로만 되짚을 수 있다:
 *   ① `message_id` → `individual_question_messages.author_id` (그 메시지를 쓴 사람)
 *   ② `message_id` 가 없는 최초 첨부 → `question_id` → `individual_questions.student_id` (질문자)
 * ②에 `claimed_mentor_id`·`designated_mentor_id` 는 **넣지 않는다** — 멘토가 탈퇴한다고
 * 학생이 올린 첨부까지 지우면 과삭제다(미삭제보다 나쁘다).
 */
export async function gatherIndividualQuestionAttachmentRefs(
  admin: SupabaseClient,
  userId: string
): Promise<StorageObjectRef[]> {
  const bucket = INDIVIDUAL_QUESTION_ATTACHMENTS_BUCKET;
  const refs: StorageObjectRef[] = [];
  const seen = new Set<string>();

  const collect = async (column: "message_id" | "question_id", ids: string[], ownOnly: boolean) => {
    for (const part of chunk(ids, IN_CHUNK)) {
      let query = admin.from("individual_question_attachments").select("storage_path").in(column, part);
      // 최초 첨부(메시지 미연결)만 질문자 소유로 본다 — 멘토 답변 첨부까지 끌어오지 않기 위함.
      if (ownOnly) query = query.is("message_id", null);
      const { data, error } = await query;
      if (error) throw new Error(`gatherDbRefs(individual_question_attachments) failed: ${error.message}`);
      for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const path = normalizeStoredObjectPath(bucket, row.storage_path as string | null);
        if (path && !seen.has(path)) {
          seen.add(path);
          refs.push({ bucket, path });
        }
      }
    }
  };

  const messageIds = await selectIds(admin, "individual_question_messages", "id", "author_id", userId);
  if (messageIds.length > 0) await collect("message_id", messageIds, false);

  const questionIds = await selectIds(admin, "individual_questions", "id", "student_id", userId);
  if (questionIds.length > 0) await collect("question_id", questionIds, true);

  return refs;
}

/**
 * 사용자 prefix(`{userId}/…`)로 **실제로** 객체를 찾을 수 있는 버킷의 인벤토리.
 * 이 경로만이 **미등록(orphan) 객체까지** 잡아낸다 — DB 조인은 등록된 행만 본다.
 */
export const ACCOUNT_DELETION_BUCKETS: readonly string[] = ACCOUNT_DELETION_PREFIX_BUCKETS;

const INVENTORY_PAGE_SIZE = 100;

/**
 * 버킷 인벤토리 — **페이지네이션 완료본**이어야 한다.
 * Supabase storage list 는 한 번에 limit 개만 주고 재귀하지 않으므로,
 * 사용자 prefix 를 BFS 로 훑으며 폴더를 따라 내려간다.
 */
export function makeListInventory(
  admin: SupabaseClient,
  buckets: readonly string[] = ACCOUNT_DELETION_PREFIX_BUCKETS
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
 * W5-c §3-3 (b): storage.objects 실측 owner 증거 수집.
 *
 * 반환 행(§ classifyDeletionPlan 입력):
 *   ① owner_id = 대상 uid (전 버킷)          — DB 미등록 orphan 의 owner 귀속 수집
 *   ② name LIKE '{uid}/%' (전 버킷)          — 유저-스코프 전 버킷 인벤토리(+owner)
 *   ③ 인자 refs 의 (bucket, name) owner 실측 — OWNERSHIP_CONFLICT 판정용
 *
 * ★ 데이터 소스 실측(staging lbeqxarxothkmzqvpudy, 2026-07-26):
 *   `storage` 스키마는 PostgREST 에 노출되어 있지 않다(PGRST106 —
 *   "Only the following schemas are exposed: public, graphql_public").
 *   따라서 이 어댑터는 현재 구성에서 **예외를 던지고**, 워커는 계획 산출 실패 →
 *   record_error → 재시도로 fail-closed 정지한다(파괴 0). 이것은 의도된 방향이다 —
 *   owner 증거 없이 분류를 통과시키는 fail-open 이 유일한 대안이기 때문이다.
 *   해제 경로: 프로젝트 API 설정(Exposed schemas)에 `storage` 추가(코드 무변경) 또는
 *   후속 회차에서 전용 SECURITY DEFINER RPC 신설(이번 회차 SQL 예산은 179·180 뿐 — §0).
 *   Storage REST API(list/info)는 owner 를 반환하지 않아 대안이 되지 못한다(실측).
 */
export function makeGatherOwnerEvidence(
  admin: SupabaseClient,
): (userId: string, refs: StorageObjectRef[]) => Promise<StorageOwnerEvidence[]> {
  const table = () => admin.schema("storage").from("objects");

  const pushRow = (out: StorageOwnerEvidence[], row: Record<string, unknown>) => {
    const bucket = typeof row.bucket_id === "string" ? row.bucket_id : "";
    const path = typeof row.name === "string" ? row.name : "";
    if (!bucket || !path) return;
    out.push({ bucket, path, ownerId: typeof row.owner_id === "string" ? row.owner_id : null });
  };

  return async (userId, refs) => {
    const out: StorageOwnerEvidence[] = [];

    // ①+② owner 귀속 ∪ 유저-스코프 전 버킷 인벤토리 (페이지네이션 완주).
    //     PostgREST or 구문의 like 와일드카드는 `*` 다.
    for (let offset = 0; ; offset += DB_PAGE_SIZE) {
      const { data, error } = await table()
        .select("bucket_id, name, owner_id")
        .or(`owner_id.eq.${userId},name.like.${userId}/*`)
        .range(offset, offset + DB_PAGE_SIZE - 1);
      if (error) {
        // 증거를 못 읽은 채 분류하면 충돌·판별불능이 전부 "없음"으로 보인다 — 실패시킨다.
        throw new Error(`gatherOwnerEvidence(owned) failed: ${error.message}`);
      }
      const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
      for (const row of page) pushRow(out, row);
      if (page.length < DB_PAGE_SIZE) break;
    }

    // ③ 후보 refs 의 owner 실측 — 버킷별 IN 청크.
    const byBucket = new Map<string, string[]>();
    for (const ref of refs) {
      if (!ref?.bucket || !ref?.path) continue;
      const list = byBucket.get(ref.bucket) ?? [];
      list.push(ref.path.replace(/^\/+/, ""));
      byBucket.set(ref.bucket, list);
    }
    for (const [bucket, paths] of byBucket) {
      for (const part of chunk(paths, IN_CHUNK)) {
        const { data, error } = await table()
          .select("bucket_id, name, owner_id")
          .eq("bucket_id", bucket)
          .in("name", part);
        if (error) {
          throw new Error(`gatherOwnerEvidence(${bucket}) failed: ${error.message}`);
        }
        for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
          pushRow(out, row);
        }
      }
    }
    return out;
  };
}

/**
 * 수집 경로가 없어 계획에 담을 수 없는 버킷.
 * 하드코딩 목록이 아니라 **전 버킷 − (prefix 커버 ∪ DB 조인 커버)** 로 계산한다 —
 * 새 버킷이 전략 없이 추가되면 자동으로 여기 걸려 real-run 이 막힌다(§3-4).
 */
export function makeUncoveredBuckets(
  all: readonly string[] = ACCOUNT_DELETION_ALL_BUCKETS,
  prefixBuckets: readonly string[] = ACCOUNT_DELETION_PREFIX_BUCKETS,
  sources: readonly DbRefSource[] = ACCOUNT_DELETION_DB_REF_SOURCES,
  undeterminable: readonly string[] = ACCOUNT_DELETION_UNDETERMINABLE_BUCKETS
): DeletionDeps["uncoveredBuckets"] {
  const uncovered = computeUncoveredBuckets({ all, prefixBuckets, sources, undeterminable });
  return async () => uncovered;
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

/**
 * 176 account_deletion_forfeit_and_anonymize — state='storage_purged' 에서만 동작하고,
 * 양수 잔액이면 **검증된 몰수 동의를 마지막으로 한 번 더** 확인한다(3계층 방어의 3층).
 */
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
    beginLocked: makeBeginLocked(admin),
    advance: makeAdvance(admin),
    recordError: makeRecordError(admin),
    revokeSessions: makeRevokeSessions(admin),
    gatherDbRefs: makeGatherDbRefs(admin),
    listInventory: makeListInventory(admin),
    gatherOwnerEvidence: makeGatherOwnerEvidence(admin),
    uncoveredBuckets: makeUncoveredBuckets(),
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
 *   **사용하지 않는다**(중복 처리 방지가 깨진다). 178 에서 EXECUTE 를 회수했다.
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
