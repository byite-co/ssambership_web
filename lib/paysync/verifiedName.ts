import "server-only";

// 본인인증 실명 조회 — 무통장입금 기본 입금자명의 출처(§5).
//
// `identity_verifications.verified_name` 이 NICE 본인인증으로 확인된 실명이다.
// `kind='self'`(본인) · `status='verified'` 행만 본다 — 보호자(guardian) 인증 행의
// 이름은 결제 당사자가 아니다.
//
// service_role 로만 읽는다: 이 테이블은 클라이언트에 열려 있지 않다.

import type { SupabaseClient } from "@supabase/supabase-js";

export async function loadVerifiedSelfName(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("identity_verifications")
    .select("verified_name")
    .eq("user_id", userId)
    .eq("kind", "self")
    .eq("status", "verified")
    .not("verified_name", "is", null)
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // 기본값이 없을 뿐이라 흐름을 막지 않는다 — 사용자가 직접 입력하면 된다.
    console.error("[paysync/verifiedName]", error.code);
    return null;
  }
  const name = (data as { verified_name?: string | null } | null)?.verified_name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}
