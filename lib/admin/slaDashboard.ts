import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { refundSlaInfo, REFUND_SLA_DAYS } from "@/lib/admin/refundSla";
import {
  SLA_DISPUTE_STATUSES,
  SLA_INDIVIDUAL_QUESTION_STATUSES,
  SLA_REFUND_REQUEST_TYPE,
  SLA_SOURCE_ROW_LIMIT,
  slaCustomOrderJudgement,
  slaDisputeJudgement,
  slaIndividualQuestionJudgement,
  slaItemHref,
  slaRefundJudgement,
  slaTitleFromBody,
  sortSlaItems,
  type SlaItem,
} from "@/lib/admin/slaConsole";
import { individualAnsweringMentorId } from "@/lib/admin/questionDrilldownConsole";
import { isOrderStatusTerminal, normalizedPrimaryOrderStatus } from "@/lib/customRequest/orderLifecycleConstants";
import { MENTOR_DEADLINE_IMMINENT_DAYS, mentorCustomOrderDisplayTitle, mentorOrderDeadlineDisplay } from "@/lib/customRequest/mentorCustomOrderBrowseDisplay";
import { pickDisplayField } from "@/lib/customRequest/customRequestQueries";

/**
 * SLA 대시보드(PR-12 §2) 서버 조회 — KPI 3개(신고 평균 응답시간 · 환불 평균 처리시간 · 멘토 중단 5일 SLA)는 그대로 두고,
 * 임박순 표를 **건별 기한 4종**으로 넓힌다: 개별질문(`expires_at`) · 맞춤의뢰 주문(마감) · 멘토 중단 환불(5일) · 분쟁(24h).
 * 기준값은 각 종류의 정본 함수·상수를 그대로 쓴다(`slaConsole.ts`). 조회 전용 · service_role 읽기(구 화면과 같은 경로).
 */

const HOUR_MS = 60 * 60 * 1000;

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

function avgHours(pairs: Array<{ start: string | null; end: string | null }>): number | null {
  const deltas: number[] = [];
  for (const p of pairs) {
    if (!p.start || !p.end) continue;
    const s = new Date(p.start).getTime();
    const e = new Date(p.end).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) continue;
    deltas.push((e - s) / HOUR_MS);
  }
  if (!deltas.length) return null;
  return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}

export type SlaDashboard = {
  reports: { avgResponseHours: number | null; resolvedCount: number; openCount: number };
  refunds: { avgProcessHours: number | null; processedCount: number; pendingCount: number };
  mentorSuspended: {
    pending: number;
    soon: number; // 2일 이내
    over: number; // 기한 초과
  };
  /** 건별 기한 4종 — 남은 기간 짧은 순(상한 `SLA_ITEM_ROW_LIMIT`) */
  items: SlaItem[];
  slaDays: number;
  error: string | null;
  /** D-AD-10: 블록별 실패(조회 실패)를 모아 partial 경고로 표면화. 비어 있으면 전 블록 정상. */
  partialErrors: string[];
  /** 신고 블록 조회 실패 여부(값이 실제 0인지 실패인지 구분). */
  reportsOk: boolean;
  /** 환불 블록 조회 실패 여부. */
  refundsOk: boolean;
  /** 멘토 중단 블록 조회 실패 여부. */
  mentorSuspendedOk: boolean;
};

/** 표시명 — users(service_role) · 실명 → 닉네임 → 이메일 → id 앞 8자 */
async function loadNames(admin: SupabaseClient, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.map((v) => str(v)).filter(Boolean))];
  if (!unique.length) return map;
  const { data, error } = await admin.from("users").select("id, full_name, nickname, email").in("id", unique);
  if (error) {
    console.error("[slaDashboard] users 이름 조회 실패:", error.message);
    return map;
  }
  for (const row of (data as Row[] | null) ?? []) {
    const id = str(row.id);
    if (id) map.set(id, str(row.full_name) || str(row.nickname) || str(row.email) || `${id.slice(0, 8)}…`);
  }
  return map;
}

async function loadRefundItems(admin: SupabaseClient, now: Date, base: SlaDashboard): Promise<Array<{ id: string; createdAt: string | null; status: string; subscriptionId: string | null }>> {
  const { data, error } = await admin
    .from("refunds")
    .select("id, created_at, status, subscription_id")
    .eq("status", "pending")
    .eq("request_type", SLA_REFUND_REQUEST_TYPE)
    .order("created_at", { ascending: true })
    .limit(SLA_SOURCE_ROW_LIMIT);
  if (error) throw error;
  const rows = ((data as Row[] | null) ?? []).map((r) => ({ id: str(r.id), createdAt: strOrNull(r.created_at), status: str(r.status), subscriptionId: strOrNull(r.subscription_id) }));
  base.mentorSuspended.pending = rows.length;
  for (const r of rows) {
    const sla = refundSlaInfo(r.createdAt, r.status, now);
    if (sla.tone === "soon") base.mentorSuspended.soon += 1;
    if (sla.tone === "over") base.mentorSuspended.over += 1;
  }
  return rows;
}

