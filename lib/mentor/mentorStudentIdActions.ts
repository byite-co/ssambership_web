"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import {
  buildStudentIdImageObjectPath,
  formatStudentIdImageStoredRef,
  safeStudentIdImageFileExtension,
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
 * 학생증(신분 확인) 서류 제출 — 가입 시 업로드가 누락된 멘토의 사후 제출 경로.
 * 이메일 인증이 필요한 가입 플로우에서는 세션이 없어 가입 화면의 학생증 파일이
 * 저장되지 못하므로, 로그인 후 이 액션으로 제출해 `mentor_profiles.student_id_image_url`을 채운다.
 */
export async function submitMentorStudentIdImageAction(formData: FormData) {
  const { user } = await requireRole("mentor");
  const raw = formData.get("studentIdDocument");
  const file = raw instanceof File ? raw : null;

  if (!file || file.size <= 0) {
    redirectWith("error", "학생증 또는 재학증명서 파일을 선택해 주세요.");
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

  const { error: updateError } = await supabase
    .from("mentor_profiles")
    .update({ student_id_image_url: storedRef, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  if (updateError) {
    await supabase.storage.from(STUDENT_ID_IMAGES_BUCKET).remove([objectPath]);
    redirectWith("error", mapDataErrorMessage(updateError.message));
  }

  revalidatePath(PATH);
  redirectWith("ok", "학생증 서류를 제출했습니다. 관리자 확인 후 인증에 반영됩니다.");
}
