import type { SupabaseClient } from "@supabase/supabase-js";
import type { MentorIndividualQuestionPricingRow } from "@/lib/individualQuestion/individualQuestionTypes";

const TABLE = "mentor_individual_question_pricing" as const;

function positiveAmountCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const amount = Math.trunc(value);
  return amount > 0 ? amount : null;
}

/**
 * 여러 멘토의 개별 질문 단가를 한 번에 조회(멘토 지정 게시판용 표시 전용).
 * RLS: authenticated select-all — 비로그인 세션에서는 빈 Map이 반환된다(에러 아님).
 */
export async function fetchMentorIndividualQuestionPriceMap(
  supabase: SupabaseClient,
  mentorIds: string[]
): Promise<{ byMentor: Map<string, number>; error: string | null }> {
  const byMentor = new Map<string, number>();
  if (!mentorIds.length) return { byMentor, error: null };

  const { data, error } = await supabase
    .from(TABLE)
    .select("mentor_id, amount_cents")
    .in("mentor_id", mentorIds);

  if (error) {
    return { byMentor, error: error.message };
  }

  for (const row of (data as Array<{ mentor_id: unknown; amount_cents: unknown }> | null) ?? []) {
    const mentorId = typeof row.mentor_id === "string" ? row.mentor_id : null;
    const amount = positiveAmountCents(row.amount_cents);
    if (mentorId && amount != null) {
      byMentor.set(mentorId, amount);
    }
  }
  return { byMentor, error: null };
}

export async function fetchMentorIndividualQuestionPrice(
  supabase: SupabaseClient,
  mentorId: string
): Promise<{ row: MentorIndividualQuestionPricingRow | null; amountCents: number | null; error: string | null }> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("mentor_id, amount_cents, updated_at")
    .eq("mentor_id", mentorId)
    .maybeSingle();

  if (error) {
    return { row: null, amountCents: null, error: error.message };
  }

  const row = data as MentorIndividualQuestionPricingRow | null;
  return {
    row,
    amountCents: positiveAmountCents(row?.amount_cents),
    error: null,
  };
}
