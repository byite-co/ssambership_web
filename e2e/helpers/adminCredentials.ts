import { loadEnvLocal } from "./env";

/**
 * 관리자 E2E 자격증명 helper — Claude Code Cloud 환경변수 입력 제한 보정.
 *
 * 계약(수렴 지시서 §30):
 * - `E2E_ADMIN_PASSWORD` 는 **실제 비밀번호에서 마지막 `#` 만 제외한 base 값**이다.
 * - 실제 로그인 비밀번호는 실행 중 메모리에서 `base + '#'` 로만 조립한다.
 * - base 가 이미 `#` 로 끝나면 중복해서 붙이지 않는다.
 * - 이 보정은 **관리자 계정에만** 적용한다. 학생/멘토/기타 계정 비밀번호에
 *   `#` 를 임의로 추가하지 마라.
 * - 완성된 비밀번호를 파일·로그·리포트·트레이스에 기록하지 마라.
 *
 * 모든 관리자 E2E 로그인은 반드시 이 helper 를 사용한다(단일 경로).
 * 레거시 `E2E_ADMIN_PW` 는 suffix 보정 없이 그대로 쓰는 완전한 비밀번호로 취급한다
 * (기존 로컬 환경 호환 — cloud 계약과 혼용 금지).
 */
export function getE2EAdminCredentials(): { email: string; password: string } {
  const env = loadEnvLocal();
  const email = (env.E2E_ADMIN_EMAIL ?? process.env.E2E_ADMIN_EMAIL ?? "").trim();
  const passwordBase = env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD;
  const legacyFull = env.E2E_ADMIN_PW ?? process.env.E2E_ADMIN_PW;

  if (!email) {
    throw new Error("E2E_ADMIN_EMAIL is required");
  }

  if (passwordBase) {
    // Claude Code Cloud 환경변수 입력 제한으로 누락된 마지막 #을 복원한다.
    const password = passwordBase.endsWith("#")
      ? passwordBase
      : `${passwordBase}${String.fromCharCode(35)}`;
    return { email, password };
  }

  if (legacyFull) {
    return { email, password: legacyFull };
  }

  throw new Error("E2E_ADMIN_PASSWORD is required");
}

/** 실행 전 검증 리포트 — 값 자체는 절대 출력하지 않는다. */
export function reportE2EAdminCredentialPresence(): {
  E2E_ADMIN_EMAIL_PRESENT: "YES" | "NO";
  E2E_ADMIN_PASSWORD_BASE_PRESENT: "YES" | "NO";
  E2E_ADMIN_PASSWORD_SUFFIX_RESTORED: "YES" | "NO";
  E2E_ADMIN_PASSWORD_LOGGED: "NO";
} {
  const env = loadEnvLocal();
  const email = (env.E2E_ADMIN_EMAIL ?? process.env.E2E_ADMIN_EMAIL ?? "").trim();
  const base = env.E2E_ADMIN_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD ?? "";
  return {
    E2E_ADMIN_EMAIL_PRESENT: email ? "YES" : "NO",
    E2E_ADMIN_PASSWORD_BASE_PRESENT: base ? "YES" : "NO",
    E2E_ADMIN_PASSWORD_SUFFIX_RESTORED: base && !base.endsWith("#") ? "YES" : "NO",
    E2E_ADMIN_PASSWORD_LOGGED: "NO",
  };
}
