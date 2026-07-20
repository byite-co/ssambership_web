import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMentorProfileForPublicMentor, getMentorUserPublic } from "@/lib/auth/mentorPublicRead";
import { fetchMentorMediaSample } from "@/lib/mentor/mentorProfileQueries";
import { probePublicReviewVisibilityColumns } from "@/lib/mentor/publicReviewVisibility";
import { pickExistingColumn, rowsFromSupabaseData } from "@/lib/qna/safeSelect";
import type { UserRow } from "@/lib/types/user";

type Row = Record<string, unknown>;

const REVIEW_TABLES = ["reviews", "mentor_reviews", "subscription_reviews"] as const;
const REVIEW_FK = ["mentor_id", "mentor_user_id", "reviewee_id", "to_user_id", "target_user_id"] as const;

const PLAN_TABLES = ["plans", "mentor_plans", "subscription_plans", "mentor_subscription_plans"] as const;
const PLAN_FK = ["mentor_id", "mentor_user_id", "user_id", "owner_id"] as const;

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

export async function fetchReviewsSummary(
  supabase: SupabaseClient,
  mentorId: string
): Promise<MentorReviewsSummary> {
  let lastProbe = "reviews 계열 테이블 없음 또는 RLS";
  for (const table of REVIEW_TABLES) {
    const { error: pe } = await supabase.from(table).select("id").limit(1);
    if (pe) {
      lastProbe = `${table}: ${pe.message}`;
      continue;
    }
    const { column, error: cErr } = await pickExistingColumn(supabase, table, REVIEW_FK);
    const vis = await probePublicReviewVisibilityColumns(supabase, table);

    // P3-2: 'reviews' 정본 테이블은 서버 집계 RPC(get_mentor_review_stats)로 count·avg 를 얻는다.
    //   → 최대 500건 client cap 없이 hidden/blinded 제외 집계(include_hidden=false). SECURITY DEFINER·
    //   집계값만 반환. RPC 부재/오류 시 아래 기존 count(exact)+평균 폴백으로 진행(무회귀).
    if (table === "reviews" && column === "mentor_id") {
      const { data: statsData, error: rpcErr } = await supabase.rpc("get_mentor_review_stats", {
        p_mentor_id: mentorId,
        p_include_hidden: false,
      });
      if (!rpcErr) {
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
          table,
          probe: "reviews.mentor_id 서버 집계 RPC(get_mentor_review_stats · hidden/blinded 제외 · 500 cap 없음)",
          error: null,
        };
      }
    }

    let count: number | null = null;
    let avgRating: number | null = null;
    let error: string | null = cErr;
    if (column) {
      let countQ = supabase.from(table).select("*", { count: "exact", head: true }).eq(column, mentorId);
      if (vis.isHidden) countQ = countQ.eq(vis.isHidden, false);
      if (vis.isBlinded) countQ = countQ.eq(vis.isBlinded, false);
      const { count: c, error: e1 } = await countQ;
      if (e1) error = e1.message;
      else count = c ?? 0;
      const { column: ratingCol } = await pickExistingColumn(supabase, table, ["rating", "score", "stars"]);
      if (ratingCol && !error) {
        let rateQ = supabase.from(table).select(ratingCol).eq(column, mentorId).limit(500);
        if (vis.isHidden) rateQ = rateQ.eq(vis.isHidden, false);
        if (vis.isBlinded) rateQ = rateQ.eq(vis.isBlinded, false);
        const { data, error: e2 } = await rateQ;
        if (!e2 && data?.length) {
          const rows = rowsFromSupabaseData(data) as Row[];
          const nums = rows
            .map((r) => r[ratingCol])
            .filter((v): v is number => typeof v === "number");
          if (nums.length) {
            avgRating = nums.reduce((a, b) => a + b, 0) / nums.length;
          }
        } else if (e2) {
          error = e2.message;
        }
      }
    } else {
      let fullCountQ = supabase.from(table).select("*", { count: "exact", head: true });
      if (vis.isHidden) fullCountQ = fullCountQ.eq(vis.isHidden, false);
      if (vis.isBlinded) fullCountQ = fullCountQ.eq(vis.isBlinded, false);
      const { count: c, error: e3 } = await fullCountQ;
      if (e3) error = e3.message;
      else count = c ?? null;
    }
    return {
      count,
      avgRating,
      table,
      probe: column
        ? `${table}.${column} 기준 집계(reviews_summary 뷰는 미사용)`
        : `${table}: 멘토 FK 컬럼 없음 — 전체 카운트만`,
      error,
    };
  }
  return { count: null, avgRating: null, table: null, probe: lastProbe, error: null };
}

/** 멘토별 plans 계열 · 구독/결제 진입에서 재사용 */
export async function fetchPlansForMentor(
  supabase: SupabaseClient,
  mentorId: string
): Promise<MentorPlansLoad> {
  let probe = "plans 계열 테이블 없음 또는 RLS";
  for (const table of PLAN_TABLES) {
    const { error: pe } = await supabase.from(table).select("id").limit(1);
    if (pe) {
      probe = `${table}: ${pe.message}`;
      continue;
    }
    const { column, error: cErr } = await pickExistingColumn(supabase, table, PLAN_FK);
    if (!column) {
      const { data, error } = await supabase.from(table).select("*").limit(12);
      if (error) return { rows: [], table, probe: `${table}: FK 미상 · ${error.message}`, error: error.message };
      return {
        rows: (data as Row[]) ?? [],
        table,
        probe: `${table}: 멘토 FK 없이 상위 12행(스키마 확정 후 eq)`,
        error: cErr,
      };
    }
    const { data, error } = await supabase.from(table).select("*").eq(column, mentorId).limit(12);
    if (error) {
      probe = `${table}.${column}: ${error.message}`;
      continue;
    }
    return {
      rows: (data as Row[]) ?? [],
      table,
      probe: `${table}.${column} · 최대 12행`,
      error: null,
    };
  }
  return { rows: [], table: null, probe, error: null };
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
