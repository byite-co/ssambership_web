import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DELIVERABLE_STORAGE_BUCKET,
  pickStoragePathFromDeliverableRow,
} from "@/lib/customRequest/orderDeliverableFiles";
import { createSignedStorageUrl } from "@/lib/storage/signedStorageUrl";
import { getStringField } from "@/lib/qna/safeSelect";

const SIGNED_URL_TTL_SEC = 300;

export type AdminDisputeDeliverableFile = {
  id: string;
  version: number | null;
  status: string | null;
  fileName: string | null;
  mimeType: string | null;
  createdAt: string | null;
  signedUrl: string | null;
};

/**
 * 분쟁에 연결된 맞춤의뢰 주문의 납품물 목록 + 단기(5분) signed URL.
 * W4(C10): custom_order_deliverables.custom_request_order_id 는 NOT NULL FK(003 SQL, 187 baseline 실측)라
 * 모든 행이 이 컬럼으로 도달 가능 — legacy 별칭(order_id/custom_order_id/request_order_id) 재시도 루프 제거,
 * 단일 고정 쿼리로 정본화. 에러는 삼키지 않고 error 로 반환(빈 결과 0건과 구분).
 */
export async function loadAdminDisputeDeliverables(
  supabase: SupabaseClient,
  orderId: string | null | undefined
): Promise<{ files: AdminDisputeDeliverableFile[]; error: string | null }> {
  const oid = String(orderId ?? "").trim();
  if (!oid) return { files: [], error: null };

  const { data, error } = await supabase
    .from("custom_order_deliverables")
    .select("*")
    .eq("custom_request_order_id", oid)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { files: [], error: error.message };

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return { files: [], error: null };

  const files: AdminDisputeDeliverableFile[] = [];
  for (const row of rows) {
    const storagePath = pickStoragePathFromDeliverableRow(row);
    let signedUrl: string | null = null;
    if (storagePath && !storagePath.startsWith("http://") && !storagePath.startsWith("https://")) {
      const signed = await createSignedStorageUrl(supabase, DELIVERABLE_STORAGE_BUCKET, storagePath, SIGNED_URL_TTL_SEC);
      signedUrl = signed.error ? null : signed.url;
    }
    const versionRaw = row.version;
    files.push({
      id: String(row.id ?? ""),
      version: typeof versionRaw === "number" && Number.isFinite(versionRaw) ? versionRaw : null,
      status: getStringField(row, ["status", "state"]),
      fileName: getStringField(row, ["original_filename", "file_name", "filename"]),
      mimeType: getStringField(row, ["mime_type", "content_type"]),
      createdAt: getStringField(row, ["created_at"]),
      signedUrl,
    });
  }
  return { files, error: null };
}
