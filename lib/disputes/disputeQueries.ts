import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserProfileById } from "@/lib/auth/getCurrentProfile";
import { USER_UI_LOAD_FAILED } from "@/lib/constants/userFacingMessages";

type Row = Record<string, unknown>;

export type DisputeBundle = {
  dispute: { table: string | null; row: Row | null; error: string | null };
  refund: { table: string | null; row: Row | null; error: string | null };
  payment: { table: string | null; row: Row | null; error: string | null };
  subscription: { table: string | null; row: Row | null; error: string | null };
  customOrder: { table: string | null; row: Row | null; error: string | null };
  modLogs: { table: string | null; rows: Row[]; error: string | null };
  probe: string;
};

/**
 * W4(C10): 맞춤의뢰 주문 → 결제 정본 경로 —
 * order_payments(custom_request_order_id, payment_id) 링크 테이블 경유 후 payments 단건(187 baseline 실측).
 * 테이블·컬럼 프로빙(order_payments/payments/payment_intents × FK 후보 4종) 제거. 오류는 그대로 반환.
 */
async function fetchPaymentRowByOrderId(
  supabase: SupabaseClient,
  orderId: string
): Promise<{ table: string | null; row: Row | null; err: string | null }> {
  const { data, error } = await supabase
    .from("order_payments")
    .select("payment_id")
    .eq("custom_request_order_id", orderId)
    .limit(1);
  if (error) {
    return { table: "order_payments", row: null, err: error.message };
  }
  const link = ((data as Row[] | null) ?? [])[0];
  const paymentId = link && link.payment_id != null ? String(link.payment_id) : null;
  if (!paymentId) {
    return { table: null, row: null, err: null };
  }
  return await fetchRowById(supabase, "payments", paymentId);
}

/** W4(C10): 후보 테이블·id 컬럼 순회(fetchByIdInTable) 제거 — 정본 테이블 1곳에서 id 단건 조회. */
async function fetchRowById(
  supabase: SupabaseClient,
  table: string,
  idValue: string
): Promise<{ table: string | null; row: Row | null; err: string | null }> {
  const { data, error } = await supabase.from(table).select("*").eq("id", idValue).maybeSingle();
  if (error) {
    return { table, row: null, err: error.message };
  }
  // 0건은 오류가 아니라 「연계 정보 없음」(err null)로 구분한다.
  return { table, row: (data as Row) ?? null, err: null };
}

/** 관리자 상세 전용: 세션으로 disputes 단건이 안 될 때만 전달(requireRole 이후 서버 전용). */
export type LoadDisputeByIdOpts = {
  adminBypassClient?: SupabaseClient;
};

