import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  amountCentsFromCashKrw,
  isOutsideMentorPriceGuide,
  mentorPlanDebitAmountCents,
  mentorSubscriptionPriceRule,
  SUBSCRIBE_PLAN_TIERS,
} from "@/lib/subscribe/mentorPlanPricing";
import { getSubscribeCatalogPlan } from "@/lib/subscribe/subscribePlanCatalog";
import type { SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { buildMentorProfilePayloads, splitCsv } from "@/lib/mentor/mentorProfilePayload";

function isMissingColumnError(err: PostgrestError | null): boolean {
  if (!err) return false;
  return /column|does not exist|schema cache/i.test(err.message);
}

export type MentorProfileFormInput = {
  userId: string;
  intro: string;
  /** 상세 소개(500자). intro_line(한줄 소개)과 별개. */
  bio: string;
  university: string;
  department: string;
  grade: string;
  subjects: string;
  highSchool: string;
  tags: string;
  subscribeOpen: boolean;
  subscriptionPricesKrw?: Record<SubscribePlanTier, number | null>;
  /** 개별 질문(지정형) 답변 단가. null/미입력이면 변경하지 않음. 구독 요금제와 별개. */
  individualQuestionPriceCash?: number | null;
  /** 프로필 사진 public URL. null/미입력이면 변경하지 않음(기존 사진 유지). */
  profileImageUrl?: string | null;
};

function priceChanged(
  row: Record<string, unknown> | null,
  tier: SubscribePlanTier,
  nextAmountCents: number
): boolean {
  if (!row) return true;
  return mentorPlanDebitAmountCents(row, tier) !== nextAmountCents;
}

async function updateMentorSubscriptionPrices(
  supabase: SupabaseClient,
  mentorId: string,
  pricesKrw: Record<SubscribePlanTier, number | null> | undefined,
  now: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pricesKrw) return { ok: true };

  const payloads: Record<string, unknown>[] = [];
  const { data: existingRows, error: selectError } = await supabase
    .from("mentor_plans")
    .select("id, mentor_id, plan_tier, amount_cents")
    .eq("mentor_id", mentorId);

  if (selectError) {
    return { ok: false, error: selectError.message };
  }

  const byTier = new Map<SubscribePlanTier, Record<string, unknown>>();
  for (const row of (existingRows as Record<string, unknown>[] | null) ?? []) {
    const tier = row.plan_tier;
    if (tier === "limited" || tier === "standard" || tier === "premium") {
      byTier.set(tier, row);
    }
  }

  for (const tier of SUBSCRIBE_PLAN_TIERS) {
    const cashKrw = pricesKrw[tier];
    if (typeof cashKrw !== "number" || !Number.isFinite(cashKrw) || cashKrw <= 0) {
      return { ok: false, error: "구독 요금은 1캐시 이상 숫자로 입력해 주세요." };
    }
    // 가격 밴드는 서버에서 강제한다 — UI 경고만으로는 밴드 밖 금액이 저장돼
    // 구독 화면에 비정상 가격이 그대로 노출·차감되는 사고가 났다.
    const rule = mentorSubscriptionPriceRule(tier);
    if (isOutsideMentorPriceGuide(Math.trunc(cashKrw), tier)) {
      const label = getSubscribeCatalogPlan(tier).label;
      return {
        ok: false,
        error: `${label} 구독 요금은 ${rule.minCashKrw.toLocaleString("ko-KR")}~${rule.maxCashKrw.toLocaleString("ko-KR")}캐시 범위에서 설정할 수 있습니다.`,
      };
    }
    const amountCents = amountCentsFromCashKrw(Math.trunc(cashKrw));
    const existing = byTier.get(tier) ?? null;
    if (!priceChanged(existing, tier, amountCents)) continue;

    payloads.push({
      mentor_id: mentorId,
      plan_tier: tier,
      amount_cents: amountCents,
      updated_at: now,
      price_updated_at: now,
    });
  }

  if (payloads.length === 0) return { ok: true };

  const { error: upsertError } = await supabase
    .from("mentor_plans")
    .upsert(payloads, { onConflict: "mentor_id,plan_tier" });

  if (upsertError) {
    return { ok: false, error: upsertError.message };
  }

  // 활성 구독 학생 알림은 158 트리거(mentor_plans amount_cents 변경 fan-out)가 upsert 트랜잭션과 원자적으로 발행한다.
  return { ok: true };
}

/**
 * 개별 질문(지정형) 답변 단가 upsert. 구독 요금제(mentor_plans)와 별개 테이블.
 * 미입력(null)이면 변경하지 않는다. 입력 시 0 초과만 허용(최소/최대 강제 없음 — 자유 금액).
 */
