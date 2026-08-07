import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FREE_QUESTION_EXPIRY_DAYS,
  FREE_QUESTION_PER_MENTOR_LIMIT,
  FREE_QUESTION_TOTAL_LIMIT,
} from "@/lib/mentor/freeQuestionPolicy";
import { fetchThreadsForRoom } from "@/lib/qna/questionRoomQueries";
import { createServiceRoleClient } from "@/lib/supabase/admin";

const TABLE = "free_question_usage" as const;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type FreeQuestionGateResult =
  | { ok: true; usedFreeQuota: true }
  | { ok: false; userMessage: string };

function freeQuestionExpiryInstant(signupCreatedAt: string | Date): number {
  const signupMs = new Date(signupCreatedAt).getTime();
  if (!Number.isFinite(signupMs)) {
    return 0;
  }
  return signupMs + FREE_QUESTION_EXPIRY_DAYS * MS_PER_DAY;
}

/**
 * 가입일(users.created_at) 기준 무료 질문권 유효 여부.
 * W4(C10): 구 "relation 부재 → 미만료(fail-open)" 분기를 제거 — 조회 오류는 전부 error 로
 * 전파하고, 게이트 호출부(assertFreeQuestionAllowed)는 error 시 거부한다(fail-closed).
 */
export async function isFreeQuestionQuotaExpired(
  supabase: SupabaseClient,
  studentId: string
): Promise<{ expired: boolean; error: string | null }> {
  const { data, error } = await supabase.from("users").select("created_at").eq("id", studentId).maybeSingle();
  if (error) {
    return { expired: false, error: error.message };
  }
  const createdAt = (data as { created_at?: string } | null)?.created_at;
  if (!createdAt) {
    return { expired: false, error: "student created_at missing" };
  }
  return { expired: Date.now() >= freeQuestionExpiryInstant(createdAt), error: null };
}

export async function countFreeQuestionsTotal(
  supabase: SupabaseClient,
  studentId: string
): Promise<{ count: number; error: string | null }> {
  // W4(C10): `free_question_usage`(044) 정본 — 구 "relation 부재 → 0건" fail-open 분기 제거.
  const { count, error } = await supabase
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId);
  if (error) {
    return { count: 0, error: error.message };
  }
  return { count: count ?? 0, error: null };
}

