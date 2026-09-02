import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveAccountStatus } from "@/lib/auth/accountStatus";
import { countMentorStudentRooms } from "@/lib/admin/mentorRoomCount";
import { accountRoleLabel } from "@/lib/admin/accountSanctionPolicy";
import type { ContentReportTargetUser } from "@/lib/admin/contentReportSanctionConsole";

/**
 * 신고 상세 — 신고당한 사용자 블록(PR-6 §1-3) 조회. 신고 대상 콘텐츠의 작성자(`AdminReportEvidence.authorId`)를 받아
 * 이름·역할·가입일·계정 상태(users) · 누적 경고(user_warnings 활성) · 이전 신고 건수(이 사용자의 글·숏폼·댓글을 대상으로 한 다른 신고) ·
 * 멘토면 담당 학생 수(mentor_student_rooms)를 모은다.
 *
 * 클라이언트는 신고 상세가 증거 조회에 쓰는 것(service_role 우선 · 세션 폴백)을 그대로 받는다 — `user_warnings` 는 정책이 없어(잠금)
 * 세션 폴백에서는 읽히지 않으며 그때는 null(횟수 미확인)로 표시한다. 조회 실패는 각 항목 null 로 열화하고 로그를 남긴다.
 */

type Row = Record<string, unknown>;

const USER_COLUMNS = "id, role, status, full_name, nickname, email, created_at, suspended_until, status_reason";
/** 작성자 콘텐츠 id 수집 상한(테이블당) — 넘으면 이전 신고 건수는 하한이다 */
const AUTHOR_CONTENT_ID_LIMIT = 200;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function countActiveWarnings(client: SupabaseClient, userId: string): Promise<number | null> {
  const { count, error } = await client.from("user_warnings").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_active", true);
  if (error) {
    console.error("[loadContentReportTargetUser] user_warnings:", error.message);
    return null;
  }
  return count ?? 0;
}

async function authorContentIds(client: SupabaseClient, authorId: string): Promise<string[]> {
  const tables = ["community_posts", "shortform_posts", "comments", "community_comments"] as const;
  const results = await Promise.all(
    tables.map(async (table) => {
      const { data, error } = await client.from(table).select("id").eq("author_id", authorId).limit(AUTHOR_CONTENT_ID_LIMIT);
      if (error) {
        console.error(`[loadContentReportTargetUser] ${table}:`, error.message);
        return [] as string[];
      }
      return ((data as { id?: unknown }[] | null) ?? []).map((r) => str(r.id)).filter(Boolean);
    })
  );
  return [...new Set(results.flat())];
}

async function countPreviousReports(client: SupabaseClient, authorId: string, excludeReportId: string): Promise<number | null> {
  const ids = await authorContentIds(client, authorId);
  if (!ids.length) return 0;
  let q = client.from("content_reports").select("id", { count: "exact", head: true }).in("target_id", ids);
  if (excludeReportId) q = q.neq("id", excludeReportId);
  const { count, error } = await q;
  if (error) {
    console.error("[loadContentReportTargetUser] content_reports:", error.message);
    return null;
  }
  return count ?? 0;
}

export async function loadContentReportTargetUser(
  client: SupabaseClient,
  authorId: string,
  opts: { excludeReportId: string }
): Promise<ContentReportTargetUser | null> {
  const id = str(authorId);
  if (!id) return null;
  const { data, error } = await client.from("users").select(USER_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[loadContentReportTargetUser] users:", error.message);
    return null;
  }
  const row = data as Row | null;
  if (!row) return null;

  const role = str(row.role);
  const [activeWarningCount, previousReportCount, mentorRoomCount] = await Promise.all([
    countActiveWarnings(client, id),
    countPreviousReports(client, id, str(opts.excludeReportId)),
    role === "mentor" ? countMentorStudentRooms(client, id) : Promise.resolve(null),
  ]);

  const status = str(row.status) || "active";
  const suspendedUntil = typeof row.suspended_until === "string" ? row.suspended_until : null;
  return {
    id,
    name: str(row.full_name) || str(row.nickname) || str(row.email) || id.slice(0, 8),
    email: str(row.email) || null,
    role,
    roleLabel: accountRoleLabel(role),
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    status,
    effectiveStatus: effectiveAccountStatus({ status, suspended_until: suspendedUntil }),
    suspendedUntil,
    statusReason: str(row.status_reason) || null,
    activeWarningCount,
    previousReportCount,
    mentorRoomCount,
  };
}
