import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { effectiveAccountStatus, type EffectiveAccountStatus } from "@/lib/auth/accountStatus";
import { accountRoleLabel } from "@/lib/admin/accountSanctionPolicy";
import { accountActionLogReason, resolveAccountLastActivity, type AccountLastActivitySource } from "@/lib/admin/accountDetailConsole";
import { countMentorStudentRooms } from "@/lib/admin/mentorRoomCount";
import { loadIdentityReview } from "@/lib/admin/mentorApprovalWorkbenchQueries";
import type { MentorIdentityReview } from "@/lib/admin/mentorIdentityReview";

/**
 * 계정 상세(PR-7 §2) 공통 조회 — 역할 무관 헤더·조치 패널·처리 이력의 재료. 전부 service_role 읽기, 쓰기 없음.
 *
 * - `users` 한 행 + 신원 판정(PR-2 `loadIdentityReview` 그대로 — `identity_verifications` 는 정책 0개 테이블) + 활성 경고 수(`user_warnings`) +
 *   멘토면 담당 학생 수(`mentor_student_rooms`) + 최근 활동(감사 로그 vs `updated_at`).
 * - 처리 이력: 이 사용자가 **대상**인 `admin_action_logs`(멘토·학생) 또는 이 관리자가 **실행**한 로그(관리자 계정) — `loadAccountActionLogs`.
 */

const USER_COLUMNS =
  "id, role, status, full_name, nickname, email, grade_level, student_status, birth_date, created_at, updated_at, suspended_until, status_reason, status_changed_at, status_changed_by, identity_verified_at";
const ADMIN_LOG_COLUMNS = "id, admin_id, action_type, target_type, target_id, detail, created_at";

type Row = Record<string, unknown>;

export type AccountUserRow = {
  id: string;
  role: string;
  status: string;
  full_name: string | null;
  nickname: string | null;
  email: string | null;
  grade_level: string | null;
  student_status: string | null;
  birth_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  suspended_until: string | null;
  status_reason: string | null;
  status_changed_at: string | null;
  status_changed_by: string | null;
  identity_verified_at: string | null;
};

export type AccountActionLogEntry = {
  id: string;
  actionType: string;
  targetType: string | null;
  targetId: string | null;
  adminId: string | null;
  adminName: string | null;
  createdAt: string | null;
  /** detail 에서 뽑은 사유 한 줄(액션마다 키가 다르다) */
  reason: string | null;
};

export type AccountActionLogs = {
  rows: AccountActionLogEntry[];
  /** 조건에 맞는 전체 건수 — 못 읽었으면 null */
  totalCount: number | null;
  error: string | null;
};

