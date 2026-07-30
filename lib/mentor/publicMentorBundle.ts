import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMentorProfileForPublicMentor, getMentorUserPublic } from "@/lib/auth/mentorPublicRead";
import { fetchMentorMediaSample } from "@/lib/mentor/mentorProfileQueries";
import type { UserRow } from "@/lib/types/user";

type Row = Record<string, unknown>;

// W4(C10): REVIEW_TABLES/REVIEW_FK/PLAN_TABLES/PLAN_FK 후보 배열·프로빙 루프 제거 —
// 정본은 public.reviews(mentor_id)와 public.mentor_plans(mentor_id) 단일 테이블(187 baseline 실측).

export type MentorReviewsSummary = {
  count: number | null;
  avgRating: number | null;
  table: string | null;
  probe: string;
  error: string | null;
};

export type MentorPlansLoad = {
  rows: Row[];
  table: string | null;
  probe: string;
  error: string | null;
};

export type PublicMentorLoadResult =
  | {
      kind: "ok";
      userRow: UserRow;
      userError: string | null;
      reviews: MentorReviewsSummary;
      plans: MentorPlansLoad;
      media: { rows: Row[]; table: string | null; error: string | null; probe: string };
      profileRow: Row | null;
      profileError: string | null;
    }
  | {
      kind: "not_found";
      message: string;
    }
  | {
      kind: "not_mentor";
      message: string;
    };

/**
 * W4(C10): 후보 테이블/컬럼 프로빙·client 집계 폴백 제거 — 정본 서버 집계 RPC
 * public.get_mentor_review_stats(p_mentor_id, p_include_hidden=false) 단일 호출로 고정
 * (hidden/blinded 제외 · 500 cap 없음 · 187 baseline 실측: reviews.mentor_id/rating/is_hidden/is_blinded).
 * RPC 오류는 폴백 없이 error 필드로 표면화한다.
 */
export async function fetchReviewsSummary(
  supabase: SupabaseClient,
  mentorId: string
): Promise<MentorReviewsSummary> {
  const { data: statsData, error: rpcErr } = await supabase.rpc("get_mentor_review_stats", {
    p_mentor_id: mentorId,
    p_include_hidden: false,
  });
  if (rpcErr) {
    return {
      count: null,
      avgRating: null,
      table: null,
      probe: `get_mentor_review_stats: ${rpcErr.message}`,
      error: rpcErr.message,
    };
  }
  const stats = (Array.isArray(statsData) ? statsData[0] : statsData) as
    | { review_count?: number | null; avg_rating?: number | string | null }
    | null
    | undefined;
  const rpcCount = Number(stats?.review_count);
  const rpcAvgRaw = stats?.avg_rating;
  const rpcAvg =
    rpcAvgRaw == null ? null : typeof rpcAvgRaw === "number" ? rpcAvgRaw : Number(rpcAvgRaw);
  return {
    count: Number.isFinite(rpcCount) ? rpcCount : 0,
    avgRating: rpcAvg != null && Number.isFinite(rpcAvg) ? rpcAvg : null,
    table: "reviews",
    probe: "reviews.mentor_id 서버 집계 RPC(get_mentor_review_stats · hidden/blinded 제외 · 500 cap 없음)",
    error: null,
  };
}

/**
 * 멘토별 플랜 조회 · 구독/결제 진입에서 재사용(실차감액 소스).
 * W4(C10): 4테이블×4FK 프로빙과 FK 미상 시 상위 12행(타 멘토 행 혼입 위험) 폴백 제거 —
 * 정본 public.mentor_plans(mentor_id, plan_tier, amount_cents, label) 단일 쿼리로 고정(187 baseline 실측).
 * 쿼리 오류는 폴백 없이 error 필드로 표면화한다(호출부 plans.error 검사 기존 동작 유지).
 */
export async function fetchPlansForMentor(
  supabase: SupabaseClient,
  mentorId: string
): Promise<MentorPlansLoad> {
  const { data, error } = await supabase
    .from("mentor_plans")
    .select("*")
    .eq("mentor_id", mentorId)
    .limit(12);
  if (error) {
    return {
      rows: [],
      table: "mentor_plans",
      probe: `mentor_plans.mentor_id: ${error.message}`,
      error: error.message,
    };
  }
  return {
    rows: (data as Row[]) ?? [],
    table: "mentor_plans",
    probe: "mentor_plans.mentor_id · 최대 12행",
    error: null,
  };
}

/**
 * 공개 멘토 상세: users + mentor_profiles + 미디어 + reviews/plans probe (더미 없음).
 */
export async function loadPublicMentorBundle(
  supabase: SupabaseClient,
  mentorId: string
): Promise<PublicMentorLoadResult> {
  const { data: userRow, error: userErr } = await getMentorUserPublic(supabase, mentorId);
  if (!userRow) {
    return {
      kind: "not_found",
      message: userErr?.message ?? "해당 사용자를 찾을 수 없습니다.",
    };
  }
  if (userRow.role !== "mentor") {
    return { kind: "not_mentor", message: "멘토 공개 프로필만 이 경로에서 표시합니다." };
  }

  const [{ row: profileRow, error: profileError }, media, reviews, plans] = await Promise.all([
    fetchMentorProfileForPublicMentor(supabase, mentorId),
    fetchMentorMediaSample(supabase, mentorId, 12),
    fetchReviewsSummary(supabase, mentorId),
    fetchPlansForMentor(supabase, mentorId),
  ]);

  const mediaProbe = media.table
    ? `${media.table} · ${media.rows.length}행`
    : "미디어 테이블 probe 실패";

  return {
    kind: "ok",
    userRow,
    userError: userErr?.message ?? null,
    profileRow,
    profileError: profileError,
    media: { ...media, probe: mediaProbe },
    reviews,
    plans,
  };
}
