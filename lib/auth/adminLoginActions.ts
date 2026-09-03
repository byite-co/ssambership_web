"use server";

import { redirect } from "next/navigation";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { adminLoginDestination, adminLoginRequiresSecondFactor, buildAdminLoginUrl } from "@/lib/auth/adminLoginConsole";
import { createClient } from "@/lib/supabase/server";

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 관리자 전용 로그인 — 1단계(비밀번호). Supabase Auth 후 `public.users.role = admin` 만 통과. service_role 미사용.
 * 실패는 코드(`?error=`)로만 돌아간다. 복귀 경로(`next`)는 허용 목록(`resolveAdminLoginReturnPath`)으로만 해석한다.
 * 2단계: `getAuthenticatorAssuranceLevel()` 이 `nextLevel === 'aal2'` 이면 코드 단계로 보낸다 — 판정만이며 코드 검증은 PR-12b.
 */
export async function adminEmailLoginAction(formData: FormData) {
  const email = textFromForm(formData.get("email"));
  const password = textFromForm(formData.get("password"));
  const next = textFromForm(formData.get("next")) || null;

  if (!email || !password) {
    redirect(buildAdminLoginUrl({ next, error: "invalid" }));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    redirect(buildAdminLoginUrl({ next, error: "invalid" }));
  }

  if (!data.user.email_confirmed_at) {
    await supabase.auth.signOut();
    redirect(buildAdminLoginUrl({ next, error: "unconfirmed" }));
  }

  const { data: profile, error: pe } = await getUserProfileById(supabase, data.user.id);
  if (pe || !profile || profile.role !== "admin") {
    await supabase.auth.signOut();
    redirect(buildAdminLoginUrl({ next, error: "not_admin" }));
  }

  // 2단계 판정 — 등록된 인증 수단이 없으면(aal1) 건너뛴다. 코드 입력·검증은 PR-12b 에서 활성화.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (adminLoginRequiresSecondFactor(aal)) {
    redirect(buildAdminLoginUrl({ next, step: "code" }));
  }

  redirect(adminLoginDestination(next));
}
