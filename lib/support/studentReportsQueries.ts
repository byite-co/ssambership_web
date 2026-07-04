import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * W-06: 학생 "내 신고 내역" 조회.
 * 보안: service-role을 쓰지 않는다 — RLS `content_reports_select_reporter`(032)가
 * `reporter_id = auth.uid()` 를 DB에서 강제하므로 사용자 세션 클라이언트 조회만으로
 * 타계정 신고 노출이 구조적으로 불가능하다. `.eq("reporter_id", userId)` 는
 * 명시성·인덱스 활용을 위한 이중 필터(서버측 세션 user.id 고정, 클라이언트 입력 미개입).
 */

export type StudentContentReportRow = {
  id: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  description: string | null;
  status: string;
  createdAt: string | null;
  resolvedAt: string | null;
};

export async function loadMyContentReports(
  supabase: SupabaseClient,
  userId: string,
  limit = 50
): Promise<{ rows: StudentContentReportRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("content_reports")
    .select("id, target_type, target_id, reason, description, status, created_at, resolved_at")
    .eq("reporter_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return { rows: [], error: error.message };

  const rows: StudentContentReportRow[] = (data ?? []).map((r) => ({
    id: String(r.id),
    targetType: String(r.target_type ?? ""),
    targetId: r.target_id ? String(r.target_id) : null,
    reason: typeof r.reason === "string" ? r.reason : null,
    description: typeof r.description === "string" ? r.description : null,
    status: String(r.status ?? "pending"),
    createdAt: typeof r.created_at === "string" ? r.created_at : null,
    resolvedAt: typeof r.resolved_at === "string" ? r.resolved_at : null,
  }));
  return { rows, error: null };
}

/** 신고 상태(032 CHECK: pending/reviewing/resolved/rejected/dismissed) → 표시 라벨·톤 */
export function reportStatusDisplay(status: string): { label: string; tone: "pending" | "done" | "muted" } {
  const s = status.toLowerCase();
  if (s === "resolved") return { label: "처리 완료", tone: "done" };
  if (s === "reviewing") return { label: "검토 중", tone: "pending" };
  if (s === "rejected" || s === "dismissed") return { label: "반려", tone: "muted" };
  return { label: "접수됨", tone: "pending" };
}

/** 신고 대상 유형 → 한국어 라벨 (관대한 매칭 — free-form 방어) */
export function reportTargetTypeLabel(targetType: string): string {
  const t = targetType.toLowerCase();
  if (t.includes("shortform") || t.includes("short")) return "숏폼";
  if (t.includes("comment")) return "댓글";
  if (t.includes("post") || t.includes("community")) return "게시글";
  if (t.includes("review")) return "리뷰";
  if (t.includes("message")) return "메시지";
  return targetType || "콘텐츠";
}