export async function loadDisputeById(
  supabase: SupabaseClient,
  id: string,
  opts?: LoadDisputeByIdOpts
): Promise<DisputeBundle> {
  let dRow: Row | null = null;
  let dErr: string | null = null;
  let resolvedTable: string | null = null;
  /** disputes 본문·연계 조회에 사용(관리자 읽기 우회 시 첫 성공 클라이언트를 끝까지 유지) */
  let readClient: SupabaseClient = supabase;

  // W4(C10): 분쟁 정본 테이블은 disputes 단일(187 baseline 실측 — order_disputes/refund_disputes/
  // user_disputes/support_tickets 부재). 후보 테이블 프로빙 제거. adminBypassClient 재시도는
  // requireRole("admin") 이후 관리자 상세에서만 전달되는 의도된 service_role 경로(C)라 유지.
  const direct = await supabase.from("disputes").select("*").eq("id", id).maybeSingle();
  const sessionMiss = Boolean(direct.error || !direct.data);
  resolvedTable = "disputes";
  if (!direct.error && direct.data) {
    dRow = direct.data as Row;
  } else if (sessionMiss && opts?.adminBypassClient) {
    const bypass = await opts.adminBypassClient.from("disputes").select("*").eq("id", id).maybeSingle();
    if (!bypass.error && bypass.data) {
      readClient = opts.adminBypassClient;
      dRow = bypass.data as Row;
    } else {
      dErr = bypass.error?.message ?? direct.error?.message ?? null;
    }
  } else {
    dErr = direct.error?.message ?? null;
  }

  if (!dRow) {
    return {
      dispute: { table: resolvedTable, row: null, error: dErr },
      refund: { table: null, row: null, error: null },
      payment: { table: null, row: null, error: null },
      subscription: { table: null, row: null, error: null },
      customOrder: { table: null, row: null, error: null },
      modLogs: { table: null, rows: [], error: null },
      probe: dErr || resolvedTable || "disputes(미로드)",
    };
  }

  // W4(C10): FK 후보 키 스캔 축소 — disputes 실존 FK 는 payment_id·subscription_id·
  // custom_request_order_id 뿐(187 baseline 실측).
  const payId = dRow.payment_id != null ? String(dRow.payment_id) : null;
  const subId = dRow.subscription_id != null ? String(dRow.subscription_id) : null;
  const cOrderId = dRow.custom_request_order_id != null ? String(dRow.custom_request_order_id) : null;

  // W4(C10): 환불 연계 — 후보 FK 컬럼(refund_id 등) 부재 실측(187 baseline 0) — 프로빙 제거,
  // 현행 관측 동작(빈 결과) 고정. 기능 정본화는 비범위.
  const rRef: { table: string | null; row: Row | null; err: string | null } = { table: null, row: null, err: null };
  let pRef = payId ? await fetchRowById(readClient, "payments", payId) : { table: null, row: null, err: null };
  const sRef = subId ? await fetchRowById(readClient, "subscriptions", subId) : { table: null, row: null, err: null };
  const cRef = cOrderId
    ? await fetchRowById(readClient, "custom_request_orders", cOrderId)
    : { table: null, row: null, err: null };

  if (!pRef.row && cOrderId) {
    const pByOrder = await fetchPaymentRowByOrderId(readClient, cOrderId);
    if (pByOrder.row) {
      pRef = { table: pByOrder.table, row: pByOrder.row, err: pByOrder.err };
    }
  }

  // W4(C10): 처리 로그 — 후보 테이블 부재 실측(187 baseline 0: moderation_logs/dispute_events/
  // support_events/admin_audit_logs) — 프로빙 제거, 현행 관측 동작(빈 결과) 고정. 기능 정본화는 비범위.
  const mTab: { table: string | null; rows: Row[]; err: string | null } = { table: null, rows: [], err: null };

  const probe = [resolvedTable, rRef.table, pRef.table, sRef.table, cRef.table, mTab.table]
    .filter((x) => x != null && x !== "")
    .join(" · ");

  return {
    dispute: { table: resolvedTable, row: dRow, error: null },
    refund: { table: rRef.table, row: rRef.row, error: rRef.err },
    payment: { table: pRef.table, row: pRef.row, error: pRef.err },
    subscription: { table: sRef.table, row: sRef.row, error: sRef.err },
    customOrder: { table: cRef.table, row: cRef.row, error: cRef.err },
    modLogs: { table: mTab.table, rows: mTab.rows, error: mTab.err },
    probe: probe || "—",
  };
}

export function pickText(row: Row | null, keys: string[]): string {
  if (!row) return "—";
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "—";
}

export function statusBadgeText(row: Row | null, keys: string[]): string {
  if (!row) return "—";
  for (const k of keys) {
    if (k in row && row[k] !== null && row[k] !== undefined) {
      return String(row[k]);
    }
  }
  return "—";
}

const MOD_LOG_TEXT_KEYS = [
  "message",
  "body",
  "detail",
  "note",
  "summary",
  "description",
  "event_type",
  "type",
  "action",
] as const;

