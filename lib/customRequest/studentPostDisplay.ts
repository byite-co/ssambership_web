import { kstDayDiff } from "@/lib/utils/kstTime";
import { formatBudgetRangeKrw } from "@/lib/customRequest/mentorCustomRequestDisplay";

type Row = Record<string, unknown>;

export type StudentPostListFilter = "all" | "draft" | "waiting" | "active" | "done";

export function isDraftStudentPost(row: Row): boolean {
  const s = String(row.status ?? row.state ?? row.post_status ?? "").trim().toLowerCase();
  return s === "draft";
}

export function studentPostStatusBucket(row: Row): StudentPostListFilter {
  const s = String(row.status ?? row.state ?? row.post_status ?? "open").toLowerCase();
  if (s === "draft") return "draft";
  if (["cancelled", "canceled", "rejected"].includes(s)) return "done";
  if (["completed", "closed", "done", "finished", "fulfilled"].includes(s)) return "done";
  if (["in_progress", "active", "assigned", "matched", "selected"].includes(s)) return "active";
  return "waiting";
}

const STATUS_BADGE: Record<StudentPostListFilter, { label: string; cls: string }> = {
  all: { label: "전체", cls: "border-slate-200 bg-slate-100 text-slate-700" },
  draft: { label: "임시저장", cls: "border-violet-200 bg-violet-100 text-violet-900" },
  waiting: { label: "지원대기", cls: "border-amber-200 bg-amber-100 text-amber-900" },
  active: { label: "진행중", cls: "border-blue-200 bg-blue-100 text-blue-900" },
  done: { label: "완료", cls: "border-emerald-200 bg-emerald-100 text-emerald-900" },
};

export function studentPostStatusBadge(row: Row): { label: string; cls: string } {
  const s = String(row.status ?? row.state ?? "").toLowerCase();
  if (s.includes("cancel") || s === "rejected") {
    return { label: "취소", cls: "border-slate-200 bg-slate-100 text-slate-600" };
  }
  const bucket = studentPostStatusBucket(row);
  if (bucket === "draft") return STATUS_BADGE.draft;
  if (bucket === "done") return STATUS_BADGE.done;
  if (bucket === "active") return STATUS_BADGE.active;
  return STATUS_BADGE.waiting;
}

export function applicationCountFromRow(row: Row): number {
  for (const k of ["application_count", "applications_count", "applicant_count", "bids_count"] as const) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  }
  return 0;
}

function pickDeadlineDate(row: Row): Date | null {
  for (const k of ["deadline", "due_at", "due_date", "ends_at", "close_at"] as const) {
    const v = row[k];
    if (v == null) continue;
    const d = v instanceof Date ? v : new Date(String(v).trim());
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** 마감 D-N 표시 (임박 시 urgent) */
export function formatDeadlineDday(row: Row): { label: string; urgent: boolean } {
  const d = pickDeadlineDate(row);
  if (!d) return { label: "일정 협의", urgent: false };
  // TZ-FIX R3 #21: 실행 환경 로컬 자정 절단 → KST 달력일 차 (kstTime.kstDayDiff 공용화).
  const diff = kstDayDiff(new Date(), d);
  if (diff < 0) return { label: "마감", urgent: true };
  if (diff === 0) return { label: "D-Day", urgent: true };
  if (diff <= 3) return { label: `D-${diff}`, urgent: true };
  return { label: `D-${diff}`, urgent: false };
}

export function formatBudgetRangeCash(row: Row): string {
  const line = formatBudgetRangeKrw(row);
  if (line === "금액 협의") return line;
  return line.replace(/원/g, "캐시");
}

export function bodyPreviewTwoLines(body: string, max = 120): string {
  const t = body.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
