import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { loadMentorProfilesForDirectory } from "@/lib/auth/mentorPublicRead";
import { API_WEB_V1_SCHEMA } from "@/lib/apiWebV1/rpc";
import type { UserRow } from "@/lib/types/user";
import { buildMentorProfileDisplay, type MentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";

type Row = Record<string, unknown>;

function isPublicBrowsePostRow(row: Row): boolean {
  const s = String(row.status ?? "").trim().toLowerCase();
  const st = String(row.state ?? "").trim().toLowerCase();
  if (!s && !st) return true;
  return s === "open" || st === "open" || st === "published";
}

function fmt(e: PostgrestError | null): string | null {
  return e ? e.message : null;
}

const INACTIVE_CUSTOM_ORDER_STATUSES = new Set(["cancelled", "canceled", "refunded", "rejected"]);

function normOrderStatusValue(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function isActiveCustomRequestOrderRow(row: Row): boolean {
  return (
    !INACTIVE_CUSTOM_ORDER_STATUSES.has(normOrderStatusValue(row.payment_status)) &&
    !INACTIVE_CUSTOM_ORDER_STATUSES.has(normOrderStatusValue(row.status)) &&
    !INACTIVE_CUSTOM_ORDER_STATUSES.has(normOrderStatusValue(row.state)) &&
    !INACTIVE_CUSTOM_ORDER_STATUSES.has(normOrderStatusValue(row.order_status))
  );
}

/**
 * W4(C10): 주문 자식 테이블(FK) 정본 열.
 * custom_order_deliverables · custom_order_revisions · custom_order_messages · order_events 모두
 * custom_request_order_id uuid NOT NULL (003, 187 baseline 실측) — 런타임 프로빙 불필요.
 */
export const ORDER_CHILD_FK_COLUMN = "custom_request_order_id" as const;

/**
 * W4(C10): 자식 행 insert 시 정본 FK + 호환 미러 열(order_id·custom_order_id·request_order_id, 비 FK·nullable)을
 * 정적으로 채운다. 4개 자식 테이블 전부에 미러 열이 실존(187 baseline)하므로 기존 프로빙 결과와 동일 payload.
 */
export function buildOrderChildIdColumns(orderId: string): Record<string, unknown> {
  return {
    custom_request_order_id: orderId,
    order_id: orderId,
    custom_order_id: orderId,
    request_order_id: orderId,
  };
}

// W4(C10): firstReadableCustomTable(후보 테이블 순회 helper) 삭제 — customOrderEscrowService 의
// 마지막 호출부까지 정본 custom_request_orders 고정으로 전환 완료, 활성 호출자 0.

export type CustomListResult = {
  table: string | null;
  sourceNote: string;
  rows: Row[];
  error: string | null;
};

/** W4(C10): custom_request_posts.created_at desc 고정(003 — 187 baseline 실측). 프로빙·정렬 재시도 제거. */
export async function loadRecentCustomRequestPosts(supabase: SupabaseClient, limit = 8): Promise<CustomListResult> {
  const table = "custom_request_posts";
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.max(limit * 4, limit));
  if (error) {
    return { table, sourceNote: error.message, rows: [], error: error.message };
  }
  const rows = (data as Row[] | null) ?? [];
  return {
    table,
    sourceNote: "최근 공개 의뢰(open/published)",
    rows: rows.filter(isPublicBrowsePostRow).slice(0, limit),
    error: null,
  };
}

/** 학생 본인이 등록한 의뢰 목록 — W4(C10): custom_request_posts.author_id(NOT NULL) 고정, 무정렬 재시도 제거 */
export async function loadStudentCustomRequestPosts(
  supabase: SupabaseClient,
  studentId: string,
  limit = 50
): Promise<CustomListResult> {
  const table = "custom_request_posts";
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("author_id", studentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return { table, sourceNote: error.message, rows: [], error: error.message };
  }
  return { table, sourceNote: `${table}.author_id`, rows: (data as Row[]) ?? [], error: null };
}

// D-CR-8: 사문 카테고리 로더(loadCustomRequestCategories)·CustomCategoryRow 제거 —
// 카테고리 테이블 부재(187 baseline 0)로 항상 빈 배열이던 스텁이 DB 조회처럼 보여 오해를 유발했다.
// 카테고리 UI 는 CustomRequestCategoryGrid 의 정적 상수로 정본화.

export function pickMentorIdFromApplication(r: Row): string | null {
  for (const k of ["mentor_id", "applicant_id", "user_id", "proposer_id"] as const) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

export function pickApplicationRowId(r: Row): string | null {
  const v = r.id;
  if (typeof v === "string" && v) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function applicationRowMatchesPostId(row: Row, postId: string): boolean {
  for (const k of ["post_id", "request_id", "custom_request_id", "custom_request_post_id"] as const) {
    if (k in row && row[k] != null && String(row[k]) === postId) return true;
  }
  return false;
}

export function verifyApplicationForPost(row: Row | null, postId: string): { ok: boolean; detail: string } {
  if (!row) return { ok: false, detail: "application row 없음" };
  if (applicationRowMatchesPostId(row, postId)) return { ok: true, detail: "post fk 일치" };
  return { ok: false, detail: "postId 불일치" };
}

/** W4(C10): custom_request_applications 단일 정본 테이블(003 — 187 baseline 실측) */
export async function loadApplicationById(
  supabase: SupabaseClient,
  applicationId: string
): Promise<{ row: Row | null; table: string | null; error: string | null }> {
  const t = "custom_request_applications";
  const { data, error } = await supabase.from(t).select("*").eq("id", applicationId).maybeSingle();
  if (error) {
    return { row: null, table: t, error: error.message };
  }
  return { row: (data as Row) ?? null, table: t, error: null };
}

/**
 * 이미 이 의뢰·학생에 대한 주문이 있는지(1명 선정 = 1주문 정책)
 * W4(C10): custom_request_orders.post_id + student_id(둘 다 NOT NULL, 003) 고정 — 컬럼 프로빙 제거.
 */
export async function findOrderForPostAndStudent(
  supabase: SupabaseClient,
  postId: string,
  studentId: string
): Promise<{ row: Row | null; table: string | null; orderId: string | null; probe: string; error: string | null }> {
  const t = "custom_request_orders";
  const { data, error } = await supabase
    .from(t)
    .select("*")
    .eq("post_id", postId)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    return { row: null, table: t, orderId: null, probe: error.message, error: error.message };
  }
  const rows = ((data as Row[] | null) ?? []).filter(isActiveCustomRequestOrderRow);
  const row = rows[0] ?? null;
  const rid = row ? pickOrderIdFromRow(row) : null;
  return { row, table: t, orderId: rid, probe: `${t}.post_id+student_id`, error: null };
}

function pickOrderIdFromRow(row: Row): string | null {
  return pickApplicationRowId(row);
}

export type PostAttachmentListItem = {
  id: string;
  original_filename: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  created_at: string;
};

export type ApplicationAttachmentListItem = {
  id: string;
  application_id: string;
  original_filename: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  created_at: string;
};

/**
 * 의뢰 등록 첨부(메타) — RLS: 작성·멘토·admin만 행 조회. 비로그인·비참여는 0행.
 * W4(C10): relation/schema cache 오류를 빈 성공으로 바꾸던 분기 제거(테이블 실존 — 012, 187 baseline) — 오류는 그대로 반환.
 */
export async function loadPostAttachments(
  supabase: SupabaseClient,
  postId: string
): Promise<{ rows: PostAttachmentListItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from("custom_request_post_attachments")
    .select("id, original_filename, file_size_bytes, mime_type, created_at")
    .eq("custom_request_post_id", postId)
    .order("created_at", { ascending: true });
  if (error) {
    return { rows: [], error: error.message };
  }
  const list = (data as Row[] | null) ?? [];
  return {
    rows: list.map((r) => ({
      id: String(r.id),
      original_filename: String(r.original_filename ?? "파일"),
      file_size_bytes: typeof r.file_size_bytes === "number" ? r.file_size_bytes : null,
      mime_type: typeof r.mime_type === "string" ? r.mime_type : null,
      created_at:
        r.created_at != null && (typeof r.created_at === "string" || r.created_at instanceof Date)
          ? String(r.created_at)
          : "",
    })),
    error: null,
  };
}

/**
 * 멘토 지원서 첨부(메타) — RLS: 지원 멘토 본인 · post 작성 학생 · admin만 행 조회.
 * W4(C10): relation/schema cache 오류의 빈 성공 변환 제거(테이블 실존 — 059, 187 baseline).
 */
export async function loadApplicationAttachments(
  supabase: SupabaseClient,
  applicationIds: string[]
): Promise<{ byApplicationId: Record<string, ApplicationAttachmentListItem[]>; error: string | null }> {
  const ids = [...new Set(applicationIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return { byApplicationId: {}, error: null };
  }
  const { data, error } = await supabase
    .from("custom_request_application_attachments")
    .select("id, application_id, original_filename, file_size_bytes, mime_type, created_at")
    .in("application_id", ids)
    .order("created_at", { ascending: true });
  if (error) {
    return { byApplicationId: {}, error: error.message };
  }
  const byApplicationId: Record<string, ApplicationAttachmentListItem[]> = {};
  for (const raw of (data as Row[] | null) ?? []) {
    const appId = String(raw.application_id ?? "");
    if (!appId) continue;
    const item: ApplicationAttachmentListItem = {
      id: String(raw.id),
      application_id: appId,
      original_filename: String(raw.original_filename ?? "파일"),
      file_size_bytes: typeof raw.file_size_bytes === "number" ? raw.file_size_bytes : null,
      mime_type: typeof raw.mime_type === "string" ? raw.mime_type : null,
      created_at:
        raw.created_at != null && (typeof raw.created_at === "string" || raw.created_at instanceof Date)
          ? String(raw.created_at)
          : "",
    };
    if (!byApplicationId[appId]) byApplicationId[appId] = [];
    byApplicationId[appId].push(item);
  }
  return { byApplicationId, error: null };
}

/** W4(C10): custom_request_posts 단일 정본 테이블(003) */
export async function loadCustomPostById(
  supabase: SupabaseClient,
  postId: string
): Promise<{ row: Row | null; table: string | null; error: string | null }> {
  const table = "custom_request_posts";
  const { data, error } = await supabase.from(table).select("*").eq("id", postId).maybeSingle();
  if (error) {
    return { row: null, table, error: error.message };
  }
  return { row: (data as Row) ?? null, table, error: null };
}

/**
 * 공개 상세 페이지: 작성자·동의어 컬럼은 RLS로 직접 SELECT 가능.
 * 멘토는 crp_select에 없어 0행 → `get_public_custom_request_post_for_browse` RPC로 최소 열만 조회(006 SQL).
 * W4(C10): RPC 실존(006, 187 baseline) — missing-function 무음 강등 분기 제거, RPC 오류는 그대로 반환.
 */
export async function loadCustomPostForPublicDetail(
  supabase: SupabaseClient,
  postId: string
): Promise<{ row: Row | null; table: string | null; error: string | null }> {
  const direct = await loadCustomPostById(supabase, postId);
  if (direct.row || direct.error) {
    return direct;
  }
  const { data, error } = await supabase.rpc("get_public_custom_request_post_for_browse", { p_post_id: postId }).maybeSingle();
  if (error) {
    return { row: null, table: "custom_request_posts", error: error.message };
  }
  if (!data) {
    return { row: null, table: "custom_request_posts", error: null };
  }
  return { row: data as Row, table: "custom_request_posts", error: null };
}

/** 의뢰자 = 현재 user 인지(컬럼명 후보) */
export function isAuthorOfPost(userId: string, row: Row | null): { ok: boolean; detail: string } {
  if (!row) return { ok: false, detail: "row 없음" };
  const col = pickAuthorColumn(row);
  if (!col) return { ok: false, detail: "author/sponsor 컬럼 미식별" };
  const v = row[col];
  if (v === userId) return { ok: true, detail: col };
  return { ok: false, detail: `${col} 불일치` };
}

function pickAuthorColumn(row: Row): string | null {
  if ("author_id" in row) return "author_id";
  return null;
}

/**
 * W4(C10): custom_request_applications.post_id(NOT NULL, 003) 고정.
 * 구 코드의 "FK 미탐지 → 전체 샘플(무필터)" 분기·무정렬 재시도 제거 — 오류는 오류로 반환.
 */
export async function loadApplicationsForPost(
  supabase: SupabaseClient,
  postId: string,
  limit = 40
): Promise<CustomListResult & { postTable: string | null }> {
  const t = "custom_request_applications";
  const { data, error } = await supabase
    .from(t)
    .select("*")
    .eq("post_id", postId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return { table: t, postTable: null, sourceNote: error.message, rows: [], error: error.message };
  }
  return { table: t, postTable: t, sourceNote: `${t}.post_id = post`, rows: (data as Row[]) ?? [], error: null };
}

/**
 * W4(C10): 주문(custom_request_orders) · 납품(custom_order_deliverables.custom_request_order_id, version desc)
 * · 분쟁(disputes.custom_request_order_id) 정본 고정 — 테이블/FK 프로빙과 무정렬 재시도 제거(187 baseline 실측).
 */
export async function loadOrderBundle(
  supabase: SupabaseClient,
  orderId: string
): Promise<{
  order: { row: Row | null; table: string | null; error: string | null };
  deliverables: CustomListResult;
  disputes: CustomListResult;
}> {
  const orderTable = "custom_request_orders";
  let orderRow: Row | null = null;
  let orderErr: string | null = null;
  {
    const { data, error } = await supabase.from(orderTable).select("*").eq("id", orderId).maybeSingle();
    if (error) {
      orderErr = error.message;
    } else {
      orderRow = (data as Row) ?? null;
    }
  }

  const deliverablesTable = "custom_order_deliverables";
  let deliv: CustomListResult;
  {
    const { data, error } = await supabase
      .from(deliverablesTable)
      .select("*")
      .eq(ORDER_CHILD_FK_COLUMN, orderId)
      .order("version", { ascending: false });
    deliv = {
      table: deliverablesTable,
      sourceNote: `deliverables · ${ORDER_CHILD_FK_COLUMN}`,
      rows: error ? [] : ((data as Row[]) ?? []),
      error: fmt(error),
    };
  }

  const disputesTable = "disputes";
  let disputes: CustomListResult;
  {
    const { data, error } = await supabase.from(disputesTable).select("*").eq(ORDER_CHILD_FK_COLUMN, orderId).limit(20);
    disputes = {
      table: disputesTable,
      sourceNote: "분쟁(조회만)",
      rows: error ? [] : ((data as Row[]) ?? []),
      error: fmt(error),
    };
  }

  return {
    order: { row: orderRow, table: orderTable, error: orderRow ? null : (orderErr ?? "주문 없음") },
    deliverables: deliv,
    disputes,
  };
}

export function pickDisplayField(row: Row, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "—";
}

// ---------------------------------------------------------------------------
// custom_request_applications (학생 비교·주문) — PostgREST가 numeric/날짜를 string이 아닌 형태로 줄 수 있음
// ---------------------------------------------------------------------------

/** 1순위 proposed_price → price → bid_amount, 숫자/문자 모두 허용 */
export function getApplicationPriceAmount(row: Row): number | null {
  for (const k of ["proposed_price", "price", "bid_amount"] as const) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
    if (typeof v === "string" && v.trim()) {
      const n = Number.parseFloat(v.replace(/,/g, "").trim());
      if (Number.isFinite(n)) {
        return n;
      }
    }
  }
  return null;
}

/** 예: 50000 → 50,000원 */
export function formatApplicationPriceKrwDisplay(row: Row): string {
  const n = getApplicationPriceAmount(row);
  if (n === null) {
    return "가격 미입력";
  }
  return new Intl.NumberFormat("ko-KR").format(n) + "캐시";
}

/** 예상 기간 (N일) */
export function formatApplicationDurationDays(row: Row): string {
  for (const k of ["expected_days", "duration_days", "delivery_days", "days"] as const) {
    const v = row[k];
    if (typeof v === "number" && v > 0) return `${Math.round(v)}일`;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return `${v.trim()}일`;
  }
  for (const k of ["expected_duration", "duration_weeks", "timeline"] as const) {
    const v = row[k];
    if (typeof v === "string" && v.trim() && v.trim() !== "—") {
      const n = Number(String(v).replace(/[^\d]/g, ""));
      if (Number.isFinite(n) && n > 0) return `${n}일`;
      return v.trim();
    }
  }
  const due = formatApplicationDueDateDisplay(row);
  if (due !== "납기 미정") return due;
  return "기간 협의";
}

function dateLikeToYmdDots(v: unknown): string | null {
  if (v == null) {
    return null;
  }
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) {
      return null;
    }
    return `${v.getFullYear()}.${String(v.getMonth() + 1).padStart(2, "0")}.${String(v.getDate()).padStart(2, "0")}`;
  }
  if (typeof v === "string" && v.trim()) {
    const t = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
      return t.slice(0, 10).replace(/-/g, ".");
    }
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  return null;
}

