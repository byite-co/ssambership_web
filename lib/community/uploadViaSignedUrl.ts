"use client";

import { createClient } from "@/lib/supabase/client";
import type { UploadContract } from "@/lib/community/uploadContractActions";

/**
 * 브라우저에서 서명 업로드 계약(UploadContract)으로 Supabase Storage 에 파일을 직접 올린다.
 * 토큰이 정확한 bucket/path 를 인가하므로 세션 유무와 무관하게 이 경로 한정으로만 업로드된다.
 * 성공 시 계약의 ref(`bucket/path`)를 반환 — finalize 액션에 그대로 넘긴다.
 */
export async function uploadFileViaContract(
  contract: UploadContract,
  file: File,
): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(contract.bucket)
    .uploadToSignedUrl(contract.path, contract.token, file, {
      contentType: file.type || undefined,
    });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ref: contract.ref };
}

/**
 * 부분 업로드 실패 등으로 finalize 에 넘기지 못한, 이번 요청의 신규 Storage 객체를 즉시 정리한다.
 * 브라우저 세션이 소유자이므로 owner-scoped RLS(cpi_auth_delete_own / sfv_mentor_delete_own)로 삭제된다.
 * finalize 를 아예 호출하지 못한 경로에서 orphan 을 0 으로 유지하기 위한 클라이언트측 보상 삭제.
 */
export async function discardUploadedContracts(
  uploaded: { bucket: string; path: string }[],
): Promise<void> {
  if (uploaded.length === 0) return;
  const supabase = createClient();
  const byBucket = new Map<string, string[]>();
  for (const u of uploaded) {
    const list = byBucket.get(u.bucket) ?? [];
    list.push(u.path);
    byBucket.set(u.bucket, list);
  }
  await Promise.all(
    Array.from(byBucket.entries()).map(async ([bucket, paths]) => {
      const { error } = await supabase.storage.from(bucket).remove(paths);
      if (error) {
        // 정리 실패는 은폐하지 않는다 — 서버 finalize 보상과 병존, 최악의 경우 재정리 대상.
        console.error("[upload] 미등록 신규 객체 정리 실패", { bucket, paths, error: error.message });
      }
    }),
  );
}
