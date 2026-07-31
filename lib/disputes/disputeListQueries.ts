import type { SupabaseClient } from "@supabase/supabase-js";
import { pickText } from "@/lib/disputes/disputeQueries";

type Row = Record<string, unknown>;

export type DisputeListItem = {
  id: string;
  typeLabel: string;
  statusLabel: string;
  /** 배지 색 등 UI용 원문 상태(영문·DB값) */
  statusRaw: string;
  orderSummary: string;
  row: Row;
};

function idOf(r: Row): string {
  for (const k of ["id", "uuid", "key"]) {
    if (k in r && r[k] !== null && r[k] !== undefined) {
      return String(r[k]);
    }
  }
  return "";
}

function pickType(r: Row): string {
  for (const k of ["type", "kind", "category", "dispute_type", "reason_code"]) {
    if (k in r && r[k] !== null && r[k] !== undefined) {
      return String(r[k]);
    }
  }
  return "—";
}

function pickStatus(r: Row): string {
  for (const k of ["status", "state", "phase", "resolution", "outcome"]) {
    if (k in r && r[k] !== null && r[k] !== undefined) {
      return String(r[k]);
    }
  }
  return "—";
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s.trim());
}

export function shortDisputeRef(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (!s) return "";
  if (isUuidLike(s)) return `#${s.slice(-6).toUpperCase()}`;
  if (s.length > 18) return `#${s.slice(0, 8).toUpperCase()}`;
  return s;
}

/** 학생·멘토 목록용 한글 상태 */
export function partyDisputeStatusKo(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s || s === "—") return "—";
  const map: Record<string, string> = {
    open: "접수됨",
    new: "접수됨",
    submitted: "접수됨",
    pending: "검토 중",
    under_review: "검토 중",
    escalated: "운영 검토 중",
    resolved: "해결됨",
    dismissed: "종료됨",
    closed: "종료됨",
    rejected: "반려됨",
  };
  return map[s] ?? raw;
}

export function partyDisputeTypeKo(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s || s === "—") return "—";
  const map: Record<string, string> = {
    refund: "환불",
    payment: "결제",
    order: "주문",
    subscription: "구독",
    custom_request: "맞춤의뢰",
    dispute: "분쟁",
  };
  if (map[s]) return map[s];
  if (s.length <= 32 && s.includes("_")) return s.replace(/_/g, " ");
  const t = raw.trim();
  return t.length > 40 ? `${t.slice(0, 20)}…` : t;
}

function orderLine(r: Row): string {
  const cro =
    r.custom_request_order_id ?? r.custom_order_id ?? r.request_order_id ?? r.mentor_order_id ?? r.custom_request_order;
  if (cro != null && String(cro).trim() !== "") {
    return `맞춤의뢰 주문 ${shortDisputeRef(cro)}`;
  }
  const oid = r.order_id ?? r.order_id_linked;
  if (oid != null && String(oid).trim() !== "") {
    return `주문 ${shortDisputeRef(oid)}`;
  }
  const pay = r.payment_id ?? r.subscription_id;
  if (pay != null && String(pay).trim() !== "") {
    return `결제·구독 ${shortDisputeRef(pay)}`;
  }
  const rf = r.refund_id;
  if (rf != null && String(rf).trim() !== "") {
    return `환불 ${shortDisputeRef(rf)}`;
  }
  return "—";
}

export function mapRowToListItem(r: Row): DisputeListItem {
  const st = pickStatus(r);
  const ty = pickType(r);
  return {
    id: idOf(r) || "—",
    typeLabel: partyDisputeTypeKo(ty),
    statusLabel: partyDisputeStatusKo(st),
    statusRaw: st === "—" ? "" : st.trim().toLowerCase(),
    orderSummary: orderLine(r),
    row: r,
  };
}

/** 관리자 목록 — 상세 `DisputeAdminPageBody` 사건 요약 키와 맞춤 */
export type AdminDisputeListItem = DisputeListItem & {
  titleLine: string;
  actorSummary: string;
  createdAt: string;
  updatedAt: string;
  /** body / reason / description 요약 */
  summaryReason: string;
  /** 맞춤의뢰 주문 등 식별자 한 줄 */
  orderRef: string;
};

function shortFk(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v);
  return s.length > 12 ? `${s.slice(0, 10)}…` : s;
}

/** users 조회 없이 disputes row FK만으로 한 줄(목록 성능) */
export function actorSummaryFromDisputeRow(r: Row): string {
  const parts: string[] = [];
  const rep = r.reporter_id ?? r.created_by ?? r.applicant_id ?? r.opened_by;
  const stu = r.student_id ?? r.user_id ?? r.plaintiff_id ?? r.buyer_id ?? r.client_id;
  const men = r.mentor_id ?? r.mentor_user_id ?? r.defendant_id ?? r.counterparty_id ?? r.expert_id;
  if (rep) parts.push(`신청 ${shortFk(rep)}`);
  if (stu) parts.push(`학생 ${shortFk(stu)}`);
  if (men) parts.push(`멘토 ${shortFk(men)}`);
  return parts.length ? parts.join(" · ") : "—";
}

function timestampish(r: Row, keys: readonly string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v == null || v === "") continue;
    return String(v);
  }
  return "—";
}

function formatTsKo(v: string): string {
  if (v === "—") return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function summaryFromRow(r: Row): string {
  const raw = pickText(r, ["body", "reason", "description", "summary", "title"]);
  if (raw === "—") return "—";
  const t = raw.trim();
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

export function mapRowToAdminListItem(r: Row): AdminDisputeListItem {
  const base = mapRowToListItem(r);
  const titleFromFields = pickText(r, ["title", "name", "summary", "subject"]);
  const titleLine = titleFromFields !== "—" ? titleFromFields : pickText(r, ["id", "uuid"]);
  const c0 = timestampish(r, ["created_at", "inserted_at", "opened_at"]);
  const u0 = timestampish(r, ["updated_at", "modified_at", "last_event_at", "resolved_at"]);
  return {
    ...base,
    titleLine,
    actorSummary: actorSummaryFromDisputeRow(r),
    createdAt: formatTsKo(c0),
    updatedAt: formatTsKo(u0),
    summaryReason: summaryFromRow(r),
    orderRef: orderLine(r),
  };
}

// W4(C10): loadDisputesListForAdmin(+LoadDisputesListForAdminOpts) 삭제 — 레포 전역 호출부 0곳
// (관리자 목록 정본 경로는 app/(admin)/admin/(console)/disputes/page.tsx 가 자체 조회 후
// mapRowToAdminListItem 만 사용). 프로빙(후보 테이블 5종·정렬 재시도)째 폐기.

/**
 * 본인 분쟁 목록 — 정본: public.disputes, 학생 = student_id · 멘토 = mentor_id,
 * created_at DESC (187 baseline 실측). W4(C10): 후보 테이블·user FK 컬럼 프로빙과
 * 정렬 재시도 제거. 오류는 error 로 반환(0건과 구분).
 */
export async function loadDisputesListForUser(
  supabase: SupabaseClient,
  userId: string,
  kind: "student" | "mentor",
  limit = 40
): Promise<{ table: string | null; items: DisputeListItem[]; error: string | null; usedColumn: string | null; probe: string }> {
  const table = "disputes";
  const column = kind === "student" ? "student_id" : "mentor_id";
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq(column, userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return { table, items: [], error: error.message, usedColumn: null, probe: table };
  }
  const rows = (data as Row[] | null) ?? [];
  return {
    table,
    items: rows.map((r) => mapRowToListItem(r as Row)),
    error: null,
    usedColumn: column,
    probe: `${table}.${column}`,
  };
}
