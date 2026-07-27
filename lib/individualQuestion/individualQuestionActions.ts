"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, requireQnaActor } from "@/lib/auth/routeGuard";
import { assertMentorApprovedForAction } from "@/lib/mentor/mentorVerificationGate";
import { fetchMentorIndividualQuestionPrice } from "@/lib/individualQuestion/individualQuestionPricing";
import { type IndividualQuestionEscrowResult } from "@/lib/individualQuestion/individualQuestionTypes";
import { amountCentsFromCashKrw } from "@/lib/subscribe/mentorPlanPricing";
import {
  fileHasContent,
  uploadIndividualQuestionAttachment,
} from "@/lib/individualQuestion/individualQuestionAttachmentStorage";
import { expiryDateForStatus, type IndividualQuestionExpirableStatus } from "@/lib/individualQuestion/individualQuestionExpiryConfig";
import { maskContactInUserText } from "@/lib/safety/trustSafetyText";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { loadSchoolClassificationCatalogs } from "@/lib/mentor/schoolClassificationCatalog";
import { normalizeSubjectCode } from "@/lib/subjects/subjectCatalog";

const STUDENT_LIST_PATH = "/individual-questions";
const MENTOR_LIST_PATH = "/mentor/individual-questions";

type IndividualQuestionRpcResult = IndividualQuestionEscrowResult | IndividualQuestionEscrowResult[] | null;

function textValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string): string | null {
  const value = textValue(formData, key);
  return value.length > 0 ? value : null;
}

