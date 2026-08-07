"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { canAccessOrder } from "@/lib/customRequest/orderAccess";
import { sanitizeTrustSafetyText } from "@/lib/safety/trustSafetyText";
import { getActiveDisputeBlockMessage } from "@/lib/customRequest/orderDisputeHelpers";
import { isCustomRequestOrderStatusDdlInRepo, MENTOR_START_SCHEMA_GATE_MESSAGE } from "@/lib/customRequest/orderSchemaGate";
import {
  ORDER_INSERT_STATUS_PENDING,
  ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS,
  ORDER_STATUSES_MENTOR_START_WORK_ALLOWED,
  isOrderRowTerminalForActions,
  normalizedPrimaryOrderStatus,
  primaryOrderStatusColumnKey,
} from "@/lib/customRequest/orderLifecycleConstants";
// W4(C10): 테이블/컬럼 프로빙 제거 — custom_request_orders·custom_order_deliverables 정본 고정(187 baseline 실측)
import { buildOrderChildIdColumns, ORDER_CHILD_FK_COLUMN } from "@/lib/customRequest/customRequestQueries";
import { nextDeliverableVersionFromRows } from "@/lib/customRequest/deliverableVersion";
import {
  buildDeliverableRowPayload,
  buildDeliverableStorageObjectPath,
  buildDeliverableSubmittedEventMetadataFromRow,
  DELIVERABLE_STORAGE_BUCKET,
  getDeliverableFileFromFormData,
  getOriginalFilenameForDisplay,
  removeStorageObjectBestEffort,
  validateDeliverableFileMagicBytes,
  validateDeliverableFileForUpload,
  validateDeliverableStoragePath,
} from "@/lib/customRequest/orderDeliverableFiles";
import { isCustomOrderPaymentConfirmed } from "@/lib/customRequest/orderPaymentPolicy";
import { recordOrderEventBestEffort } from "@/lib/customRequest/orderRoomMutations";
import { markCustomOrderDeliveredRpc, startCustomOrderWorkRpc } from "@/lib/customRequest/orderTransitionRpc";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

function orderPath(orderId: string) {
  return `/custom-request/orders/${encodeURIComponent(orderId)}`;
}

function redirectWithError(orderId: string, msg: string): never {
  redirect(`${orderPath(orderId)}?error=${encodeURIComponent(msg)}`);
}

/**
 * 멘토 작업 시작: primary 상태가 허용 집합(예: pending/open)일 때만 `in_progress` 등으로 전이.
 * insert 직후 값은 `insertCustomRequestOrder`·스키마에 따름.
 */
export async function startCustomOrderWorkAction(formData: FormData): Promise<void> {
  const { user } = await requireRole("mentor");
  const supabase = await createClient();
  const orderId = String(formData.get("orderId") ?? "").trim();
  if (!orderId) {
    redirect("/custom-request?error=" + encodeURIComponent("orderId가 필요합니다."));
  }

  if (!isCustomRequestOrderStatusDdlInRepo()) {
    redirectWithError(orderId, MENTOR_START_SCHEMA_GATE_MESSAGE);
  }

  const { data: rowData, error: oe } = await supabase
    .from("custom_request_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (oe || !rowData) {
    redirectWithError(orderId, oe?.message ?? "주문 정보를 찾을 수 없습니다.");
  }
  const row = rowData as Row;

  const access = canAccessOrder(row, user.id, "mentor");
  if (!access.ok) {
    redirectWithError(orderId, "이 주문에 접근할 수 없습니다.");
  }

  // W4(C10): custom_request_orders.mentor_id(NOT NULL) 정본 — 멘토 컬럼 프로빙 제거
  if (String(row.mentor_id) !== user.id) {
    redirectWithError(orderId, "배정된 멘토 본인만 작업을 시작할 수 있습니다.");
  }

  const disputeBlockStart = await getActiveDisputeBlockMessage(supabase, orderId);
  if (disputeBlockStart) {
    redirectWithError(orderId, disputeBlockStart);
  }

  if (!isCustomOrderPaymentConfirmed(row)) {
    redirectWithError(orderId, "학생 측 결제가 완료된 뒤에만 작업을 시작할 수 있습니다.");
  }

  const norm = normalizedPrimaryOrderStatus(row);
  if (!norm) {
    redirectWithError(orderId, "주문 상태를 확인할 수 없어 작업을 시작할 수 없습니다.");
  }
  if (isOrderRowTerminalForActions(row)) {
    redirectWithError(orderId, "완료된 주문에서는 작업을 시작할 수 없습니다.");
  }
  if (norm === ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS) {
    redirectWithError(orderId, "이미 작업이 시작된 상태입니다.");
  }
  if (!ORDER_STATUSES_MENTOR_START_WORK_ALLOWED.has(norm)) {
    redirectWithError(orderId, `현재 상태(${norm})에서는 작업을 시작할 수 없습니다.`);
  }

  const stCol = primaryOrderStatusColumnKey(row);
  if (!stCol) {
    redirectWithError(orderId, "주문 상태 컬럼을 찾을 수 없습니다.");
  }

  const transition = await startCustomOrderWorkRpc(supabase, orderId);
  if (!transition.ok) {
    redirectWithError(orderId, transition.error);
  }

  await recordOrderEventBestEffort(supabase, orderId, "order_started", user.id, { from: norm });

  revalidatePath(orderPath(orderId));
  revalidatePath("/custom-request");
  revalidatePath("/mentor/custom-request/orders");
  redirect(`${orderPath(orderId)}?ok=${encodeURIComponent("작업을 시작했습니다.")}`);
}

