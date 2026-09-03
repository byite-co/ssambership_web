import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { rangeForPage, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  ACCOUNT_DELETION_STALL_STATES,
  ACCOUNT_DELETION_TAB_VALUES,
  accountDeletionTabStates,
  buildAccountDeletionListItem,
  countStalledAccountDeletionJobs,
  parseAccountDeletionJobRow,
  type AccountDeletionJobRow,
  type AccountDeletionListItem,
  type AccountDeletionRequester,
  type AccountDeletionTab,
} from "@/lib/admin/accountDeletionConsole";

/**
 * 관리자 · 탈퇴 요청 현황(PR-13 §1) 서버 조회 — **조회 전용**, service_role 읽기.
 * `account_deletion_jobs` 는 RLS on + 정책 0 + anon/authenticated 테이블 권한 없음(151) → service_role 이 아니면 아무것도 못 읽는다.
 * 요청자 표시명은 `users`(실명 → 닉네임 → 이메일)로 채우되 익명화된 행은 `(삭제 처리됨)` 으로 접는다(`accountDeletionRequesterLabel`).
 * 이 모듈에는 insert/update/rpc 가 없다 — 단계 전이는 처리기(cron → saga worker)만이 한다(§1-1-B: 관리자 재시도 RPC 없음).
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 뒤에서만 호출된다.
 */

type Row = Record<string, unknown>;

const JOB_COLUMNS =
  "id, user_id, state, attempts, last_error, next_attempt_at, cancelable_until, dry_run, requested_at, locked_at, purging_at, storage_purged_at, finalized_at, auth_soft_deleted_at, completed_at, canceled_at, failed_at, updated_at, lease_owner, leased_until, forfeit_consent_at, consented_balance_cents";
const USER_COLUMNS = "id, role, status, full_name, nickname, email";
/** 대시보드 `탈퇴 멈춤` 집계가 한 번에 읽는 상한 — 종료 상태를 제외한 활성·실패 행만이라 현행 2건. */
export const ACCOUNT_DELETION_STALL_SCAN_LIMIT = 1000;

export const ACCOUNT_DELETION_READ_UNAVAILABLE_MESSAGE = "서버 설정(서비스 키)이 없어 탈퇴 요청을 읽을 수 없습니다.";
const LOAD_ERROR = "탈퇴 요청을 불러오지 못했습니다.";

export type AccountDeletionListResult = { rows: AccountDeletionListItem[]; totalCount: number; error: string | null };
export type AccountDeletionTabCounts = Record<AccountDeletionTab, number>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

function serviceRoleOrNull(): SupabaseClient | null {
  try {
    return createServiceRoleClient();
  } catch {
    return null;
  }
}

function isRangeNotSatisfiable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "PGRST103" || /range not satisfiable|invalid range/i.test(String(error.message ?? ""));
}