/** 처리 로그 row를 사용자 화면용 한 줄로(원문 JSON 노출 방지) */
export function formatModLogLine(row: Record<string, unknown>): string {
  for (const k of MOD_LOG_TEXT_KEYS) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 240);
  }
  const at = row.created_at ?? row.timestamp ?? row.inserted_at;
  if (at != null) {
    const s = String(at);
    return s.length > 22 ? `처리 시각 ${s.slice(0, 19)}…` : `처리 시각 ${s}`;
  }
  return "처리 기록(상세 비공개)";
}

/**
 * W22 목록·상세: refunds / payments / 구독 / 맞춤주문 연계 1줄(스키마·RLS에 따라 empty 가능)
 */
export function w22EntityLine(
  label: string,
  table: string | null,
  row: Row | null,
  err: string | null
): string {
  void table;
  if (err) {
    console.error("[w22EntityLine]", label, err);
    return `${label}: ${USER_UI_LOAD_FAILED}`;
  }
  if (!row) {
    return `${label}: 연계 정보 없음`;
  }
  const id = pickText(row, ["id", "uuid"]);
  const money = pickText(row, ["amount", "total", "amount_krw", "gross", "refund_amount", "price", "net"]);
  const st = pickText(row, ["status", "state", "refund_status", "payment_status"]);
  const bits: string[] = [];
  if (id !== "—") bits.push(`id ${id}`);
  if (money !== "—") bits.push(money);
  if (st !== "—") bits.push(`상태 ${st}`);
  return `${label}: ${bits.join(" · ")}`.trim();
}

/**
 * W4(C10): 당사자 판정 정본 컬럼 — disputes.student_id(원고) · disputes.mentor_id(상대).
 * 나머지 후보 키(reporter_id/user_id/created_by/counterparty_id 등)는 부재 실측(187 baseline 0)이라 삭제.
 */
export function canPartyViewDispute(
  userId: string,
  role: "student" | "mentor",
  row: Row | null
): { ok: boolean; detail: string } {
  if (!row) return { ok: false, detail: "row 없음" };
  if ("student_id" in row && String(row.student_id) === userId) {
    return { ok: true, detail: "student_id" };
  }
  if (role === "mentor" && "mentor_id" in row && String(row.mentor_id) === userId) {
    return { ok: true, detail: "mentor_id" };
  }
  return { ok: false, detail: "user 매칭 실패" };
}

export type DisputeActorSummary = {
  id: string | null;
  display: string;
  roleHint: string;
  probe: string;
};

/**
 * 관리자 상세: disputes row에 있는 user FK → public.users 한 줄(가능할 때)
 */
export async function loadDisputeActorSummaries(
  supabase: SupabaseClient,
  dRow: Row
): Promise<{ reporter: DisputeActorSummary; student: DisputeActorSummary; mentor: DisputeActorSummary }> {
  const pickUid = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = dRow[k];
      if (typeof v === "string" && v.length >= 8) {
        return v;
      }
    }
    return null;
  };
  async function one(id: string | null, roleHint: string): Promise<DisputeActorSummary> {
    if (!id) {
      return { id: null, display: "—", roleHint, probe: "FK 없음" };
    }
    const { data, error } = await getUserProfileById(supabase, id);
    if (error || !data) {
      return { id, display: `${id.slice(0, 8)}…`, roleHint, probe: error?.message ?? "users 조회 없음" };
    }
    const display = (data.nickname?.trim() || data.full_name?.trim() || id) as string;
    return { id, display, roleHint, probe: "users" };
  }
  const reporter = await one(
    pickUid(["submitted_by", "reporter_id", "created_by", "applicant_id", "opened_by"]),
    "신청/신고"
  );
  const student = await one(pickUid(["student_id", "user_id", "buyer_id", "client_id", "plaintiff_id"]), "학생/의뢰자");
  const mentor = await one(
    pickUid(["mentor_id", "mentor_user_id", "expert_id", "defendant_id", "counterparty_id", "assigned_mentor_id"]),
    "멘토/상대"
  );
  return { reporter, student, mentor };
}
