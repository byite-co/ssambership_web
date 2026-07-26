/**
 * 학교·전공 인증 승인 — 서버 정본 RPC 계약(순수 헬퍼).
 *
 * 승인은 `public.approve_mentor_school_verification_admin`(SQL 174) **한 경로**로만 수행한다.
 * RPC 가 하는 일(웹에서 재구현하지 않는다):
 *   - `is_admin()` 관리자 확인(mentor·student·anon 거부)
 *   - `document_storage_ref` 존재·파싱·소유 경로 검증
 *   - `storage.objects` 실제 객체 행 존재 확인
 *   - 재승인 시 기존 approved → `superseded` 전이 후 대상 행 승인(같은 트랜잭션)
 * 어느 단계든 실패하면 예외로 전체 rollback 된다(승인 0 · 기존 approved 변경 0).
 *
 * ★ 호출 클라이언트: **관리자 세션 클라이언트**여야 한다. RPC 의 `is_admin()` 은 호출자
 *   JWT 의 `auth.uid()` 를 읽으므로, service role 클라이언트로 부르면 `auth.uid()` 가 NULL 이라
 *   정상 관리자도 NOT_ADMIN 으로 거부된다.
 */

export const APPROVE_MENTOR_SCHOOL_VERIFICATION_RPC =
  "approve_mentor_school_verification_admin" as const;

export type ApproveMentorSchoolVerificationParams = {
  p_verification_id: string;
  p_university_name: string;
  p_university_id: string;
  p_department_name: string;
  p_major_category: string;
  p_school_tier: string;
};

export function buildApproveMentorSchoolVerificationParams(input: {
  verificationId: string;
  universityName: string;
  universityId: string;
  departmentName: string;
  majorCategory: string;
  schoolTier: string;
}): ApproveMentorSchoolVerificationParams {
  return {
    p_verification_id: input.verificationId,
    p_university_name: input.universityName,
    p_university_id: input.universityId,
    p_department_name: input.departmentName,
    p_major_category: input.majorCategory,
    p_school_tier: input.schoolTier,
  };
}

/** RPC 성공 반환(jsonb) — 서류 내용·signed URL·토큰은 포함하지 않는다. */
export type ApproveMentorSchoolVerificationResult = {
  verificationId: string;
  mentorId: string;
  supersededCount: number;
};

export function parseApproveMentorSchoolVerificationResult(
  data: unknown
): ApproveMentorSchoolVerificationResult | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const verificationId = row.verification_id;
  const mentorId = row.mentor_id;
  if (typeof verificationId !== "string" || typeof mentorId !== "string") return null;
  const superseded = row.superseded_count;
  return {
    verificationId,
    mentorId,
    supersededCount: typeof superseded === "number" ? superseded : 0,
  };
}

/**
 * RPC 예외 메시지 → 관리자용 한글 안내.
 * 경로·토큰·서류 내용은 노출하지 않는다(원문 메시지를 그대로 흘리지 않는다).
 */
export function mapApproveMentorSchoolVerificationError(raw: string | null | undefined): string {
  const message = typeof raw === "string" ? raw : "";

  if (message.includes("NOT_ADMIN")) {
    return "관리자 권한이 없어 승인할 수 없습니다.";
  }
  if (message.includes("VERIFICATION_NOT_FOUND")) {
    return "학교·전공 인증 요청을 찾을 수 없습니다.";
  }
  if (message.includes("NOT_REVIEWABLE")) {
    return "이미 처리되었거나 심사 대기 상태가 아닌 요청입니다.";
  }
  if (message.includes("DOCUMENT_REF_MISSING")) {
    return "제출된 증빙 서류가 없어 승인할 수 없습니다. 재제출을 요청해 주세요.";
  }
  if (message.includes("DOCUMENT_REF_UNPARSEABLE") || message.includes("DOCUMENT_REF_OWNER_MISMATCH")) {
    return "증빙 서류 참조가 올바르지 않아 승인할 수 없습니다. 재제출을 요청해 주세요.";
  }
  if (message.includes("DOCUMENT_OBJECT_NOT_FOUND")) {
    return "증빙 서류 파일을 찾을 수 없어 승인할 수 없습니다. 재제출을 요청해 주세요.";
  }
  if (message.includes("INVALID_INPUT")) {
    return "승인하려면 학교명, 학과명, 전공 계열, 학교군을 모두 입력해야 합니다.";
  }
  if (message.includes("uq_msv_one_approved_per_mentor")) {
    return "다른 승인이 동시에 처리되었습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.";
  }
  return "학교·전공 인증을 승인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