export async function loadSlaDashboard(now: Date = new Date()): Promise<SlaDashboard> {
  const base: SlaDashboard = {
    reports: { avgResponseHours: null, resolvedCount: 0, openCount: 0 },
    refunds: { avgProcessHours: null, processedCount: 0, pendingCount: 0 },
    mentorSuspended: { pending: 0, soon: 0, over: 0 },
    items: [],
    slaDays: REFUND_SLA_DAYS,
    error: null,
    partialErrors: [],
    reportsOk: true,
    refundsOk: true,
    mentorSuspendedOk: true,
  };

  let admin: SupabaseClient;
  try {
    admin = createServiceRoleClient();
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "서비스 키 오류" };
  }

  const items: SlaItem[] = [];
  // 항목별 멘토 id — 표시명은 마지막에 users 한 번으로 채운다(키 = `${kind}:${id}`).
  const mentorIdByItem = new Map<string, string>();
  const push = (item: SlaItem, mentorId: string | null) => {
    if (mentorId) mentorIdByItem.set(`${item.kind}:${item.id}`, mentorId);
    items.push(item);
  };

  // 신고 응답시간 — 반환 error 를 검사해 실패를 0 으로 위장하지 않는다.
  try {
    const { data: resolved, error: resolvedErr } = await admin
      .from("content_reports")
      .select("created_at, resolved_at, status")
      .in("status", ["resolved", "dismissed"])
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(500);
    const { count: openCount, error: openErr } = await admin
      .from("content_reports")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "reviewing"]);
    if (resolvedErr || openErr) throw resolvedErr ?? openErr;
    const resolvedRows = (resolved as Array<{ created_at: string | null; resolved_at: string | null }>) ?? [];
    base.reports.avgResponseHours = avgHours(resolvedRows.map((r) => ({ start: r.created_at, end: r.resolved_at })));
    base.reports.resolvedCount = resolvedRows.length;
    base.reports.openCount = openCount ?? 0;
  } catch {
    base.reportsOk = false;
    base.partialErrors.push("신고 지표를 불러오지 못했습니다.");
  }

  // 환불 처리시간
  try {
    const { data: processed, error: processedErr } = await admin
      .from("refunds")
      .select("created_at, processed_at, status")
      .not("processed_at", "is", null)
      .order("processed_at", { ascending: false })
      .limit(500);
    const { count: pendingCount, error: pendingErr } = await admin.from("refunds").select("id", { count: "exact", head: true }).eq("status", "pending");
    if (processedErr || pendingErr) throw processedErr ?? pendingErr;
    const processedRows = (processed as Array<{ created_at: string | null; processed_at: string | null }>) ?? [];
    base.refunds.avgProcessHours = avgHours(processedRows.map((r) => ({ start: r.created_at, end: r.processed_at })));
    base.refunds.processedCount = processedRows.length;
    base.refunds.pendingCount = pendingCount ?? 0;
  } catch {
    base.refundsOk = false;
    base.partialErrors.push("환불 지표를 불러오지 못했습니다.");
  }

  // 멘토 중단 5일 SLA 잔여 — KPI + 표 행(환불 → 환불 상세). 멘토 이름은 구독 행의 mentor_id 로.
  try {
    const refunds = await loadRefundItems(admin, now, base);
    const subIds = [...new Set(refunds.map((r) => r.subscriptionId).filter((v): v is string => Boolean(v)))];
    const mentorBySub = new Map<string, string>();
    if (subIds.length) {
      const { data, error } = await admin.from("subscriptions").select("id, mentor_id").in("id", subIds);
      if (error) console.error("[slaDashboard] subscriptions 조회 실패:", error.message);
      for (const row of (data as Row[] | null) ?? []) mentorBySub.set(str(row.id), str(row.mentor_id));
    }
    for (const r of refunds) {
      const mentorId = r.subscriptionId ? mentorBySub.get(r.subscriptionId) ?? null : null;
      push(
        {
          ...slaRefundJudgement(r.createdAt, r.status, now),
          kind: "refund",
          id: r.id,
          title: "구독 환불(멘토 중단)",
          status: r.status,
          mentorName: null,
          href: slaItemHref("refund", r.id),
        },
        mentorId
      );
    }
  } catch {
    base.mentorSuspendedOk = false;
    base.partialErrors.push("멘토 중단 환불 지표를 불러오지 못했습니다.");
  }

  // 분쟁(처리 중 3상태) — 기한 = 접수 + 24h(disputeElapsed 규칙)
  try {
    const { data, error } = await admin
      .from("disputes")
      .select("id, status, mentor_id, body, created_at")
      .in("status", [...SLA_DISPUTE_STATUSES])
      .order("created_at", { ascending: true })
      .limit(SLA_SOURCE_ROW_LIMIT);
    if (error) throw error;
    for (const row of (data as Row[] | null) ?? []) {
      const id = str(row.id);
      if (!id) continue;
      push(
        {
          ...slaDisputeJudgement(strOrNull(row.created_at), str(row.status), now),
          kind: "dispute",
          id,
          title: slaTitleFromBody(row.body, "분쟁"),
          status: str(row.status) || null,
          mentorName: null,
          href: slaItemHref("dispute", id),
        },
        strOrNull(row.mentor_id)
      );
    }
  } catch (e) {
    console.error("[slaDashboard] disputes:", e instanceof Error ? e.message : e);
    base.partialErrors.push("분쟁 항목을 불러오지 못했습니다.");
  }

  // 개별질문(답변 대기) — 기한 = expires_at
  try {
    const { data, error } = await admin
      .from("individual_questions")
      .select("id, status, title, subject, question_type, designated_mentor_id, claimed_mentor_id, expires_at")
      .in("status", [...SLA_INDIVIDUAL_QUESTION_STATUSES])
      .not("expires_at", "is", null)
      .order("expires_at", { ascending: true })
      .limit(SLA_SOURCE_ROW_LIMIT);
    if (error) throw error;
    for (const row of (data as Row[] | null) ?? []) {
      const id = str(row.id);
      if (!id) continue;
      const mentorId = individualAnsweringMentorId({
        question_type: strOrNull(row.question_type),
        designated_mentor_id: strOrNull(row.designated_mentor_id),
        claimed_mentor_id: strOrNull(row.claimed_mentor_id),
      });
      push(
        {
          ...slaIndividualQuestionJudgement(strOrNull(row.expires_at), str(row.status), now),
          kind: "individual_question",
          id,
          title: str(row.title) || str(row.subject) || "개별질문",
          status: str(row.status) || null,
          mentorName: null,
          href: slaItemHref("individual_question", id),
        },
        mentorId
      );
    }
  } catch (e) {
    console.error("[slaDashboard] individual_questions:", e instanceof Error ? e.message : e);
    base.partialErrors.push("개별질문 항목을 불러오지 못했습니다.");
  }

  // 맞춤의뢰 주문(종결 아님) — 기한·D-day 는 멘토 대시보드와 같은 함수
  try {
    const { data, error } = await admin.from("custom_request_orders").select("*").order("created_at", { ascending: false }).limit(SLA_SOURCE_ROW_LIMIT);
    if (error) throw error;
    const rows = ((data as Row[] | null) ?? []).filter((row) => !isOrderStatusTerminal(normalizedPrimaryOrderStatus(row)));
    const postIds = [...new Set(rows.map((r) => str(r.post_id)).filter(Boolean))];
    const postTitle = new Map<string, string>();
    if (postIds.length) {
      const { data: posts, error: postsErr } = await admin.from("custom_request_posts").select("id, title").in("id", postIds);
      if (postsErr) console.error("[slaDashboard] custom_request_posts 조회 실패:", postsErr.message);
      for (const p of (posts as Row[] | null) ?? []) postTitle.set(str(p.id), str(p.title));
    }
    for (const row of rows) {
      const id = str(row.id);
      if (!id) continue;
      // 마감 컬럼 선택은 멘토 대시보드 D-day 와 같은 키 순서(deadline → due_at → due_date → close_at · 첫 비어 있지 않은 문자열).
      const deadline = mentorOrderDeadlineDisplay(row);
      const deadlineRaw = pickDisplayField(row, ["deadline", "due_at", "due_date", "close_at"]);
      const deadlineIso = deadline.sortKey === 9999 || deadlineRaw === "—" ? null : deadlineRaw;
      push(
        {
          ...slaCustomOrderJudgement(deadlineIso, deadline.sortKey === 9999 ? null : deadline.sortKey, MENTOR_DEADLINE_IMMINENT_DAYS, now),
          kind: "custom_order",
          id,
          title: postTitle.get(str(row.post_id)) || mentorCustomOrderDisplayTitle(row),
          status: normalizedPrimaryOrderStatus(row) || null,
          mentorName: null,
          href: slaItemHref("custom_order", id),
        },
        strOrNull(row.mentor_id)
      );
    }
  } catch (e) {
    console.error("[slaDashboard] custom_request_orders:", e instanceof Error ? e.message : e);
    base.partialErrors.push("맞춤의뢰 주문 항목을 불러오지 못했습니다.");
  }

  // 멘토 이름표 — users 한 번으로 채운다(없으면 id 앞 8자).
  const names = await loadNames(admin, [...mentorIdByItem.values()]);
  base.items = sortSlaItems(
    items.map((it) => {
      const mentorId = mentorIdByItem.get(`${it.kind}:${it.id}`) ?? null;
      return { ...it, mentorName: mentorId ? (names.get(mentorId) ?? `${mentorId.slice(0, 8)}…`) : null };
    })
  );
  return base;
}
