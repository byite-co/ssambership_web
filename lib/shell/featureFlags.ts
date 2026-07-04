/**
 * 출시 준비 중 기능의 환경별 노출 토글.
 * 기본 OFF(운영 보호). 로컬·스테이징에서만 .env로 켠다.
 */
export function isCustomRequestFeatureEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_FEATURE_CUSTOM_REQUEST;
  if (typeof v !== "string") return false;
  const norm = v.trim().toLowerCase();
  return norm === "on" || norm === "1" || norm === "true" || norm === "yes";
}

/**
 * 계정 삭제(회원 탈퇴) — 정식 오픈(기본 ON). 스펙: docs/plans/account-deletion-spec.md
 * SQL 115(user_deletion_log · anonymize_user_for_deletion RPC) 라이브 적용 완료.
 * env로 명시적 OFF(off/0/false/no) 지정 시 비활성 — 긴급 킬 스위치.
 */
export function isAccountDeletionFeatureEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_FEATURE_ACCOUNT_DELETION;
  if (typeof v !== "string") return true;
  const norm = v.trim().toLowerCase();
  return !(norm === "off" || norm === "0" || norm === "false" || norm === "no");
}

/**
 * 사용자 차단(user_blocks) — 정식 오픈(기본 ON). 스펙: docs/plans/user-blocks-spec.md
 * SQL 116(user_blocks 테이블 · RLS) 라이브 적용 완료.
 * env로 명시적 OFF(off/0/false/no) 지정 시 비활성 — 긴급 킬 스위치.
 */
export function isUserBlocksEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_FEATURE_USER_BLOCKS;
  if (typeof v !== "string") return true;
  const norm = v.trim().toLowerCase();
  return !(norm === "off" || norm === "0" || norm === "false" || norm === "no");
}
