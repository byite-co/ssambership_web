import type { SupabaseClient } from "@supabase/supabase-js";

type MutationResult =
  | { ok: true; id: string; row: Record<string, unknown> | null }
  | { ok: false; error: string };

// W4(C10): insertWithCandidates/updateWithCandidates(누락 컬럼 오류 시 축소 payload 재시도 사다리) 제거 —
// 정본 payload 의 모든 컬럼이 003 스키마에 실존(187 baseline 실측)하므로 단일 insert/update 로 고정.
// 오류는 재시도 없이 그대로 반환한다.

function toId(row: Record<string, unknown> | null, err: string | null): MutationResult {
  if (err) return { ok: false, error: err };
  if (!row) return { ok: false, error: "삽입 행이 없습니다." };
  const raw = row.id;
  if (raw === undefined || raw === null) return { ok: false, error: "id 컬럼이 없습니다." };
  return { ok: true, id: String(raw), row };
}

export type NewCustomRequestInput = {
  category: string;
  subject: string;
  goal: string;
  body: string;
  deadline: string;
  budgetMin: string;
  budgetMax: string;
  deliverableFormat: string;
  agreedProhibited: boolean;
  agreedNoExternalContact: boolean;
  authorId: string;
  status?: "open" | "draft";
};

/** W4(C10): 단일 정본 payload — 모든 키가 custom_request_posts 실존 컬럼(003, 187 baseline). 축소 폴백 payload 폐기. */
function buildCustomRequestPostPayload(input: NewCustomRequestInput): Record<string, unknown> {
  const postStatus = input.status ?? "open";
  const bMin = input.budgetMin ? Number(input.budgetMin) : null;
  const bMax = input.budgetMax ? Number(input.budgetMax) : null;
  return {
    subject: input.subject,
    body: input.body,
    category: input.category,
    subcategory: input.goal,
    goal: input.goal,
    title: input.subject,
    due_at: input.deadline || null,
    deadline: input.deadline || null,
    due_date: input.deadline || null,
    deliverable_type: input.deliverableFormat,
    deliverable_format: input.deliverableFormat,
    result_format: input.deliverableFormat,
    budget_min: bMin,
    budget_max: bMax,
    status: postStatus,
    state: postStatus,
    author_id: input.authorId,
  };
}

export async function insertCustomRequestPost(
  supabase: SupabaseClient,
  input: NewCustomRequestInput
): Promise<MutationResult> {
  const postStatus = input.status ?? "open";
  if (postStatus !== "draft" && (!input.agreedProhibited || !input.agreedNoExternalContact)) {
    return { ok: false, error: "필수 동의 항목이 필요합니다." };
  }
  const { data, error } = await supabase
    .from("custom_request_posts")
    .insert(buildCustomRequestPostPayload(input))
    .select("*")
    .limit(1)
    .maybeSingle();
  return toId((data as Record<string, unknown> | null) ?? null, error ? error.message : null);
}

export async function updateCustomRequestDraftPost(
  supabase: SupabaseClient,
  postId: string,
  input: NewCustomRequestInput
): Promise<MutationResult> {
  const postStatus = input.status ?? "draft";
  if (postStatus !== "draft" && (!input.agreedProhibited || !input.agreedNoExternalContact)) {
    return { ok: false, error: "필수 동의 항목이 필요합니다." };
  }
  const { data, error } = await supabase
    .from("custom_request_posts")
    .update(buildCustomRequestPostPayload(input))
    .eq("id", postId)
    .select("*")
    .limit(1)
    .maybeSingle();
  return toId((data as Record<string, unknown> | null) ?? null, error ? error.message : null);
}

export async function deleteCustomRequestDraftPost(
  supabase: SupabaseClient,
  postId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("custom_request_posts")
    .delete()
    .eq("id", postId)
    .eq("status", "draft")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!data) {
    return { ok: false, error: "삭제할 임시저장 글이 없습니다." };
  }
  return { ok: true };
}

