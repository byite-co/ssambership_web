"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { isUserBlocksEnabled } from "@/lib/shell/featureFlags";
import { createClient } from "@/lib/supabase/server";

/**
 * 차단 생성/해제 서버 액션 (스펙 §2).
 * 세션 클라이언트로 insert/delete — RLS(ub_insert_own/ub_delete_own)가
 * blocker_id = auth.uid() 를 DB에서 강제(타인 명의 차단 불가). self-block은
 * 서버 검증 + DB CHECK 이중 거부.
 */

function safeReturnTo(raw: FormDataEntryValue | null): string {
  const s = typeof raw === "string" ? raw : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/community";
}

export async function blockUserAction(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get("returnTo"));
  const fail = (msg: string): never =>
    redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);

  if (!isUserBlocksEnabled()) fail("차단 기능이 아직 활성화되지 않았습니다.");
  const blockedUserId = String(formData.get("blockedUserId") ?? "").trim();
  if (!blockedUserId) fail("차단할 사용자를 확인할 수 없습니다.");

  const { user } = await getServerUserWithProfile();
  if (!user) redirect(`/login/student?next=${encodeURIComponent(returnTo)}`);
  if (user.id === blockedUserId) fail("자기 자신은 차단할 수 없습니다.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_blocks")
    .insert({ blocker_id: user.id, blocked_id: blockedUserId });
  // PK 중복(이미 차단됨)은 성공으로 간주 — 멱등 UX
  if (error && !/duplicate|already exists|23505/i.test(error.message)) {
    fail("차단 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}ok=${encodeURIComponent("사용자를 차단했어요. 설정 > 차단 관리에서 해제할 수 있어요.")}`);
}

export async function unblockUserAction(formData: FormData): Promise<void> {
  const returnTo = safeReturnTo(formData.get("returnTo")) || "/settings/blocks";
  if (!isUserBlocksEnabled()) redirect("/mypage");
  const blockedUserId = String(formData.get("blockedUserId") ?? "").trim();
  if (!blockedUserId) redirect(returnTo);

  const { user } = await getServerUserWithProfile();
  if (!user) redirect(`/login/student?next=${encodeURIComponent(returnTo)}`);

  const supabase = await createClient();
  await supabase.from("user_blocks").delete().eq("blocker_id", user.id).eq("blocked_id", blockedUserId);

  revalidatePath(returnTo);
  redirect(returnTo);
}
