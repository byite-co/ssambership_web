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
 * 스키마가 FK 컬럼 후보를 여럿 가지므로 순서대로 시도해 처음 잡히는 컬럼을 쓴다.
 */
export async function loadAdminDisputeDeliverables(
  supabase: SupabaseClient,
  orderId: string | null | undefined
): Promise<{ files: AdminDisputeDeliverableFile[]; error: string | null }> {
  const oid = String(orderId ?? "").trim();
  if (!oid) return { files: [], error: null };

  const fkCandidates = ["custom_request_order_id", "order_id", "custom_order_id", "request_order_id"] as const;
  let rows: Record<string, unknown>[] = [];
  let lastError: string | null = null;
  for (const fk of fkCandidates) {
    const { data, error } = await supabase
      .from("custom_order_deliverables")
      .select("*")
      .eq(fk, oid)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      lastError = error.message;
      continue;
    }
    if (data && data.length > 0) {
      rows = data as Record<string, unknown>[];
      lastError = null;
      break;
    }
    lastError = null;
  }
  if (rows.length === 0) return { files: [], error: lastError };

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
