// lib/utils/kstTime.ts — KST 고정 시각 유틸 (TZ-FIX R2 신설)
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** timestamptz ISO → "2026. 8. 29. 오후 3:05" (ko-KR medium/short, Asia/Seoul 고정) */
export function formatKoDateTimeKst(iso: unknown): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul",
  }).format(d);
}

/** instant → KST 달력일 "YYYY-MM-DD" */
export function kstDayString(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const s = new Date(d.getTime() + KST_OFFSET_MS);
  return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}-${String(s.getUTCDate()).padStart(2, "0")}`;
}

/** 두 instant의 KST 달력일 차 (b − a, 일 단위 정수) — D-day 용 */
export function kstDayDiff(aIso: string | Date, bIso: string | Date): number {
  const day = (v: string | Date) => {
    const d = typeof v === "string" ? new Date(v) : v;
    return Math.floor((d.getTime() + KST_OFFSET_MS) / 86400000);
  };
  return day(bIso) - day(aIso);
}

/** KST 달력 기준 해당 월 1일 00:00의 instant */
export function kstMonthStartInstant(at: Date): Date {
  const s = new Date(at.getTime() + KST_OFFSET_MS);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1) - KST_OFFSET_MS);
}
