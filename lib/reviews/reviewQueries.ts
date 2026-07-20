import type { SupabaseClient } from "@supabase/supabase-js";
import { pickExistingColumn } from "@/lib/qna/safeSelect";
import { checkReviewEligibility } from "@/lib/reviews/checkReviewEligibility";
import { formatGradeSubject, maskStudentName } from "@/lib/reviews/reviewDisplay";
import { isPubliclyVisibleReview, mapReviewDbRow, type ReviewDbRow } from "@/lib/reviews/reviewRowMapper";
import { maskContactInUserText } from "@/lib/safety/trustSafetyText";

export type ReviewCardItem = {
  id: string;
  rating: number;
  content: string;
  createdAt: string;
  subscriptionCount: number;
  studentInitial: string;
  studentMaskedName: string;
  gradeSubject: string;
  mentorReply: string | null;
  mentorRepliedAt: string | null;
};

export type ReviewListResult = {
  items: ReviewCardItem[];
  total: number;
  page: number;
  limit: number;
  avgRating: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
};

type UserMini = {
  full_name: string | null;
  nickname: string | null;
  grade_level: string | null;
};

function applyPublicFilters<T extends { eq: (col: string, val: boolean) => T }>(q: T): T {
  return q.eq("is_hidden", false).eq("is_blinded", false);
}

async function loadAuthorsMap(supabase: SupabaseClient, ids: string[]): Promise<Map<string, UserMini>> {
  const map = new Map<string, UserMini>();
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) return map;
  const { data } = await supabase.from("users").select("id, full_name, nickname, grade_level").in("id", unique);
  for (const r of data ?? []) {
    const id = String((r as { id?: string }).id ?? "");
    if (!id) continue;
    map.set(id, {
      full_name: (r as UserMini).full_name ?? null,
      nickname: (r as UserMini).nickname ?? null,
      grade_level: (r as UserMini).grade_level ?? null,
    });
  }
  return map;
}

async function mentorFirstSubject(supabase: SupabaseClient, mentorId: string): Promise<string | null> {
  const { data } = await supabase
    .from("mentor_profiles")
    .select("teaching_subjects")
    .eq("user_id", mentorId)
    .maybeSingle();
  const subjects = (data as { teaching_subjects?: string[] | null } | null)?.teaching_subjects;
  if (Array.isArray(subjects) && subjects[0]) return String(subjects[0]);
  return null;
}

function toCard(row: ReviewDbRow, author: UserMini | undefined, subject: string | null): ReviewCardItem {
  const name = maskStudentName(author?.full_name, author?.nickname);
  const initial = name.replace(/\*/g, "").slice(0, 1) || "학";
  return {
    id: row.id,
    rating: row.rating,
    content: row.body,
    createdAt: row.created_at,
    subscriptionCount: row.subscription_count,
    studentInitial: initial,
    studentMaskedName: name,
    gradeSubject: formatGradeSubject(author?.grade_level, subject),
    mentorReply: row.mentor_reply,
    mentorRepliedAt: row.mentor_replied_at,
  };
}

function mapRows(data: Record<string, unknown>[] | null): ReviewDbRow[] {
  return (data ?? []).map((r) => mapReviewDbRow(r));
}

export async function listMentorReviews(
  supabase: SupabaseClient,
  mentorId: string,
  opts: { page?: number; limit?: number; includeHidden?: boolean }
): Promise<ReviewListResult> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 10));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let q = supabase
    .from("reviews")
    .select("*", { count: "exact" })
    .eq("mentor_id", mentorId)
    .order("created_at", { ascending: false });

  if (!opts.includeHidden) {
    q = applyPublicFilters(q);
  }

  const { data, count, error } = await q.range(from, to);
  if (error) {
    return {
      items: [],
      total: 0,
      page,
      limit,
      avgRating: null,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    };
  }

  const rows = mapRows(data as Record<string, unknown>[] | null);
  const authorIds = rows.map((r) => r.author_id);
  const [authors, subject] = await Promise.all([
    loadAuthorsMap(supabase, authorIds),
    mentorFirstSubject(supabase, mentorId),
  ]);

  // P3-2: 최대 500건 클라이언트 집계(cap 결함) 제거 → 서버 집계 RPC(get_mentor_review_stats).
  // 집계값만 반환(원본 미노출)하며 hidden/blinded 를 제외한다(include_hidden 은 관리자 전용, 서버 강제).
  const { data: statsData } = await supabase.rpc("get_mentor_review_stats", {
    p_mentor_id: mentorId,
    p_include_hidden: opts.includeHidden ?? false,
  });
  const stats = (Array.isArray(statsData) ? statsData[0] : statsData) as
    | {
        review_count?: number | null;
        avg_rating?: number | string | null;
        d1?: number | null;
        d2?: number | null;
        d3?: number | null;
        d4?: number | null;
        d5?: number | null;
      }
    | null
    | undefined;

  const total = count ?? (typeof stats?.review_count === "number" ? stats.review_count : rows.length);
  const avgRating =
    stats?.avg_rating == null
      ? null
      : typeof stats.avg_rating === "number"
        ? stats.avg_rating
        : Number(stats.avg_rating) || null;
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
    1: Number(stats?.d1) || 0,
    2: Number(stats?.d2) || 0,
    3: Number(stats?.d3) || 0,
    4: Number(stats?.d4) || 0,
    5: Number(stats?.d5) || 0,
  };

  return {
    items: rows.map((r) => toCard(r, authors.get(r.author_id), subject)),
    total,
    page,
    limit,
    avgRating,
    distribution,
  };
}

