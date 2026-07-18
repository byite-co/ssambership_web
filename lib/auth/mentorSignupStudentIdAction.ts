"use server";

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

/**
 * 가입 직후(이메일 인증 대기 등으로 세션이 없는 경우)에만 허용되는 업로드 창.
 * userId(UUID)는 signUp 응답으로 가입 당사자에게만 전달되므로, 이 창 안에서
 * "빈 학생증 칸 채우기"만 허용하면 제3자가 악용할 여지가 사실상 없다.
 */
const SIGNUP_UPLOAD_WINDOW_MS = 15 * 60 * 1000;

/**
 * 비인증 표면이므로 실패 사유를 세분해 노출하지 않는다 — 계정 존재·상태를
 * 응답 차이로 구분할 수 없도록 자격 관련 실패는 전부 이 문구 하나로 통일.
 */
const GENERIC_FAIL_MESSAGE = "가입 정보를 확인하지 못했습니다.";

type Result = { ok: boolean; message: string | null };

function fail(message: string): Result {
  return { ok: false, message };
}

/**
 * 멘토 가입 화면에서 첨부한 학생증을 세션 없이도 저장하는 서버 액션.
 *
 * 이메일 인증이 켜진 환경에서는 signUp이 세션 없이 반환되어 클라이언트가
 * Storage에 업로드할 수 없다(기존에는 파일이 그대로 유실됐다). 이 액션은
 * service role로 업로드를 대행하되 다음 조건을 모두 요구한다:
 * - 해당 userId의 auth 계정이 존재하고 생성된 지 15분 이내일 것
 * - 가입 메타데이터의 app_role이 mentor일 것
 * - mentor_profiles.student_id_image_url이 아직 비어 있을 것(덮어쓰기 불가)
 */
export async function uploadMentorStudentIdAfterSignUpAction(formData: FormData): Promise<Result> {
  const userIdRaw = formData.get("userId");
  const userId = typeof userIdRaw === "string" ? userIdRaw.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return fail(GENERIC_FAIL_MESSAGE);
  }

  const raw = formData.get("studentIdDocument");
  const file = raw instanceof File ? raw : null;
  if (!file || file.size <= 0) {
    return fail("학생증 또는 재학증명서 파일을 선택해 주세요.");
  }
  if (file.size > STUDENT_ID_IMAGE_MAX_BYTES) {
    return fail(`학생증 서류는 최대 ${STUDENT_ID_IMAGE_MAX_BYTES_LABEL}까지 업로드할 수 있습니다.`);
  }
  const extension = safeStudentIdImageFileExtension(file.name);
  if (!extension) {
    return fail("JPG, JPEG, PNG, PDF 형식의 서류만 업로드할 수 있습니다.");
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    // service role 미설정 환경 — 기존 사후 제출 경로(/mentor/verification)로 안내
    return fail("지금은 파일을 저장할 수 없습니다. 로그인 후 인증 화면에서 다시 제출해 주세요.");
  }

  // 자격 검증을 파일 버퍼링보다 먼저 수행한다(무자격 요청에 메모리 낭비 방지).
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError || !authUser?.user) {
    return fail(GENERIC_FAIL_MESSAGE);
  }
  const createdAtMs = Date.parse(authUser.user.created_at ?? "");
  if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > SIGNUP_UPLOAD_WINDOW_MS) {
    return fail(GENERIC_FAIL_MESSAGE);
  }
  if (authUser.user.user_metadata?.app_role !== "mentor") {
    return fail(GENERIC_FAIL_MESSAGE);
  }

  const { data: profile, error: profileError } = await admin
    .from("mentor_profiles")
    .select("user_id, student_id_image_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError || !profile) {
    return fail(GENERIC_FAIL_MESSAGE);
  }
  if (typeof profile.student_id_image_url === "string" && profile.student_id_image_url.trim()) {
    // 이미 제출된 상태 — 덮어쓰지 않는다.
    return { ok: true, message: null };
  }

  const bytes = await file.arrayBuffer();
  const verified = validateJpgPngPdfMagicBytes(bytes, extension);
  if (!verified.ok) {
    return fail(verified.error);
  }

  const objectPath = buildStudentIdImageObjectPath(userId, file.name);
  const storedRef = formatStudentIdImageStoredRef(objectPath);

  const { error: uploadError } = await admin.storage.from(STUDENT_ID_IMAGES_BUCKET).upload(objectPath, bytes, {
    contentType: verified.file.mimeType,
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) {
    return fail(mapDataErrorMessage(uploadError.message));
  }

  const { data: updated, error: updateError } = await admin
    .from("mentor_profiles")
    .update({ student_id_image_url: storedRef, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .or("student_id_image_url.is.null,student_id_image_url.eq.")
    .select("user_id");
  if (updateError) {
    await admin.storage.from(STUDENT_ID_IMAGES_BUCKET).remove([objectPath]);
    return fail(mapDataErrorMessage(updateError.message));
  }
  if (!updated?.length) {
    // 경합으로 이미 채워진 경우 — 방금 올린 객체만 정리하고 성공으로 처리
    await admin.storage.from(STUDENT_ID_IMAGES_BUCKET).remove([objectPath]);
  }
  return { ok: true, message: null };
}
