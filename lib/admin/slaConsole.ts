/**
 * SLA 대시보드(PR-12 §2)의 순수 규칙 — **건별 기한** 4종(개별질문 · 맞춤의뢰 주문 · 환불(멘토 중단) · 분쟁)의 남은 기간 · 톤 · 상세 링크.
 *
 * - 기준값(기한 시간)은 바꾸지 않는다. 종류마다 이미 쓰는 판정을 그대로 부른다:
 *   환불 `refundSlaInfo`(5일 · 2일 이하 임박) · 분쟁 `disputeElapsed`(24h 주의 · 48h 위험 → 기한 = 접수 + 24h) ·
 *   개별질문 `expires_at`(답변 창) + `isIndividualQuestionExpiringSoon`(12h) · 맞춤의뢰 주문 D-day(`mentorOrderDeadlineDisplay` 의 달력일 차 + `MENTOR_DEADLINE_IMMINENT_DAYS`).
 * - 축이 다른 멘토 활동(멘토별 집계)과 둘 다 둔다 — 항목의 멘토 이름은 멘토 활동 검색으로, 멘토 활동의 미답변 수는 이 화면으로 링크한다(§2-3).
 * - 환불 딥링크는 PR-3 키 `status=pending`(구 `type`/`sort` 키는 환불 화면이 읽지 않는다).
 * - 정의 설명 문단은 넣지 않는다(오너 지시) — 남은 기간 중심.
 *
 * node --test 계약 테스트가 직접 import 하므로 React·`@/` import 를 두지 않는다.
 */
import { CUSTOM_REQUEST_ORDER_BASE_PATH } from "./customRequestOrderConsole.ts";
import { DISPUTE_ELAPSED_WARNING_HOURS, disputeDetailPath, disputeElapsed } from "./disputeConsole.ts";
import { MENTOR_ACTIVITY_BASE_PATH } from "./mentorActivityConsole.ts";
import { INDIVIDUAL_AWAITING_STATUSES, individualQuestionPath } from "./questionDrilldownConsole.ts";
import { refundDetailPath } from "./refundConsole.ts";
import { REFUND_SLA_DAYS, refundSlaInfo, refundSlaToneClass } from "./refundSla.ts";
import { isIndividualQuestionExpiringSoon } from "../individualQuestion/individualQuestionFormat.ts";

export const SLA_BASE_PATH = "/admin/sla";
/** 환불 화면 대기 탭 — PR-3 이후의 키. */
export const SLA_REFUND_QUEUE_HREF = "/admin/refunds?status=pending";
export const SLA_MODERATION_HREF = "/admin/moderation?status=pending";
export const SLA_MENTOR_ACTIVITY_HREF = MENTOR_ACTIVITY_BASE_PATH;
/** 표에 그리는 상한(남은 기간 짧은 순) · 종류별 원본 조회 상한 */
export const SLA_ITEM_ROW_LIMIT = 50;
export const SLA_SOURCE_ROW_LIMIT = 200;

export const SLA_EMPTY_STATE = { title: "기한이 임박한 항목이 없습니다", description: "개별질문 · 맞춤의뢰 주문 · 멘토 중단 환불 · 분쟁 중 처리 중인 건이 여기에 남은 기간순으로 나타납니다." } as const;

export const SLA_ITEM_KINDS = ["individual_question", "custom_order", "refund", "dispute"] as const;
export type SlaItemKind = (typeof SLA_ITEM_KINDS)[number];

export const SLA_ITEM_KIND_LABELS: Readonly<Record<SlaItemKind, string>> = {
  individual_question: "개별질문",
  custom_order: "맞춤의뢰",
  refund: "환불",
  dispute: "분쟁",
};

/** 상태 배지(`AdminStatusPill`) 사전 키 — 종류별 테이블 */
export const SLA_ITEM_STATUS_TABLE: Readonly<Record<SlaItemKind, string>> = {
  individual_question: "individual_questions",
  custom_order: "custom_request_orders",
  refund: "refunds",
  dispute: "disputes",
};

/** 분쟁 중 SLA 를 재는 상태 — 처리 중(구 대시보드 "분쟁 처리중" · RPC 갱신 조건과 같은 3값). 보류·제재·종결은 기한 추적 대상이 아니다. */
export const SLA_DISPUTE_STATUSES: readonly string[] = ["open", "under_review", "escalated"];
/** 개별질문 중 SLA 를 재는 상태 — 답변 대기(PR-8 판정과 같은 집합) */
export const SLA_INDIVIDUAL_QUESTION_STATUSES: readonly string[] = INDIVIDUAL_AWAITING_STATUSES;
/** 환불 중 SLA 를 재는 종류 — 멘토 중단 환불(5일)만. `refundSla.isSlaTrackedRequestType` 과 같다. */
export const SLA_REFUND_REQUEST_TYPE = "subscription_mentor_suspended";