export async function insertCustomRequestPostAttachment(
  supabase: SupabaseClient,
  input: {
    postId: string;
    uploadedBy: string;
    storagePath: string;
    originalFilename: string;
    mimeType: string;
    fileSizeBytes: number;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("custom_request_post_attachments").insert({
    custom_request_post_id: input.postId,
    uploaded_by: input.uploadedBy,
    storage_path: input.storagePath,
    original_filename: input.originalFilename,
    mime_type: input.mimeType,
    file_size_bytes: input.fileSizeBytes,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function insertCustomRequestApplicationAttachment(
  supabase: SupabaseClient,
  input: {
    applicationId: string;
    uploadedBy: string;
    storagePath: string;
    originalFilename: string;
    mimeType: string;
    fileSizeBytes: number;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("custom_request_application_attachments").insert({
    application_id: input.applicationId,
    uploaded_by: input.uploadedBy,
    storage_path: input.storagePath,
    original_filename: input.originalFilename,
    mime_type: input.mimeType,
    file_size_bytes: input.fileSizeBytes,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export type MentorApplicationInput = {
  postId: string;
  mentorId: string;
  proposedPrice: string;
  deliveryAt: string;
  scope: string;
  coverNote: string;
  extraAnswers: string;
};

/**
 * custom_request_applications(후보) — 멘토 1지원 1행. 주문·결제·선정은 별 흐름(후속).
 */
export async function insertMentorApplication(
  supabase: SupabaseClient,
  input: MentorApplicationInput
): Promise<MutationResult> {
  // W4(C10): custom_request_applications.post_id + mentor_id 정본 고정(003, NOT NULL — 187 baseline).
  const t = "custom_request_applications";

  // W4(C10): 중복 지원 사전 검사 — 스키마형 오류를 무시하고 insert 를 진행하던 fail-open 분기 제거.
  // (post_id, mentor_id) unique 제약이 없는 baseline 에서는 이 검사가 유일한 중복 방지이므로 오류 시 fail-closed.
  const { data: dup, error: dupErr } = await supabase
    .from(t)
    .select("id")
    .eq("post_id", input.postId)
    .eq("mentor_id", input.mentorId)
    .limit(1)
    .maybeSingle();
  if (dupErr) {
    return { ok: false, error: dupErr.message };
  }
  if (dup) {
    return { ok: false, error: "ALREADY_APPLIED" };
  }

  const priceNum = input.proposedPrice ? Number.parseFloat(input.proposedPrice) : null;
  const p1: Record<string, unknown> = {
    post_id: input.postId,
    mentor_id: input.mentorId,
    proposed_price: priceNum,
    price: priceNum,
    bid_amount: priceNum,
    delivery_at: input.deliveryAt || null,
    proposed_due: input.deliveryAt || null,
    due_proposed: input.deliveryAt || null,
    scope: input.scope,
    offer_scope: input.scope,
    services_offered: input.scope,
    cover_letter: input.coverNote,
    message: input.coverNote,
    self_intro: input.coverNote,
    extra_answers: input.extraAnswers,
    answers: input.extraAnswers,
    notes: input.extraAnswers,
    status: "submitted",
    state: "submitted",
  };
  // W4(C10): 축소 payload(content 단일 컬럼) 폴백 제거 — p1 의 모든 컬럼이 003 스키마에 실존.
  const { data, error } = await supabase.from(t).insert(p1).select("*").limit(1).maybeSingle();
  if (error) {
    // 표시 메시지 매핑(K): unique 위반을 ALREADY_APPLIED 로 치환 — 작업은 여전히 실패로 반환됨.
    if (/unique|23505|duplicate|already exists/i.test(error.message)) {
      return { ok: false, error: "ALREADY_APPLIED" };
    }
    return { ok: false, error: error.message };
  }
  return toId((data as Record<string, unknown> | null) ?? null, null);
}

export type CreateOrderFromApplicationInput = {
  postId: string;
  studentId: string;
  applicationId: string;
  mentorId: string;
  /** application에서 스냅샷(지원 제안가) */
  agreedPrice: number;
};

/**
 * 멘토 1명 선정 = custom_request_orders 1행(결제·납품은 후속).
 */
export async function insertCustomRequestOrder(
  supabase: SupabaseClient,
  input: CreateOrderFromApplicationInput
): Promise<MutationResult> {
  if (!Number.isFinite(input.agreedPrice)) {
    return { ok: false, error: "ORDER_PRICE_INVALID" };
  }
  // W4(C10): custom_request_orders 정본 테이블 고정(003, 187 baseline) — 후보 테이블 프로빙 제거
  const t = "custom_request_orders";
  const ap = input.agreedPrice;
  /** 003 스키마: post_id, student_id, mentor_id NOT NULL + status 등; agreed_price 등 스냅샷 */
  const pLean: Record<string, unknown> = {
    post_id: input.postId,
    student_id: input.studentId,
    mentor_id: input.mentorId,
    application_id: input.applicationId,
    custom_request_application_id: input.applicationId,
    selected_application_id: input.applicationId,
    status: "pending",
    state: "pending",
    order_status: "open",
    payment_status: "unpaid",
    agreed_price: ap,
    proposed_price: ap,
    price: ap,
    amount: ap,
  };
  // W4(C10): 축소 payload 폴백(p2/p3/p1) 제거 — pLean 의 모든 컬럼이 003 스키마에 실존. 단일 insert.
  const { data, error } = await supabase.from(t).insert(pLean).select("*").limit(1).maybeSingle();
  return toId((data as Record<string, unknown> | null) ?? null, error ? error.message : null);
}