/** delivery_at → proposed_due → due_proposed, ISO 풀 문자열을 그대로 보여주지 않음 */
export function formatApplicationDueDateDisplay(row: Row): string {
  for (const k of ["delivery_at", "proposed_due", "due_proposed"] as const) {
    const s = dateLikeToYmdDots(row[k]);
    if (s) {
      return s;
    }
  }
  return "납기 미정";
}

/** DB status 원문을 크게 박지 않고 짧은 사용자 라벨 */
export function formatApplicationStatusForStudent(row: Row): string {
  const s = String(row.status ?? row.state ?? "")
    .toLowerCase()
    .trim();
  if (s === "submitted" || s === "submit" || s === "sent") {
    return "지원서 제출됨";
  }
  if (s === "draft" || s === "pending_draft") {
    return "작성 중";
  }
  if (s === "accepted" || s === "selected" || s === "approved") {
    return "선정됨";
  }
  if (s === "rejected" || s === "declined" || s === "cancelled" || s === "canceled") {
    return "검토 종료";
  }
  if (s === "in_review" || s === "open" || !s) {
    return "검토 가능";
  }
  return "검토 가능";
}

const COMPARE_EMPTY = "작성된 내용이 없습니다.";

function applicationFirstNonEmptyString(row: Row, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }
  return "";
}

