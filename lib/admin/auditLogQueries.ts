import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { ADMIN_LIST_SEARCH_USER_ID_LIMIT, buildAdminUsersSearchOr } from "@/lib/admin/adminDataTable";
import { rangeForPage, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  AUDIT_LOG_PERSON_TARGET_TYPES,
  AUDIT_LOG_SYSTEM_ACTOR,
  auditLogActionTypesFilter,
  auditLogPeriodStartIso,
  auditLogSearchScope,
  buildAuditLogItem,
  type AuditLogFilters,
  type AuditLogItem,
} from "@/lib/admin/auditLogConsole";

/**
 * 관리자 · 감사 로그(PR-10 §2) 서버 조회 — **조회 전용**(`admin_action_logs` select 만 · 쓰기 없음).
 * `admin_action_logs` 는 관리자 SELECT RLS 가 있어 세션으로 읽히지만, 실행자·대상 이름표(`users`)는 관리자 RLS SELECT 가 없어
 * service_role 로 읽는다(PR-7 계정 목록과 같은 경로 · 이중 requireRole admin 가드 뒤). 키가 없으면 이름 없이 id 앞 8자로 그린다.
 */

type Row = Record<string, unknown>;

const LOG_COLUMNS = "id, admin_id, action_type, target_type, target_id, detail, created_at";
const USER_NAME_COLUMNS = "id, full_name, nickname, email";

export type AuditLogListResult = { rows: AuditLogItem[]; totalCount: number; error: string | null };
export type AuditLogAdminOption = { id: string; name: string; email: string | null };

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

function displayName(row: Row): string {
  return str(row.full_name) || str(row.nickname) || str(row.email) || `${str(row.id).slice(0, 8)}…`;
}

/** 실행자 필터 옵션 + 이름표 — `users.role = 'admin'` 전부(현행 3명). */
export async function loadAuditLogAdmins(session: SupabaseClient): Promise<AuditLogAdminOption[]> {
  const db = serviceRoleOrNull() ?? session;
  const { data, error } = await db.from("users").select(USER_NAME_COLUMNS).eq("role", "admin").order("created_at", { ascending: true });
  if (error) {
    console.error("[auditLog] 관리자 목록 조회 실패:", error.message);
    return [];
  }
  return ((data as Row[] | null) ?? [])
    .map((r) => ({ id: str(r.id), name: displayName(r), email: strOrNull(r.email) }))
    .filter((a) => a.id);
}

async function loadUserNames(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await db.from("users").select(USER_NAME_COLUMNS).in("id", unique);
  if (error) {
    console.error("[auditLog] users 이름 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.id);
    if (id) map.set(id, displayName(row));
  }
  return map;
}

async function searchTargetUserIds(db: SupabaseClient, term: string): Promise<string[]> {
  const { data, error } = await db.from("users").select("id").or(buildAdminUsersSearchOr(term)).limit(ADMIN_LIST_SEARCH_USER_ID_LIMIT);
  if (error) {
    console.error("[auditLog] 대상 검색(users) 실패:", error.message);
    return [];
  }
  return ((data as Row[] | null) ?? []).map((r) => str(r.id)).filter(Boolean);
}

/** 전체 건수(필터 없음) — `N / M` 의 M */
export async function countAuditLogTotal(session: SupabaseClient): Promise<number> {
  const db = serviceRoleOrNull() ?? session;
  const { count, error } = await db.from("admin_action_logs").select("id", { count: "exact", head: true });
  if (error) {
    console.error("[auditLog] 전체 건수 조회 실패:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function loadAuditLogList(
  session: SupabaseClient,
  params: AdminListParams,
  filters: AuditLogFilters,
  nowIso: string
): Promise<AuditLogListResult> {
  const db = serviceRoleOrNull() ?? session;
  const scope = auditLogSearchScope(params.search);
  let targetIds: string[] | null = null;
  if (scope.kind === "uuid") targetIds = [scope.id];
  else if (scope.kind === "users") {
    targetIds = await searchTargetUserIds(db, scope.term);
    if (targetIds.length === 0) return { rows: [], totalCount: 0, error: null };
  }

  const { include, exclude } = auditLogActionTypesFilter(filters);
  const since = auditLogPeriodStartIso(filters.period, nowIso);
  const { from, to } = rangeForPage(params);

  let q = db.from("admin_action_logs").select(LOG_COLUMNS, { count: "exact" });
  if (filters.actor === AUDIT_LOG_SYSTEM_ACTOR) q = q.is("admin_id", null);
  else if (filters.actor) q = q.eq("admin_id", filters.actor);
  if (include) q = q.in("action_type", include);
  if (exclude) q = q.neq("action_type", exclude);
  if (since) q = q.gte("created_at", since);
  if (targetIds) q = q.in("target_id", targetIds);

  const { data, error, count } = await q.order("created_at", { ascending: false }).range(from, to);
  if (error) {
    if (isRangeNotSatisfiable(error)) return { rows: [], totalCount: count ?? 0, error: null };
    console.error("[auditLog] admin_action_logs 조회 실패:", error.message);
    return { rows: [], totalCount: 0, error: "감사 로그를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  const raw = ((data as Row[] | null) ?? []).map((r) => ({
    id: str(r.id),
    createdAt: strOrNull(r.created_at),
    actorId: strOrNull(r.admin_id),
    actionType: str(r.action_type),
    targetType: strOrNull(r.target_type),
    targetId: strOrNull(r.target_id),
    detail: r.detail,
  }));

  const adminIds = raw.map((r) => r.actorId ?? "").filter(Boolean);
  const personIds = raw.filter((r) => r.targetType && AUDIT_LOG_PERSON_TARGET_TYPES.includes(r.targetType)).map((r) => r.targetId ?? "").filter(Boolean);
  const names = await loadUserNames(db, [...adminIds, ...personIds]);

  return {
    rows: raw.filter((r) => r.id).map((r) => buildAuditLogItem(r, { admins: names, users: names })),
    totalCount: count ?? raw.length,
    error: null,
  };
}
