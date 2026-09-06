import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { getPostLoginPath, safeInternalNextPath } from "@/lib/auth/getPostLoginPath";
import { profileCompletionGuard } from "@/lib/auth/profileCompletion";
import type { AppRole, UserRow } from "@/lib/types/user";
import type { User } from "@supabase/supabase-js";

type GuardRole = AppRole;

function loginPathFor(r: GuardRole): string {
  if (r === "student") return "/login/student";
  if (r === "mentor") return "/login/mentor";
  if (r === "admin") return "/admin/login";
  return "/login";
}

/** requireRole → 로그인 시 `next` 루프·회원가입/로그인 self 참조는 제외 */
function rawReturnToFromRequestHeaders(h: Headers): string | null {
  const v = h.get("x-return-to") ?? h.get("x-pathname");
  if (!v) return null;
  return safeInternalNextPath(v) ?? null;
}

function isAuthPathname(p: string): boolean {
  if (p === "/login" || p.startsWith("/login/")) return true;
  if (p === "/signup" || p.startsWith("/signup/")) return true;
  if (p === "/admin/login" || p.startsWith("/admin/login?")) return true;
  return false;
}

async function guardReturnTo(): Promise<string | null> {
  const h = await headers();
  const raw = rawReturnToFromRequestHeaders(h);
  const pathOnly = raw ? (raw.split("?")[0] ?? raw) : null;
  return raw && pathOnly && !isAuthPathname(pathOnly) ? raw : null;
}

async function loginRedirectUrlForGuard(expectedRole: GuardRole): Promise<string> {
  const returnTo = await guardReturnTo();
  const base = loginPathFor(expectedRole);
  if (!returnTo) return base;
  return `${base}?${new URLSearchParams({ next: returnTo })}`;
}

/**
 * DB-5(206) 완성 게이트: `profile_completed_at IS NULL`(role NULL) 세션은 역할 페이지 어디서든
 * `/complete-profile?next=<복귀 경로>` 로 보낸다. 완성 전엔 DB 가 쓰기를 전부 거부하므로
 * 여기서 먼저 막아 RLS 오류 화면이 뜨지 않게 한다. 반환은 역할이 확정된 프로필.
 */
async function requireCompletedProfile(profile: UserRow): Promise<UserRow & { role: AppRole }> {
  const decision = profileCompletionGuard(profile, { next: await guardReturnTo() });
  if (decision.kind === "incomplete") {
    redirect(decision.redirectTo);
  }
  return { ...profile, role: decision.role };
}

export async function requireRole(role: GuardRole): Promise<{ user: User; profile: UserRow | null }> {
  const { user, profile: rawProfile } = await getServerUserWithProfile();
  if (!user) {
    redirect(await loginRedirectUrlForGuard(role));
  }
  if (!rawProfile) {
    redirect(await loginRedirectUrlForGuard(role));
  }
  const profile = await requireCompletedProfile(rawProfile);
  if (role === "admin") {
    if (profile.role !== "admin") {
      redirect(getPostLoginPath(profile.role));
    }
    return { user, profile };
  }
  if (profile.role !== role) {
    redirect(getPostLoginPath(profile.role));
  }
  return { user, profile };
}

/** 캐시 충전 — 학생·멘토 (관리자 제외) */
export async function requireWalletChargeAccess(): Promise<{ user: User; profile: UserRow | null }> {
  const { user, profile: rawProfile } = await getServerUserWithProfile();
  if (!user) {
    redirect(await loginRedirectUrlForGuard("student"));
  }
  const profile = rawProfile ? await requireCompletedProfile(rawProfile) : null;
  if (profile?.role === "admin") {
    redirect(getPostLoginPath("admin"));
  }
  if (profile && profile.role !== "student" && profile.role !== "mentor") {
    redirect(getPostLoginPath(profile.role));
  }
  return { user, profile };
}

/**
 * QnA 서버 액션: `actor`(student|mentor)는 **public.users.profile.role** 만 신뢰.
 * formData의 `name="actor"` 는 권한에 사용하지 말 것(클라이언트 변조 방지).
 */
export async function requireQnaActor(): Promise<{
  user: User;
  profile: UserRow;
  actor: "student" | "mentor";
}> {
  const { user, profile: rawProfile, error } = await getServerUserWithProfile();
  if (error) {
    redirect("/login?error=profile");
  }
  if (!user) {
    redirect(await loginRedirectUrlForGuard("student"));
  }
  if (!rawProfile) {
    redirect("/login?error=profile");
  }
  const profile = await requireCompletedProfile(rawProfile);
  if (profile.role === "student" || profile.role === "mentor") {
    return { user, profile, actor: profile.role };
  }
  redirect(getPostLoginPath(profile.role));
}
