import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { isStatusActive, rangeForPage, type AdminListParams } from "@/lib/admin/adminListParams";
import { buildAdminUsersSearchOr, normalizeAdminListSearchTerm } from "@/lib/admin/adminDataTable";
import { loadIdentityKinds } from "@/lib/admin/mentorApprovalWorkbenchQueries";
import type { MentorIdentityReviewKind } from "@/lib/admin/mentorIdentityReview";
import { effectiveAccountStatus, type EffectiveAccountStatus } from "@/lib/auth/accountStatus";
import {
  ACCOUNT_ROLE_TAB_VALUES,
  accountRoleTabFilter,
  isUuidLike,
  resolveAccountLastActivity,
  type AccountLastActivitySource,
  type AccountRoleTab,
  type AccountVerifiedFilter,
} from "@/lib/admin/accountDetailConsole";

/**
 * 계정 목록(PR-7 §1) 서버 조회 — 전부 service_role 읽기(`users` 는 관리자 RLS SELECT 가 없다 — 구 화면과 같은 경로).
 *
 * - 역할 탭(`role`) · 계정 상태(`status`) · 본인인증(`verified` = `identity_verified_at` 유무) · 검색(이름·닉네임·이메일, uuid 면 id) · 페이징 모두 서버.
 * - 행 보조 정보: 멘토 승인 상태(`mentor_profiles.verification_status`) · 본인인증 배지(PR-2 와 같은 `loadIdentityKinds` 4상태 판정) ·
 *   최근 활동(이 사용자를 대상으로 한 마지막 감사 로그 vs `users.updated_at` 중 늦은 쪽 — `resolveAccountLastActivity`).
 * - 조회 전용. 정지·차단 폼은 목록에 없다(상세에서만).
 */

const USER_COLUMNS = "id, role, status, full_name, nickname, email, suspended_until, created_at, updated_at, identity_verified_at";
/** 페이지 행들의 감사 로그 후보 상한 — 25행 × 최근 몇 건이면 충분하다. */
const ADMIN_LOG_SCAN_LIMIT = 500;

type Row = Record<string, unknown>;

export type AccountListItem = {
  id: string;
  role: string;
  name: string;
  email: string | null;
  nickname: string | null;
  status: string;
  effectiveStatus: EffectiveAccountStatus;
  suspendedUntil: string | null;
  /** 멘토만 — `mentor_profiles.verification_status`. 행이 없으면 null */
  verificationStatus: string | null;
  /** PR-2 판정(4상태). 판정 불가(service_role 부재)면 null */
  identity: MentorIdentityReviewKind | null;
  createdAt: string | null;
  lastActivityAt: string | null;
  lastActivitySource: AccountLastActivitySource | null;
};

export type AccountListResult = {
  rows: AccountListItem[];
  totalCount: number;
  error: string | null;
  identityError: string | null;
};

export type AccountRoleTabCounts = Record<AccountRoleTab, number>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function isRangeNotSatisfiable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return String(error.code ?? "") === "PGRST103" || /range not satisfiable|invalid range/i.test(String(error.message ?? ""));
}

function serviceRoleOrNull(): SupabaseClient | null {
  try {
    return createServiceRoleClient();
  } catch {
    return null;
  }
}

type Scope = { role: string | null; status: string | null; verified: AccountVerifiedFilter; term: string; rawSearch: string };

// .select() 이후 체인용
type PgQuery = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

function applyScope(q: PgQuery, scope: Scope): PgQuery {
  let r = q;
  if (scope.role) r = r.eq("role", scope.role);
  if (scope.status) r = r.eq("status", scope.status);
  if (scope.verified === "yes") r = r.not("identity_verified_at", "is", null);
  if (scope.verified === "no") r = r.is("identity_verified_at", null);
  if (scope.term) {
    const parts = [buildAdminUsersSearchOr(scope.term)];
    if (isUuidLike(scope.rawSearch)) parts.push(`id.eq.${scope.rawSearch.trim()}`);
    r = r.or(parts.join(","));
  }
  return r;
}

async function headCount(db: SupabaseClient, scope: Scope): Promise<number> {
  const { count, error } = await applyScope(db.from("users").select("id", { count: "exact", head: true }), scope);
  if (error) {
    console.error("[loadAccountList] head count 실패:", error.message);
    return 0;
  }
  return count ?? 0;
}

