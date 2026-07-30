import type { SupabaseClient } from "@supabase/supabase-js";
import { pickDisplayField } from "@/lib/customRequest/customRequestQueries";
import { mentorCustomOrderStatusHeadline } from "@/lib/customRequest/mentorCustomOrderBrowseDisplay";
import { SUBSCRIPTIONS_TABLE } from "@/lib/subscribe/subscriptionsTable";
import { loadMentorPayoutsBundle } from "@/lib/mentor/mentorPayoutsQueries";
import { aggregateThreadStatsForRooms } from "@/lib/home/threadStats";

type Row = Record<string, unknown>;

export const MENTOR_DASHBOARD_DATA_MODEL = [
  "질문방·학생 연결",
  "답변·처리 현황",
  "정산(이번 달 예상)",
  "맞춤의뢰",
  "멘토 프로필",
  "알림",
] as const;

export type MentorDashboardData = {
  rooms: { rows: Row[]; error: string | null };
  connectedRoomCount: number;
  activeStudentCount: number;
  disputeCount: number;
  monthlyRevenueCash: number;
  threadStats: Awaited<ReturnType<typeof aggregateThreadStatsForRooms>>;
  payouts: Awaited<ReturnType<typeof loadMentorPayoutsBundle>>;
  customRecent: {
    table: string | null;
    rows: Row[];
    error: string | null;
    probe: string;
    /** open / under_review 분쟁이 붙은 주문 id (RLS·당사자 한정) */
    activeDisputeOrderIds: Set<string>;
  };
  notifyProbe: { label: string; detail: string; status: "skeleton" | "connected" | "empty" };
};

// W4(C10): 사문 export 삭제 — loadMentorDashboardData(레거시 멘토 대시보드 로더)는 repo 전역
// 호출부 0(테스트 포함 grep 실측)이라 전용 프로빙 헬퍼 fetchRecentCustomOrders(request_orders
// 후보 테이블·5개 FK 후보 프로빙)와 notificationsCountProbe(user_id→recipient_id→mentor_id→
// student_id column-retry)를 함께 삭제했다. 정본 경로: 맞춤의뢰 주문은 아래
// fetchMentorCustomRequestOrdersFromPrimaryTable(custom_request_orders.mentor_id), 알림 정본
// 수신자 컬럼은 notifications.user_id(+is_read/read_at)다. MentorDashboardData 타입은
// components/home/* 표시 계층이 참조하므로 유지한다.

/**
 * W4(C10): subscriptions 테이블·컬럼 프로빙 제거 — 정본 public.subscriptions
 * (mentor_id, status) 고정 컬럼(187 baseline 실측 · XW-10). 구 in-list("active","ACTIVE",
 * "running","paid")는 status CHECK 상 'active' 외 불가능 값이라 eq('active')와 동작 동일.
 * 오류 시 console.error 후 0 반환 — 멘토 허브 KPI 표시 전용 degrade(성공 아님).
 */
export async function countActiveSubscriptionsForMentor(
  supabase: SupabaseClient,
  mentorId: string
): Promise<number> {
  const { count, error } = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("mentor_id", mentorId)
    .eq("status", "active");
  if (error) {
    console.error("[countActiveSubscriptionsForMentor]", error.message);
    return 0;
  }
  return count ?? 0;
}

export {
  mentorCustomOrderStatusHeadline,
  mentorCustomOrderWorkroomHref,
  mentorCustomOrderPaymentLine,
  mentorCustomOrderPaymentBadge,
} from "@/lib/customRequest/mentorCustomOrderBrowseDisplay";

export function customOrderLine(r: Row, activeDisputeOrderIds?: ReadonlySet<string> | null) {
  const title = pickDisplayField(r, ["title", "subject", "label", "name"]);
  const titleLine = title !== "—" ? title : "맞춤의뢰";
  const when = pickDisplayField(r, ["updated_at", "created_at"]);
  const whenShort = when !== "—" && when.length > 10 ? when.slice(0, 10) : when;
  return `${mentorCustomOrderStatusHeadline(r, activeDisputeOrderIds)} · ${titleLine} · ${whenShort}`;
}

const CUSTOM_REQUEST_ORDERS_TABLE = "custom_request_orders" as const;

/**
 * `public.custom_request_orders` 만 조회한다. (`custom_orders` 테이블은 사용하지 않음.)
 * W4(C10): 사전 probe select·5개 FK 후보 pickExistingColumn·order 실패 시 무정렬 재시도
 * (column-retry) 제거 — 정본 custom_request_orders(mentor_id, updated_at) 고정 컬럼
 * 단일 쿼리(187 baseline 실측). 오류는 error 필드로 표면화한다.
 */
export async function fetchMentorCustomRequestOrdersFromPrimaryTable(
  supabase: SupabaseClient,
  mentorId: string,
  limit = 50
): Promise<{ rows: Row[]; error: string | null; probe: string }> {
  const { data, error } = await supabase
    .from(CUSTOM_REQUEST_ORDERS_TABLE)
    .select("*")
    .eq("mentor_id", mentorId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) {
    return { rows: [], error: error.message, probe: "" };
  }
  return { rows: (data as Row[]) ?? [], error: null, probe: "" };
}
