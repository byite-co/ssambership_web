import { completeProfilePath, getPostLoginPath, resolvePostLoginPath, type ProfileRoleHint } from "./getPostLoginPath.ts";
import type { AppRole } from "@/lib/types/user";

/**
 * `api_app_v1.complete_profile` 계약(DB-5 206 · 보고서 §3)의 순수 코어 — 인자 조립 · 응답 해석 ·
 * 오류 코드 → 필드 오류 매핑 · `next` → 이동 경로. supabase·next 미의존(계약 테스트 공용).
 *
 * 시그니처: complete_profile(p_role, p_display_name, p_birthdate, p_terms_agreed, p_marketing_agreed,
 *   p_grade_level, p_university_name, p_department_name) returns jsonb
 * 성공: {ok:true, role, is_minor, next:'home'|'guardian_consent'|'identity_verification', nickname, profile_completed_at}
 * 실패: {ok:false, code: ...} — 동의 원장(user_consent_records)은 RPC 가 남기며 웹은 별도로 쓰지 않는다.
 */

export const COMPLETE_PROFILE_RPC = "complete_profile" as const;
export const COMPLETE_PROFILE_RPC_SCHEMA = "api_app_v1" as const;

export const DISPLAY_NAME_MAX_LENGTH = 30;
export const GRADE_LEVEL_MAX_LENGTH = 20;

export type CompleteProfileFormValues = {
  role: ProfileRoleHint;
  displayName: string;
  birthdate: string; // YYYY-MM-DD
  termsAgreed: boolean;
  marketingAgreed: boolean;
  gradeLevel: string;
  universityName: string;
  departmentName: string;
};

export type CompleteProfileRpcArgs = {
  p_role: ProfileRoleHint;
  p_display_name: string;
  p_birthdate: string;
  p_terms_agreed: boolean;
  p_marketing_agreed: boolean;
  p_grade_level: string | null;
  p_university_name: string | null;
  p_department_name: string | null;
};

function trimOrNull(v: string): string | null {
  const t = v.trim();
  return t ? t : null;
}

/** 폼 값 → RPC 인자. 학생은 대학·학과를, 멘토는 학년을 보내지 않는다(서버가 무시하지만 계약을 명시). */
export function buildCompleteProfileArgs(v: CompleteProfileFormValues): CompleteProfileRpcArgs {
  const isMentor = v.role === "mentor";
  return {
    p_role: v.role,
    p_display_name: v.displayName.trim(),
    p_birthdate: v.birthdate.trim(),
    p_terms_agreed: Boolean(v.termsAgreed),
    p_marketing_agreed: Boolean(v.marketingAgreed),
    p_grade_level: isMentor ? null : trimOrNull(v.gradeLevel),
    p_university_name: isMentor ? trimOrNull(v.universityName) : null,
    p_department_name: isMentor ? trimOrNull(v.departmentName) : null,
  };
}

export type CompleteProfileField = "role" | "displayName" | "birthdate" | "terms" | "gradeLevel" | "universityName";

export type CompleteProfileFieldError = { field: CompleteProfileField; message: string };

export const COMPLETE_PROFILE_FIELD_ERRORS: Record<string, CompleteProfileFieldError> = {
  ROLE_INVALID: { field: "role", message: "학생 또는 멘토를 선택해 주세요." },
  DISPLAY_NAME_REQUIRED: { field: "displayName", message: "표시 이름을 입력해 주세요." },
  DISPLAY_NAME_TOO_LONG: { field: "displayName", message: `표시 이름은 ${DISPLAY_NAME_MAX_LENGTH}자 이하로 입력해 주세요.` },
  BIRTHDATE_REQUIRED: { field: "birthdate", message: "생년월일을 입력해 주세요." },
  BIRTHDATE_INVALID: { field: "birthdate", message: "생년월일을 확인해 주세요. 오늘 이전, 1900년 이후여야 해요." },
  TERMS_REQUIRED: { field: "terms", message: "이용약관과 개인정보 처리방침에 동의해 주세요." },
  GRADE_REQUIRED: { field: "gradeLevel", message: "학년을 입력해 주세요." },
  GRADE_LEVEL_TOO_LONG: { field: "gradeLevel", message: `학년은 ${GRADE_LEVEL_MAX_LENGTH}자 이하로 입력해 주세요.` },
  UNIVERSITY_REQUIRED: { field: "universityName", message: "대학교 이름을 입력해 주세요." },
};

/** 계정 상태 거부 — 필드 오류가 아니라 화면 상단 안내. */
export const COMPLETE_PROFILE_ACCOUNT_ERRORS: Record<string, string> = {
  ACCOUNT_BANNED: "이용이 제한된 계정이에요. 고객센터에 문의해 주세요.",
  ACCOUNT_SUSPENDED: "일시 정지된 계정이에요. 정지 기간이 끝난 뒤 다시 시도해 주세요.",
  ACCOUNT_NOT_ACTIVE: "지금은 프로필을 완성할 수 없는 계정 상태예요. 고객센터에 문의해 주세요.",
  ACCOUNT_DELETION_IN_PROGRESS: "탈퇴가 진행 중인 계정이에요. 탈퇴를 취소한 뒤 다시 시도해 주세요.",
  AUTH_REQUIRED: "로그인이 만료됐어요. 다시 로그인해 주세요.",
  USER_NOT_FOUND: "계정 정보를 찾지 못했어요. 다시 로그인해 주세요.",
};