export async function createReview(
  supabase: SupabaseClient,
  authorId: string,
  input: { mentorId: string; rating: number; body: string }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const eligibility = await checkReviewEligibility(supabase, authorId, input.mentorId);
  if (!eligibility.eligible) {
    return { ok: false, error: eligibility.reason };
  }

  const rating = Math.round(input.rating);
  if (rating < 1 || rating > 5) {
    return { ok: false, error: "별점은 1~5점 사이로 선택해 주세요." };
  }

  const text = input.body.trim();
  if (text.length < 20) {
    return { ok: false, error: "리뷰는 최소 20자 이상 작성해 주세요." };
  }
  if (text.length > 500) {
    return { ok: false, error: "리뷰는 최대 500자까지 작성할 수 있습니다." };
  }

  // [연락처 마스킹] 길이 검증은 원본 기준, 저장은 명백한 외부 연락처만 가린 값으로.
  const safeBody = maskContactInUserText(text);
  const insertRow: Record<string, unknown> = {
    mentor_id: input.mentorId,
    author_id: authorId,
    rating,
    body: safeBody,
  };

  const subCountCol = await pickExistingColumn(supabase, "reviews", ["subscription_count"]);
  if (subCountCol.column) {
    insertRow[subCountCol.column] = eligibility.subscriptionCount;
  }

  const { data, error } = await supabase.from("reviews").insert(insertRow).select("id").single();

  if (error) {
    if (/unique|duplicate/i.test(error.message)) {
      return { ok: false, error: "이미 리뷰를 작성했습니다." };
    }
    return { ok: false, error: "리뷰 저장에 실패했습니다." };
  }

  return { ok: true, id: String((data as { id: string }).id) };
}

export async function replyToReview(
  supabase: SupabaseClient,
  mentorId: string,
  reviewId: string,
  reply: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const text = reply.trim();
  if (text.length < 2) {
    return { ok: false, error: "답글을 입력해 주세요." };
  }
  if (text.length > 500) {
    return { ok: false, error: "답글은 최대 500자까지 작성할 수 있습니다." };
  }

  const { data: row, error: fetchErr } = await supabase
    .from("reviews")
    .select("id, mentor_id, mentor_reply")
    .eq("id", reviewId)
    .maybeSingle();

  if (fetchErr || !row) {
    return { ok: false, error: "리뷰를 찾을 수 없습니다." };
  }

  const r = row as { mentor_id: string; mentor_reply: string | null };
  if (r.mentor_id !== mentorId) {
    return { ok: false, error: "본인에게 달린 리뷰에만 답글할 수 있습니다." };
  }
  if (r.mentor_reply?.trim()) {
    return { ok: false, error: "답글은 1회만 작성할 수 있습니다." };
  }

  const { error } = await supabase
    .from("reviews")
    .update({ mentor_reply: text, mentor_replied_at: new Date().toISOString() })
    .eq("id", reviewId)
    .eq("mentor_id", mentorId);

  if (error) {
    return { ok: false, error: "답글 저장에 실패했습니다." };
  }
  return { ok: true };
}

export async function hideReview(
  supabase: SupabaseClient,
  reviewId: string,
  hidden: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const patch: Record<string, unknown> = {
    is_hidden: hidden,
    moderation_state: hidden ? "hidden" : "visible",
  };
  const { error } = await supabase.from("reviews").update(patch).eq("id", reviewId);
  if (error) {
    return { ok: false, error: "처리에 실패했습니다." };
  }
  return { ok: true };
}

export async function listMentorReceivedReviews(
  supabase: SupabaseClient,
  mentorId: string,
  limit = 50
): Promise<ReviewCardItem[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("mentor_id", mentorId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit * 3, 150));

  if (error || !data) return [];

  const rows = mapRows(data as Record<string, unknown>[]).filter(isPubliclyVisibleReview).slice(0, limit);
  const authors = await loadAuthorsMap(
    supabase,
    rows.map((r) => r.author_id)
  );
  const subject = await mentorFirstSubject(supabase, mentorId);
  return rows.map((r) => toCard(r, authors.get(r.author_id), subject));
}
