/**
 * public.users 1행에 대응하는 앱용 타입 (1차, 컬럼 늘어나면 동기화)
 */
export type AppRole = "student" | "mentor" | "admin";

export type UserRow = {
  id: string;
  role: AppRole;
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
