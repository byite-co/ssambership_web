"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { updateMentorProfile } from "@/lib/mentor/mentorProfileMutations";
import { deleteMentorAvatarObject, uploadMentorAvatar } from "@/lib/storage/mentorAvatarStorage";
import { SUBSCRIBE_PLAN_TIERS } from "@/lib/subscribe/mentorPlanPricing";
import type { SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";

const PATH = "/mentor/profile/edit";

function errQ(msg: string) {
  const q = new URLSearchParams();
  q.set("error", msg);
  return `${PATH}?${q.toString()}`;
}

function parsePriceKrw(formData: FormData, tier: SubscribePlanTier): number | null {
  const raw = String(formData.get(`subscriptionPriceKrw_${tier}`) ?? "").replace(/[^\d]/g, "");
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 개별 질문 답변 단가(캐시). 미입력이면 null → 변경 없음. */
function parseIndividualQuestionPriceCash(formData: FormData): number | null {
  const raw = String(formData.get("individualQuestionPriceCash") ?? "").replace(/[^\d]/g, "");
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function submitMentorProfileEdit(formData: FormData) {
  const { user } = await requireRole("mentor");
  const supabase = await createClient();

  const intro = String(formData.get("intro") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const university = String(formData.get("university") ?? "").trim();
  const department = String(formData.get("department") ?? "").trim();
  const grade = String(formData.get("grade") ?? "").trim();
  const subjects = String(formData.get("subjects") ?? "").trim();
  const highSchool = String(formData.get("highSchool") ?? "").trim();
  const tags = String(formData.get("tags") ?? "").trim();
  const subscribeOpen = formData.get("subscribeOpen") === "on";
  const subscriptionPricesKrw = Object.fromEntries(
    SUBSCRIBE_PLAN_TIERS.map((tier) => [tier, parsePriceKrw(formData, tier)])
  ) as Record<SubscribePlanTier, number | null>;

  if (SUBSCRIBE_PLAN_TIERS.some((tier) => subscriptionPricesKrw[tier] == null)) {
    redirect(errQ("구독 요금은 1캐시 이상 숫자로 입력해 주세요."));
  }

  // W2(C6): 가격 밴드 판정은 DB(F8)가 정본 — 클라 선판정을 제거했다. 프로필(F7)과
  // 요금(F8)이 각각 원자 RPC 라 구 "부분 저장" 우려도 함께 해소된다(clamp 없이
  // PLAN_PRICE_OUT_OF_BAND envelope 를 그대로 사용자에게 매핑).

  // 교체 시 구 아바타 정리용: 새 업로드 전에 기존 profile_image_url 을 조회한다.
  let oldAvatarUrl: string | null = null;
  {
    const { data: existing } = await supabase
      .from("mentor_profiles")
      .select("profile_image_url")
      .eq("user_id", user.id)
      .maybeSingle();
    const v =
      existing && typeof (existing as { profile_image_url?: unknown }).profile_image_url === "string"
        ? (existing as { profile_image_url: string }).profile_image_url
        : null;
    oldAvatarUrl = v && v.trim() ? v : null;
  }

  // 프로필 사진(선택): 새 파일이 있을 때만 업로드. DB 성공 전에는 기존 객체를 삭제하지 않는다.
  // 미선택이면 profileImageUrl = null → 기존 사진 유지(컬럼 미변경).
  let profileImageUrl: string | null = null;
  let uploadedAvatarUrl: string | null = null; // 이번 요청 신규 업로드(실패 시 보상 삭제 대상)
  const profileImageFile = formData.get("profileImage");
  if (profileImageFile instanceof File && profileImageFile.size > 0) {
    const buffer = Buffer.from(await profileImageFile.arrayBuffer());
    const uploaded = await uploadMentorAvatar(supabase, user.id, {
      buffer,
      mime: profileImageFile.type,
    });
    if (uploaded.error) {
      redirect(errQ(uploaded.error));
    }
    profileImageUrl = uploaded.url;
    uploadedAvatarUrl = uploaded.url;
  }

  const r = await updateMentorProfile(supabase, {
    userId: user.id,
    intro,
    bio,
    university,
    department,
    grade,
    subjects,
    highSchool,
    tags,
    subscribeOpen,
    subscriptionPricesKrw,
    individualQuestionPriceCash: parseIndividualQuestionPriceCash(formData),
    profileImageUrl,
  });

  if (!r.ok) {
    // DB 실패 → 이번 요청 신규 업로드 아바타 고아 방지 보상 삭제(구 객체는 건드리지 않음).
    if (uploadedAvatarUrl) {
      const del = await deleteMentorAvatarObject(supabase, uploadedAvatarUrl);
      if (!del.ok) {
        console.error("[mentor/profile] orphan 아바타 보상 삭제 실패", { uploadedAvatarUrl, error: del.error });
      }
    }
    redirect(errQ(r.error));
  }

  // DB 성공 후 교체된 구 아바타만 정리(새 업로드가 있고 구 URL 과 다를 때). post-commit 실패는 구조화 로그.
  if (uploadedAvatarUrl && oldAvatarUrl && oldAvatarUrl !== uploadedAvatarUrl) {
    const del = await deleteMentorAvatarObject(supabase, oldAvatarUrl);
    if (!del.ok) {
      console.error("[mentor/profile] 교체 구 아바타 정리 실패", { oldAvatarUrl, error: del.error });
    }
  }

  revalidatePath("/mentor/profile");
  revalidatePath(PATH);
  revalidatePath("/mentors");
  redirect(`${PATH}?ok=1`);
}
