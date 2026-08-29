/**
 * 멘토 맞춤의뢰 주문 목록·카드용 표시 헬퍼 (클라이언트 번들 안전).
 * — Supabase / server-only 모듈을 import하지 않습니다.
 */
import { kstDayDiff } from "@/lib/utils/kstTime";
import { pickDisplayField } from "@/lib/customRequest/customRequestQueries";
import {
  isOrderRowPaymentConfirmedForMentorWork,
  normalizedPrimaryOrderStatus,
  orderStatusLabelForUi,
  paymentStatusBadgeLabelForRaw,
  paymentStatusLabelForUi,
} from "@/lib/customRequest/orderLifecycleConstants";
import type { MentorOrderBrowseTabId } from "@/lib/customRequest/mentorOrderBrowseTabClassify";

type Row = Record<string, unknown>;

const ORDER_TITLE_KEYS = [
  "title",
  "subject",
  "post_title",
  "request_title",
  "label",
  "name",
  "description",
  "goal",
] as const;

function pickFirstString(row: Row, keys: readonly string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "—";
}

/** 수락된 의뢰 목록·대시보드 카드 제목 (주문 행에 title 없으면 연관 필드 시도) */
export function mentorCustomOrderDisplayTitle(row: Row, fallback = "맞춤의뢰 주문"): string {
  const title = pickFirstString(row, ORDER_TITLE_KEYS);
  if (title !== "—") return title;
  const body = pickFirstString(row, ["body", "content"]);
  if (body !== "—") {
    return body.length > 60 ? `${body.slice(0, 60)}…` : body;
  }
  return fallback;
}

/** 멘토 주문 목록·대시보드 — 의뢰자 표시(이름 없으면 student_id 축약) */
export function mentorCustomOrderStudentLabel(row: Row): string {
  const name = pickFirstString(row, ["student_name", "buyer_name", "client_name", "requester_name"]);
  if (name !== "—") return name;
  const sid = pickFirstString(row, ["student_id", "buyer_id", "user_id", "client_id", "requester_id"]);
  if (sid !== "—" && sid.length > 10) return `의뢰자 ····${sid.slice(-6)}`;
  if (sid !== "—") return `의뢰자 ${sid}`;
  return "의뢰자";
}

/** 할 일·리스트 D-day — enrichment 후 deadline/due_at/due_date/close_at 기준 */
export const MENTOR_DEADLINE_IMMINENT_DAYS = 7;

export function mentorOrderDeadlineDisplay(row: Row): { dday: string; dateStr: string; sortKey: number } {
  const deadline = pickDisplayField(row, ["deadline", "due_at", "due_date", "close_at"]);
  if (deadline === "—") return { dday: "—", dateStr: "", sortKey: 9999 };
  try {
    const d = new Date(deadline);
    // TZ-FIX R3 #21: 실행 환경 로컬 자정 절단 → KST 달력일 차 (kstTime.kstDayDiff 공용화).
    const diff = kstDayDiff(new Date(), d);
    const dday = diff === 0 ? "D-Day" : diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
    const dateStr = deadline.substring(0, 10).replace(/-/g, ".");
    return { dday, dateStr, sortKey: diff };
  } catch {
    return { dday: "—", dateStr: "", sortKey: 9999 };
  }
}

/** 목록·카드: open/under_review 분쟁을 최우선, 다음 결제 미확인 시 결제 대기. */
export function mentorCustomOrderStatusHeadline(row: Row, activeDisputeOrderIds?: ReadonlySet<string> | null): string {
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : "";
  if (activeDisputeOrderIds && id && activeDisputeOrderIds.has(id)) {
    return "해결 요청 검토 중";
  }
  if (!isOrderRowPaymentConfirmedForMentorWork(row)) {
    return "결제 대기 · 진행 대기";
  }
  const norm = normalizedPrimaryOrderStatus(row);
  if (!norm) {
    return "진행 중";
  }
  return orderStatusLabelForUi(norm);
}

export function mentorCustomOrderWorkroomHref(orderId: string): string {
  return `/custom-request/orders/${encodeURIComponent(orderId)}`;
}

/** 수락된 의뢰 카드·작업방 CTA 라벨 (상태별) */
export function mentorCustomOrderWorkroomCtaLabel(
  tab: MentorOrderBrowseTabId,
  row?: Row
): string {
  if (tab === "done") return "완료 내역 보기";
  if (tab === "billing") return "작업방 입장";
  if (tab === "work" || tab === "revision") return "이어서 작업하기";
  if (tab === "delivery") {
    const norm = row ? normalizedPrimaryOrderStatus(row) : "";
    if (
      norm === "waiting_review" ||
      norm === "pending_review" ||
      norm === "in_review" ||
      norm === "delivery_submitted"
    ) {
      return "확인 상태 보기";
    }
    return "납품 관리";
  }
  if (tab === "dispute") return "작업방 보기";
  return "작업방 입장";
}

export function mentorCustomOrderPaymentLine(row: Row): string {
  for (const k of ["payment_status", "payment_state", "pay_status"] as const) {
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    return paymentStatusLabelForUi(s);
  }
  return "결제 정보 없음";
}

export function mentorCustomOrderPaymentBadge(row: Row): string {
  for (const k of ["payment_status", "payment_state", "pay_status"] as const) {
    const v = row[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    return paymentStatusBadgeLabelForRaw(s);
  }
  return "—";
}
