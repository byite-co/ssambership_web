"use server";

import { revalidateCommunityPaths } from "@/lib/community/communityRevalidate";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { normalizeCommunityPostCategory } from "@/lib/community/communityBoardConstants";
import { insertMentorBoardPost, insertMentorShortformPost } from "@/lib/community/communityMutations";
import { SHORTFORM_CATEGORIES, type ShortformCategorySlug } from "@/lib/community/communityShortformConstants";
import {
  TRUST_SAFETY_COMMUNITY_ERROR_CODE,
  findRestrictedPhraseInText,
  maskContactInUserText,
} from "@/lib/safety/trustSafetyText";

const NEW_PATH = "/mentor/community/new";

function buildErrorRedirect(code: string) {
  const qs = new URLSearchParams();
  qs.set("error", code);
  return `${NEW_PATH}?${qs.toString()}`;
}

export async function submitMentorCommunityPost(formData: FormData) {
  /** 멘토가 아니면 requireRole에서 리다이렉트되어 저장되지 않음 */
  const { user } = await requireRole("mentor");
  const supabase = await createClient();

  const postType = String(formData.get("postType") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const categoryRaw = String(formData.get("category") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();
  const rights = formData.get("rightsAck") === "on";

  if (postType !== "shortform" && postType !== "board") {
    redirect(buildErrorRedirect("invalid_target"));
  }
  if (!title || !body) {
    redirect(buildErrorRedirect("validation_fields"));
  }
  if (!source) {
    redirect(buildErrorRedirect("validation_source"));
  }
  if (!rights) {
    redirect(buildErrorRedirect("validation_rights"));
  }
  if (findRestrictedPhraseInText(title, body)) {
    redirect(buildErrorRedirect(TRUST_SAFETY_COMMUNITY_ERROR_CODE));
  }

  const boardCategory = normalizeCommunityPostCategory(categoryRaw);
  const shortformHit = SHORTFORM_CATEGORIES.find((c) => c.slug === categoryRaw && c.slug !== "all");
  const shortformCategory: ShortformCategorySlug = shortformHit ? shortformHit.slug : "study";
  const category = postType === "shortform" ? shortformCategory : boardCategory;

  const input = { title: maskContactInUserText(title), body: maskContactInUserText(body), category, source };

  if (postType === "shortform") {
    const r = await insertMentorShortformPost(supabase, user.id, input);
    if (!r.ok) {
      console.error("[submitMentorCommunityPost] shortform insert failed", r.error);
      redirect(buildErrorRedirect("shortform_save"));
    }
    revalidateCommunityPaths({ mutation: "post_create", kind: "shortform", postId: r.id });
    redirect(`/community/shortform/${r.id}`);
  }

  const r2 = await insertMentorBoardPost(supabase, user.id, input);
  if (!r2.ok) {
    console.error("[submitMentorCommunityPost] board insert failed", r2.error);
    redirect(buildErrorRedirect("board_save"));
  }
  revalidateCommunityPaths({ mutation: "post_create", kind: "board", postId: r2.id });
  redirect(`/community/board/${r2.id}`);
}
