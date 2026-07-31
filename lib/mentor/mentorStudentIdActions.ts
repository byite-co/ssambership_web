"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  buildStudentIdImageObjectPath,
  formatStudentIdImageStoredRef,
  safeStudentIdImageFileExtension,
  STUDENT_ID_IMAGE_MAX_BYTES,
  STUDENT_ID_IMAGE_MAX_BYTES_LABEL,
  STUDENT_ID_IMAGES_BUCKET,
} from "@/lib/storage/studentIdImageStorage";
import { validateJpgPngPdfMagicBytes } from "@/lib/storage/uploadMagicBytes";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";

const PATH = "/mentor/verification";

function redirectWith(kind: "ok" | "error", message: string): never {
  const q = new URLSearchParams();
  q.set(kind === "ok" ? "studentIdDoc" : "studentIdDocError", message);
  redirect(`${PATH}?${q.toString()}`);
}

/**
 * 학생증(신분 확인) 서류 제출 — 가입 시 업로드가 실패·누락된 멘토의 사후 제출 경로.
 * 가입 화면의 학생증은 세션이 없어도 서버 액션(uploadMentorStudentIdAfterSignUpAction)이
 * 저장하지만, 그 업로드가 실패했거나 파일을 첨부하지 않은 멘토는 로그인 후 이 액션으로
 * 제출해 `mentor_profiles.student_id_image_url`을 채운다.
 */
export async function submitMentorStudentIdImageAction(formData: FormData) {
  const { user } = await requireRole("mentor");
  const raw = formData.get("studentIdDocument");
  const file = raw instanceof File ? raw : null;

  if (!file || file.size <= 0) {
    redirectWith("error", "학생증 또는 재학증명서 파일을 선택해 주세요.");
  }
  if (file.size > STUDENT_ID_IMAGE_MAX_BYTES) {
    redirectWith("error", `학생증 서류는 최대 ${STUDENT_ID_IMAGE_MAX_BYTES_LABEL}까지 업로드할 수 있습니다.`);
  }
  const extension = safeStudentIdImageFileExtension(file.name);
  if (!extension) {
    redirectWith("error", "JPG, JPEG, PNG, PDF 형식의 서류만 업로드할 수 있습니다.");
  }

  const bytes = await file.arrayBuffer();
  const verified = validateJpgPngPdfMagicBytes(bytes, extension);
  if (!verified.ok) {
    redirectWith("error", verified.error);
  }

  const supabase = await createClient();
  const objectPath = buildStudentIdImageObjectPath(user.id, file.name);
  const storedRef = formatStudentIdImageStoredRef(objectPath);

  const { error: uploadError } = await supabase.storage.from(STUDENT_ID_IMAGES_BUCKET).upload(objectPath, bytes, {
    contentType: verified.file.mimeType,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) {
    redirectWith("error", mapDataErrorMessage(uploadError.message));
  }

  // W2(C6): 인증서류 경로 반영은 service_role 로 수행한다(의도된 예외 — 목록화).
  // student_id_image_url 은 F7 allowlist 밖의 인증서류 컬럼이라 RPC 대상이 아니고,
  // 세션(authenticated) 직접 UPDATE 는 C6 게이트(직접 쓰기 0건)와 M11 회수 이후
  // 모두 성립하지 않는다. 본인(user.id) 행 한정 + 가입 창구 액션과 동일 패턴.
  let updateFailed: string | null = null;
  try {
    const admin = createServiceRoleClient();
    const { error: updateError } = await admin
      .from("mentor_profiles")
      .update({ student_id_image_url: storedRef, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);
    if (updateError) updateFailed = updateError.message;
  } catch (e) {
    updateFailed = e instanceof Error ? e.message : String(e);
  }
  if (updateFailed) {
    await supabase.storage.from(STUDENT_ID_IMAGES_BUCKET).remove([objectPath]);
    redirectWith("error", mapDataErrorMessage(updateFailed));
  }

  revalidatePath(PATH);
  redirectWith("ok", "학생증 서류를 제출했습니다. 관리자 확인 후 인증에 반영됩니다.");
}
