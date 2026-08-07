"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import {
  buildMentorSchoolVerificationObjectPath,
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
  q.set(kind === "ok" ? "schoolDoc" : "schoolDocError", message);
  redirect(`${PATH}?${q.toString()}`);
}

function fileFromForm(formData: FormData): File | null {
  const raw = formData.get("schoolVerificationDocument");
  return raw instanceof File ? raw : null;
}

export async function submitMentorSchoolVerificationAction(formData: FormData) {
  const { user } = await requireRole("mentor");
  const file = fileFromForm(formData);

  if (!file || file.size <= 0) {
    redirectWith("error", "학교·전공 증명 서류 파일을 선택해 주세요.");
  }
  // D-MT-7: 같은 student-id-images 버킷을 쓰는 학생증 경로와 동일한 크기 상한을 적용한다
  // (임의 크기 파일이 arrayBuffer 로 전량 적재되던 스토리지·메모리 비대칭 제거).
  if (file.size > STUDENT_ID_IMAGE_MAX_BYTES) {
    redirectWith("error", `학교·전공 증명 서류는 최대 ${STUDENT_ID_IMAGE_MAX_BYTES_LABEL}까지 업로드할 수 있습니다.`);
  }
  const extension = safeStudentIdImageFileExtension(file.name);
  if (!extension) {
    redirectWith("error", "JPG, JPEG, PNG, PDF 형식의 서류만 업로드할 수 있습니다.");
  }

  const supabase = await createClient();
  const objectPath = buildMentorSchoolVerificationObjectPath(user.id, file.name);
  const storedRef = formatStudentIdImageStoredRef(objectPath);
  const bytes = await file.arrayBuffer();
  const verified = validateJpgPngPdfMagicBytes(bytes, extension);
  if (!verified.ok) {
    redirectWith("error", verified.error);
  }

  const { error: uploadError } = await supabase.storage.from(STUDENT_ID_IMAGES_BUCKET).upload(objectPath, bytes, {
    contentType: verified.file.mimeType,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) {
    redirectWith("error", mapDataErrorMessage(uploadError.message));
  }

  const { error: insertError } = await supabase.from("mentor_school_verifications").insert({
    mentor_id: user.id,
    status: "pending",
    document_storage_ref: storedRef,
  });

  if (insertError) {
    await supabase.storage.from(STUDENT_ID_IMAGES_BUCKET).remove([objectPath]);
    redirectWith("error", mapDataErrorMessage(insertError.message));
  }

  revalidatePath(PATH);
  redirectWith("ok", "학교·전공 증명 서류를 제출했습니다. 관리자 확인 후 인증됩니다.");
}