function compNorm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export type ApplicationTextBlocksForCompare = {
  proposal: string;
  scope: string;
  extra: string;
};

/**
 * cover_letter / scope / notes 우선순위와 동일·포함 본문 중복 완화
 */
export function getApplicationTextBlocksForCompare(row: Row): ApplicationTextBlocksForCompare {
  const rawP = applicationFirstNonEmptyString(row, ["cover_letter", "message", "content", "self_intro"]);
  const rawS = applicationFirstNonEmptyString(row, ["scope", "offer_scope", "services_offered"]);
  const rawE = applicationFirstNonEmptyString(row, ["notes", "extra_answers", "answers"]);

  const proposal = rawP || COMPARE_EMPTY;
  let scope = rawS || COMPARE_EMPTY;
  let extra = rawE || COMPARE_EMPTY;

  const nP = rawP ? compNorm(rawP) : "";
  const nS = rawS ? compNorm(rawS) : "";
  const nE = rawE ? compNorm(rawE) : "";

  if (nP && nS && nP === nS) {
    scope = "제안 내용에 포함되어 있어, 별도의 작업 범위 문구는 없습니다.";
  }
  if (nE && nP && nE === nP) {
    extra = "제안 내용에 포함되어 있어, 별도 추가 메모는 없습니다.";
  } else if (nE && nS && nE === nS && nP && nE !== nP) {
    extra = "작업 범위에 포함되어 있어, 별도 추가 메모는 없습니다.";
  } else if (nE && nP && nS && nE === nP && nE === nS) {
    extra = "제안·작업 범위와 동일한 내용입니다.";
  }
  return { proposal, scope, extra };
}

