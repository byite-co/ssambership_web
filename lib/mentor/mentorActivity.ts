/**
 * 멘토 활동 상태(active / terminating / terminated / paused) 공용 상수·판정.
 * (PART B: P0 #5 멘토 활동 중단 대안)
 */

import { addMonthsClampedKst } from "../subscribe/subscriptionsTable.ts";

export const MENTOR_TERMINATION_NOTICE_DAYS = 14; // 완전 종료 2주 사전 공지
export const MENTOR_MAX_PAUSE_DAYS = 7; // 일시 중단 최대 1주
export const MENTOR_REST_FREQUENCY_MONTHS = 6; // 일반 휴식 빈도 제한(6개월 1회)

export type MentorActivityInfo = {
  activity_status?: string | null;
  pause_until?: string | null;
  termination_effective_at?: string | null;
  last_pause_at?: string | null;
};

export type MentorActivityState = "active" | "terminating" | "terminated" | "paused";

export function mentorActivityState(
  info: MentorActivityInfo | null | undefined,
  now: Date = new Date()
): MentorActivityState {
  const raw = String(info?.activity_status ?? "active").trim().toLowerCase();
  if (raw === "terminated") return "terminated";
  if (raw === "terminating") return "terminating";
  if (raw === "paused") {
    const until = info?.pause_until ? new Date(info.pause_until) : null;
    if (until && !Number.isNaN(until.getTime()) && until.getTime() <= now.getTime()) {
      return "active"; // 복귀 예정일 경과 → 자동 복귀
    }
    return "paused";
  }
  return "active";
}

/** 신규 구독을 받을 수 있는 상태인지(활동중만 허용). */
export function mentorAcceptsNewSubscriptions(
  info: MentorActivityInfo | null | undefined,
  now: Date = new Date()
): boolean {
  return mentorActivityState(info, now) === "active";
}

/** 일반 휴식(rest)을 새로 신청할 수 있는지 — 마지막 휴식이 6개월 이전이어야 함. */
export function canRequestNormalRest(
  lastPauseAtIso: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!lastPauseAtIso) return true;
  const last = new Date(lastPauseAtIso);
  if (Number.isNaN(last.getTime())) return true;
  // TZ-FIX R2 #16+#17: 서버 로컬(UTC) setMonth(말일 이월) → KST 달력 −6개월 + 말일
  // clamp (R1 정본 addMonthsClampedKst 재사용 — setMonth 사용 금지).
  const threshold = addMonthsClampedKst(now, -MENTOR_REST_FREQUENCY_MONTHS);
  return last.getTime() <= threshold.getTime();
}

export function clampPauseDays(raw: number | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MENTOR_MAX_PAUSE_DAYS, Math.trunc(n));
}

export function addDaysIso(baseIso: string | null | undefined, days: number, now: Date = new Date()): string {
  const base = baseIso ? new Date(baseIso) : now;
  const d = Number.isNaN(base.getTime()) ? new Date(now) : new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
