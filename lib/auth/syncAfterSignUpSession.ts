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
 * signUp 이후 세션이 있을 때: 가입 트리거가 만든 users 행을 검증한다(직접 쓰기 0).
 * 각 단계 try/catch 분리, 실패는 warning으로 누적(가입 자체는 이미 성공)
 */
export async function syncAfterSignUpWithSession(i: SyncInput): Promise<SyncResult> {
  const warnings: string[] = [];
  const supabase = createClient();

  // 수렴 M1: users 는 클라이언트 직접 UPDATE 불가(테이블 권한 회수 + 보호 트리거).
  // 프로필·동의·상태 필드는 전부 DB 가입 트리거(handle_new_auth_user)가
  // raw_user_meta_data 로부터 서버측에서 제공하는 것이 정본이다. 여기서는
  // 트리거 결과 행을 **검증만** 하고, 실패를 직접 쓰기로 우회하지 않는다.
  try {
    const { data: row, error } = await supabase
      .from("users")
      .select("id, role, nickname")
      .eq("id", i.userId)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!row) {
      warnings.push("[프로필 저장] 가입 프로필 행이 아직 준비되지 않았어요. 로그인 후 다시 확인해 주세요.");
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
  // 수렴 M1 이후 아래 필드는 가입 트리거가 auth 메타데이터에서 직접 소비한다 —
  // 클라이언트 재전송 0 (호출부 시그니처는 유지).
  void i.email;
  void i.role;
  void i.fullName;
  void i.nickname;
  void i.gradeLevel;
  void i.studentStatus;
  void i.birthDate;
  void i.termsAgree;
  void i.privacyAgree;
  void i.marketingAgree;

  return { warningMessages: warnings };
}
