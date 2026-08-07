import type { SupabaseClient } from "@supabase/supabase-js";
import { getMentorUserPublic, loadMentorProfilesForDirectory } from "@/lib/auth/mentorPublicRead";
import { canAccessOrder } from "@/lib/customRequest/orderAccess";
import { pickDisplayField } from "@/lib/customRequest/customRequestQueries";
import {
  formatOrderRoomDate,
  normalizedPrimaryOrderStatus,
  orderStatusLabelForUi,
  paymentStatusLabelForUi,
} from "@/lib/customRequest/orderLifecycleConstants";
import { pickMentorIdFromOrderRow } from "@/lib/customRequest/orderDetailQueries";
import { buildMentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import {
  mentorCustomOrderDisplayTitle,
  mentorCustomOrderWorkroomHref,
} from "@/lib/customRequest/mentorCustomOrderBrowseDisplay";
import type { DsStatusTone } from "@/lib/design-system/statusBadge";
import {
  classifyStudentOrderBrowseTab,
  type StudentOrderBrowseTabId,
} from "@/lib/customRequest/studentOrderBrowseTabClassify";
import { shortOrderIdForDisplay } from "@/lib/utils/formatOrderIdForDisplay";

type Row = Record<string, unknown>;

const CUSTOM_REQUEST_ORDERS_TABLE = "custom_request_orders" as const;

// D-CR-2: 소유 FK 컬럼 프로빙(요청당 +7 쿼리) 제거 — custom_request_orders.student_id(NOT NULL, 003)
// 단일 정본 컬럼으로 고정. 주문 상세·멘토 목록 조회부(findOrderForPostAndStudent 등)와 동일한 정본화.

function pickDeadlineRaw(row: Row): unknown {
  for (const k of ["proposed_due", "delivery_at", "deliver_by", "due_at", "deadline", "expected_delivery_at"] as const) {
    const v = row[k];
    if (v != null && String(v).trim()) {
      return v;
    }
  }
  return null;
}

function pickPostIdFromOrderRow(r: Row): string | null {
  for (const k of ["post_id", "custom_request_post_id", "request_id", "custom_request_id"] as const) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function loadPostsByIdsForStudentList(supabase: SupabaseClient, postIds: string[]): Promise<Map<string, Row>> {
  const postsById = new Map<string, Row>();
  if (postIds.length === 0) return postsById;
  const { data, error } = await supabase
    .from("custom_request_posts")
    .select("id,title,subject,category,goal")
    .in("id", postIds);
  if (error) return postsById;
  for (const row of (data as Row[]) ?? []) {
    const pid = typeof row.id === "string" ? row.id : "";
    if (pid) postsById.set(pid, row);
  }
  return postsById;
}

/** `orderLifecycleConstants` ORDER_STATUS_LABEL_MAP 키 기준 — 라벨과 tone 일치 */
const STUDENT_ORDER_TONE_TERMINAL = new Set([
  "completed",
  "accepted",
  "finished",
  "closed",
  "cancelled",
  "canceled",
  "done",
  "resolved",
  "rejected",
  "disputed",
  "refunded",
]);

const STUDENT_ORDER_TONE_WAITING = new Set(["pending", "unpaid"]);

const STUDENT_ORDER_TONE_ACTIVE = new Set([
  "open",
  "in_progress",
  "submitted",
  "paid",
  "delivered",
  "in_review",
  "waiting_review",
  "delivered_pending_review",
  "pending_review",
  "redelivered",
  "delivery_submitted",
  "revision_requested",
]);

function resolveStudentOrderStatusTone(
  norm: string,
  orderId: string,
  activeDisputeOrderIds?: ReadonlySet<string> | null
): DsStatusTone {
  if (activeDisputeOrderIds?.has(orderId)) return "danger";
  const s = norm.trim().toLowerCase();
  if (!s) return "neutral";
  if (STUDENT_ORDER_TONE_TERMINAL.has(s)) return "neutral";
  if (STUDENT_ORDER_TONE_WAITING.has(s)) return "warning";
  if (STUDENT_ORDER_TONE_ACTIVE.has(s)) return "info";
  return "neutral";
}

function resolvePaymentTone(payRaw: string): DsStatusTone {
  const s = payRaw.trim().toLowerCase();
  if (s === "paid" || s === "completed" || s === "settled") return "success";
  if (s === "escrowed" || s === "held") return "info";
  return "neutral";
}

function pickPaymentRaw(row: Row): string {
  for (const k of ["payment_status", "payment_state", "pay_status"] as const) {
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function formatAmountLine(row: Row): string {
  for (const k of ["agreed_price", "proposed_price", "price", "amount", "total_amount"] as const) {
    const raw = row[k];
    if (raw == null) continue;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return `${raw.toLocaleString("ko-KR")}캐시`;
    }
    const s = String(raw).trim().replace(/[, ]/g, "");
    const n = Number(s);
    if (Number.isFinite(n)) {
      return `${n.toLocaleString("ko-KR")}캐시`;
    }
    if (String(raw).trim()) {
      return String(raw).trim();
    }
  }
  return "—";
}

/**
 * `public.custom_request_orders` 만 조회. D-CR-2: 학생 소유 정본 컬럼 `student_id` 단일 필터.
 * RLS 오탐 대비로 클라이언트에서 `canAccessOrder` 재검증(방어적).
 */
export async function fetchStudentCustomRequestOrdersFromPrimaryTable(
  supabase: SupabaseClient,
  studentUserId: string,
  limit = 80
): Promise<{ rows: Row[]; error: string | null; probe: string }> {
  const t = CUSTOM_REQUEST_ORDERS_TABLE;
  const probe = `${t}.student_id`;

  const o1 = await supabase
    .from(t)
    .select("*")
    .eq("student_id", studentUserId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (o1.error) {
    // updated_at 컬럼 부재 등 정렬 관련 오류만 무정렬로 1회 재시도, 그 외는 오류 그대로 반환.
    if (!/order|column/i.test(o1.error.message)) {
      return { rows: [], error: o1.error.message, probe: "" };
    }
    const o2 = await supabase.from(t).select("*").eq("student_id", studentUserId).limit(limit);
    if (o2.error) {
      return { rows: [], error: o2.error.message, probe: "" };
    }
    const raw = ((o2.data as Row[]) ?? []).filter((r) => canAccessOrder(r, studentUserId, "student").ok);
    return { rows: raw, error: null, probe };
  }
  const raw = ((o1.data as Row[]) ?? []).filter((r) => canAccessOrder(r, studentUserId, "student").ok);
  return { rows: raw, error: null, probe };
}

export type StudentCustomOrderListRowView = {
  id: string;
  idShort: string;
  titleLine: string;
  subjectLine: string;
  orderStatusLabel: string;
  statusTone: DsStatusTone;
  paymentStatusLabel: string;
  paymentTone: DsStatusTone;
  amountLine: string;
  mentorLine: string;
  mentorId: string | null;
  createdLabel: string;
  deadlineLabel: string;
  workroomHref: string;
  browseTab: Exclude<StudentOrderBrowseTabId, "all">;
};

export async function enrichStudentCustomOrderListRows(
  supabase: SupabaseClient,
  rows: Row[],
  activeDisputeOrderIds?: ReadonlySet<string> | null
): Promise<StudentCustomOrderListRowView[]> {
  const mentorIds = [...new Set(rows.map((r) => pickMentorIdFromOrderRow(r)).filter((x): x is string => !!x))];
  const { byUser: profByUser } = await loadMentorProfilesForDirectory(supabase, mentorIds);
  const userById = new Map<string, Awaited<ReturnType<typeof getMentorUserPublic>>["data"]>();

  await Promise.all(
    mentorIds.map(async (mid) => {
      const { data } = await getMentorUserPublic(supabase, mid);
      userById.set(mid, data);
    })
  );

  const postIds = [...new Set(rows.map(pickPostIdFromOrderRow).filter((x): x is string => !!x))];
  const postsById = await loadPostsByIdsForStudentList(supabase, postIds);

  const out: StudentCustomOrderListRowView[] = [];
  for (const r of rows) {
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : null;
    if (!id) continue;

    const mid = pickMentorIdFromOrderRow(r);
    const profRow = mid ? profByUser.get(mid) ?? null : null;
    const urow = mid ? userById.get(mid) ?? null : null;
    const display = buildMentorProfileDisplay(profRow, urow);
    const mentorLine =
      mid && display.displayName.trim() && display.displayName !== "멘토"
        ? display.displayName
        : mid
          ? `멘토 ${shortOrderIdForDisplay(mid)}`
          : "—";

    const norm = normalizedPrimaryOrderStatus(r);
    const orderStatusLabel = activeDisputeOrderIds?.has(id)
      ? "분쟁 접수 · 운영 검토 중"
      : norm
        ? orderStatusLabelForUi(norm)
        : "—";
    const payRaw = pickPaymentRaw(r);
    const paymentStatusLabel = payRaw ? paymentStatusLabelForUi(payRaw) : "—";

    const createdLabel = formatOrderRoomDate(r.created_at ?? null);
    const deadlineLabel = formatOrderRoomDate(pickDeadlineRaw(r));

    const postId = pickPostIdFromOrderRow(r);
    const post = postId ? postsById.get(postId) ?? null : null;
    let titleLine = pickStudentOrderTitleLine(r);
    let subjectLine = "—";
    if (post) {
      const postTitle = pickDisplayField(post, ["title", "subject", "goal"]);
      if (postTitle !== "—") {
        titleLine = mentorCustomOrderDisplayTitle({ ...r, post_title: postTitle });
      }
      subjectLine = pickDisplayField(post, ["subject", "category"]);
    }

    out.push({
      id,
      idShort: id.length <= 16 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`,
      titleLine,
      subjectLine,
      orderStatusLabel,
      statusTone: resolveStudentOrderStatusTone(norm, id, activeDisputeOrderIds),
      paymentStatusLabel,
      paymentTone: resolvePaymentTone(payRaw),
      amountLine: formatAmountLine(r),
      mentorLine,
      mentorId: mid,
      createdLabel,
      deadlineLabel,
      workroomHref: mentorCustomOrderWorkroomHref(id),
      browseTab: classifyStudentOrderBrowseTab(r, activeDisputeOrderIds ?? new Set<string>()),
    });
  }
  return out;
}

export function pickStudentOrderTitleLine(row: Row): string {
  const title = pickDisplayField(row, ["title", "subject", "label", "name"]);
  return title !== "—" ? title : "맞춤의뢰 주문";
}