export type SlaTone = "ok" | "soon" | "over";

export type SlaJudgement = {
  /** 기한 instant(ISO) — 없으면 null(표에서 `—`) */
  deadlineAt: string | null;
  /** 기한까지 남은 ms(음수 = 초과) — 없으면 null */
  remainingMs: number | null;
  label: string;
  tone: SlaTone;
};

export type SlaItem = SlaJudgement & {
  kind: SlaItemKind;
  id: string;
  title: string;
  status: string | null;
  /** 상대 멘토 표시명 — 없으면 null */
  mentorName: string | null;
  href: string;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

// ── 링크 ─────────────────────────────────────────────────────────────────────

/** 행 → 해당 상세: 개별질문 → PR-8 질문 상세 · 맞춤의뢰 → 주문 목록(그 주문으로 검색) · 환불 → 환불 상세 · 분쟁 → 분쟁 상세 */
export function slaItemHref(kind: SlaItemKind, id: string): string {
  switch (kind) {
    case "individual_question":
      return individualQuestionPath(id);
    case "custom_order":
      return `${CUSTOM_REQUEST_ORDER_BASE_PATH}?q=${encodeURIComponent(id)}`;
    case "refund":
      return refundDetailPath(id);
    case "dispute":
      return disputeDetailPath(id);
  }
}

/** 항목의 멘토 이름 → 멘토 활동(그 이름으로 검색) */
export function slaMentorActivityHref(mentorName: string): string {
  const q = mentorName.trim();
  return q ? `${MENTOR_ACTIVITY_BASE_PATH}?q=${encodeURIComponent(q)}` : MENTOR_ACTIVITY_BASE_PATH;
}

// ── 남은 기간 표기 ────────────────────────────────────────────────────────────

/** 남은 기간 한 줄 — `N일 N시간 남음` · `N시간 N분 남음` · `N분 남음` · `오늘 마감` 은 쓰지 않는다(시각 기준) · 초과는 `N시간 초과`/`N일 초과` */
export function formatSlaRemaining(remainingMs: number | null): string {
  if (remainingMs === null || !Number.isFinite(remainingMs)) return "—";
  const over = remainingMs < 0;
  const abs = Math.abs(remainingMs);
  const days = Math.floor(abs / DAY_MS);
  const hours = Math.floor((abs % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((abs % HOUR_MS) / 60_000);
  let body: string;
  if (days >= 1) body = hours ? `${days}일 ${hours}시간` : `${days}일`;
  else if (hours >= 1) body = minutes ? `${hours}시간 ${minutes}분` : `${hours}시간`;
  else body = `${Math.max(1, minutes)}분`;
  return over ? `${body} 초과` : `${body} 남음`;
}

export function slaToneClass(tone: SlaTone): string {
  return refundSlaToneClass(tone);
}

// ── 종류별 판정(기준값은 각 종류의 정본 그대로) ──────────────────────────────

/** 환불(멘토 중단): `refundSlaInfo` 의 톤 · 기한 = 요청일 + `REFUND_SLA_DAYS` */
export function slaRefundJudgement(createdAt: string | null | undefined, status: string | null | undefined, now: Date): SlaJudgement {
  const info = refundSlaInfo(createdAt, status, now);
  const created = timeOf(createdAt);
  if (created === null || info.daysRemaining === null) return { deadlineAt: null, remainingMs: null, label: info.label, tone: info.tone };
  const deadline = created + REFUND_SLA_DAYS * DAY_MS;
  const remainingMs = deadline - now.getTime();
  return { deadlineAt: new Date(deadline).toISOString(), remainingMs, label: formatSlaRemaining(remainingMs), tone: info.tone };
}

/** 분쟁: `disputeElapsed` 의 톤(24h 주의 → soon · 48h 위험 → over) · 기한 = 접수 + `DISPUTE_ELAPSED_WARNING_HOURS` */
export function slaDisputeJudgement(createdAt: string | null | undefined, status: string | null | undefined, now: Date): SlaJudgement {
  const elapsed = disputeElapsed(createdAt, status, now.getTime());
  const created = timeOf(createdAt);
  if (elapsed.tone === "none" || created === null) return { deadlineAt: null, remainingMs: null, label: "—", tone: "ok" };
  const deadline = created + DISPUTE_ELAPSED_WARNING_HOURS * HOUR_MS;
  const remainingMs = deadline - now.getTime();
  const tone: SlaTone = elapsed.tone === "danger" ? "over" : elapsed.tone === "warning" ? "soon" : "ok";
  return { deadlineAt: new Date(deadline).toISOString(), remainingMs, label: formatSlaRemaining(remainingMs), tone };
}

/** 개별질문: 기한 = `expires_at`(답변 창) · 지났으면 over · `isIndividualQuestionExpiringSoon`(12h) 이면 soon */
export function slaIndividualQuestionJudgement(expiresAt: string | null | undefined, status: string | null | undefined, now: Date): SlaJudgement {
  const deadline = timeOf(expiresAt);
  if (deadline === null) return { deadlineAt: null, remainingMs: null, label: "—", tone: "ok" };
  const remainingMs = deadline - now.getTime();
  const tone: SlaTone = remainingMs <= 0 ? "over" : isIndividualQuestionExpiringSoon(expiresAt, status, now) ? "soon" : "ok";
  return { deadlineAt: new Date(deadline).toISOString(), remainingMs, label: formatSlaRemaining(remainingMs), tone };
}

/**
 * 맞춤의뢰 주문: 기한 = 주문 행의 마감(`mentorOrderDeadlineDisplay` 가 고른 deadline/due_at/due_date/close_at) ·
 * 톤은 멘토 대시보드 D-day 규칙 그대로 — 달력일 차 < 0 이면 over · ≤ `imminentDays`(`MENTOR_DEADLINE_IMMINENT_DAYS`) 이면 soon.
 */
export function slaCustomOrderJudgement(deadlineIso: string | null | undefined, dayDiff: number | null | undefined, imminentDays: number, now: Date): SlaJudgement {
  const deadline = timeOf(deadlineIso);
  if (deadline === null || typeof dayDiff !== "number" || !Number.isFinite(dayDiff)) return { deadlineAt: null, remainingMs: null, label: "—", tone: "ok" };
  const remainingMs = deadline - now.getTime();
  const tone: SlaTone = dayDiff < 0 ? "over" : dayDiff <= imminentDays ? "soon" : "ok";
  return { deadlineAt: new Date(deadline).toISOString(), remainingMs, label: formatSlaRemaining(remainingMs), tone };
}

// ── 정렬 · 요약 ──────────────────────────────────────────────────────────────

/** 남은 기간 짧은 순(초과가 맨 위) · 기한 없는 항목은 뒤 · 같으면 종류 순서 → id */
export function compareSlaItems(a: SlaItem, b: SlaItem): number {
  const ar = a.remainingMs === null ? Number.POSITIVE_INFINITY : a.remainingMs;
  const br = b.remainingMs === null ? Number.POSITIVE_INFINITY : b.remainingMs;
  if (ar !== br) return ar - br;
  const ak = SLA_ITEM_KINDS.indexOf(a.kind);
  const bk = SLA_ITEM_KINDS.indexOf(b.kind);
  if (ak !== bk) return ak - bk;
  return a.id.localeCompare(b.id);
}

export function sortSlaItems(items: readonly SlaItem[], limit: number = SLA_ITEM_ROW_LIMIT): SlaItem[] {
  return [...items].sort(compareSlaItems).slice(0, Math.max(0, limit));
}

export type SlaToneCounts = Record<SlaTone, number>;

export function countSlaTones(items: readonly SlaItem[]): SlaToneCounts {
  const out: SlaToneCounts = { ok: 0, soon: 0, over: 0 };
  for (const it of items) out[it.tone] += 1;
  return out;
}

/** 표 제목 옆 요약 — `초과 N · 임박 N · 전체 N` */
export function formatSlaSummary(items: readonly SlaItem[]): string {
  const c = countSlaTones(items);
  return `초과 ${c.over} · 임박 ${c.soon} · 전체 ${items.length}`;
}

/** 본문 첫 줄을 제목으로(분쟁 접수 내용 등) — 비어 있으면 fallback */
export function slaTitleFromBody(body: unknown, fallback: string, max = 40): string {
  const s = typeof body === "string" ? body.replace(/\s+/g, " ").trim() : "";
  if (!s) return fallback;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
