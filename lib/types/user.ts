/**
 * public.users 1행에 대응하는 앱용 타입 (1차, 컬럼 늘어나면 동기화)
 */
export type AppRole = "student" | "mentor" | "admin";

export type UserRow = {
  id: string;
  /**
   * DB-5(206)부터 NULL 허용 — 소셜 가입 직후(프로필 완성 전) 행은 `role NULL · profile_completed_at NULL`.
   * 완성된 행은 CHECK `users_role_required_when_completed` 로 반드시 역할을 가진다.
   * 역할 분기 전에는 `isProfileIncomplete()`(lib/auth/profileCompletion) 로 완성 여부를 먼저 본다.
   */
  role: AppRole | null;
  /** 프로필 완성 시각(DB-5 206). NULL = 완성 전(소셜 가입 직후·대시보드 생성 계정) → `/complete-profile`. */
  profile_completed_at?: string | null;
  status: string;
  /** 정지 만료 시각(102 마이그레이션). suspended 전용, null=영구/미설정 */
  suspended_until?: string | null;
  /** 본인인증(NICE) 완료 시각(S-B m2). null=미인증 — identity 게이트 판독 컬럼 */
  identity_verified_at?: string | null;
  status_reason?: string | null;
  full_name: string | null;
  display_name?: string | null;
  nickname: string | null;
  email: string | null;
  grade_level: string | null;
  student_status: string | null;
  birth_date: string | null;
  terms_agreed_at: string | null;
  privacy_agreed_at: string | null;
  marketing_agreed: boolean;
  created_at: string;
  updated_at: string;
};
