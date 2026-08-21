// S-C 부록 C: 본인인증 게이트 롤아웃 플래그.
//
// IDENTITY_GATE_ENABLED (서버 전용 env — NEXT_PUBLIC_ 승격 금지):
//   미설정 또는 'true' 외 = 게이트 OFF. 배포 순서: off로 배포 → 스테이징 실측 → on.
//   (프록시/NICE 장애 시 전 로그인 유저가 온보딩에 감금되는 단일 장애점 방지)
//
// 플래그는 게이트(레이아웃 리다이렉트 + 머니패스 가드)에만 걸린다.
// 인증 플로우 자체(/onboarding/*, /api/identity/*)는 상시 활성.

import type { UserRow } from "@/lib/types/user";

export function isIdentityGateEnabled(): boolean {
  return process.env.IDENTITY_GATE_ENABLED?.trim() === "true";
}

/**
 * 레이아웃 게이트 판정 — 게이트 ON && 로그인 프로필 && identity_verified_at 미설정.
 * profile null(비로그인/프로필 조회 실패)은 기존 가드(requireRole)의 소관 — 게이트는 관여하지 않는다.
 */
export function needsIdentityOnboarding(profile: UserRow | null): boolean {
  if (!isIdentityGateEnabled()) return false;
  if (!profile) return false;
  return profile.identity_verified_at == null;
}
