import type { SupabaseClient } from "@supabase/supabase-js";
import { amountCentsFromCashKrw, SUBSCRIBE_PLAN_TIERS } from "@/lib/subscribe/mentorPlanPricing";
import { getSubscribeCatalogPlan } from "@/lib/subscribe/subscribePlanCatalog";
import type { SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { splitCsv } from "@/lib/mentor/mentorProfilePayload";
import { callApiWebV1Rpc } from "@/lib/apiWebV1/rpc";

/**
 * S2-2 전환 W2(C6): 멘토 프로필·요금제 저장 정본 — F7
 * `api_web_v1.mentor_profile_update_self`(허용 9필드 전면 교체) + F8
 * `api_web_v1.mentor_plan_prices_set_self`(3-tier 원자, 입력 = cash KRW)
 * (계약 §7 F7/F8 · §17 #10·#11 — XW-02·XW-03 해소).
 * mentor_profiles·mentor_plans 직접 쓰기(INSERT/UPDATE/upsert)·스키마 프로빙
 * extras(grade/tags 계열)·비정상 계정 INSERT 폴백은 전부 제거했다 — 특권 컬럼
 * (verification_status·cap_limit)·인증서류(student_id_image_url)·payout 컬럼은
 * 어떤 인자로도 전달되지 않는다(F7 allowlist 가 DB 정본).
 */

/** F7 오류코드 → 사용자 문구. */
function f7CodeToMessage(code: string): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "로그인 정보가 만료되었어요. 다시 로그인해 주세요.";
    case "ROLE_NOT_MENTOR":
      return "멘토만 프로필을 수정할 수 있어요.";
    case "MENTOR_PROFILE_NOT_FOUND":
      return "멘토 프로필을 찾을 수 없어요. 고객센터로 문의해 주세요.";
    case "UNIVERSITY_NAME_REQUIRED":
      return "대학명을 입력해 주세요.";
    case "DEPARTMENT_NAME_REQUIRED":
      return "학과명을 입력해 주세요.";
    case "PROFILE_IMAGE_REF_INVALID":
      return "프로필 사진 참조가 올바르지 않아요. 사진을 다시 업로드해 주세요.";
    case "ACCOUNT_BANNED":
    case "ACCOUNT_SUSPENDED":
    case "ACCOUNT_DELETION_IN_PROGRESS":
      return "현재 계정 상태에서는 프로필을 수정할 수 없어요.";
    default:
      return "프로필을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
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

async function updateMentorSubscriptionPrices(
  supabase: SupabaseClient,
  pricesKrw: Record<SubscribePlanTier, number | null> | undefined
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!pricesKrw) return { ok: true };

  for (const tier of SUBSCRIBE_PLAN_TIERS) {
    const cashKrw = pricesKrw[tier];
    if (typeof cashKrw !== "number" || !Number.isFinite(cashKrw) || cashKrw <= 0) {
      return { ok: false, error: "구독 요금은 1캐시 이상 숫자로 입력해 주세요." };
    }
  }

  // F8: 3개 tier 를 한 RPC 호출로 원자 처리. 입력 단위는 cash KRW(센트 아님 — DB 가
  // ×100 저장·cap_weight 강제). 밴드 판정은 DB 정본 — 밖이면 clamp 없이
  // PLAN_PRICE_OUT_OF_BAND 로 거부된다(계약 §7 F8, T-SEC-06·07).
  const res = await callApiWebV1Rpc(supabase, "mentor_plan_prices_set_self", {
    p_limited_cash_krw: Math.trunc(pricesKrw.limited as number),
    p_standard_cash_krw: Math.trunc(pricesKrw.standard as number),
    p_premium_cash_krw: Math.trunc(pricesKrw.premium as number),
  });
  if (!res.ok) {
    const d = res.detail ?? {};
    return {
      ok: false,
      error: f8CodeToMessage(res.code, {
        tier: typeof d.tier === "string" ? d.tier : undefined,
        min: typeof d.min_cash_krw === "number" ? d.min_cash_krw : undefined,
        max: typeof d.max_cash_krw === "number" ? d.max_cash_krw : undefined,
      }),
    };
  }
  // updated[]·unchanged[] 는 모두 정상 응답이다(§8.3 F8 — 변경 없으면 updated:[]).
  return { ok: true };
}