export function maskContact(s: string): string {
  if (s.length <= 2) return "**";
  return s[0] + "·".repeat(Math.min(4, s.length - 2)) + s[s.length - 1];
}

export type EnrichedApplication = {
  row: Row;
  mentorId: string | null;
  applicationId: string | null;
  display: MentorProfileDisplay | null;
};

/**
 * 멘토용 모집 중 의뢰 목록 — 018 `list_open_custom_request_posts_for_mentor_browse` RPC.
 * W4(C10): RPC 실존(018, 187 baseline) — 오류를 'empty'(빈 목록 성공)로 바꾸던 분기 제거.
 * 모든 오류는 console.error 후 `rpc_unavailable`(안내 문구 표시)로 강등 — 표시 전용 강등이며 성공이 아님.
 */
export async function loadOpenCustomRequestPostsForMentorBrowse(
  supabase: SupabaseClient,
  limit = 50
): Promise<{ rows: Row[]; status: "ok" | "empty" | "rpc_unavailable" }> {
  const { data, error } = await supabase.rpc("list_open_custom_request_posts_for_mentor_browse", { p_limit: limit });
  if (error) {
    console.error("[loadOpenCustomRequestPostsForMentorBrowse] rpc failed", error.message);
    return { rows: [], status: "rpc_unavailable" };
  }
  return { rows: (data as Row[]) ?? [], status: "ok" };
}

