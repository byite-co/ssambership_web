"use server";

import { randomUUID } from "crypto";
import { getServerAuthUser } from "@/lib/auth/getCurrentUser";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { assertAccountActive } from "@/lib/auth/accountStatus";
import { createClient } from "@/lib/supabase/server";
import { COMMUNITY_POST_IMAGES_BUCKET } from "@/lib/community/communityStorage";
import {
  SHORTFORM_VIDEO_BUCKET,
  SHORTFORM_VIDEO_MAX_BYTES,
} from "@/lib/community/communityShortformConstants";

/**
 * Staged direct-upload 계약(P0-4 게시판 이미지 · P2-24 숏폼 영상).
 *
 * 큰 바이너리를 Next Server Action/Route 본문으로 보내면 body 제한(25MB)에 걸려 413 이 난다.
 * 대신 서버가 "인증 사용자 기준 bucket/path 로 한정된 서명 업로드 계약"만 발급하고,
 * 브라우저가 그 토큰으로 Supabase Storage 에 직접 올린다. finalize 액션에는 storage ref 만 넘긴다.
 *
 * 안전:
 *  - path 는 항상 서버가 `{auth.uid()}/{uuid}.{ext}` 로 고정 — 클라이언트가 임의 bucket/path 를 못 고른다.
 *  - createSignedUploadUrl 자체가 storage RLS(INSERT: 소유 폴더 + 숏폼은 is_mentor())로 재검사된다.
 *  - MIME·확장자·크기를 계약 발급 시 1차 검증하고, 버킷의 allowed_mime_types·file_size_limit 가
 *    실제 업로드에서 최종 강제한다(잘못된 형식/초과 크기는 storage 가 거부).
 */

export type UploadContract = {
  bucket: string;
  /** 서명이 허용하는 정확한 객체 경로. 브라우저는 이 path 로만 업로드할 수 있다. */
  path: string;
  /** uploadToSignedUrl 에 넘길 1회용 토큰. */
  token: string;
  /** DB 에 저장/finalize 로 넘길 `bucket/path` 참조. */
  ref: string;
};

export type UploadContractResult =
  | ({ ok: true } & UploadContract)
  | { ok: false; error: string };

const VIDEO_MIME_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

const IMAGE_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const COMMUNITY_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function sanitizeName(name: string | undefined): string {
  const safe = (name ?? "image").replace(/[^\w.\-]+/g, "_").slice(0, 40);
  return safe || "image";
}

/** 숏폼 영상 1건의 직접 업로드 계약 발급. 멘토 + 활성 계정만. */
export async function createShortformVideoUploadContract(input: {
  contentType: string;
  sizeBytes: number;
}): Promise<UploadContractResult> {
  const { user } = await getServerAuthUser();
  if (!user) return { ok: false, error: "auth" };

  const supabase = await createClient();
  const acct = await assertAccountActive(supabase, user.id);
  if (!acct.ok) return { ok: false, error: "account_blocked" };
  const { data: profile } = await getUserProfileById(supabase, user.id);
  if (profile?.role !== "mentor") return { ok: false, error: "mentor_only" };

  const mime = (input.contentType ?? "").trim().toLowerCase();
  const ext = VIDEO_MIME_EXT[mime];
  if (!ext) return { ok: false, error: "video_type" };
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, error: "video" };
  if (input.sizeBytes > SHORTFORM_VIDEO_MAX_BYTES) return { ok: false, error: "video_size" };

  const path = `${user.id}/${randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from(SHORTFORM_VIDEO_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) return { ok: false, error: "video_upload" };
  return {
    ok: true,
    bucket: SHORTFORM_VIDEO_BUCKET,
    path,
    token: data.token,
    ref: `${SHORTFORM_VIDEO_BUCKET}/${path}`,
  };
}

/** 커뮤니티 게시판 이미지 1건의 직접 업로드 계약 발급. 활성 계정만(작성 권한은 finalize 가 재검사). */
export async function createCommunityImageUploadContract(input: {
  contentType: string;
  sizeBytes: number;
  fileName?: string;
}): Promise<UploadContractResult> {
  const { user } = await getServerAuthUser();
  if (!user) return { ok: false, error: "auth" };

  const supabase = await createClient();
  const acct = await assertAccountActive(supabase, user.id);
  if (!acct.ok) return { ok: false, error: "account_blocked" };

  const mime = (input.contentType ?? "").trim().toLowerCase();
  const ext = IMAGE_MIME_EXT[mime];
  if (!ext) return { ok: false, error: "image_type" };
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return { ok: false, error: "image" };
  if (input.sizeBytes > COMMUNITY_IMAGE_MAX_BYTES) return { ok: false, error: "image_size" };

  const path = `${user.id}/${randomUUID()}-${sanitizeName(input.fileName)}.${ext}`;
  const { data, error } = await supabase.storage
    .from(COMMUNITY_POST_IMAGES_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data?.token) return { ok: false, error: "upload" };
  return {
    ok: true,
    bucket: COMMUNITY_POST_IMAGES_BUCKET,
    path,
    token: data.token,
    ref: `${COMMUNITY_POST_IMAGES_BUCKET}/${path}`,
  };
}