/** F8 오류코드 → 사용자 문구(밴드 범위는 envelope 보조 필드가 정본). */
function f8CodeToMessage(
  code: string,
  detail: { tier?: string; min?: number; max?: number } | null
): string {
  if (code === "PLAN_PRICE_OUT_OF_BAND") {
    const tier = detail?.tier;
    const label = tier === "limited" || tier === "standard" || tier === "premium"
      ? getSubscribeCatalogPlan(tier).label
      : "구독";
    if (detail && typeof detail.min === "number" && typeof detail.max === "number") {
      return `${label} 구독 요금은 ${detail.min.toLocaleString("ko-KR")}~${detail.max.toLocaleString("ko-KR")}캐시 범위에서 설정할 수 있습니다.`;
    }
    return `${label} 요금이 허용 범위를 벗어났습니다. 안내된 범위에서 설정해 주세요.`;
  }
  if (code === "PLAN_PRICE_INVALID") return "구독 요금은 1캐시 이상 숫자로 입력해 주세요.";
  if (code === "ROLE_NOT_MENTOR" || code === "MENTOR_NOT_APPROVED") {
    return "승인된 멘토만 구독 요금을 설정할 수 있어요.";
  }
  return "구독 요금을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.";
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

export async function updateMentorProfile(
  supabase: SupabaseClient,
  input: MentorProfileFormInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const subjects = splitCsv(input.subjects);

  // [과목 필수 게이트] 담당 과목이 0개면 구독 공개를 켤 수 없다(활동 차단).
  if (input.subscribeOpen && subjects.length === 0) {
    return { ok: false, error: "가르치는 과목을 1개 이상 선택해야 구독 공개를 켤 수 있어요." };
  }

  // F7 은 허용 9필드 전면 교체다 — 편집 폼이 다루지 않는 answer_style 과, 새 업로드가
  // 없을 때의 profile_image_url 은 현재 값을 그대로 전달해 유지한다(자기 행 읽기).
  const { data: current, error: curErr } = await supabase
    .from("mentor_profiles")
    .select("answer_style, profile_image_url")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (curErr) {
    return { ok: false, error: "프로필 현재 값을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  const cur = (current ?? {}) as { answer_style?: unknown; profile_image_url?: unknown };

  const res = await callApiWebV1Rpc(supabase, "mentor_profile_update_self", {
    p_university_name: input.university?.trim() || "",
    p_department_name: input.department?.trim() || "",
    p_high_school_name: input.highSchool?.trim() || null,
    p_teaching_subjects: subjects,
    p_intro_line: input.intro?.trim() || null,
    p_bio: input.bio?.trim() || null,
    p_answer_style: typeof cur.answer_style === "string" ? cur.answer_style : null,
    p_profile_image_url:
      input.profileImageUrl?.trim() ||
      (typeof cur.profile_image_url === "string" ? cur.profile_image_url : null),
    p_is_open_for_subscriptions: input.subscribeOpen,
  });
  if (!res.ok) {
    return { ok: false, error: f7CodeToMessage(res.code) };
  }

  const priceUpdate = await updateMentorSubscriptionPrices(supabase, input.subscriptionPricesKrw);
  if (!priceUpdate.ok) return priceUpdate;

  const iqPriceUpdate = await updateMentorIndividualQuestionPrice(
    supabase,
    input.individualQuestionPriceCash
  );
  if (!iqPriceUpdate.ok) return iqPriceUpdate;

  return { ok: true };
}
