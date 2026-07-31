import { createClient } from "@/lib/supabase/client";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";
import type { AppRole } from "@/lib/types/user";

type SyncInput = {
  userId: string;
  email: string;
  role: Exclude<AppRole, "admin">;
  fullName: string;
  nickname: string;
  gradeLevel: string;
  studentStatus: string;
  birthDate: string;
  termsAgree: boolean;
  privacyAgree: boolean;
  marketingAgree: boolean;
  universityName: string;
  departmentName: string;
  teachingSubjectsCsv: string;
  highSchoolName: string;
  introLine: string;
  studentIdFile: File | null;
};

type SyncResult = { warningMessages: string[] };

/**
 * signUp 이후 세션이 있을 때: users/mentor upsert(트리거와 맞춤) + (멘토) Storage 업로드 + mentor_profiles URL 갱신
 * 각 단계 try/catch 분리, 실패는 warning으로 누적(가입 자체는 이미 성공)
 */
export async function syncAfterSignUpWithSession(i: SyncInput): Promise<SyncResult> {
  const warnings: string[] = [];
  const supabase = createClient();
  const now = new Date().toISOString();

  const birthDate = i.birthDate?.trim() ? i.birthDate : null;
  try {
    const { error } = await supabase.from("users").upsert(
      {
        id: i.userId,
        email: i.email,
        role: i.role,
        status: "active",
        full_name: i.fullName || null,
        nickname: i.nickname || null,
        grade_level: i.gradeLevel || null,
        student_status: i.studentStatus || null,
        birth_date: birthDate,
        terms_agreed_at: i.termsAgree ? now : null,
        privacy_agreed_at: i.privacyAgree ? now : null,
        marketing_agreed: i.marketingAgree,
        updated_at: now,
      },
      { onConflict: "id" }
    );
    if (error) {
      throw error;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`[프로필 저장] ${mapDataErrorMessage(msg)}`);
  }

  // W2(C6): 구 mentor_profiles 백업 upsert(브라우저 직접 쓰기 — verification_status
  // 포함)와 학생증 브라우저 업로드·student_id_image_url 직접 UPDATE 는 제거했다.
  // 프로필 행 생성은 DB 가입 트리거(handle_new_auth_user)가 정본이고, RPC/트리거
  // 실패를 직접 upsert 로 우회하지 않는다(계약 §20.3 M11 게이트 ③ 선행 조건).
  // 학생증 저장은 세션 유무와 무관하게 service_role 서버 액션
  // (uploadMentorStudentIdAfterSignUpAction)이 단일 경로다 — 호출은 가입 페이지가 한다.
  void i.universityName;
  void i.departmentName;
  void i.teachingSubjectsCsv;
  void i.highSchoolName;
  void i.introLine;
  void i.studentIdFile;

  return { warningMessages: warnings };
}