/**
 * 이미 이 의뢰에 (동일 멘토) 지원이 있는지 — 지원서 작성·중복 안내.
 * W4(C10): custom_request_applications.post_id+mentor_id 고정.
 * 조회 오류 시 console.error 후 false — 표시 전용 강등(중복 안내 UX 힌트일 뿐, 성공 아님. 실제 중복 차단은 insert 시 dup 검사).
 */
export async function mentorHasApplicationForPost(
  supabase: SupabaseClient,
  postId: string,
  mentorId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("custom_request_applications")
    .select("id")
    .eq("post_id", postId)
    .eq("mentor_id", mentorId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[mentorHasApplicationForPost] query failed", { postId, error: error.message });
    return false;
  }
  return Boolean(data);
}

/**
 * 멘토가 해당 post에 제출한 application id (없으면 null).
 * W4(C10): 정본 고정. 조회 오류 시 console.error 후 null — 표시 전용 강등(링크 힌트), 성공 아님.
 */
export async function loadMentorApplicationIdForPost(
  supabase: SupabaseClient,
  postId: string,
  mentorId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("custom_request_applications")
    .select("id")
    .eq("post_id", postId)
    .eq("mentor_id", mentorId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[loadMentorApplicationIdForPost] query failed", { postId, error: error.message });
    return null;
  }
  if (!data) return null;
  const id = (data as Row).id;
  return id != null ? String(id) : null;
}

