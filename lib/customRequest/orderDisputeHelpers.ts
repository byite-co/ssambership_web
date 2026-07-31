import type { SupabaseClient } from "@supabase/supabase-js";
// W4(C10): disputes 단일 정본 테이블 · custom_request_order_id 정본 FK 고정(004, 187 baseline 실측) — 프로빙 제거
import { ORDER_CHILD_FK_COLUMN } from "@/lib/customRequest/customRequestQueries";

type Row = Record<string, unknown>;

/**
 * 004 `disputes.status` CHECK: open | under_review | resolved | dismissed | escalated
 * — 주문방 UI·액션 잠금의 "진행 중 분쟁": open · under_review · escalated.
 *   resolved · dismissed · closed 등 종료 상태는 active로 보지 않음.
 */
const ACTIVE_DISPUTE_STATUSES = new Set(["open", "under_review", "escalated"]);

function disputeStatusField(r: Row): string {
  for (const k of ["status", "state", "label"] as const) {
    const v = r[k];
    if (v !== null && v !== undefined && String(v).trim()) {
      return String(v).trim().toLowerCase();
    }
  }
  return "";
}

export function hasActiveDisputeForOrderRows(rows: Row[] | null | undefined): boolean {
  if (!rows?.length) {
    return false;
  }
  for (const r of rows) {
    const s = disputeStatusField(r);
    if (s && ACTIVE_DISPUTE_STATUSES.has(s)) {
      return true;
    }
  }
  return false;
}

/**
 * 주문 목록·대시보드: RLS 하에서 보이는 분쟁만 집계(당사자 본인 주문만).
 * `custom_request_order_id` 우선 FK(getDisputeRowsForOrderId / loadOrderBundle 과 동일).
 */
export async function fetchActiveOpenDisputeOrderIdSet(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  const trimmed = [...new Set(orderIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!trimmed.length) {
    return out;
  }
  const { data, error } = await supabase.from("disputes").select("*").in(ORDER_CHILD_FK_COLUMN, trimmed);
  if (error) {
    // W4(C10): 표시 전용 강등(목록 배지·카운트) — 오류를 로그로 표면화하고 빈 집합 반환. 성공 아님.
    // 쓰기 잠금은 getActiveDisputeBlockMessage(fail-closed)가 별도로 담당한다.
    console.error("[fetchActiveOpenDisputeOrderIdSet] query failed", error.message);
    return out;
  }
  for (const row of (data as Row[] | null) ?? []) {
    if (!hasActiveDisputeForOrderRows([row])) {
      continue;
    }
    const v = row[ORDER_CHILD_FK_COLUMN];
    if (typeof v === "string" && v.trim()) {
      out.add(v.trim());
    }
  }
  return out;
}

/**
 * 주문방·서버 액션에서 동일한 방식으로 분쟁 목록을 가져온다(loadOrderBundle disputes와 병행).
 */
export async function getDisputeRowsForOrderId(
  supabase: SupabaseClient,
  orderId: string
): Promise<{ rows: Row[]; error: string | null }> {
  const { data, error } = await supabase.from("disputes").select("*").eq(ORDER_CHILD_FK_COLUMN, orderId);
  if (error) {
    return { rows: [], error: error.message };
  }
  return { rows: (data as Row[]) ?? [], error: null };
}

/**
 * 서버 액션 전용 쓰기 잠금 게이트.
 * W4(C10): '스키마 미배포(relation/schema cache) 오류면 잠그지 않는다'던 fail-open 분기 제거 —
 * disputes 는 실존 테이블(004, 187 baseline)이므로 해당 분기는 RLS·일시 장애 오류까지 통과시키는 구멍이었다.
 * 이제 모든 조회 오류는 보수적으로 잠근다(fail-closed).
 */
export async function getActiveDisputeBlockMessage(
  supabase: SupabaseClient,
  orderId: string
): Promise<string | null> {
  const { rows, error } = await getDisputeRowsForOrderId(supabase, orderId);
  if (error) {
    console.error("[getActiveDisputeBlockMessage] dispute query failed", { orderId, error });
    return "분쟁 상태를 확인할 수 없어 진행할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (hasActiveDisputeForOrderRows(rows)) {
    return "진행 중인 분쟁이 있어 이 작업을 할 수 없습니다.";
  }
  return null;
}