/** 요청자 `users` 행 — 없으면(하드 삭제) 맵에 없고, 익명화된 행은 그대로 실어 표시층이 `(삭제 처리됨)` 으로 접는다. */
async function loadRequesters(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, AccountDeletionRequester>> {
  const map = new Map<string, AccountDeletionRequester>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await db.from("users").select(USER_COLUMNS).in("id", unique);
  if (error) {
    console.error("[accountDeletionConsole] users 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.id);
    if (!id) continue;
    map.set(id, { id, role: strOrNull(row.role), status: strOrNull(row.status), fullName: strOrNull(row.full_name), nickname: strOrNull(row.nickname), email: strOrNull(row.email) });
  }
  return map;
}

function parseJobs(raw: readonly Row[]): AccountDeletionJobRow[] {
  return raw.map(parseAccountDeletionJobRow).filter((j): j is AccountDeletionJobRow => j !== null);
}

async function toItems(db: SupabaseClient, jobs: readonly AccountDeletionJobRow[], nowIso: string): Promise<AccountDeletionListItem[]> {
  const requesters = await loadRequesters(
    db,
    jobs.map((j) => j.userId)
  );
  return jobs.map((job) => buildAccountDeletionListItem(job, requesters.get(job.userId) ?? null, nowIso));
}

export async function loadAccountDeletionList(params: AdminListParams, tab: AccountDeletionTab, nowIso: string): Promise<AccountDeletionListResult> {
  const db = serviceRoleOrNull();
  if (!db) return { rows: [], totalCount: 0, error: ACCOUNT_DELETION_READ_UNAVAILABLE_MESSAGE };
  const states = [...accountDeletionTabStates(tab)];
  const { from, to } = rangeForPage(params);
  const res = await db.from("account_deletion_jobs").select(JOB_COLUMNS, { count: "exact" }).in("state", states).order("requested_at", { ascending: false }).range(from, to);
  if (res.error) {
    if (isRangeNotSatisfiable(res.error)) {
      const head = await db.from("account_deletion_jobs").select("id", { count: "exact", head: true }).in("state", states);
      return { rows: [], totalCount: head.count ?? 0, error: head.error ? LOAD_ERROR : null };
    }
    console.error("[accountDeletionConsole] account_deletion_jobs 조회 실패:", res.error.message);
    return { rows: [], totalCount: 0, error: LOAD_ERROR };
  }
  const jobs = parseJobs((res.data as Row[] | null) ?? []);
  const rows = await toItems(db, jobs, nowIso);
  return { rows, totalCount: res.count ?? rows.length, error: null };
}

export async function countAccountDeletionTabs(): Promise<AccountDeletionTabCounts> {
  const counts = Object.fromEntries(ACCOUNT_DELETION_TAB_VALUES.map((t) => [t, 0])) as AccountDeletionTabCounts;
  const db = serviceRoleOrNull();
  if (!db) return counts;
  const results = await Promise.all(
    ACCOUNT_DELETION_TAB_VALUES.map(async (tab) => {
      const { count, error } = await db.from("account_deletion_jobs").select("id", { count: "exact", head: true }).in("state", [...accountDeletionTabStates(tab)]);
      if (error) console.error(`[accountDeletionConsole] ${tab} 건수 조회 실패:`, error.message);
      return [tab, count ?? 0] as const;
    })
  );
  for (const [tab, n] of results) counts[tab] = n;
  return counts;
}

/** 상세 1건 — 없으면 item null · error null(호출부가 빈 상태를 그린다). */
export async function loadAccountDeletionJob(jobId: string, nowIso: string): Promise<{ item: AccountDeletionListItem | null; error: string | null }> {
  const db = serviceRoleOrNull();
  if (!db) return { item: null, error: ACCOUNT_DELETION_READ_UNAVAILABLE_MESSAGE };
  const id = str(jobId);
  if (!id) return { item: null, error: null };
  const { data, error } = await db.from("account_deletion_jobs").select(JOB_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[accountDeletionConsole] account_deletion_jobs(1건):", error.message);
    return { item: null, error: LOAD_ERROR };
  }
  const job = data ? parseAccountDeletionJobRow(data as Row) : null;
  if (!job) return { item: null, error: null };
  const [item] = await toItems(db, [job], nowIso);
  return { item: item ?? null, error: null };
}

/**
 * 대시보드 `탈퇴 멈춤`(§1-4) — `state NOT IN (completed, canceled)` 행을 읽어 화면과 **같은 판정 함수**로 센다(취소 유예 중 pending 은 제외).
 * 조회 실패는 0 으로 위장하지 않고 null.
 */
export async function countAccountDeletionStalled(nowIso: string): Promise<number | null> {
  const db = serviceRoleOrNull();
  if (!db) return null;
  const { data, error } = await db.from("account_deletion_jobs").select(JOB_COLUMNS).in("state", [...ACCOUNT_DELETION_STALL_STATES]).order("requested_at", { ascending: true }).limit(ACCOUNT_DELETION_STALL_SCAN_LIMIT);
  if (error) {
    console.error("[accountDeletionConsole] 멈춤 집계 실패:", error.message);
    return null;
  }
  return countStalledAccountDeletionJobs(parseJobs((data as Row[] | null) ?? []), nowIso);
}
