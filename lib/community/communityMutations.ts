import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

type MutationResult =
  | { ok: true; id: string; row: Record<string, unknown> | null }
  | { ok: false; error: string };

function isMissingColumnError(err: PostgrestError | null): boolean {
  if (!err) return false;
  return /column|does not exist|schema cache/i.test(err.message);
}

async function insertWithCandidates(
  supabase: SupabaseClient,
  table: string,
  payloads: Record<string, unknown>[]
): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  let lastError = "insert 후보를 모두 실패했습니다.";
  for (let attemptIndex = 0; attemptIndex < payloads.length; attemptIndex++) {
    const payload = payloads[attemptIndex];
    const { data, error } = await supabase.from(table).insert(payload).select("*").limit(1).maybeSingle();
    if (!error) {
      return { row: (data as Record<string, unknown> | null) ?? null, error: null };
    }
    lastError = error.message;
    if (!isMissingColumnError(error)) {
      return { row: null, error: error.message };
    }
  }
  console.warn("[communityMutations] insertWithCandidates all attempts failed", {
    table,
    attempts: payloads.length,
  });
  return { row: null, error: lastError };
}

type ComposeInput = {
  title: string;
  body: string;
  category: string;
  source: string;
};

function toResult(row: Record<string, unknown> | null, err: string | null): MutationResult {
  if (err) return { ok: false, error: err };
  const id = row && typeof row.id === "string" ? row.id : null;
  if (!id) return { ok: false, error: "저장은 되었으나 id를 확인할 수 없습니다." };
  return { ok: true, id, row };
}

/**
 * shortform_posts — community_posts와 테이블을 분리 유지. 컬럼명 후보만 시도.
 */
export async function insertMentorShortformPost(
  supabase: SupabaseClient,
  userId: string,
  input: ComposeInput
): Promise<MutationResult> {
  const { title, body, category, source } = input;
  const t = "shortform_posts";

  const payloads: Record<string, unknown>[] = [
    { title, body, category, source, author_id: userId, author_role: "mentor" },
    { title, body, category, source, author_id: userId, author_role: "mentor", rights_confirmed: true },
    { title, content: body, category, source_url: source, author_id: userId, author_role: "mentor", rights_confirmed: true },
    { title, text: body, category, source, user_id: userId, author_role: "mentor", rights_ack: true },
    { title, body, category, attribution: source, user_id: userId, author_role: "mentor", legal_use_confirmed: true },
    { title, content: body, category, source, user_id: userId, author_role: "mentor" },
  ];

  const { row, error } = await insertWithCandidates(supabase, t, payloads);
  return toResult(row, error);
}

export type InsertCommunityCommentInput = {
  postType: "board" | "shortform";
  postId: string;
  body: string;
};

/**
 * public.community_comments — 016 SQL 선행. author_id = 로그인 사용자(액션에서 전달)
 */
export async function insertCommunityComment(
  supabase: SupabaseClient,
  userId: string,
  input: InsertCommunityCommentInput
): Promise<{ ok: true } | { ok: false; error: "validation" | "db" }> {
  const { postType, postId, body } = input;
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 1000) {
    return { ok: false, error: "validation" };
  }
  // author_label 은 클라이언트가 보내지 않는다 — 서버 트리거가 users 정본에서
  // 파생한다(board·shortform 공통, 수렴 §10.6).
  const { error } = await supabase.from("community_comments").insert({
    post_type: postType,
    post_id: postId,
    author_id: userId,
    body: trimmed,
    status: "visible",
  });
  if (error) {
    return { ok: false, error: "db" };
  }
  return { ok: true };
}