export type MentorApplicationWithPostHint = {
  application: Row;
  postId: string;
  postTitle: string;
  href: string;
};

export type MentorOrderApplicationFilterKeys = {
  applicationIds: Set<string>;
  postIds: Set<string>;
};

function pickPostIdFromCustomRow(r: Row): string {
  return String(
    r.post_id ?? r.custom_request_post_id ?? r.request_id ?? r.custom_request_id ?? ""
  ).trim();
}

function applicationHasMentorOrder(app: Row, keys: MentorOrderApplicationFilterKeys): boolean {
  const appId = pickApplicationRowId(app);
  if (appId && keys.applicationIds.has(appId)) {
    return true;
  }
  const postId = pickPostIdFromCustomRow(app);
  return Boolean(postId && keys.postIds.has(postId));
}

/**
 * 멘토 주문 중 application·post 연결 키(제안 목록에서 주문 전환 건 제외용, 읽기 전용).
 * W4(C10): custom_request_orders.mentor_id/application_id/post_id 고정(003).
 * 조회 오류 시 console.error 후 빈 집합 — 표시 전용 강등(목록 필터 힌트), 성공 아님.
 */
export async function fetchMentorOrderApplicationFilterKeys(
  supabase: SupabaseClient,
  mentorId: string
): Promise<MentorOrderApplicationFilterKeys> {
  const empty = { applicationIds: new Set<string>(), postIds: new Set<string>() };
  const { data, error } = await supabase
    .from("custom_request_orders")
    .select("application_id, post_id")
    .eq("mentor_id", mentorId);
  if (error) {
    console.error("[fetchMentorOrderApplicationFilterKeys] query failed", { mentorId, error: error.message });
    return empty;
  }
  const applicationIds = new Set<string>();
  const postIds = new Set<string>();
  for (const row of ((data ?? []) as unknown as Row[])) {
    const aid = String(row.application_id ?? "").trim();
    if (aid) {
      applicationIds.add(aid);
    }
    const pid = String(row.post_id ?? "").trim();
    if (pid) {
      postIds.add(pid);
    }
  }
  return { applicationIds, postIds };
}

