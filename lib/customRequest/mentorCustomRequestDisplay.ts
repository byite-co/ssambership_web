/**
 * 맞춤의뢰(멘토) 목록/상세 표시용 — domain 로직 없음, 표시·포맷만.
 */

type Row = Record<string, unknown>;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * ISO·Date 등 → `2026.05.03` (로컬 날짜). invalid/없으면 "일정 협의"
 */
/**
 * 희망 납기·일정: 없음/invalid → "일정 협의"
 */
export function formatDateYYYYMMDD(value: unknown): string {
  if (value == null) {
    return "일정 협의";
  }
  const d =
    value instanceof Date
      ? value
      : typeof value === "string" && value.trim()
        ? new Date(value.trim())
        : null;
  if (!d || Number.isNaN(d.getTime())) {
    return "일정 협의";
  }
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

/**
 * 등록일 등: 없음/invalid → "—"
 */
export function formatDateYMDOrDash(value: unknown): string {
  if (value == null) {
    return "—";
  }
  const d =
    value instanceof Date
      ? value
      : typeof value === "string" && value.trim()
        ? new Date(value.trim())
        : null;
  if (!d || Number.isNaN(d.getTime())) {
    return "—";
  }
  // TZ-FIX R3 #24: 로컬 getter → KST 벽시계 (P-B, YYYY.MM.DD 포맷 유지).
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${k.getUTCFullYear()}.${pad2(k.getUTCMonth() + 1)}.${pad2(k.getUTCDate())}`;
}

function parseKrw(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n) && n >= 0) {
    return n;
  }
  if (typeof n === "string" && n.trim()) {
    const v = Number(String(n).replace(/[, ]/g, ""));
    if (Number.isFinite(v) && v >= 0) {
      return v;
    }
  }
  return null;
}

/**
 * `budget_min` / `budget_max` 등 → `50,000원` / `~` 범위. 없으면 "금액 협의"
 */
export function formatBudgetRangeKrw(row: Row): string {
  const min = parseKrw(row.budget_min);
  const max = parseKrw(row.budget_max);
  if (min != null && max != null) {
    if (min === max) {
      return `${min.toLocaleString("ko-KR")}캐시`;
    }
    return `${min.toLocaleString("ko-KR")}캐시 ~ ${max.toLocaleString("ko-KR")}캐시`;
  }
  const b = parseKrw((row as { budget?: unknown }).budget);
  if (b != null) {
    return `${b.toLocaleString("ko-KR")}캐시`;
  }
  for (const k of ["min_budget", "max_budget", "price_range"] as const) {
    if (row[k] != null) {
      const v = parseKrw(row[k]);
      if (v != null) {
        return `${v.toLocaleString("ko-KR")}캐시`;
      }
    }
  }
  return "금액 협의";
}

export type MentorPostStatusUiTone = "blue" | "green" | "gray" | "amber";

export function mentorPostStatusToken(row: Row): string {
  for (const k of ["status", "state", "stage"] as const) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) {
      return v.trim().toLowerCase();
    }
  }
  return "";
}

const MENTOR_POST_STATUS: Readonly<Record<string, { label: string; tone: MentorPostStatusUiTone }>> = {
  open: { label: "모집 중", tone: "blue" },
  submitted: { label: "지원서 제출됨", tone: "amber" },
  selected: { label: "진행 중", tone: "green" },
  closed: { label: "마감", tone: "gray" },
  complete: { label: "완료", tone: "green" },
  completed: { label: "완료", tone: "green" },
  cancelled: { label: "취소됨", tone: "gray" },
  canceled: { label: "취소됨", tone: "gray" },
  published: { label: "모집 중", tone: "blue" },
  in_progress: { label: "진행 중", tone: "green" },
  draft: { label: "작성 중", tone: "gray" },
  archived: { label: "마감", tone: "gray" },
};

export function mentorPostStatusLabelForUi(token: string): string {
  const t = String(token).trim().toLowerCase();
  if (!t) {
    return "상태 확인 필요";
  }
  if (Object.prototype.hasOwnProperty.call(MENTOR_POST_STATUS, t)) {
    const status = MENTOR_POST_STATUS[t];
    if (status) return status.label;
  }
  return "상태 확인 필요";
}

export function mentorPostStatusUiTone(token: string): MentorPostStatusUiTone {
  const t = String(token).trim().toLowerCase();
  if (!t) {
    return "gray";
  }
  if (Object.prototype.hasOwnProperty.call(MENTOR_POST_STATUS, t)) {
    const status = MENTOR_POST_STATUS[t];
    if (status) return status.tone;
  }
  return "gray";
}

/** mentor 지원 application row `status`/`state` (표시만) */
export function mentorApplicationStatusLabelForUi(raw: string): string {
  const s = String(raw).trim().toLowerCase();
  if (!s || s === "—") {
    return "—";
  }
  const m: Readonly<Record<string, string>> = {
    submitted: "지원서 제출됨",
    pending: "검토 대기",
    selected: "선정됨",
    accepted: "선정됨",
    rejected: "미선정",
    withdrawn: "철회됨",
    open: "접수 중",
    in_review: "검토 중",
    review: "검토 중",
  };
  return m[s] ?? "상태 확인 필요";
}
