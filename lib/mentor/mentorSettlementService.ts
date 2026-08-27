import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  kstDateString,
  kstMonthBounds,
  kstYearMonth,
  listRecentYearMonths,
  parseMentorSettlementLines,
  parseMentorSettlementSummary,
  type MentorSettlementLine,
  type MentorSettlementSummary,
} from "@/lib/mentor/mentorSettlementSchema";
import {
  summaryToTrendPoint,
  type MentorSettlementPageData,
} from "@/lib/mentor/mentorSettlementDisplay";
import {
  loadMentorPayoutBankAccount,
  loadPerformanceLines,
} from "@/lib/mentor/mentorPayoutsService";

/**
 * 멘토 정산 페이지 데이터 로더 — DB RPC(mentor_settlement_summary / mentor_settlement_lines)
 * 단일 소스. 두 RPC 는 security definer + auth.uid() 고정이라 세션 클라이언트로 호출해야
 * 본인 데이터가 나온다(service role 은 빈 결과).
 *
 * 실패 처리(fail-closed): RPC error·data null·스키마 위반 전부 { ok: false } — 호출측은
 * 0 을 렌더하지 말고 오류 상태를 그린다(PR #75 zero-row 무음 흡수 패턴 재발 금지).
 */
export type SettlementFetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

const LOAD_ERROR_MESSAGE = "정산 정보를 불러오지 못했습니다";

export async function fetchMentorSettlementSummary(
  supabase: SupabaseClient,
  ym: string
): Promise<SettlementFetchResult<MentorSettlementSummary>> {
  const { data, error } = await supabase.rpc("mentor_settlement_summary", { p_month: `${ym}-01` });
  if (error) {
    console.error("[fetchMentorSettlementSummary]", ym, error.message);
    return { ok: false, error: LOAD_ERROR_MESSAGE };
  }
  if (data == null) {
    console.error("[fetchMentorSettlementSummary]", ym, "RPC 응답이 null");
    return { ok: false, error: LOAD_ERROR_MESSAGE };
  }
  try {
    return { ok: true, data: parseMentorSettlementSummary(data) };
  } catch (e) {
    console.error("[fetchMentorSettlementSummary]", ym, e);
    return { ok: false, error: LOAD_ERROR_MESSAGE };
  }
}

export async function fetchMentorSettlementLines(
  supabase: SupabaseClient,
  opts: { ym?: string | null }
): Promise<SettlementFetchResult<MentorSettlementLine[]>> {
  const bounds = opts.ym ? kstMonthBounds(opts.ym) : null;
  const { data, error } = await supabase.rpc("mentor_settlement_lines", {
    p_from: bounds?.fromIso ?? null,
    p_to: bounds?.toIso ?? null,
  });
  if (error) {
    console.error("[fetchMentorSettlementLines]", opts.ym ?? "all", error.message);
    return { ok: false, error: LOAD_ERROR_MESSAGE };
  }
  if (data == null) {
    console.error("[fetchMentorSettlementLines]", opts.ym ?? "all", "RPC 응답이 null");
    return { ok: false, error: LOAD_ERROR_MESSAGE };
  }
  try {
    return { ok: true, data: parseMentorSettlementLines(data) };
  } catch (e) {
    console.error("[fetchMentorSettlementLines]", opts.ym ?? "all", e);
    return { ok: false, error: LOAD_ERROR_MESSAGE };
  }
}

const TREND_MONTHS = 6;

export async function loadMentorSettlementPageData(
  supabase: SupabaseClient,
  mentorId: string
): Promise<SettlementFetchResult<MentorSettlementPageData>> {
  const now = new Date();
  const ym = kstYearMonth(now);
  const todayKst = kstDateString(now);
  const trendYms = listRecentYearMonths(ym, TREND_MONTHS);

  const [summaryResult, linesResult, bank, performanceLines, ...pastSummaryResults] =
    await Promise.all([
      fetchMentorSettlementSummary(supabase, ym),
      fetchMentorSettlementLines(supabase, { ym }),
      loadMentorPayoutBankAccount(supabase, mentorId),
      loadPerformanceLines(supabase, mentorId),
      ...trendYms.slice(1).map((pastYm) => fetchMentorSettlementSummary(supabase, pastYm)),
    ]);

  if (!summaryResult.ok) return summaryResult;
  if (!linesResult.ok) return linesResult;
  const failedPast = pastSummaryResults.find((r) => !r.ok);
  if (failedPast && !failedPast.ok) return failedPast;

  const trend = [summaryResult, ...pastSummaryResults]
    .map((r) => (r.ok ? summaryToTrendPoint(r.data) : null))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .reverse();

  // KST 기준 이번 달 진행률 — 우측 "지급 일정" 위젯 (서버 계산으로 hydration 안전)
  const day = Number(todayKst.slice(8, 10));
  const [y, m] = ym.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthProgressPct = Math.min(100, Math.round((day / daysInMonth) * 100));

  return {
    ok: true,
    data: {
      month: ym,
      todayKst,
      monthProgressPct,
      summary: summaryResult.data,
      lines: linesResult.data,
      trend,
      bank,
      performanceLines,
    },
  };
}