/**
 * 멘토가 지원한 의뢰 post id 전체(주문 전환 여부 무관) — open 풀 제외용.
 * W4(C10): custom_request_applications.mentor_id/post_id 고정.
 * 조회 오류 시 console.error 후 빈 집합 — 표시 전용 강등(open 풀 필터), 성공 아님.
 */
export async function loadMentorAppliedPostIdSet(
  supabase: SupabaseClient,
  mentorId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("custom_request_applications")
    .select("post_id")
    .eq("mentor_id", mentorId);
  if (error) {
    console.error("[loadMentorAppliedPostIdSet] query failed", { mentorId, error: error.message });
    return new Set();
  }
  const ids = new Set<string>();
  for (const row of ((data ?? []) as unknown as Row[])) {
    const id = String(row.post_id ?? "").trim();
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * 멘토가 제출한 지원 요약(의뢰 제목은 browse RPC·상세 조회로 보강).
 * 주문으로 전환된 지원은 제외(매칭 대기만).
 * W4(C10): custom_request_applications.mentor_id + created_at desc 고정 — 무정렬 재시도 제거, 오류는 listFailed.
 */
export async function loadMentorRecentApplicationsWithPostHints(
  supabase: SupabaseClient,
  mentorId: string,
  max = 20
): Promise<{ items: MentorApplicationWithPostHint[]; listFailed: boolean }> {
  const orderKeys = await fetchMentorOrderApplicationFilterKeys(supabase, mentorId);
  const o1 = await supabase
    .from("custom_request_applications")
    .select("*")
    .eq("mentor_id", mentorId)
    .order("created_at", { ascending: false })
    .limit(max);
  if (o1.error) {
    console.error("[loadMentorRecentApplicationsWithPostHints] query failed", { mentorId, error: o1.error.message });
    return { items: [], listFailed: true };
  }
  const pending = ((o1.data as Row[]) ?? []).filter((a) => !applicationHasMentorOrder(a, orderKeys));
  return mapAppsToHints(supabase, pending);
}

async function mapAppsToHints(
  supabase: SupabaseClient,
  apps: Row[]
): Promise<{ items: MentorApplicationWithPostHint[]; listFailed: boolean }> {
  const items: MentorApplicationWithPostHint[] = [];
  for (const a of apps) {
    const pid = pickPostIdFromCustomRow(a);
    if (!pid) {
      continue;
    }
    const detail = await loadCustomPostForPublicDetail(supabase, pid);
    const title = detail.row
      ? pickDisplayField(detail.row, ["title", "subject", "body"])
      : "맞춤의뢰";
    items.push({
      application: a,
      postId: pid,
      postTitle: title,
      href: `/mentor/custom-request/posts/${pid}`,
    });
  }
  return { items, listFailed: false };
}

/**
 * 학생·의뢰자: 선정한 주문 id(선택 전·비해당 시 null) — UI에는 orderId만 사용.
 * W4(C10): 조회 오류 시 console.error 후 null — 표시 전용 강등(주문방 이동 링크 힌트), 성공 아님.
 * 실제 1의뢰 1주문 강제는 주문 생성 경로에서 별도 수행.
 */
export async function getOrderIdForPostAndStudent(
  supabase: SupabaseClient,
  postId: string,
  studentId: string
): Promise<string | null> {
  const r = await findOrderForPostAndStudent(supabase, postId, studentId);
  if (r.error) {
    console.error("[getOrderIdForPostAndStudent] query failed", { postId, error: r.error });
  }
  return r.orderId;
}

/**
 * D-CR-5: 지원자 표시명(nickname) 배치 조회 — mentor_directory_v1(V3) 1쿼리.
 * 프로필 배치(loadMentorProfilesForDirectory)는 nickname 을 매핑하지 않으므로 표시명 전용으로 분리 조회한다.
 */
async function loadMentorNicknamesByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Map<string, string | null>> {
  const byId = new Map<string, string | null>();
  if (ids.length === 0) return byId;
  const { data, error } = await supabase
    .schema(API_WEB_V1_SCHEMA)
    .from("mentor_directory_v1")
    .select("mentor_id, nickname")
    .in("mentor_id", ids);
  if (error) {
    console.error("[loadMentorNicknamesByIds] directory read failed", error.message);
    return byId;
  }
  for (const raw of (data as Row[] | null) ?? []) {
    const id = typeof raw.mentor_id === "string" ? raw.mentor_id : String(raw.mentor_id ?? "");
    if (id) byId.set(id, typeof raw.nickname === "string" ? raw.nickname : null);
  }
  return byId;
}

/**
 * D-CR-5: 지원자 1명당 프로필·users 2쿼리 순차(N+1) 제거 —
 * mentorIds 를 모아 배치 2쿼리(프로필 in() + 표시명 in())로 치환.
 */
export async function enrichApplicationRows(supabase: SupabaseClient, rows: Row[]): Promise<EnrichedApplication[]> {
  const mentorIds = [
    ...new Set(rows.map(pickMentorIdFromApplication).filter((x): x is string => !!x)),
  ];

  const [{ byUser: profByUser }, nickById] = await Promise.all([
    loadMentorProfilesForDirectory(supabase, mentorIds),
    loadMentorNicknamesByIds(supabase, mentorIds),
  ]);

  return rows.map((row) => {
    const mentorId = pickMentorIdFromApplication(row);
    const applicationId = pickApplicationRowId(row);
    if (!mentorId) {
      return { row, mentorId: null, applicationId, display: null };
    }
    const profRow = (profByUser.get(mentorId) as Row | undefined) ?? null;
    // buildMentorProfileDisplay 는 userRow 의 full_name·nickname 만 표시명에 사용한다(V3 는 full_name 비노출).
    const userRow = { full_name: null, nickname: nickById.get(mentorId) ?? null } as unknown as UserRow;
    const display = buildMentorProfileDisplay(profRow, userRow);
    return { row, mentorId, applicationId, display };
  });
}