function isPostgresUniqueViolation(e: { code?: string; message?: string } | null | undefined): boolean {
  if (e?.code === "23505") {
    return true;
  }
  const m = (e?.message ?? "").toLowerCase();
  return m.includes("duplicate key") || m.includes("unique constraint");
}

/**
 * custom_order_deliverables insert + Storage(비공개 버킷) 업로드 + primary open → delivered.
 * FormData: orderId, deliverableFile(optional), deliverableBody(노트·텍스트, 파일 없을 때는 필수).
 */
export async function submitMentorOrderDeliverableAction(formData: FormData): Promise<void> {
  const { user } = await requireRole("mentor");
  const supabase = await createClient();
  const orderId = String(formData.get("orderId") ?? "").trim();
  const note = String(formData.get("deliverableBody") ?? "").trim();
  const file = getDeliverableFileFromFormData(formData, "deliverableFile");

  if (!orderId) {
    redirect("/custom-request?error=" + encodeURIComponent("orderId가 필요합니다."));
  }
  if (!file && !note) {
    redirectWithError(orderId, "납품 파일을 선택하거나 납품 설명(텍스트)을 입력하세요.");
  }

  // 안전필터(납품 메모): 멘토→학생 노출 통로 → 연락처 마스킹 + 대필 차단.
  // 파일 업로드 전에 차단하여 고아 업로드를 막고, 차단 시 오탐 감시 로그를 남긴다.
  let safeNote = note;
  if (note) {
    const noteSafety = sanitizeTrustSafetyText(note);
    if (!noteSafety.ok) {
      console.warn("[deliverable-note-blocked]", { orderId, bannedPhrase: noteSafety.bannedPhrase });
      redirectWithError(orderId, noteSafety.error);
    }
    safeNote = noteSafety.text;
  }
  if (file) {
    const verr = validateDeliverableFileForUpload({
      name: file.name,
      size: file.size,
      type: file.type,
    });
    if (verr) {
      redirectWithError(orderId, verr);
    }
  }

  const { data: rowData, error: oe } = await supabase
    .from("custom_request_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (oe || !rowData) {
    redirectWithError(orderId, oe?.message ?? "주문을 찾을 수 없습니다.");
  }
  const row = rowData as Row;

  const access = canAccessOrder(row, user.id, "mentor");
  if (!access.ok) {
    redirectWithError(orderId, "이 주문에 납품을 등록할 권한이 없습니다.");
  }
  // W4(C10): custom_request_orders.mentor_id(NOT NULL) 정본 — 멘토 컬럼 프로빙 제거
  if (String(row.mentor_id) !== user.id) {
    redirectWithError(orderId, "배정 멘토 본인만 납품을 등록할 수 있습니다.");
  }

  const disputeBlockDel = await getActiveDisputeBlockMessage(supabase, orderId);
  if (disputeBlockDel) {
    redirectWithError(orderId, disputeBlockDel);
  }

  if (!isCustomOrderPaymentConfirmed(row)) {
    redirectWithError(orderId, "학생 측 결제가 완료된 뒤에만 납품을 등록할 수 있습니다.");
  }

  const norm = normalizedPrimaryOrderStatus(row);
  if (!norm) {
    redirectWithError(orderId, "주문 상태를 확인할 수 없어 납품을 등록할 수 없습니다.");
  }
  if (isOrderRowTerminalForActions(row)) {
    redirectWithError(orderId, "완료된 주문에서는 납품을 등록할 수 없습니다.");
  }
  if (norm === ORDER_INSERT_STATUS_PENDING) {
    redirectWithError(orderId, "작업 시작 후에만 납품을 등록할 수 있습니다(상태: pending).");
  }
  if (
    norm !== ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS &&
    norm !== "delivered" &&
    norm !== "revision_requested"
  ) {
    redirectWithError(orderId, `이 상태(${norm})에서는 납품을 등록할 수 없습니다.`);
  }

  const deliverablesTable = "custom_order_deliverables";
  const idBase = buildOrderChildIdColumns(orderId);

  // 파일 검증(버전 무관)은 재시도 루프 밖에서 1회만 수행한다.
  let fileBuf: ArrayBuffer | null = null;
  let originalForDb: string | null = null;
  if (file) {
    originalForDb = getOriginalFilenameForDisplay(file.name);
    if (originalForDb == null) {
      redirectWithError(orderId, "파일 이름이 비어 있거나 사용할 수 없습니다.");
    }
    fileBuf = await file.arrayBuffer();
    const mErr = validateDeliverableFileMagicBytes(file.type, fileBuf);
    if (mErr) {
      redirectWithError(orderId, mErr);
    }
  }

  // D-CR-1: 버전 채번을 앱에서 1회 read-max 후 고정하면 동시 납품 시 같은 version 으로 unique(23505)
  // 충돌이 나고, 업로드 객체를 롤백 삭제한 뒤 사용자에게 재시도를 요구하게 된다. 웹에서 할 수 있는 최선으로
  // 매 시도마다 max(version)+1 을 다시 읽어 재채번하고, 충돌이면 (버전별 스토리지 경로가 달라지므로)
  // 업로드까지 다시 시도한다. 채번의 완전한 원자성은 DB 함수(INSERT ... SELECT coalesce(max)+1)로만 보장된다.
  const MAX_DELIVERABLE_ATTEMPTS = 5;

  let inserted: Row | null = null;
  let nextVersion = 0;
  for (let attempt = 0; attempt < MAX_DELIVERABLE_ATTEMPTS; attempt++) {
    const { data: vrows, error: ve } = await supabase
      .from(deliverablesTable)
      .select("version")
      .eq(ORDER_CHILD_FK_COLUMN, orderId);
    if (ve) {
      redirectWithError(orderId, ve.message);
    }
    const attemptVersion = nextDeliverableVersionFromRows(vrows as { version?: unknown }[] | null);

    let storageObjectPath: string | null = null;
    let fileMeta: { objectPath: string; originalName: string; mime: string; size: number } | null = null;
    if (file && fileBuf && originalForDb != null) {
      const { objectPath } = buildDeliverableStorageObjectPath(orderId, attemptVersion, file.type, file.name);
      const pCheck = validateDeliverableStoragePath(objectPath, orderId, attemptVersion);
      if (pCheck.ok === false) {
        redirectWithError(orderId, pCheck.userMessage);
      }
      storageObjectPath = objectPath;
      const { error: upErr } = await supabase.storage.from(DELIVERABLE_STORAGE_BUCKET).upload(objectPath, fileBuf, {
        contentType: file.type && file.type.length > 0 ? file.type : "application/octet-stream",
        upsert: false,
      });
      if (upErr) {
        console.error("[submitMentorOrderDeliverableAction] storage upload", upErr);
        redirectWithError(orderId, upErr.message || "파일 업로드에 실패했습니다. 잠시 후 다시 시도하세요.");
      }
      fileMeta = {
        objectPath,
        originalName: originalForDb,
        mime: (file.type || "application/octet-stream").toLowerCase(),
        size: file.size,
      };
    }

    // W4(C10): payload 폴백 사다리(누락 컬럼 재시도) 제거 — 정본 payload 단일 insert
    const payload = buildDeliverableRowPayload(idBase, attemptVersion, safeNote, fileMeta);
    const { data: insertedData, error: ie } = await supabase
      .from(deliverablesTable)
      .insert(payload)
      .select("*")
      .maybeSingle();

    if (!ie && insertedData) {
      inserted = insertedData as Row;
      nextVersion = attemptVersion;
      break;
    }

    // 실패 — 이번 시도의 업로드 객체는 정리(다음 시도는 버전·경로가 달라 재사용 불가).
    if (storageObjectPath) {
      await removeStorageObjectBestEffort(supabase, storageObjectPath);
    }
    if (ie && isPostgresUniqueViolation(ie) && attempt < MAX_DELIVERABLE_ATTEMPTS - 1) {
      // 동시 납품으로 version 충돌 — 재채번 후 재시도.
      continue;
    }
    if (ie) {
      if (isPostgresUniqueViolation(ie)) {
        redirectWithError(orderId, "납품 처리 중 충돌이 발생했습니다. 다시 시도해 주세요.");
      }
      console.error("[submitMentorOrderDeliverableAction] insert failed", { orderId, insertErr: ie.message });
      redirectWithError(orderId, ie.message);
    }
    console.error("[submitMentorOrderDeliverableAction] insert returned no row", { orderId });
    redirectWithError(orderId, "납품 기록을 저장하지 못했습니다. 잠시 후 다시 시도하세요.");
  }

  if (!inserted) {
    redirectWithError(orderId, "납품 기록을 저장하지 못했습니다. 잠시 후 다시 시도하세요.");
  }

  const eventMeta = buildDeliverableSubmittedEventMetadataFromRow(inserted, nextVersion);
  await recordOrderEventBestEffort(supabase, orderId, "deliverable_submitted", user.id, eventMeta);

  if (
    norm === ORDER_MENTOR_WORK_STARTED_PRIMARY_STATUS ||
    norm === "revision_requested" ||
    norm === "delivered"
  ) {
    const transition = await markCustomOrderDeliveredRpc(supabase, orderId);
    if (!transition.ok) {
      console.error("[submitMentorOrderDeliverableAction] order delivered transition failed", orderId, transition.error);
      redirectWithError(orderId, transition.error);
    }
  }

  revalidatePath(orderPath(orderId));
  revalidatePath("/custom-request");
  revalidatePath("/mentor/custom-request/orders");
  redirect(`${orderPath(orderId)}?ok=${encodeURIComponent("납품이 등록되었습니다.")}`);
}
