import { formatCashKrw } from "@/lib/mentor/mentorPayoutsConstants";
import type { PayoutLineType, PayoutUiStatus } from "@/lib/mentor/mentorPayoutsTypes";

export { formatCashKrw };

export function formatPayoutTableDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function typeBadgeClass(type: PayoutLineType): string {
  if (type === "subscription") return "border-slate-200 bg-slate-100 text-slate-600";
  if (type === "individual_question") return "border-sky-200 bg-sky-50 text-sky-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

export function typeBadgeLabel(type: PayoutLineType): string {
  if (type === "subscription") return "구독";
  if (type === "individual_question") return "개별질문";
  return "맞춤의뢰";
}

export function settlementStatusBadge(status: PayoutUiStatus): { label: string; className: string } {
  switch (status) {
    case "paid":
      return { label: "정산완료", className: "border-emerald-200 bg-emerald-50 text-emerald-800" };
    case "hold":
      return { label: "보류", className: "border-slate-200 bg-slate-100 text-slate-600" };
    case "cancelled":
      return { label: "취소", className: "border-slate-200 bg-slate-100 text-slate-500" };
    default:
      return { label: "정산예정", className: "border-amber-200 bg-amber-50 text-amber-900" };
  }
}

export function performanceStatusBadge(status: "done" | "in_progress" | "cancelled"): {
  label: string;
  className: string;
} {
  switch (status) {
    case "done":
      return { label: "완료", className: "border-emerald-200 bg-emerald-50 text-emerald-800" };
    case "cancelled":
      return { label: "취소", className: "border-slate-200 bg-slate-100 text-slate-500" };
    default:
      return { label: "진행중", className: "border-slate-200 bg-slate-100 text-slate-600" };
  }
}

export function momLabel(pct: number | null): string {
  if (pct === null) return "전월 대비 —";
  if (pct === 0) return "전월 대비 0%";
  const sign = pct > 0 ? "+" : "";
  return `전월 대비 ${sign}${pct}%`;
}

export function momClass(pct: number | null): string {
  if (pct === null || pct === 0) return "text-slate-500";
  return pct > 0 ? "text-emerald-700" : "text-red-600";
}
