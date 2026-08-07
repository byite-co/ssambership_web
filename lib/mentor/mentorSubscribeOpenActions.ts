"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { setMentorSubscribeOpen } from "@/lib/mentor/mentorSubscribeOpen";

/**
 * 멘토 self "신규 구독 받기 / 그만 받기" 토글.
 * 본인 mentor_profiles 의 구독 받기 flag 만 갱신(다른 필드·정산·환불·cap 무관).
 * form 의 hidden input `open` = "true" | "false".
 *
 * D-MT-8: setMentorSubscribeOpen 의 {ok:false,error} 를 버리지 않는다. 저장 실패 시
 * ?error= 로 리다이렉트해 표면화한다(성공처럼 보이던 무음 no-op 제거 — 멘토가 '그만 받기'로
 * 껐다고 믿지만 실제로는 켜진 채 유지되던 오류).
 */
export async function setMentorSubscribeOpenAction(formData: FormData): Promise<void> {
  const { user } = await requireRole("mentor");
  const supabase = await createClient();
  const open = String(formData.get("open") ?? "") === "true";
  const res = await setMentorSubscribeOpen(supabase, user.id, open);
  revalidatePath("/mentor/mypage");
  revalidatePath("/mentor/profile");
  revalidatePath("/mentors");
  if (!res.ok) {
    redirect(`/mentor/mypage?error=${encodeURIComponent(res.error)}`);
  }
}
