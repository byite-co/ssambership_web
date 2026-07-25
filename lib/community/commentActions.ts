"use server";

import { redirect } from "next/navigation";
import { revalidateCommunityPaths } from "@/lib/community/communityRevalidate";
import { getServerAuthUser } from "@/lib/auth/getCurrentUser";
import { createClient } from "@/lib/supabase/server";
import { insertCommunityComment } from "@/lib/community/communityMutations";
import { authorStoredLabelFromProfile } from "@/lib/community/communityAuthorLabels";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { TRUST_SAFETY_COMMUNITY_ERROR_CODE, sanitizeTrustSafetyText } from "@/lib/safety/trustSafetyText";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildCommentRedirect(path: string, err: string) {
  const q = new URLSearchParams();
  q.set("commentError", err);
  return `${path}?${q.toString()}`;
}

export async function submitCommunityCommentAction(formData: FormData) {
  const postType = String(formData.get("postType") ?? "").trim();
  const postId = String(formData.get("postId") ?? "").trim();
  const body = String(formData.get("body") ?? "");
  const returnPath = String(formData.get("returnPath") ?? "").trim();

  const { user } = await getServerAuthUser();
  if (!user) {
    if (returnPath.startsWith("/")) {
      redirect(`/login?next=${encodeURIComponent(returnPath)}`);
    }
    redirect("/login");
  }

  if (postType !== "board" && postType !== "shortform") {
    redirect(buildCommentRedirect(returnPath || "/community", "invalid"));
  }
  if (!UUID_RE.test(postId)) {
    redirect(buildCommentRedirect(returnPath || "/community", "invalid"));
  }
  if (!returnPath.startsWith("/")) {
    redirect("/community");
  }

  const t = body.trim();
  if (t.length < 1 || t.length > 1000) {
    redirect(buildCommentRedirect(returnPath, "length"));
  }
  const safety = sanitizeTrustSafetyText(t);
  if (!safety.ok) {
    redirect(buildCommentRedirect(returnPath, TRUST_SAFETY_COMMUNITY_ERROR_CODE));
  }

  const supabase = await createClient();
  const { data: profile } = await getUserProfileById(supabase, user.id);
  const authorLabel = authorStoredLabelFromProfile(profile);

  const r = await insertCommunityComment(supabase, user.id, {
    postType,
    postId,
    body: safety.text,
    authorLabel,
  });

  if (!r.ok) {
    if (r.error === "validation") {
      redirect(buildCommentRedirect(returnPath, "length"));
    }
    redirect(buildCommentRedirect(returnPath, "save"));
  }

  revalidateCommunityPaths({
    mutation: "comment_create",
    kind: postType === "board" ? "board" : "shortform",
    postId,
    extraPaths: [returnPath],
  });

  redirect(returnPath);
}