export async function countFreeQuestionsForMentor(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<{ count: number; error: string | null }> {
  const { count, error } = await supabase
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("mentor_id", mentorId);
  if (error) {
    return { count: 0, error: error.message };
  }
  return { count: count ?? 0, error: null };
}

/** 멘토 상세 UI: 남은 무료 질문권 (0~3). 비로그인은 null. */
export async function loadFreeQuestionRemainingForMentor(
  supabase: SupabaseClient,
  studentId: string | null | undefined,
  mentorId: string
): Promise<number | null> {
  if (!studentId) {
    return null;
  }
  const expiry = await isFreeQuestionQuotaExpired(supabase, studentId);
  if (expiry.error) {
    return null;
  }
  if (expiry.expired) {
    return 0;
  }
  const { count, error } = await countFreeQuestionsForMentor(supabase, studentId, mentorId);
  if (error) {
    return null;
  }
  return Math.max(0, FREE_QUESTION_PER_MENTOR_LIMIT - count);
}

/** 활성 구독이 없을 때 새 질문 스레드 허용 여부(차감 없음). */
export async function assertFreeQuestionAllowed(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<FreeQuestionGateResult> {
  const expiry = await isFreeQuestionQuotaExpired(supabase, studentId);
  if (expiry.error) {
    console.error("[assertFreeQuestionAllowed] expiry check", expiry.error);
    return { ok: false, userMessage: "무료 질문권을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (expiry.expired) {
    return {
      ok: false,
      userMessage: `무료 질문권은 가입 후 ${FREE_QUESTION_EXPIRY_DAYS}일까지만 사용할 수 있습니다. 멘토를 구독한 뒤 질문해 주세요.`,
    };
  }

  const total = await countFreeQuestionsTotal(supabase, studentId);
  if (total.error) {
    console.error("[assertFreeQuestionAllowed] total count", total.error);
    return { ok: false, userMessage: "무료 질문권을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (total.count >= FREE_QUESTION_TOTAL_LIMIT) {
    return {
      ok: false,
      userMessage: `무료 질문권을 모두 사용했습니다(최대 ${FREE_QUESTION_TOTAL_LIMIT}회). 멘토를 구독한 뒤 질문해 주세요.`,
    };
  }

  const perMentor = await countFreeQuestionsForMentor(supabase, studentId, mentorId);
  if (perMentor.error) {
    console.error("[assertFreeQuestionAllowed] mentor count", perMentor.error);
    return { ok: false, userMessage: "무료 질문권을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (perMentor.count >= FREE_QUESTION_PER_MENTOR_LIMIT) {
    return {
      ok: false,
      userMessage: `이 멘토에게는 무료 질문권을 ${FREE_QUESTION_PER_MENTOR_LIMIT}회까지 사용할 수 있습니다. 구독 후 질문해 주세요.`,
    };
  }

  return { ok: true, usedFreeQuota: true };
}

export async function recordFreeQuestionUsage(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<{ ok: true } | { ok: false; userMessage: string }> {
  const { error: insErr } = await supabase.from(TABLE).insert({
    student_id: studentId,
    mentor_id: mentorId,
  });
  if (insErr) {
    if (insErr.code === "P0001") {
      return { ok: false, userMessage: "이 멘토에게 사용할 수 있는 무료 질문권을 모두 사용했습니다." };
    }
    if (insErr.code === "P0002") {
      return { ok: false, userMessage: "무료 질문권을 모두 사용했습니다." };
    }
    if (insErr.code === "P0003") {
      return {
        ok: false,
        userMessage: `무료 질문권은 가입 후 ${FREE_QUESTION_EXPIRY_DAYS}일까지만 사용할 수 있습니다. 멘토를 구독한 뒤 질문해 주세요.`,
      };
    }
    console.error("[recordFreeQuestionUsage] insert", insErr.message);
    return { ok: false, userMessage: "무료 질문권 차감에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
  return { ok: true };
}

/** 게이트 통과 직후 차감(폼 액션 등). */
export async function assertFreeQuestionAllowedAndRecord(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string
): Promise<FreeQuestionGateResult> {
  const allowed = await assertFreeQuestionAllowed(supabase, studentId, mentorId);
  if (!allowed.ok) {
    return allowed;
  }
  const recorded = await recordFreeQuestionUsage(supabase, studentId, mentorId);
  if (!recorded.ok) {
    return { ok: false, userMessage: recorded.userMessage };
  }
  return { ok: true, usedFreeQuota: true };
}

/**
 * 무료 스레드 짝짓기용 usage 조회 — service_role 전용.
 * `free_question_usage` RLS는 student_id=auth.uid() select만 허용하므로 멘토 세션에서도
 * 동작하도록 service_role 로 읽는다.
 *
 * W4(C10): `thread_id` 는 P1-8A(136) 정본 컬럼(FK + UNIQUE) — 구 "thread_id 미적용 DB →
 * created_at 만으로 재조회" 컬럼 fallback 은 제거했다. 조회 실패는 error 로 전파한다
 * (빈 결과로 은폐하지 않는다).
 */
async function readFreeQuestionUsageRowsForPairing(
  studentId: string,
  mentorId: string
): Promise<{ rows: { created_at: unknown; thread_id: unknown }[]; error: string | null }> {
  try {
    const admin = createServiceRoleClient();
    const { data, error } = await admin
      .from(TABLE)
      .select("created_at, thread_id")
      .eq("student_id", studentId)
      .eq("mentor_id", mentorId)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("[readFreeQuestionUsageRowsForPairing]", { studentId, mentorId, code: error.code });
      return { rows: [], error: error.message };
    }
    return { rows: (data as { created_at: unknown; thread_id: unknown }[]) ?? [], error: null };
  } catch {
    console.error("[readFreeQuestionUsageRowsForPairing] service role unavailable", { studentId, mentorId });
    return { rows: [], error: "free_question_usage 조회에 실패했습니다." };
  }
}

/** room 내 무료질문권으로 생성된 것으로 매칭된 thread id 집합. 조회 실패는 error 로 구분한다. */
export async function loadFreeQuestionThreadIdsInRoom(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string,
  roomId: string
): Promise<{ ids: Set<string>; error: string | null }> {
  const usagesQ = await readFreeQuestionUsageRowsForPairing(studentId, mentorId);
  if (usagesQ.error) {
    return { ids: new Set(), error: usagesQ.error };
  }
  const usages = usagesQ.rows;
  if (usages.length === 0) {
    return { ids: new Set(), error: null };
  }

  const { rows: threads, error: threadErr } = await fetchThreadsForRoom(supabase, roomId);
  if (threadErr) {
    return { ids: new Set(), error: threadErr };
  }
  if (threads.length === 0) {
    return { ids: new Set(), error: null };
  }

  const roomThreadIds = new Set<string>();
  for (const t of threads as { id: unknown }[]) {
    const tid = typeof t.id === "string" ? t.id : t.id != null ? String(t.id) : "";
    if (tid) roomThreadIds.add(tid);
  }

  // D-QR-10: thread_id 정본 링크가 있는 행만 인정한다(이 room 소속만).
  // 구 "링크 없는 레거시 행 ±15분 시각 근접 폴백" 은 유료 스레드를 무료체험으로 오분류할 수 있어
  // 제거했다(P1-8A 136 이후 usage 행은 항상 thread_id FK+UNIQUE 로 정본 링크된다).
  const result = new Set<string>();
  for (const u of usages) {
    const linked = typeof u.thread_id === "string" ? u.thread_id : u.thread_id != null ? String(u.thread_id) : "";
    if (linked && roomThreadIds.has(linked)) result.add(linked);
  }

  return { ids: result, error: null };
}

/** 메시지/답변 게이트: 해당 thread 가 무료질문권 1회 사용과 짝지어진 스레드인지. 조회 실패는 error 로 구분. */
export async function isFreeQuestionThreadInRoom(
  supabase: SupabaseClient,
  studentId: string,
  mentorId: string,
  roomId: string,
  threadId: string
): Promise<{ isFree: boolean; error: string | null }> {
  const tid = threadId.trim();
  if (!tid) {
    return { isFree: false, error: null };
  }
  const { ids, error } = await loadFreeQuestionThreadIdsInRoom(supabase, studentId, mentorId, roomId);
  if (error) {
    return { isFree: false, error };
  }
  return { isFree: ids.has(tid), error: null };
}