async function loadVerificationStatuses(db: SupabaseClient, mentorIds: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!mentorIds.length) return map;
  const { data, error } = await db.from("mentor_profiles").select("user_id, verification_status").in("user_id", [...mentorIds]);
  if (error) {
    console.error("[loadAccountList] mentor_profiles 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.user_id);
    if (id) map.set(id, str(row.verification_status));
  }
  return map;
}

/** 사용자별 마지막 감사 로그 시각 — `admin_action_logs.target_id` 기준(처리자 FK 인덱스 없음 — 80명 규모라 스캔으로 충분, DB 변경 금지). */
async function loadLastAdminLogAt(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const { data, error } = await db
    .from("admin_action_logs")
    .select("target_id, created_at")
    .in("target_id", [...ids])
    .order("created_at", { ascending: false })
    .limit(ADMIN_LOG_SCAN_LIMIT);
  if (error) {
    console.error("[loadAccountList] admin_action_logs 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.target_id);
    const at = strOrNull(row.created_at);
    if (id && at && !map.has(id)) map.set(id, at);
  }
  return map;
}

export async function loadAccountList(params: AdminListParams, filters: { role: AccountRoleTab; verified: AccountVerifiedFilter }): Promise<AccountListResult> {
  const db = serviceRoleOrNull();
  if (!db) return { rows: [], totalCount: 0, error: "서비스 키가 없어 계정 목록을 조회할 수 없습니다.", identityError: null };

  const term = normalizeAdminListSearchTerm(params.search);
  const scope: Scope = {
    role: accountRoleTabFilter(filters.role),
    status: isStatusActive(params.status) ? params.status : null,
    verified: filters.verified,
    term,
    rawSearch: params.search,
  };
  const { from, to } = rangeForPage(params);

  const q = applyScope(db.from("users").select(USER_COLUMNS, { count: "exact" }), scope);
  const r = await q.order("created_at", { ascending: false }).range(from, to);

  let rows: Row[] = [];
  let totalCount = 0;
  if (r.error) {
    if (!isRangeNotSatisfiable(r.error)) return { rows: [], totalCount: 0, error: r.error.message, identityError: null };
    totalCount = await headCount(db, scope);
  } else {
    rows = (r.data as Row[] | null) ?? [];
    totalCount = r.count ?? 0;
  }

  const ids = rows.map((row) => str(row.id)).filter(Boolean);
  const mentorIds = rows.filter((row) => str(row.role) === "mentor").map((row) => str(row.id)).filter(Boolean);
  const nameById = new Map<string, string>();
  for (const row of rows) nameById.set(str(row.id), str(row.full_name));

  const [verification, identity, lastLog] = await Promise.all([
    loadVerificationStatuses(db, mentorIds),
    loadIdentityKinds(ids, nameById),
    loadLastAdminLogAt(db, ids),
  ]);

  return {
    rows: rows.map((row) => {
      const id = str(row.id);
      const status = str(row.status) || "active";
      const suspendedUntil = strOrNull(row.suspended_until);
      const last = resolveAccountLastActivity({ updatedAt: strOrNull(row.updated_at), lastAdminLogAt: lastLog.get(id) ?? null });
      return {
        id,
        role: str(row.role),
        name: str(row.full_name) || str(row.nickname) || str(row.email) || id.slice(0, 8),
        email: strOrNull(row.email),
        nickname: strOrNull(row.nickname),
        status,
        effectiveStatus: effectiveAccountStatus({ status, suspended_until: suspendedUntil }),
        suspendedUntil,
        verificationStatus: verification.get(id) ?? null,
        identity: identity.byId.get(id) ?? null,
        createdAt: strOrNull(row.created_at),
        lastActivityAt: last.at,
        lastActivitySource: last.source,
      };
    }),
    totalCount,
    error: null,
    identityError: identity.error,
  };
}

/** 역할 탭 건수(head count 4회, 병렬). 실패한 탭은 0. */
export async function countAccountRoleTabs(): Promise<AccountRoleTabCounts> {
  const db = serviceRoleOrNull();
  const out = Object.fromEntries(ACCOUNT_ROLE_TAB_VALUES.map((t) => [t, 0])) as AccountRoleTabCounts;
  if (!db) return out;
  const entries = await Promise.all(
    ACCOUNT_ROLE_TAB_VALUES.map(async (tab) => {
      const count = await headCount(db, { role: accountRoleTabFilter(tab), status: null, verified: "all", term: "", rawSearch: "" });
      return [tab, count] as const;
    })
  );
  for (const [tab, count] of entries) out[tab] = count;
  return out;
}
