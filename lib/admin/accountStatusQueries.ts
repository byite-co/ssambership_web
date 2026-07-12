import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/admin";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { rangeForPage, isStatusActive } from "@/lib/admin/adminListParams";

export type AdminUserRow = {
  id: string;
  role: string;
  status: string;
  full_name: string | null;
  nickname: string | null;
  email: string | null;
  suspended_until: string | null;
  status_reason: string | null;
  status_changed_at: string | null;
  created_at: string | null;
  warning_count?: number;
};

/** 주어진 user id 들의 활성 경고 수를 맵으로 반환(테이블 미적용 시 빈 맵). */
async function activeWarningCounts(
  admin: ReturnType<typeof createServiceRoleClient>,
  userIds: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!userIds.length) return map;
  try {
    const { data, error } = await admin
      .from("user_warnings")
      .select("user_id")
      .in("user_id", userIds)
      .eq("is_active", true);
    if (error) return map;
    for (const r of (data as Array<{ user_id?: string }>) ?? []) {
      const id = r.user_id ? String(r.user_id) : "";
      if (id) map.set(id, (map.get(id) ?? 0) + 1);
    }
  } catch {
    /* table not present */
  }
  return map;
}

export type AdminUsersPaged = {
  rows: AdminUserRow[];
  totalCount: number;
  error: string | null;
};

const SELECT =
  "id, role, status, full_name, nickname, email, suspended_until, status_reason, status_changed_at, created_at";

/** 관리자 계정 목록 — 서비스 롤로 전체 사용자 조회(검색·상태필터·페이지네이션). */
export async function loadAdminUsersListPaged(params: AdminListParams): Promise<AdminUsersPaged> {
  let admin;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    return { rows: [], totalCount: 0, error: e instanceof Error ? e.message : "서비스 키 오류" };
  }

  const { from, to } = rangeForPage(params);
  let q = admin.from("users").select(SELECT, { count: "exact" });

  if (isStatusActive(params.status)) {
    q = q.eq("status", params.status);
  }
  if (params.search) {
    const s = params.search.replace(/[%,]/g, " ").trim();
    if (s) {
      q = q.or(
        [`email.ilike.%${s}%`, `nickname.ilike.%${s}%`, `full_name.ilike.%${s}%`, `id.eq.${s}`]
          .join(",")
      );
    }
  }

  const { data, error, count } = await q
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    // id.eq 가 UUID 가 아니면 실패할 수 있음 — id 조건 제거 후 재시도
    if (params.search) {
      const s = params.search.replace(/[%,]/g, " ").trim();
      let q2 = admin.from("users").select(SELECT, { count: "exact" });
      if (isStatusActive(params.status)) q2 = q2.eq("status", params.status);
      q2 = q2.or([`email.ilike.%${s}%`, `nickname.ilike.%${s}%`, `full_name.ilike.%${s}%`].join(","));
      const retry = await q2.order("created_at", { ascending: false }).range(from, to);
      if (!retry.error) {
        return {
          rows: (retry.data as AdminUserRow[]) ?? [],
          totalCount: retry.count ?? 0,
          error: null,
        };
      }
    }
    return { rows: [], totalCount: 0, error: error.message };
  }

  const rows = (data as AdminUserRow[]) ?? [];
  const warnMap = await activeWarningCounts(admin, rows.map((r) => r.id));
  for (const r of rows) r.warning_count = warnMap.get(r.id) ?? 0;
  return { rows, totalCount: count ?? 0, error: null };
}

export async function countAdminUsersByStatus(): Promise<Record<string, number>> {
  const out: Record<string, number> = { active: 0, suspended: 0, banned: 0, all: 0 };
  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return out;
  }
  const statuses = ["active", "suspended", "banned"] as const;
  await Promise.all(
    statuses.map(async (st) => {
      const { count } = await admin
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("status", st);
      out[st] = count ?? 0;
    })
  );
  const { count: all } = await admin.from("users").select("id", { count: "exact", head: true });
  out.all = all ?? 0;
  return out;
}

/* ── 신설 기능 조회(읽기 전용): 사용자 차단 · 회원 탈퇴 로그 ─────────────── */

export type AdminUserBlockRow = {
  blockerId: string;
  blockedId: string;
  blockerNickname: string | null;
  blockedNickname: string | null;
  createdAt: string | null;
};

export type AdminDeletionLogRow = {
  userId: string;
  nickname: string | null;
  reason: string | null;
  requestedAt: string | null;
};

async function nicknameMap(
  admin: ReturnType<typeof createServiceRoleClient>,
  ids: string[]
): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const { data } = await admin.from("users").select("id, nickname").in("id", uniq);
  const m = new Map<string, string>();
  for (const r of data ?? []) {
    if (typeof r.id === "string" && typeof r.nickname === "string") m.set(r.id, r.nickname);
  }
  return m;
}

/** 사용자 차단 현황 — 최근 limit건 + 총 건수. 실패 시 빈 결과(화면 비파괴). */
export async function loadRecentUserBlocks(
  limit = 10
): Promise<{ rows: AdminUserBlockRow[]; totalCount: number; ok: boolean }> {
  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return { rows: [], totalCount: 0, ok: false };
  }
  const { data, error, count } = await admin
    .from("user_blocks")
    .select("blocker_id, blocked_id, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], totalCount: 0, ok: false };
  const raw = (data ?? []) as Array<Record<string, unknown>>;
  const ids = raw.flatMap((r) => [String(r.blocker_id ?? ""), String(r.blocked_id ?? "")]);
  const names = await nicknameMap(admin, ids);
  const rows: AdminUserBlockRow[] = raw.map((r) => {
    const blockerId = String(r.blocker_id ?? "");
    const blockedId = String(r.blocked_id ?? "");
    return {
      blockerId,
      blockedId,
      blockerNickname: names.get(blockerId) ?? null,
      blockedNickname: names.get(blockedId) ?? null,
      createdAt: typeof r.created_at === "string" ? r.created_at : null,
    };
  });
  return { rows, totalCount: count ?? rows.length, ok: true };
}

/** 회원 탈퇴 로그 — 최근 limit건 + 총 건수. 탈퇴자는 익명화되어 닉네임이 없을 수 있음. */
export async function loadRecentDeletionLogs(
  limit = 10
): Promise<{ rows: AdminDeletionLogRow[]; totalCount: number; ok: boolean }> {
  let admin;
  try {
    admin = createServiceRoleClient();
  } catch {
    return { rows: [], totalCount: 0, ok: false };
  }
  const { data, error, count } = await admin
    .from("user_deletion_log")
    .select("user_id, reason, requested_at", { count: "exact" })
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (error) return { rows: [], totalCount: 0, ok: false };
  const raw = (data ?? []) as Array<Record<string, unknown>>;
  const names = await nicknameMap(
    admin,
    raw.map((r) => String(r.user_id ?? ""))
  );
  const rows: AdminDeletionLogRow[] = raw.map((r) => {
    const userId = String(r.user_id ?? "");
    return {
      userId,
      nickname: names.get(userId) ?? null,
      reason: typeof r.reason === "string" ? r.reason : null,
      requestedAt: typeof r.requested_at === "string" ? r.requested_at : null,
    };
  });
  return { rows, totalCount: count ?? rows.length, ok: true };
}
