"use server";

import { redirect } from "next/navigation";
import { revalidateCommunityPaths } from "@/lib/community/communityRevalidate";
import { getServerAuthUser } from "@/lib/auth/getCurrentUser";
import { createClient } from "@/lib/supabase/server";
import { isCommunityPostUuid } from "@/lib/community/communityQueries";

const TABLE = "content_reports";

const ALLOWED_REASONS = new Set([
  "부적절한 내용",
  "스팸·광고",
  "욕설·비방",
  "개인정보 노출",
  "기타",
]);

function applyReportSearch(path: string, kind: "ok" | "err", errCode?: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const u = new URL(normalized, "https://ssambership.local");
  if (kind === "ok") {
    u.searchParams.delete("reportError");
    u.searchParams.set("reportOk", "1");
  } else {
    u.searchParams.delete("reportOk");
    if (errCode) u.searchParams.set("reportError", errCode);
  }
  return `${u.pathname}${u.search}`;
}

export async function submitCommunityContentReportAction(formData: FormData) {
  const variant = String(formData.get("postVariant") ?? "").trim();
  const postId = String(formData.get("postId") ?? "").trim();
  const returnPath = String(formData.get("returnPath") ?? "").trim();
  const reasonRaw = String(formData.get("reason") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  const { user } = await getServerAuthUser();
  if (!user) {
    if (returnPath.startsWith("/")) {
      redirect(`/login?next=${encodeURIComponent(returnPath)}`);
    }
    redirect("/login");
  }

  if (variant !== "board" && variant !== "shortform") {
    redirect(applyReportSearch(returnPath || "/community", "err", "invalid"));
  }
  if (!postId || !isCommunityPostUuid(postId)) {
    console.error("[communityContentReport] rejected: missing or invalid target_id");
    redirect(applyReportSearch(returnPath || "/community", "err", "invalid"));
  }
  if (!returnPath.startsWith("/")) {
    redirect("/community");
  }

  const targetId = postId;

  const reason = ALLOWED_REASONS.has(reasonRaw) ? reasonRaw : "기타";
  const descTrim = description.trim();
  const desc = descTrim.length > 500 ? descTrim.slice(0, 500) : descTrim;
  const descriptionOut = desc.length > 0 ? desc : null;

  // 신고 target 정본 어휘(수렴 M2): 숏폼 글은 shortform_post — 모호한 legacy
  // 'shortform' 은 서버 allowlist 에서 제거됐다.
  const target_type = variant === "board" ? "community_post" : "shortform_post";

  const supabase = await createClient();
  const { error } = await supabase.from(TABLE).insert({
    reporter_id: user.id,
    target_type,
    target_id: targetId,
    reason,
    description: descriptionOut,
  });

  if (error) {
    console.error("[communityContentReport] insert failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    const denied =
      error.code === "42501" ||
      /permission denied|row-level security|rls|policy/i.test(String(error.message ?? ""));
    redirect(applyReportSearch(returnPath, "err", denied ? "denied" : "save"));
  }

  // 매트릭스: 신고 접수 × (공개 목록·상세·관리자 큐). 신고만으로 노출은 바뀌지 않지만
  // 관리자 검수 큐(`/admin/reports`·`/admin/moderation`)는 즉시 갱신돼야 한다.
  revalidateCommunityPaths({
    mutation: "report_create",
    kind: variant === "shortform" ? "shortform" : "board",
    postId: targetId,
    extraPaths: ["/admin"],
  });

  redirect(applyReportSearch(returnPath, "ok"));
}
