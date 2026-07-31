import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildOrderChildIdColumns,
  type CustomListResult,
  ORDER_CHILD_FK_COLUMN,
} from "@/lib/customRequest/customRequestQueries";

type Row = Record<string, unknown>;

export type OrderRoomEventKind =
  | "order_started"
  | "order_cancelled"
  | "deliverable_submitted"
  | "deliverable_accepted"
  | "message_created"
  | "revision_requested"
  | "dispute_opened"
  | "dispute_split_applied"
  | "settlement_item_created"
  | "payment_confirmed";

// W4(C10): 후보 테이블/컬럼 배열(ORDER_EVENT_TABLES·MESSAGE_TABLES·EVENT_TYPE_KEYS·EVENT_ACTOR_KEYS 등)과
// 런타임 프로빙 제거. 정본: order_events(event, metadata — actor 열 없음) · custom_order_messages(author_id, body —
// role 열 없음) · custom_order_revisions(request_note) — 187 baseline 실측.

/**
 * 핵심 주문 액션 성공 후 호출. insert 실패 시 console.error만 — 사용자 성공 흐름은 유지(감사 로그 best-effort, 의도된 설계).
 * W4(C10): order_events 단일 정본 insert — actor 열은 스키마에 없으므로 metadata.actor_id 로만 기록(현행 관측 동작 동일).
 */
export async function recordOrderEventBestEffort(
  supabase: SupabaseClient,
  orderId: string,
  kind: OrderRoomEventKind,
  actorId: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const payload: Record<string, unknown> = {
    ...buildOrderChildIdColumns(orderId),
    event: kind,
    metadata: { event: kind, actor_id: actorId, ...extra },
  };
  const { error } = await supabase.from("order_events").insert(payload);
  if (error) {
    console.error("[recordOrderEventBestEffort] insert failed", error.message, { orderId, kind });
  }
}

/** W4(C10): custom_order_messages.custom_request_order_id + created_at asc 고정 — 프로빙·무정렬 재시도 제거 */
export async function loadOrderMessages(supabase: SupabaseClient, orderId: string): Promise<CustomListResult> {
  const table = "custom_order_messages";
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(ORDER_CHILD_FK_COLUMN, orderId)
    .order("created_at", { ascending: true });
  if (error) {
    return { table, sourceNote: "메시지를 불러오지 못했습니다.", rows: [], error: error.message };
  }
  return { table, sourceNote: "주문 메시지", rows: (data as Row[]) ?? [], error: null };
}

/** W4(C10): custom_order_revisions.custom_request_order_id + created_at desc 고정 */
export async function loadOrderRevisions(supabase: SupabaseClient, orderId: string): Promise<CustomListResult> {
  const table = "custom_order_revisions";
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(ORDER_CHILD_FK_COLUMN, orderId)
    .order("created_at", { ascending: false });
  if (error) {
    return { table, sourceNote: "수정 요청을 불러오지 못했습니다.", rows: [], error: error.message };
  }
  return { table, sourceNote: "수정 요청", rows: (data as Row[]) ?? [], error: null };
}

/**
 * RLS: author = auth.uid(). 주문 당사자만 상위 액션에서 호출.
 * W4(C10): custom_order_messages(custom_request_order_id, author_id, body) 단일 정본 insert —
 * role/party 열은 스키마에 없어 저장하지 않음(라벨은 author_id 로 파생, 현행 관측 동작 동일).
 */
export async function insertOrderRoomMessage(
  supabase: SupabaseClient,
  orderId: string,
  authorId: string,
  text: string
): Promise<{ id: string | null; error: string | null }> {
  const payload: Record<string, unknown> = {
    ...buildOrderChildIdColumns(orderId),
    author_id: authorId,
    body: text,
  };
  const { data, error } = await supabase.from("custom_order_messages").insert(payload).select("id").limit(1);
  if (error) {
    return { id: null, error: error.message };
  }
  const row = Array.isArray(data) ? (data[0] as Row | undefined) : undefined;
  const id = typeof row?.id === "string" ? row.id : null;
  return { id, error: null };
}

// W4(C10) 삭제: insertOrderRevisionRequest — repo 전체(테스트 포함) 호출부 0. 학생 수정 요청의 정본 경로는
// requestCustomOrderRevisionRpc(lib/customRequest/orderTransitionRpc.ts) + orderRevisionActions.ts.

export function pickOrderStudentId(order: Row | null): string {
  if (!order) {
    return "";
  }
  for (const k of ["student_id", "buyer_id", "user_id", "client_id", "author_id", "requester_id"] as const) {
    const v = order[k];
    if (typeof v === "string" && v) {
      return v;
    }
  }
  return "";
}

export function pickOrderMentorIdFromRow(order: Row | null): string {
  if (!order) {
    return "";
  }
  for (const k of ["mentor_id", "mentor_user_id", "assignee_id", "assigned_mentor_id", "selected_mentor_id", "expert_id"] as const) {
    const v = order[k];
    if (typeof v === "string" && v) {
      return v;
    }
  }
  return "";
}

export function orderPartyLabelForMessage(
  message: Row,
  _order: Row | null,
  studentId: string,
  mentorId: string
): "학생" | "멘토" | "참여자" {
  // W4(C10): 메시지 role 동의어 키(sender_role 등) 판독 제거 — custom_order_messages 에 role 열이 없어
  // 항상 도달 불가한 사문 분기였음. 라벨은 author_id 로만 판정(현행 관측 동작 동일).
  const v = message.author_id;
  if (typeof v === "string" && v) {
    if (v === studentId) {
      return "학생";
    }
    if (v === mentorId) {
      return "멘토";
    }
  }
  return "참여자";
}