async function updateMentorIndividualQuestionPrice(
  supabase: SupabaseClient,
  priceCash: number | null | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (priceCash == null) return { ok: true };
  if (!Number.isFinite(priceCash) || priceCash <= 0) {
    return { ok: false, error: "개별 질문 답변 단가는 1캐시 이상 숫자로 입력해 주세요." };
  }
  // mentor_individual_question_pricing 은 SELECT 전용 RLS라 직접 upsert 가 거부된다.
  // SECURITY DEFINER RPC set_individual_question_price 로 본인(auth.uid()) 단가만 upsert.
  const { error } = await supabase.rpc("set_individual_question_price", {
    p_amount_cents: amountCentsFromCashKrw(priceCash),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * 가입·sync 시 사용한 컬럼 + 확장 후보(마이그레이션과 맞춤)
 */
export async function updateMentorProfile(
  supabase: SupabaseClient,
  input: MentorProfileFormInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const subjects = splitCsv(input.subjects);

  // [과목 필수 게이트] 담당 과목이 0개면 구독 공개를 켤 수 없다(활동 차단).
  // 가입 시 과목은 이미 필수이므로, 이 가드는 기존 0과목 멘토가 과목 없이 활동하는 것을 막는다.
  if (input.subscribeOpen && subjects.length === 0) {
    return { ok: false, error: "가르치는 과목을 1개 이상 선택해야 구독 공개를 켤 수 있어요." };
  }

  const now = new Date().toISOString();
  // [avatar·인증서류 분리] payload 는 순수 빌더로 만든다. 빌더는 인증서류 컬럼
  // (student_id_image_url)을 절대 포함하지 않으며(계약 테스트로 강제), university_name·
  // department_name(학적 잠금)도 제외한다. avatar 는 imagePatch 로만 별도 갱신한다.
  const payloads = buildMentorProfilePayloads({
    userId: input.userId,
    intro: input.intro,
    bio: input.bio,
    grade: input.grade,
    subjects: input.subjects,
    highSchool: input.highSchool,
    tags: input.tags,
    subscribeOpen: input.subscribeOpen,
    profileImageUrl: input.profileImageUrl,
  });
  const core: Record<string, unknown> = { ...payloads.core, updated_at: now };

  // [안전장치] 정상 계정은 가입(syncAfterSignUpSession)에서 mentor_profiles 행이
  // 이미 만들어지므로 위 upsert 는 UPDATE 가 되어 university_name·department_name 을 건드리지 않는다(잠금 유지).
  // 다만 행이 없는 비정상 계정이면 이 upsert 가 INSERT 가 되는데, 두 컬럼이
  // NOT NULL(기본값 없음)이면 누락 시 저장이 통째로 실패한다. 그 경우에만 한해
  // 최초 INSERT 를 성립시키기 위해 현재 표시값으로 채운다. 행이 이미 있으면 절대 덮어쓰지 않는다.
  const { data: existingProfile } = await supabase
    .from("mentor_profiles")
    .select("user_id")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (existingProfile) {
    // 기존 행: UPDATE만 — university_name·department_name(학적 잠금·NOT NULL)은 건드리지 않는다.
    // upsert(INSERT ... ON CONFLICT)는 INSERT 튜플에 NOT NULL 컬럼을 요구해 23502로 실패하므로 update 사용.
    const { error: upErr } = await supabase.from("mentor_profiles").update(core).eq("user_id", input.userId);
    if (upErr) {
      return { ok: false, error: upErr.message };
    }
  } else {
    // 신규 행(비정상 계정): NOT NULL 컬럼을 현재 표시값으로 채워 최초 INSERT 성립.
    core.university_name = input.university?.trim() || "";
    core.department_name = input.department?.trim() || "";
    const { error: insErr } = await supabase.from("mentor_profiles").insert(core);
    if (insErr) {
      return { ok: false, error: insErr.message };
    }
  }

  // 프로필 사진(avatar): 새 URL이 있을 때만 자기 컬럼만 갱신. 인증서류(student_id_image_url)는
  // 절대 건드리지 않는다(imagePatch 는 profile_image_url 단일 키). core upsert와 분리해
  // 컬럼 부재(SQL 미적용) 환경에서도 다른 필드 저장이 깨지지 않도록 missing-column 오류는 무시한다.
  if (payloads.imagePatch) {
    const { error: imgErr } = await supabase
      .from("mentor_profiles")
      .update({ ...payloads.imagePatch, updated_at: now })
      .eq("user_id", input.userId);
    if (imgErr && !isMissingColumnError(imgErr)) {
      return { ok: false, error: imgErr.message };
    }
  }

  for (const patch of payloads.extras) {
    const { error } = await supabase.from("mentor_profiles").update({ ...patch, updated_at: now }).eq("user_id", input.userId);
    if (!error) {
      break;
    }
    if (!isMissingColumnError(error)) {
      return { ok: false, error: error.message };
    }
  }

  const priceUpdate = await updateMentorSubscriptionPrices(
    supabase,
    input.userId,
    input.subscriptionPricesKrw,
    now
  );
  if (!priceUpdate.ok) return priceUpdate;

  const iqPriceUpdate = await updateMentorIndividualQuestionPrice(
    supabase,
    input.individualQuestionPriceCash
  );
  if (!iqPriceUpdate.ok) return iqPriceUpdate;

  return { ok: true };
}
