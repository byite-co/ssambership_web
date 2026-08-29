/**
 * 멘토 통합 대시보드 UI 헬퍼 — server-only import 없음
 */
import { kstDayDiff } from "@/lib/utils/kstTime";
import { pickDisplayField } from "@/lib/customRequest/customRequestQueries";
import { classifyMentorOrderBrowseTab } from "@/lib/customRequest/mentorOrderBrowseTabClassify";
import {
  getMentorOpenPostCategoryId,
  MENTOR_OPEN_POST_CATEGORY_COLORS,
  MENTOR_OPEN_POST_CATEGORY_LABELS,
  type MentorOpenPostCategoryId,
} from "@/lib/customRequest/mentorOpenPostCategory";
import { mentorCustomOrderWorkroomHref } from "@/lib/customRequest/mentorCustomOrderBrowseDisplay";
import type { MentorHubOrderRow, MentorHubScheduleItem } from "@/lib/mentor/dashboard/mentorHubDashboardTypes";

type Row = Record<string, unknown>;

export function formatMomPct(pct: number | null): string {
  if (pct === null) return "지난 달 대비 —";
  if (pct === 0) return "지난 달 대비 0%";
  const sign = pct > 0 ? "▲" : "▼";
  return `지난 달 대비 ${sign}${Math.abs(pct)}%`;
}

export function formatRatingDisplay(avg: number | null): string {
  if (avg == null || Number.isNaN(avg)) return "—";
  return avg.toFixed(1);
}

export function starFillCount(avg: number | null): number {
  if (avg == null || Number.isNaN(avg)) return 0;
  return Math.round(avg);
}

export function getDeadlineDisplay(row: Row): { dday: string; dateStr: string; urgent: boolean } {
  const deadline = pickDisplayField(row, ["deadline", "due_at", "due_date", "close_at"]);
  if (deadline === "—") return { dday: "—", dateStr: "", urgent: false };
  try {
    const d = new Date(deadline);
    // TZ-FIX R3 #21: 실행 환경 로컬 자정 절단 → KST 달력일 차 (kstTime.kstDayDiff 공용화).
    const diff = kstDayDiff(new Date(), d);
    const dday = diff === 0 ? "D-Day" : diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
    const dateStr = deadline.substring(0, 10).replace(/-/g, ".");
    const urgent = diff >= 0 && diff <= 3;
    return { dday, dateStr, urgent };
  } catch {
    return { dday: "—", dateStr: "", urgent: false };
  }
}

export function getStudentName(row: Row): string {
  const name = pickDisplayField(row, ["student_name", "buyer_name", "client_name", "requester_name"]);
  return name !== "—" ? name : "학생";
}

export function getStudentInitial(name: string): string {
  const t = name.trim();
  return t ? t.slice(0, 1) : "학";
}

export function getRecentActivity(row: Row): string {
  const updated = pickDisplayField(row, ["updated_at", "last_message_at", "last_activity_at"]);
  if (updated === "—") return "최근 활동 없음";
  try {
    const d = new Date(updated);
    const now = new Date();
    const diffMin = Math.round((now.getTime() - d.getTime()) / (1000 * 60));
    if (diffMin < 60) return `${Math.max(1, diffMin)}분 전`;
    if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)}시간 전`;
    return `${Math.round(diffMin / (60 * 24))}일 전`;
  } catch {
    return updated.substring(0, 10);
  }
}

export function getOrderStatusBadge(
  row: Row,
  disputeSet: ReadonlySet<string>
): { label: string; cls: string } {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (id && disputeSet.has(id)) return { label: "분쟁", cls: "bg-red-50 text-red-700 border-red-200" };
  const tab = classifyMentorOrderBrowseTab(row, disputeSet);
  if (tab === "revision") return { label: "수정 요청", cls: "bg-orange-50 text-orange-700 border-orange-200" };
  if (tab === "delivery") return { label: "납품 대기", cls: "bg-violet-50 text-violet-700 border-violet-200" };
  if (tab === "billing") return { label: "작업 대기", cls: "bg-amber-50 text-amber-800 border-amber-200" };
  if (tab === "done") return { label: "완료", cls: "bg-slate-100 text-slate-600 border-slate-200" };
  return { label: "작업 중", cls: "bg-blue-50 text-blue-700 border-blue-200" };
}

export function mapOrderRowToHub(row: Row, disputeSet: ReadonlySet<string>): MentorHubOrderRow | null {
  const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : null;
  if (!id) return null;
  const title = pickDisplayField(row, ["title", "subject", "label", "name"]);
  const titleLine = title !== "—" ? title : "맞춤의뢰 주문";
  const cat = pickDisplayField(row, ["category_label", "category", "category_name", "subject_area"]);
  const categoryLabel = cat !== "—" ? cat : "기타";
  const studentName = getStudentName(row);
  const { dday, dateStr, urgent } = getDeadlineDisplay(row);
  const badge = getOrderStatusBadge(row, disputeSet);
  return {
    id,
    title: titleLine,
    categoryLabel,
    studentName,
    studentInitial: getStudentInitial(studentName),
    dday,
    ddayUrgent: urgent,
    deadlineDate: dateStr,
    statusLabel: badge.label,
    statusClassName: badge.cls,
    recentActivity: getRecentActivity(row),
    workroomHref: mentorCustomOrderWorkroomHref(id),
  };
}

export function getPostCategoryLabel(row: Row): string {
  const id = getMentorOpenPostCategoryId(row);
  return MENTOR_OPEN_POST_CATEGORY_LABELS[id];
}

export function getCategoryColor(id: MentorOpenPostCategoryId): string {
  return MENTOR_OPEN_POST_CATEGORY_COLORS[id];
}

export function mapOrderToScheduleItem(order: MentorHubOrderRow): MentorHubScheduleItem {
  return {
    id: order.id,
    kind: "order",
    title: order.title,
    badgeLabel: order.statusLabel,
    badgeClassName: order.statusClassName,
    meta: order.dday,
    href: order.workroomHref,
    urgent: order.ddayUrgent,
  };
}
