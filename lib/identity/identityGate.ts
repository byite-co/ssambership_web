import "server-only";

// S-C: 머니패스 서버 가드 — 웹 서버 계층(라우트 핸들러·서버 액션) 한정.
//
// 삽입 지점(감사확인-6 / 부록 B): 구독 생성 · 개별질문 결제(에스크로 생성) ·
// 맞춤형 주문(에스크로 홀드) · 멘토 지원. DB/RPC 레벨 가드는 절대 금지 —
// 앱 부팅 fail-closed RPC 3종·IQ 에스크로·지갑 뷰의 직접 RPC 경로는 정책상
// 비대상(앱 재배포 없음 전제, 부록 B).
//
// 403 형식: HTTP 403 + message 가 `IDENTITY_REQUIRED` 로 시작해야 한다
// (앱 에러 매퍼는 message 선두 대문자 토큰만 읽는다 — code 필드만으로는 인식 불가).

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { isIdentityGateEnabled } from "@/lib/identity/identityGateFlag";

export const IDENTITY_REQUIRED_CODE = "IDENTITY_REQUIRED" as const;
/** 앱 에러 매퍼 계약: 선두 대문자 토큰 = IDENTITY_REQUIRED */
export const IDENTITY_REQUIRED_MESSAGE =
  "IDENTITY_REQUIRED: 본인인증 후 이용할 수 있어요. 웹에서 본인인증을 완료해 주세요.";

export type VerifiedIdentityCheck =
  | { ok: true }
  | { ok: false; code: typeof IDENTITY_REQUIRED_CODE; message: string };

/**
 * 머니패스 진입점 공용 가드. 게이트 플래그 OFF 면 통과(부록 C — 가드도 플래그 종속).
 * 판독 실패는 fail-closed(403) — 결제는 재시도 가능하지만 미인증 결제는 되돌릴 수 없다.
 */
export async function requireVerifiedIdentity(userId: string): Promise<VerifiedIdentityCheck> {
  if (!isIdentityGateEnabled()) {
    return { ok: true };
  }
  if (!userId) {
    return { ok: false, code: IDENTITY_REQUIRED_CODE, message: IDENTITY_REQUIRED_MESSAGE };
  }
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("users")
    .select("id, identity_verified_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[identity-gate] identity_verified_at 판독 실패 — fail-closed", {
      userId,
      message: error.message,
    });
    return { ok: false, code: IDENTITY_REQUIRED_CODE, message: IDENTITY_REQUIRED_MESSAGE };
  }
  if (!data || !data.identity_verified_at) {
    return { ok: false, code: IDENTITY_REQUIRED_CODE, message: IDENTITY_REQUIRED_MESSAGE };
  }
  return { ok: true };
}

/** 라우트 핸들러용 403 응답 (message 선두 토큰 계약 준수) */
export function identityRequiredJsonResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: IDENTITY_REQUIRED_CODE, message: IDENTITY_REQUIRED_MESSAGE },
    { status: 403 }
  );
}
