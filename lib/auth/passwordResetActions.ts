"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function publicOrigin(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  return "";
}

/**
 * Supabase Auth 비밀번호 재설정 메일 발송.
 * Redirect URL은 Supabase Dashboard의 Redirect allowlist에 등록되어 있어야 합니다.
 */
export async function requestPasswordResetAction(formData: FormData) {
  const email = textFromForm(formData.get("email")).toLowerCase();
  if (!email) {
    redirect("/forgot-password?error=empty_email");
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const inferred = host ? `${proto}://${host}`.replace(/\/$/, "") : "";
  const origin = publicOrigin() || inferred;
  if (!origin) {
    redirect("/forgot-password?error=missing_site_url");
  }

  const redirectTo = `${origin}/auth/update-password`;
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    // 원문(레이트리밋·계정 존재 여부 등)이 비인증 표면에 반사되지 않도록
    // Supabase 메시지는 콘솔에만 남기고, 화면에는 고정 code 만 넘긴다(admin 로그인 규약과 동일).
    console.error("[passwordReset] resetPasswordForEmail failed:", error.message);
    redirect("/forgot-password?error=reset_failed");
  }

  redirect("/forgot-password?sent=1");
}
