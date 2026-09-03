import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/admin";

// PR-7: 구 계정 목록 조회(loadAdminUsersListPaged · countAdminUsersByStatus · AdminUserRow)는 `accountListQueries.ts` 로 대체돼 삭제했다.
// 이 파일에는 계정 목록 하단의 읽기 전용 참고(사용자 차단 현황 · 회원 탈퇴 로그)만 남는다.

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
