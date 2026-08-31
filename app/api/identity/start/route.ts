import { NextRequest, NextResponse } from "next/server";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  NICE_VID_COOKIE,
  startIdentityVerification,
  type IdentityVerificationKind,
} from "@/lib/identity/service";
import { resolveRequestOrigin } from "@/lib/http/requestOrigin";

// S-C: 본인인증 시작 (로그인 필수, kind 전이 규칙·스로틀은 service 가 검증).
// 인증 플로우는 게이트 플래그와 무관하게 상시 활성(부록 C).
//
// return_url 은 요청이 들어온 호스트(허용목록: ssambership.com / www.ssambership.com) 기준으로
// 조립한다 — 시작 호스트 == 복귀 호스트여야 host-only 세션 쿠키가 NICE 복귀 요청에 실린다.
// 허용목록 밖(프리뷰 등)은 APP_URL 폴백.

function isKind(value: unknown): value is IdentityVerificationKind {
  return value === "self" || value === "guardian";
}

export async function POST(req: NextRequest) {
  const { user, profile } = await getServerUserWithProfile();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "auth", message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }
  if (!profile) {
    return NextResponse.json(
      { ok: false, error: "profile", message: "계정 정보를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요." },
      { status: 403 }
    );
  }
  if (profile.role !== "student" && profile.role !== "mentor") {
    return NextResponse.json(
      { ok: false, error: "forbidden", message: "본인인증 대상 계정이 아닙니다." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "요청 정보가 올바르지 않습니다." },
      { status: 400 }
    );
  }
  const kind = (body as { kind?: unknown } | null)?.kind;
  if (!isKind(kind)) {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "요청 정보가 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const admin = createServiceRoleClient();
  const origin = resolveRequestOrigin(req.headers, { allowLocalhost: process.env.NODE_ENV !== "production" });
  const result = await startIdentityVerification(admin, { userId: user.id, kind, appUrl: origin ?? undefined });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.code, message: result.message },
      { status: result.status }
    );
  }

  const res = NextResponse.json({ ok: true, vid: result.vid, authUrl: result.authUrl });
  res.cookies.set(NICE_VID_COOKIE, result.vid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/identity",
    maxAge: 30 * 60,
  });
  return res;
}
