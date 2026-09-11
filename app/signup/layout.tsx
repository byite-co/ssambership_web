import type { ReactNode } from "react";

// 웹 PR-2 후속(소셜 버튼 노출 게이트): `/signup` 은 클라이언트 페이지("use client")라 빌드 시 정적 프리렌더(○) 대상이었다.
// 소셜 버튼 게이트(방침 개정 시행일 2026-09-11 KST · `lib/legal/socialLoginRevision.ts`)가 빌드 시점이 아니라
// **요청 시점(서버 시계)** 에 평가되도록 세그먼트를 동적으로 고정한다 — 로그인 3페이지(쿠키 → 동적)와 같은 조건.
// 13일에 재배포 없이 0시(KST)부터 버튼이 노출된다. 페이지 본문·이메일 가입 경로는 무변경.
export const dynamic = "force-dynamic";

export default function SignupLayout({ children }: { children: ReactNode }) {
  return children;
}