export type AccountDetailBase = {
  user: AccountUserRow;
  displayName: string;
  roleLabel: string;
  effectiveStatus: EffectiveAccountStatus;
  identity: MentorIdentityReview | null;
  identityError: string | null;
  activeWarningCount: number | null;
  /** 멘토일 때 담당 학생 수 — 학생·관리자·조회 실패면 null */
  mentorRoomCount: number | null;
  statusChangedByName: string | null;
  lastActivity: { at: string | null; source: AccountLastActivitySource | null };
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export function serviceRoleOrNull(): SupabaseClient | null {
  try {
    return createServiceRoleClient();
  } catch {
    return null;
  }
}

export const ACCOUNT_READ_UNAVAILABLE_MESSAGE = "서비스 키가 없어 계정 정보를 조회할 수 없습니다.";

export function accountDisplayName(row: Pick<AccountUserRow, "full_name" | "nickname" | "email" | "id">): string {
  return str(row.full_name) || str(row.nickname) || str(row.email) || row.id.slice(0, 8);
}

export async function loadUserNamesByIds(db: SupabaseClient, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.map((v) => str(v)).filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await db.from("users").select("id, full_name, nickname, email").in("id", unique);
  if (error) {
    console.error("[accountDetail] users 이름 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.id);
    if (!id) continue;
    map.set(id, str(row.full_name) || str(row.nickname) || str(row.email) || id.slice(0, 8));
  }
  return map;
}

async function countActiveWarnings(db: SupabaseClient, userId: string): Promise<number | null> {
  const { count, error } = await db.from("user_warnings").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_active", true);
  if (error) {
    console.error("[accountDetail] user_warnings:", error.message);
    return null;
  }
  return count ?? 0;
}

async function loadLastAdminLogAt(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await db
    .from("admin_action_logs")
    .select("created_at")
    .eq("target_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[accountDetail] admin_action_logs(last):", error.message);
    return null;
  }
  return strOrNull((data as Row | null)?.created_at);
}

/**
 * 처리 이력 — `by: "target"` 이면 이 사용자를 대상으로 한 로그(target_id), `by: "admin"` 이면 이 관리자가 실행한 로그(admin_id).
 * 최근 `limit` 건 + 전체 건수(더 보기 판단용).
 */
export async function loadAccountActionLogs(db: SupabaseClient, userId: string, opts: { by: "target" | "admin"; limit: number }): Promise<AccountActionLogs> {
  const column = opts.by === "admin" ? "admin_id" : "target_id";
  const { data, error, count } = await db
    .from("admin_action_logs")
    .select(ADMIN_LOG_COLUMNS, { count: "exact" })
    .eq(column, userId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, opts.limit));
  if (error) {
    console.error("[accountDetail] admin_action_logs:", error.message);
    return { rows: [], totalCount: null, error: "처리 이력을 불러오지 못했습니다." };
  }
  const raw = (data as Row[] | null) ?? [];
  const names = await loadUserNamesByIds(db, raw.map((r) => str(r.admin_id)));
  return {
    rows: raw.map((r) => {
      const adminId = strOrNull(r.admin_id);
      return {
        id: str(r.id),
        actionType: str(r.action_type),
        targetType: strOrNull(r.target_type),
        targetId: strOrNull(r.target_id),
        adminId,
        adminName: adminId ? (names.get(adminId) ?? null) : null,
        createdAt: strOrNull(r.created_at),
        reason: accountActionLogReason(r.detail),
      };
    }),
    totalCount: count ?? raw.length,
    error: null,
  };
}

export async function loadAccountDetailBase(db: SupabaseClient, userId: string): Promise<{ base: AccountDetailBase | null; error: string | null }> {
  const id = str(userId);
  if (!id) return { base: null, error: null };
  const { data, error } = await db.from("users").select(USER_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[accountDetail] users:", error.message);
    return { base: null, error: "계정 정보를 불러오지 못했습니다." };
  }
  const row = data as AccountUserRow | null;
  if (!row) return { base: null, error: null };

  const role = str(row.role);
  const registeredName = str(row.full_name);
  const [identity, activeWarningCount, mentorRoomCount, lastAdminLogAt, names] = await Promise.all([
    loadIdentityReview(id, registeredName),
    countActiveWarnings(db, id),
    role === "mentor" ? countMentorStudentRooms(db, id) : Promise.resolve(null),
    loadLastAdminLogAt(db, id),
    loadUserNamesByIds(db, [row.status_changed_by]),
  ]);

  const status = str(row.status) || "active";
  return {
    base: {
      user: row,
      displayName: accountDisplayName(row),
      roleLabel: accountRoleLabel(role),
      effectiveStatus: effectiveAccountStatus({ status, suspended_until: row.suspended_until }),
      identity: identity.review,
      identityError: identity.error,
      activeWarningCount,
      mentorRoomCount,
      statusChangedByName: row.status_changed_by ? (names.get(row.status_changed_by) ?? null) : null,
      lastActivity: resolveAccountLastActivity({ updatedAt: row.updated_at, lastAdminLogAt }),
    },
    error: null,
  };
}
