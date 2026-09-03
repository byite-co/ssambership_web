import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * `mentor_profiles.verification_status` 한 컬럼 전이 — PR-2b 의 보류·승인 취소 액션이 쓰는 쓰기 경로.
 *
 * 기존 승인·반려·재제출 액션(`mentorApprovalActions.runMentorProfileUpdate`)과 **같은 방식**이다:
 *   세션(admin JWT) 클라이언트로 먼저 시도 → RLS 거부면 service_role 로 한 번 더. 패치는 상태 컬럼 하나.
 *   `.in(from)` 게이트가 동시 결정을 막는다 — touched=false 는 "이미 다른 상태"(다른 관리자가 먼저 처리)다.
 * 새 테이블·RPC·트리거는 쓰지 않는다. 학교 인증 행·요금제 행은 이 모듈이 절대 건드리지 않는다.
 */

const TABLE = "mentor_profiles";
const STATUS_COLUMN = "verification_status";

export type MentorStatusTransitionResult = {
  /** 게이트(`from`)에 맞는 행이 있어 실제로 갱신됐는가 */
  touched: boolean;
  /** RLS 이외의 오류 원문(화면에는 toAdminDisplayError 를 거쳐 보인다) */
  errorMsg: string | null;
};

function isRlsDenied(message: string): boolean {
  return /permission|row-level|rls|denied|policy/i.test(message);
}

export async function transitionMentorVerificationStatus(
  mentorUserId: string,
  from: readonly string[],
  to: string
): Promise<MentorStatusTransitionResult> {
  const fromList = [...from];
  const patch: Record<string, unknown> = { [STATUS_COLUMN]: to };
  const exec = async (client: SupabaseClient) =>
    client.from(TABLE).update(patch).eq("user_id", mentorUserId).in(STATUS_COLUMN, fromList).select("user_id");

  const session = await createClient();
  const first = await exec(session);
  if (first.error && !isRlsDenied(first.error.message)) {
    return { touched: false, errorMsg: first.error.message };
  }
  if (!first.error && first.data && first.data.length > 0) {
    return { touched: true, errorMsg: null };
  }

  try {
    const sr = createServiceRoleClient();
    const second = await exec(sr);
    if (second.error) return { touched: false, errorMsg: second.error.message };
    if (second.data && second.data.length > 0) return { touched: true, errorMsg: null };
    return { touched: false, errorMsg: null };
  } catch {
    if (first.error) return { touched: false, errorMsg: first.error.message };
    return { touched: false, errorMsg: null };
  }
}