export const COMPLETE_PROFILE_GENERIC_ERROR = "프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.";

export type CompleteProfileNext = "home" | "guardian_consent" | "identity_verification";

export type CompleteProfileOutcome =
  | { kind: "done"; role: AppRole; next: CompleteProfileNext; isMinor: boolean; redirectTo: string }
  | { kind: "already_completed"; redirectTo: string }
  | { kind: "field_error"; field: CompleteProfileField; message: string; code: string }
  | { kind: "error"; message: string; code: string | null };

function readString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function isCompleteProfileNext(v: unknown): v is CompleteProfileNext {
  return v === "home" || v === "guardian_consent" || v === "identity_verification";
}

function isAppRole(v: unknown): v is AppRole {
  return v === "student" || v === "mentor" || v === "admin";
}

/** `next` 값 → 이동 경로. home 은 post-login(`nextPath` 존중), 나머지는 온보딩 고정 경로. */
export function completeProfileDestination(next: CompleteProfileNext, role: AppRole, nextPath?: string | null): string {
  if (next === "guardian_consent") return "/onboarding/guardian";
  if (next === "identity_verification") return "/onboarding/verify";
  return resolvePostLoginPath(nextPath ?? null, role);
}

/**
 * RPC 응답(jsonb envelope) 해석. `rpcError` 는 PostgREST 수준 오류(네트워크·권한 · 완성 전 RLS 등) —
 * 원문을 화면에 비추지 않고 일반 문구로 바꾼다.
 */
export function interpretCompleteProfileResponse(
  data: unknown,
  rpcError: { message?: string } | null | undefined,
  opts?: { nextPath?: string | null },
): CompleteProfileOutcome {
  if (rpcError) {
    return { kind: "error", message: COMPLETE_PROFILE_GENERIC_ERROR, code: null };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { kind: "error", message: COMPLETE_PROFILE_GENERIC_ERROR, code: null };
  }
  const o = data as Record<string, unknown>;
  if (o.ok === true) {
    const role = isAppRole(o.role) ? o.role : null;
    const next = isCompleteProfileNext(o.next) ? o.next : "home";
    if (!role) return { kind: "error", message: COMPLETE_PROFILE_GENERIC_ERROR, code: null };
    return {
      kind: "done",
      role,
      next,
      isMinor: o.is_minor === true,
      redirectTo: completeProfileDestination(next, role, opts?.nextPath ?? null),
    };
  }
  const code = readString(o, "code");
  if (code === "ALREADY_COMPLETED") {
    const role = isAppRole(o.role) ? o.role : null;
    return { kind: "already_completed", redirectTo: role ? resolvePostLoginPath(opts?.nextPath ?? null, role) : getPostLoginPath(null) };
  }
  if (code && COMPLETE_PROFILE_FIELD_ERRORS[code]) {
    const fe = COMPLETE_PROFILE_FIELD_ERRORS[code];
    return { kind: "field_error", field: fe.field, message: fe.message, code };
  }
  if (code && COMPLETE_PROFILE_ACCOUNT_ERRORS[code]) {
    return { kind: "error", message: COMPLETE_PROFILE_ACCOUNT_ERRORS[code], code };
  }
  return { kind: "error", message: COMPLETE_PROFILE_GENERIC_ERROR, code };
}

/** 클라이언트 사전 검증(서버와 같은 규칙 · 왕복 절약) — 서버 판정이 정본이며 여기서 통과해도 RPC 오류는 그대로 표시한다. */
export function validateCompleteProfileForm(v: CompleteProfileFormValues): Partial<Record<CompleteProfileField, string>> {
  const errors: Partial<Record<CompleteProfileField, string>> = {};
  const name = v.displayName.trim();
  if (!name) errors.displayName = COMPLETE_PROFILE_FIELD_ERRORS.DISPLAY_NAME_REQUIRED.message;
  else if (name.length > DISPLAY_NAME_MAX_LENGTH) errors.displayName = COMPLETE_PROFILE_FIELD_ERRORS.DISPLAY_NAME_TOO_LONG.message;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.birthdate.trim())) errors.birthdate = COMPLETE_PROFILE_FIELD_ERRORS.BIRTHDATE_REQUIRED.message;
  if (!v.termsAgreed) errors.terms = COMPLETE_PROFILE_FIELD_ERRORS.TERMS_REQUIRED.message;
  if (v.role === "student") {
    const grade = v.gradeLevel.trim();
    if (!grade) errors.gradeLevel = COMPLETE_PROFILE_FIELD_ERRORS.GRADE_REQUIRED.message;
    else if (grade.length > GRADE_LEVEL_MAX_LENGTH) errors.gradeLevel = COMPLETE_PROFILE_FIELD_ERRORS.GRADE_LEVEL_TOO_LONG.message;
  } else if (!v.universityName.trim()) {
    errors.universityName = COMPLETE_PROFILE_FIELD_ERRORS.UNIVERSITY_REQUIRED.message;
  }
  return errors;
}

/** 완성 화면 진입 시 `?role_hint`·`?next` 를 잃지 않고 재진입하는 경로(로그인 만료 등). */
export function completeProfileReentryPath(roleHint: unknown, nextPath: string | null | undefined): string {
  return completeProfilePath({ roleHint, next: nextPath });
}