function positiveIntegerValue(formData: FormData, key: string): number | null {
  const raw = textValue(formData, key).replace(/[,\s]/g, "");
  if (!/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function firstRpcResult(data: IndividualQuestionRpcResult): IndividualQuestionEscrowResult | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

function actionError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function createErrorMessage(codeOrMessage: string | null | undefined): string {
  const value = (codeOrMessage ?? "").toLowerCase();
  if (value.includes("insufficient") || value.includes("cash_insufficient")) {
    return "캐시가 부족해요. 충전 후 다시 질문해 주세요.";
  }
  if (value.includes("mentor_not_approved")) {
    return "아직 승인되지 않은 멘토에게는 개별 질문을 보낼 수 없어요.";
  }
  if (value.includes("invalid_price")) {
    return "개별 질문 단가가 올바르지 않습니다.";
  }
  if (value.includes("invalid_required_")) {
    return "답변 자격 조건이 올바르지 않습니다.";
  }
  return "개별 질문을 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function claimErrorMessage(codeOrMessage: string | null | undefined): string {
  const value = (codeOrMessage ?? "").toLowerCase();
  if (value.includes("mentor_school_verification_required")) {
    return "이 질문은 학교·전공 인증을 완료한 멘토만 답변할 수 있어요.";
  }
  if (value.includes("mentor_qualification_not_met")) {
    return "이 질문은 학생이 지정한 학교군·전공계열 자격을 가진 멘토만 답변할 수 있어요.";
  }
  if (value.includes("mentor_subject_not_met")) {
    return "본인 담당 과목의 질문만 답변할 수 있어요.";
  }
  if (value.includes("mentor_not_approved")) {
    return "승인 완료 후 공개 질문을 가져갈 수 있어요.";
  }
  return "이미 다른 멘토가 답변을 맡았어요. 목록을 새로 확인해 주세요.";
}

function catalogHasCode(options: Array<{ code: string }>, code: string | null): boolean {
  if (!code) return true;
  return options.some((option) => option.code === code);
}

async function setQuestionExpiryBestEffort(
  supabase: ReturnType<typeof createServiceRoleClient>,
  questionId: string,
  status: IndividualQuestionExpirableStatus
): Promise<void> {
  const expiresAt = expiryDateForStatus(status).toISOString();
  const { error } = await supabase
    .from("individual_questions")
    .update({ expires_at: expiresAt })
    .eq("id", questionId)
    .eq("status", status);
  if (error) {
    console.error("[individualQuestion] expires_at update failed", {
      questionId,
      status,
      error: error.message,
    });
  }
}

// [P1-11 원자화] 개별질문 알림(assigned/claimed/answered/released/message)은 이제 DB AFTER 트리거
// (155_p1_11_iq_notification_atomization.sql)가 domain write 와 같은 트랜잭션에서 record_domain_notification
// 으로 원자·멱등 기록한다. 기존 best-effort 후처리 알림 헬퍼는 이중 발송을 막기 위해 제거했다.

export async function createDirectIndividualQuestionAction(formData: FormData) {
  const { user } = await requireRole("student");
  const mentorId = textValue(formData, "mentorId");
  const idempotencyKey = textValue(formData, "idempotencyKey");
  const title = textValue(formData, "title");
  const body = textValue(formData, "body");
  // P2-23: 과목은 정본 subjects.code 로 정규화한다(미매핑 입력은 null). 자유 문자열을 그대로 저장하지 않는다.
  const subject = normalizeSubjectCode(optionalText(formData, "subject"));
  const topic = optionalText(formData, "topic");
  const attachment = formData.get("attachment");
  // origin=iq-tab: 개별 질문 탭 내 작성 화면(/individual-questions/direct/[mentorId])에서 제출.
  // 허용값은 "iq-tab" 하나뿐이며 경로는 서버에서 조립한다(폼 값 그대로 redirect하지 않음 — open redirect 방지).
  const fromTab = textValue(formData, "origin") === "iq-tab";
  const returnPath = mentorId
    ? fromTab
      ? `${STUDENT_LIST_PATH}/direct/${encodeURIComponent(mentorId)}`
      : `/mentors/${encodeURIComponent(mentorId)}/individual-question/new`
    : fromTab
      ? STUDENT_LIST_PATH
      : "/mentors";
  // 멘토 자체가 문제인 오류(미승인·단가 미설정)의 복귀 지점 — 탭 경로는 안내 문구가 있는 작성 화면 그대로.
  const mentorFallbackPath = fromTab ? returnPath : `/mentors/${encodeURIComponent(mentorId)}`;

  if (!mentorId) actionError(fromTab ? STUDENT_LIST_PATH : "/mentors", "멘토 정보가 올바르지 않습니다.");
  if (!idempotencyKey) actionError(returnPath, "제출 정보가 만료되었습니다. 다시 시도해 주세요.");
  if (!title || !body) actionError(returnPath, "제목과 내용을 모두 입력해 주세요.");

  const supabase = await createClient();
  const approval = await assertMentorApprovedForAction(supabase, mentorId);
  if (!approval.ok) actionError(mentorFallbackPath, "승인된 멘토에게만 개별 질문을 보낼 수 있어요.");

  const price = await fetchMentorIndividualQuestionPrice(supabase, mentorId);
  if (!price.amountCents) {
    actionError(mentorFallbackPath, "이 멘토는 지금 지정 질문을 받지 않아요. 다른 멘토를 지정해 보세요.");
  }

  // [연락처 마스킹] 저장 전 명백한 외부 연락처만 가린다(질문방 메시지와 동일 정책).
  const safeTitle = maskContactInUserText(title);
  const safeBody = maskContactInUserText(body);

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("create_individual_question_with_hold", {
    p_student_id: user.id,
    p_question_type: "direct",
    p_mentor_id: mentorId,
    p_subject: subject,
    p_topic: topic,
    p_title: safeTitle,
    p_body: safeBody,
    p_price_cents: price.amountCents,
    p_idempotency_key: idempotencyKey,
  });

  const result = firstRpcResult(data as IndividualQuestionRpcResult);
  if (error || !result?.ok || !result.question_id) {
    actionError(returnPath, createErrorMessage(error?.message ?? result?.code ?? result?.message));
  }

  if (result.code !== "already_exists") {
    await setQuestionExpiryBestEffort(admin, result.question_id, "assigned");
    // assigned 알림은 155 AFTER INSERT 트리거가 원자 발행(best-effort 제거).
  }

  if (result.code !== "already_exists" && attachment instanceof File && fileHasContent(attachment)) {
    const upload = await uploadIndividualQuestionAttachment(admin, {
      questionId: result.question_id,
      messageId: null,
      file: attachment,
    });
    if (!upload.ok) {
      redirect(`${STUDENT_LIST_PATH}/${result.question_id}?created=1&warning=${encodeURIComponent(upload.error)}`);
    }
  }

  revalidatePath(STUDENT_LIST_PATH);
  revalidatePath(MENTOR_LIST_PATH);
  revalidatePath(`/mentors/${mentorId}`);
  redirect(`${STUDENT_LIST_PATH}/${result.question_id}?created=1`);
}

export async function createOpenIndividualQuestionAction(formData: FormData) {
  const { user } = await requireRole("student");
  const idempotencyKey = textValue(formData, "idempotencyKey");
  const title = textValue(formData, "title");
  const body = textValue(formData, "body");
  // P2-23: 과목은 정본 subjects.code 로 정규화한다(미매핑 입력은 null). 자유 문자열을 그대로 저장하지 않는다.
  const subject = normalizeSubjectCode(optionalText(formData, "subject"));
  const topic = optionalText(formData, "topic");
  const requiredSchoolTier = optionalText(formData, "requiredSchoolTier");
  const requiredMajorCategory = optionalText(formData, "requiredMajorCategory");
  // 폼 입력은 캐시(=원) 단위. 저장은 정규 cents(=캐시×100)로 변환.
  const priceCash = positiveIntegerValue(formData, "priceCents");
  const attachment = formData.get("attachment");
  const returnPath = `${STUDENT_LIST_PATH}/new`;

  if (!idempotencyKey) actionError(returnPath, "제출 정보가 만료되었습니다. 다시 시도해 주세요.");
  if (!title || !body) actionError(returnPath, "제목과 내용을 모두 입력해 주세요.");
  // 금액 자유화: 최소/최대 강제 없음. 단 0·음수·빈값은 차단(positiveIntegerValue가 양수만 반환).
  if (!priceCash) {
    actionError(returnPath, "예치할 금액을 0보다 큰 캐시로 입력해 주세요.");
  }

  const admin = createServiceRoleClient();
  const catalogs = await loadSchoolClassificationCatalogs(admin);
  if (!catalogHasCode(catalogs.schoolTiers, requiredSchoolTier)) {
    actionError(returnPath, "학교군 자격 조건이 올바르지 않습니다.");
  }
  if (!catalogHasCode(catalogs.majorCategories, requiredMajorCategory)) {
    actionError(returnPath, "전공계열 자격 조건이 올바르지 않습니다.");
  }

  // [연락처 마스킹] 저장 전 명백한 외부 연락처만 가린다(질문방 메시지와 동일 정책).
  const safeTitle = maskContactInUserText(title);
  const safeBody = maskContactInUserText(body);

  const { data, error } = await admin.rpc("create_individual_question_with_hold_v2", {
    p_student_id: user.id,
    p_question_type: "open",
    p_mentor_id: null,
    p_subject: subject,
    p_topic: topic,
    p_title: safeTitle,
    p_body: safeBody,
    p_price_cents: amountCentsFromCashKrw(priceCash),
    p_idempotency_key: idempotencyKey,
    p_required_school_tier: requiredSchoolTier,
    p_required_major_category: requiredMajorCategory,
  });

  const result = firstRpcResult(data as IndividualQuestionRpcResult);
  if (error || !result?.ok || !result.question_id) {
    actionError(returnPath, createErrorMessage(error?.message ?? result?.code ?? result?.message));
  }

  if (result.code !== "already_exists") {
    await setQuestionExpiryBestEffort(admin, result.question_id, "open");
  }

  if (result.code !== "already_exists" && attachment instanceof File && fileHasContent(attachment)) {
    const upload = await uploadIndividualQuestionAttachment(admin, {
      questionId: result.question_id,
      messageId: null,
      file: attachment,
    });
    if (!upload.ok) {
      redirect(`${STUDENT_LIST_PATH}/${result.question_id}?created=1&warning=${encodeURIComponent(upload.error)}`);
    }
  }

  revalidatePath(STUDENT_LIST_PATH);
  revalidatePath(MENTOR_LIST_PATH);
  redirect(`${STUDENT_LIST_PATH}/${result.question_id}?created=1`);
}

export async function claimOpenIndividualQuestionAction(formData: FormData) {
  const { user } = await requireRole("mentor");
  const questionId = textValue(formData, "questionId");
  if (!questionId) actionError(MENTOR_LIST_PATH, "질문 정보가 올바르지 않습니다.");

  const supabase = await createClient();
  const approval = await assertMentorApprovedForAction(supabase, user.id);
  if (!approval.ok) actionError(MENTOR_LIST_PATH, "승인 완료 후 공개 질문을 가져갈 수 있어요.");

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("claim_individual_question_v2", {
    p_question_id: questionId,
    p_mentor_id: user.id,
  });
  const result = firstRpcResult(data as IndividualQuestionRpcResult);
  if (error || !result?.ok || !result.question_id) {
    actionError(MENTOR_LIST_PATH, claimErrorMessage(error?.message ?? result?.code ?? result?.message));
  }

  await setQuestionExpiryBestEffort(admin, result.question_id, "claimed");
  // claimed 알림은 155 AFTER UPDATE(status→claimed) 트리거가 원자 발행(best-effort·전용 재조회 제거).

  revalidatePath(MENTOR_LIST_PATH);
  revalidatePath(`${MENTOR_LIST_PATH}/${result.question_id}`);
  revalidatePath(STUDENT_LIST_PATH);
  revalidatePath(`${STUDENT_LIST_PATH}/${result.question_id}`);
  redirect(`${MENTOR_LIST_PATH}/${result.question_id}?claimed=1`);
}

type IndividualQuestionPartyRow = {
  id: string;
  student_id: string | null;
  question_type: string;
  designated_mentor_id: string | null;
  claimed_mentor_id: string | null;
  status: string;
  release_ledger_id: string | null;
  refund_ledger_id: string | null;
};

const PARTY_COLUMNS =
  "id, student_id, question_type, designated_mentor_id, claimed_mentor_id, status, release_ledger_id, refund_ledger_id";

const TERMINAL_STATUSES = new Set(["refunded", "expired", "canceled"]);

// 대화 메시지 전송 — 멘토·학생 공통. party만 허용. status 불변(보충 대화 포함).
export async function sendIndividualQuestionMessageAction(formData: FormData) {
  const { user, actor } = await requireQnaActor();
  const questionId = textValue(formData, "questionId");
  const body = textValue(formData, "body");
  const attachment = formData.get("attachment");
  const hasAttachment = attachment instanceof File && fileHasContent(attachment);
  const listPath = actor === "mentor" ? MENTOR_LIST_PATH : STUDENT_LIST_PATH;
  const detailPath = questionId ? `${listPath}/${encodeURIComponent(questionId)}` : listPath;

  if (!questionId) actionError(listPath, "질문 정보가 올바르지 않습니다.");
  if (!body && !hasAttachment) actionError(detailPath, "보낼 내용을 입력하거나 파일을 첨부해 주세요.");

  const admin = createServiceRoleClient();
  const { data: question, error: questionError } = await admin
    .from("individual_questions")
    .select(PARTY_COLUMNS)
    .eq("id", questionId)
    .maybeSingle();

  const row = question as IndividualQuestionPartyRow | null;
  if (questionError || !row) actionError(listPath, "개별 질문을 찾을 수 없습니다.");

  const isStudentParty = actor === "student" && row.student_id === user.id;
  const isMentorParty =
    actor === "mentor" && (row.designated_mentor_id === user.id || row.claimed_mentor_id === user.id);
  if (!isStudentParty && !isMentorParty) {
    actionError(listPath, "이 질문의 대화에 참여할 권한이 없습니다.");
  }
  if (TERMINAL_STATUSES.has(row.status) || row.refund_ledger_id) {
    actionError(detailPath, "이미 종료된 질문에는 메시지를 보낼 수 없습니다.");
  }
  if (row.status === "released" || row.release_ledger_id) {
    actionError(detailPath, "정산이 완료된 질문입니다.");
  }

  // [연락처 마스킹] 저장 전 명백한 외부 연락처만 가린다(질문방 메시지와 동일 정책).
  const safeBody = body ? maskContactInUserText(body) : "";
  const { data: message, error: messageError } = await admin
    .from("individual_question_messages")
    .insert({ question_id: questionId, author_id: user.id, body: safeBody || "(첨부 파일)" })
    .select("id")
    .single();

  const messageId = typeof message?.id === "string" ? message.id : null;
  if (messageError || !messageId) {
    actionError(detailPath, "메시지를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }

  if (hasAttachment) {
    const upload = await uploadIndividualQuestionAttachment(admin, {
      questionId,
      messageId,
      file: attachment,
    });
    if (!upload.ok) {
      actionError(detailPath, upload.error);
    }
  }

  // 상대방 알림은 155 AFTER INSERT(individual_question_messages) 트리거가 원자 발행(best-effort 제거).

  revalidatePath(MENTOR_LIST_PATH);
  revalidatePath(`${MENTOR_LIST_PATH}/${questionId}`);
  revalidatePath(STUDENT_LIST_PATH);
  revalidatePath(`${STUDENT_LIST_PATH}/${questionId}`);
  redirect(`${detailPath}?sent=1`);
}

// 멘토 [답변 확정] — status를 answered로 전이(지급은 학생 [해결됨] 때). 메시지 전송과 분리.
export async function confirmIndividualQuestionAnswerByMentorAction(formData: FormData) {
  const { user } = await requireRole("mentor");
  const questionId = textValue(formData, "questionId");
  const detailPath = questionId ? `${MENTOR_LIST_PATH}/${encodeURIComponent(questionId)}` : MENTOR_LIST_PATH;
  if (!questionId) actionError(MENTOR_LIST_PATH, "질문 정보가 올바르지 않습니다.");

  const supabase = await createClient();
  const approval = await assertMentorApprovedForAction(supabase, user.id);
  if (!approval.ok) actionError(detailPath, "승인 완료 후 답변을 확정할 수 있어요.");

  const admin = createServiceRoleClient();
  const { data: question, error: questionError } = await admin
    .from("individual_questions")
    .select(PARTY_COLUMNS)
    .eq("id", questionId)
    .maybeSingle();

  const row = question as IndividualQuestionPartyRow | null;
  if (questionError || !row) actionError(MENTOR_LIST_PATH, "개별 질문을 찾을 수 없습니다.");

  const ownsDirect = row.question_type === "direct" && row.designated_mentor_id === user.id;
  const ownsOpen = row.question_type === "open" && row.claimed_mentor_id === user.id;
  if (!ownsDirect && !ownsOpen) actionError(MENTOR_LIST_PATH, "이 질문을 확정할 권한이 없습니다.");
  if (TERMINAL_STATUSES.has(row.status) || row.refund_ledger_id) {
    actionError(detailPath, "이미 종료된 질문입니다.");
  }
  if (row.status === "answered" || row.status === "released" || row.release_ledger_id) {
    redirect(`${detailPath}?answered=1`);
  }
  const canConfirmDirect = ownsDirect && row.status === "assigned";
  const canConfirmOpen = ownsOpen && row.status === "claimed";
  if (!canConfirmDirect && !canConfirmOpen) {
    actionError(detailPath, "현재 상태에서는 답변을 확정할 수 없습니다.");
  }

  const { error: updateError } = await admin
    .from("individual_questions")
    .update({ status: "answered", answered_at: new Date().toISOString() })
    .eq("id", questionId)
    .eq("status", row.status)
    .or(`designated_mentor_id.eq.${user.id},claimed_mentor_id.eq.${user.id}`);

  if (updateError) actionError(detailPath, "답변 확정 상태를 저장하지 못했습니다.");

  // answered 알림은 155 AFTER UPDATE(status→answered) 트리거가 원자 발행(best-effort 제거).

  revalidatePath(MENTOR_LIST_PATH);
  revalidatePath(`${MENTOR_LIST_PATH}/${questionId}`);
  revalidatePath(STUDENT_LIST_PATH);
  revalidatePath(`${STUDENT_LIST_PATH}/${questionId}`);
  redirect(`${detailPath}?answered=1`);
}

// 학생이 답변을 확정([해결됨]) → 그때 멘토 지급(release). 본인·answered 상태만.
export async function confirmIndividualQuestionAnswerAction(formData: FormData) {
  const { user } = await requireRole("student");
  const questionId = textValue(formData, "questionId");
  const detailPath = questionId ? `${STUDENT_LIST_PATH}/${encodeURIComponent(questionId)}` : STUDENT_LIST_PATH;
  if (!questionId) actionError(STUDENT_LIST_PATH, "질문 정보가 올바르지 않습니다.");

  const admin = createServiceRoleClient();
  const { data: question, error: questionError } = await admin
    .from("individual_questions")
    .select("id, student_id, status, designated_mentor_id, claimed_mentor_id, release_ledger_id")
    .eq("id", questionId)
    .maybeSingle();

  const row = question as
    | {
        id: string;
        student_id: string | null;
        status: string;
        designated_mentor_id: string | null;
        claimed_mentor_id: string | null;
        release_ledger_id: string | null;
      }
    | null;

  if (questionError || !row) actionError(STUDENT_LIST_PATH, "개별 질문을 찾을 수 없습니다.");
  if (row.student_id !== user.id) actionError(STUDENT_LIST_PATH, "이 질문을 확정할 권한이 없습니다.");
  if (row.release_ledger_id || row.status === "released") {
    redirect(`${detailPath}?resolved=1`);
  }
  if (row.status === "refunded" || row.status === "expired" || row.status === "canceled") {
    actionError(detailPath, "이미 종료된 질문입니다.");
  }
  if (row.status !== "answered") {
    actionError(detailPath, "멘토 답변이 등록된 뒤에 확정할 수 있어요.");
  }

  // 지급은 070 RPC만 경유(멱등). 지갑 직접 조작 금지.
  const { data: payoutData, error: payoutError } = await admin.rpc("release_individual_question_payout", {
    p_question_id: questionId,
  });
  const payout = firstRpcResult(payoutData as IndividualQuestionRpcResult);
  if (payoutError || !payout?.ok) {
    actionError(detailPath, "지급 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }

  // released 알림은 155 AFTER UPDATE(status→released) 트리거가 멘토에게 원자 발행(best-effort 제거).

  revalidatePath(MENTOR_LIST_PATH);
  revalidatePath(`${MENTOR_LIST_PATH}/${questionId}`);
  revalidatePath(STUDENT_LIST_PATH);
  revalidatePath(`${STUDENT_LIST_PATH}/${questionId}`);
  redirect(`${detailPath}?resolved=1`);
}
