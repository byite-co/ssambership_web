import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMentorDirectoryUserRows, loadMentorProfilesForDirectory } from "@/lib/auth/mentorPublicRead";
import { buildMentorProfileDisplay, type MentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import type { MentorsListFilters, MentorsListSort } from "@/lib/mentor/mentorsListSearchParams";
import { MENTORS_PAGE_SIZE } from "@/lib/mentor/mentorsListSearchParams";
import { mentorIsVerified } from "@/lib/mentor/mentorPublicProfileDisplay";
import { probePublicReviewVisibilityColumns } from "@/lib/mentor/publicReviewVisibility";
import { pickExistingColumn, rowsFromSupabaseData } from "@/lib/qna/safeSelect";
import { assignPlansByTier, type PlansByTier, type SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { loadMentorCapUsageBatch, type MentorCapUsage } from "@/lib/subscribe/mentorCapService";
import { mentorVerificationStatusAllowsActivity } from "@/lib/mentor/mentorVerificationGate";
import { formatAvgResponseHoursLabel, loadMentorAvgResponseHours } from "@/lib/mentor/avgResponseHoursDisplay";
import { getMajorSubjects, getMinorSubjects } from "@/lib/subjects/subjectCatalog";
import { mentorPlanCashKrw } from "@/lib/subscribe/mentorPlanPricing";
import {
  formatSubscribePlanCashMonthlyLabel,
  getSubscribeCatalogPlan,
} from "@/lib/subscribe/subscribePlanCatalog";
import { applySchoolClassificationLabels } from "@/lib/mentor/schoolClassificationCatalog";
import type {
  MentorGradeFilter,
  MentorTypeFilter,
} from "@/lib/mentor/mentorsListSearchParams";
type Row = Record<string, unknown>;

type PublicMentorsListOptions = {
  fetchLimit?: number;
  pageSize?: number;
  schoolTierLabels?: Record<string, string>;
  majorCategoryLabels?: Record<string, string>;
};

export const PUBLIC_MENTORS_RLS_HINT =
  "멘토 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요. 문제가 계속되면 고객 지원으로 문의해 주세요.";

export type MentorListStats = {
  totalAnswers: number | null;
  connectedStudents: number | null;
  avgResponseLabel: string;
  satisfactionLabel: string;
};

export type MentorTierPrice = {
  tier: SubscribePlanTier;
  label: string;
  cashLabel: string;
  cashKrw: number;
  weeklyLabel: string;
  priorityLabel: string;
  recommend?: boolean;
};

export type MentorPublicListCard = {
  mentorId: string;
  display: MentorProfileDisplay;
  userStatus: string;
  userCreatedAt: string | null;
  reviewCount: number | null;
  avgRating: number | null;
  priceLabel: string | null;
  byTier: PlansByTier | null;
  tierPrices: MentorTierPrice[];
  minPriceKrw: number | null;
  stats: MentorListStats;
  /** cap 마감 여부 (구체 수치는 학생 미노출 — boolean만) */
  subscriptionClosed: boolean;
};

export type PublicMentorsListResult = {
  cards: MentorPublicListCard[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  usersError: string | null;
  profilesError: string | null;
  onlySelfVisibleHint: boolean;
};

const PLAN_TABLES = ["plans", "mentor_plans", "subscription_plans", "mentor_subscription_plans"] as const;
const PLAN_FK = ["mentor_id", "mentor_user_id", "user_id", "owner_id"] as const;

function parsePriceNumber(row: Row): number | null {
  for (const k of ["amount_cents", "price_cents", "monthly_price_cents"]) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  for (const k of ["price", "monthly_price", "amount", "price_krw"]) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number.parseFloat(v.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

async function batchReviewStats(
  supabase: SupabaseClient,
  mentorIds: string[]
): Promise<{ map: Map<string, { count: number | null; avg: number | null }>; probe: string }> {
  const empty = new Map<string, { count: number | null; avg: number | null }>();
  if (!mentorIds.length) return { map: empty, probe: "멘토 id 없음" };

  const summaryTables = ["reviews_summary", "mentor_review_stats", "mentor_reviews_summary"] as const;
  for (const table of summaryTables) {
    const { error: pe } = await supabase.from(table).select("*").limit(1);
    if (pe) continue;
    const { column: mid } = await pickExistingColumn(supabase, table, ["mentor_id", "mentor_user_id", "user_id"]);
    if (!mid) continue;
    const { data, error } = await supabase.from(table).select("*").in(mid, mentorIds);
    if (error) continue;
    const map = new Map<string, { count: number | null; avg: number | null }>();
    const summaryRows = rowsFromSupabaseData(data) as Row[];
    for (const row of summaryRows) {
      const id = String(row[mid]);
      const cnt =
        typeof row.review_count === "number"
          ? row.review_count
          : typeof row.count === "number"
            ? row.count
            : typeof row.reviews_count === "number"
              ? row.reviews_count
              : null;
      const avg =
        typeof row.avg_rating === "number"
          ? row.avg_rating
          : typeof row.average_rating === "number"
            ? row.average_rating
            : typeof row.rating_avg === "number"
              ? row.rating_avg
              : null;
      map.set(id, { count: cnt, avg });
    }
    return { map, probe: `${table} · in(${mid})` };
  }

  for (const table of ["reviews", "mentor_reviews", "subscription_reviews"] as const) {
    const { error: pe } = await supabase.from(table).select("id").limit(1);
    if (pe) continue;
    const { column: mid } = await pickExistingColumn(supabase, table, [
      "mentor_id",
      "mentor_user_id",
      "reviewee_id",
      "to_user_id",
      "target_user_id",
    ]);
    if (!mid) continue;
    const { column: ratingCol } = await pickExistingColumn(supabase, table, ["rating", "score", "stars"]);
    const vis = await probePublicReviewVisibilityColumns(supabase, table);
    let batchQ = supabase.from(table).select("*").in(mid, mentorIds).limit(2500);
    if (vis.isHidden) batchQ = batchQ.eq(vis.isHidden, false);
    if (vis.isBlinded) batchQ = batchQ.eq(vis.isBlinded, false);
    const { data, error } = await batchQ;
    if (error) continue;
    const acc = new Map<string, { c: number; rs: number; rn: number }>();
    const reviewRows = rowsFromSupabaseData(data) as Row[];
    for (const row of reviewRows) {
      const id = String(row[mid]);
      const s = acc.get(id) ?? { c: 0, rs: 0, rn: 0 };
      s.c += 1;
      if (ratingCol && typeof row[ratingCol] === "number") {
        s.rs += row[ratingCol] as number;
        s.rn += 1;
      }
      acc.set(id, s);
    }
    const map = new Map<string, { count: number | null; avg: number | null }>();
    for (const [id, s] of acc) {
      map.set(id, { count: s.c, avg: s.rn ? s.rs / s.rn : null });
    }
    return { map, probe: `${table} · in(${mid}) · 최대 2500행 집계` };
  }

  return { map: empty, probe: "reviews_summary / reviews 계열 미가용 또는 RLS" };
}

type MentorPlanBatch = { label: string; byTier: PlansByTier; probe: string };

async function batchPlanLabels(
  supabase: SupabaseClient,
  mentorIds: string[]
): Promise<{ byMentor: Map<string, MentorPlanBatch>; probe: string }> {
  let lastProbe = "plans 테이블 없음 또는 RLS";

  for (const table of PLAN_TABLES) {
    const { error: pe } = await supabase.from(table).select("id").limit(1);
    if (pe) {
      lastProbe = `${table}: ${pe.message}`;
      continue;
    }
    const { column: fk, error: fkErr } = await pickExistingColumn(supabase, table, PLAN_FK);
    if (!fk) {
      lastProbe = `${table}: ${fkErr ?? "FK 컬럼 없음"}`;
      continue;
    }
    const { data, error } = await supabase.from(table).select("*").in(fk, mentorIds).limit(800);
    if (error) {
      lastProbe = `${table}.${fk}: ${error.message}`;
      continue;
    }
    const rows = rowsFromSupabaseData(data) as Row[];
    const rowsByMentor = new Map<string, Row[]>();
    for (const row of rows) {
      const mid = String(row[fk]);
      if (!mentorIds.includes(mid)) continue;
      const list = rowsByMentor.get(mid) ?? [];
      list.push(row);
      rowsByMentor.set(mid, list);
    }
    const out = new Map<string, MentorPlanBatch>();
    for (const [mid, mentorRows] of rowsByMentor) {
      const { byTier } = assignPlansByTier(mentorRows);
      const standardPrice = byTier.standard ? parsePriceNumber(byTier.standard) : null;
      let minPrice: number | null = null;
      for (const tier of ["limited", "standard", "premium"] as const) {
        const planRow = byTier[tier];
        const p = planRow ? parsePriceNumber(planRow) : null;
        if (p != null) minPrice = minPrice == null ? p : Math.min(minPrice, p);
      }
      const label =
        standardPrice != null
          ? `${getSubscribeCatalogPlan("standard").label} ${formatMoney(standardPrice)}`
          : minPrice != null
            ? `대표 ${formatMoney(minPrice)}~`
            : null;
      out.set(mid, {
        label: label ?? "",
        byTier,
        probe: `${table}.${fk}`,
      });
    }
    return { byMentor: out, probe: `${table}.${fk} · 행 ${rows.length}` };
  }

  return { byMentor: new Map(), probe: lastProbe };
}

function formatMoney(n: number): string {
  return formatSubscribePlanCashMonthlyLabel(n);
}

function priceKrwFromRow(row: Row | null, tier: SubscribePlanTier): number {
  return mentorPlanCashKrw(row, tier);
}

function buildTierPrices(byTier: PlansByTier | null): { tierPrices: MentorTierPrice[]; minPriceKrw: number | null } {
  const tiers: SubscribePlanTier[] = ["limited", "standard", "premium"];
  const tierPrices: MentorTierPrice[] = tiers.map((tier) => {
    const row = byTier?.[tier] ?? null;
    const catalog = getSubscribeCatalogPlan(tier);
    const krw = priceKrwFromRow(row, tier);
    return {
      tier,
      label: catalog.label,
      cashLabel: formatSubscribePlanCashMonthlyLabel(krw),
      cashKrw: krw,
      weeklyLabel: catalog.weeklyLabel,
      priorityLabel: catalog.priorityLabel,
      recommend: catalog.recommend,
    };
  });
  const minPriceKrw = tierPrices.length ? Math.min(...tierPrices.map((t) => t.cashKrw)) : null;
  return { tierPrices, minPriceKrw };
}

function schoolTierMatchesFilter(school: string, display: MentorProfileDisplay): boolean {
  if (!school) return true;
  if (!display.schoolVerified) return false;
  return display.schoolTier === school;
}

// 대분류 라벨 선택 시 그 대분류 + 소분류 라벨 어느 하나라도 멘토 과목 텍스트에 포함되면 매칭.
// teaching_subjects 가 자유 텍스트라 라벨 부분일치로 보수적으로 처리(3단계 code화 후 재정합).
function subjectMatchesPreset(subject: string, subjectsText: string): boolean {
  if (!subject) return true;
  const blob = subjectsText.toLowerCase();
  const major = getMajorSubjects().find((m) => m.label === subject);
  const labels = major ? [major.label, ...getMinorSubjects(major.code).map((s) => s.label)] : [subject];
  return labels.some((label) => blob.includes(label.toLowerCase()));
}

function gradeMatchesFilter(grades: MentorGradeFilter[], blob: string): boolean {
  if (!grades.length) return true;
  return grades.some((g) => {
    if (g === "중등") return /중등|중학|중1|중2|중3/.test(blob);
    if (g === "고등") return /고등|고1|고2|고3|내신|수능/.test(blob);
    if (g === "N수") return /n수|재수|검정/.test(blob);
    return false;
  });
}

function mentorTypeMatchesFilter(types: MentorTypeFilter[], display: MentorProfileDisplay): boolean {
  if (!types.length) return true;
  if (!display.schoolVerified) return false;
  const category = display.verifiedMajorCategory?.trim();
  if (!category) return false;
  return types.some((type) => type === category);
}

function cardMatchesFilters(f: MentorsListFilters, card: MentorPublicListCard): boolean {
  const d = card.display;
  const blob = [
    d.displayName,
    d.intro,
    d.subjects,
    d.tags,
    d.university,
    d.department,
    d.rawUniversity,
    d.rawDepartment,
    d.verifiedMajorCategory,
    d.schoolTier,
    d.highSchool,
    d.grade,
  ]
    .join(" ")
    .toLowerCase();

  if (f.q && !blob.includes(f.q.toLowerCase())) return false;
  if (f.school && !schoolTierMatchesFilter(f.school, d)) return false;
  if (!f.school && f.university) {
    const verifiedUniversity = d.schoolVerified ? d.university.toLowerCase() : "";
    if (!verifiedUniversity.includes(f.university.toLowerCase())) return false;
  }
  if (f.subject && !subjectMatchesPreset(f.subject, d.subjects || d.tags)) return false;
  if (f.verifiedOnly && !mentorIsVerified(d.verification)) return false;
  if (f.verification && !d.verification.toLowerCase().includes(f.verification.toLowerCase())) return false;
  if (!gradeMatchesFilter(f.grades, blob)) return false;
  if (!mentorTypeMatchesFilter(f.mentorTypes, d)) return false;

  // 구독 요금 필터: 멘토의 세 플랜(라이트/스탠다드/프리미엄) 중 하나라도 밴드에 들어가면 매칭.
  // 범위는 라벨(3~5만 / 5~10만 / 10~20만 / 20만 이상)과 일치하도록 정정.
  if (f.priceBand) {
    const prices = (card.tierPrices ?? [])
      .map((t) => t.cashKrw)
      .filter((p): p is number => typeof p === "number" && Number.isFinite(p));
    if (card.minPriceKrw != null) prices.push(card.minPriceKrw);
    if (prices.length) {
      const inBand = (p: number) => {
        if (f.priceBand === "3to5") return p >= 30_000 && p < 50_000;
        if (f.priceBand === "5to10") return p >= 50_000 && p < 100_000;
        if (f.priceBand === "10to20") return p >= 100_000 && p < 200_000;
        if (f.priceBand === "over20") return p >= 200_000;
        return true;
      };
      if (!prices.some(inBand)) return false;
    }
  }
  return true;
}

function sortKey(f: MentorsListSort): (a: MentorPublicListCard, b: MentorPublicListCard) => number {
  switch (f) {
    case "popular":
      return (a, b) => {
        const scoreA = (a.reviewCount ?? 0) * 10 + (a.avgRating ?? 0);
        const scoreB = (b.reviewCount ?? 0) * 10 + (b.avgRating ?? 0);
        return scoreB - scoreA;
      };
    case "review":
      return (a, b) => (b.reviewCount ?? -1e9) - (a.reviewCount ?? -1e9);
    case "rating":
      return (a, b) => (b.avgRating ?? -1) - (a.avgRating ?? -1);
    case "response":
      return (a, b) => {
        const parseMin = (label: string) => {
          const m = label.match(/(\d+)\s*분/);
          if (m) return Number(m[1]);
          const h = label.match(/(\d+)\s*시간/);
          if (h) return Number(h[1]) * 60;
          if (label.includes("48시간 이상")) return 49 * 60;
          return Number.POSITIVE_INFINITY;
        };
        return parseMin(a.stats.avgResponseLabel) - parseMin(b.stats.avgResponseLabel);
      };
    case "price_desc":
      return (a, b) => (b.minPriceKrw ?? -1) - (a.minPriceKrw ?? -1);
    case "price_asc":
      return (a, b) => (a.minPriceKrw ?? Number.POSITIVE_INFINITY) - (b.minPriceKrw ?? Number.POSITIVE_INFINITY);
    case "new":
    default:
      return (a, b) => {
        const ta = a.userCreatedAt ? Date.parse(a.userCreatedAt) : 0;
        const tb = b.userCreatedAt ? Date.parse(b.userCreatedAt) : 0;
        return tb - ta;
      };
  }
}

async function batchMentorListStats(
  supabase: SupabaseClient,
  mentorIds: string[],
  reviewMap: Map<string, { count: number | null; avg: number | null }>
): Promise<Map<string, MentorListStats>> {
  const out = new Map<string, MentorListStats>();
  for (const id of mentorIds) {
    const rev = reviewMap.get(id);
    const satisfactionLabel =
      rev?.avg != null && Number.isFinite(rev.avg) ? `${Math.round((rev.avg / 5) * 100)}%` : "—";
    out.set(id, {
      totalAnswers: null,
      connectedStudents: null,
      avgResponseLabel: "—",
      satisfactionLabel,
    });
  }
  if (!mentorIds.length) return out;

  const applyProfileStatsRow = (row: Row, mentorUserId: string) => {
    const prev = out.get(mentorUserId);
    if (!prev) return;
    const answers =
      typeof row.total_answers === "number"
        ? row.total_answers
        : typeof row.cumulative_answers === "number"
          ? row.cumulative_answers
          : typeof row.answer_count === "number"
            ? row.answer_count
            : prev.totalAnswers;
    const students =
      typeof row.connected_students === "number"
        ? row.connected_students
        : typeof row.student_count === "number"
          ? row.student_count
          : prev.connectedStudents;
    const respMin =
      typeof row.avg_response_minutes === "number"
        ? row.avg_response_minutes
        : typeof row.average_response_minutes === "number"
          ? row.average_response_minutes
          : null;
    const sat =
      typeof row.satisfaction_percent === "number"
        ? `${Math.round(row.satisfaction_percent)}%`
        : typeof row.satisfaction_score === "number"
          ? `${Math.round(row.satisfaction_score)}%`
          : prev.satisfactionLabel;
    out.set(mentorUserId, {
      totalAnswers: answers,
      connectedStudents: students,
      avgResponseLabel: respMin != null ? `${Math.round(respMin)}분` : prev.avgResponseLabel,
      satisfactionLabel: sat,
    });
  };

  {
    const { error: pe } = await supabase.from("mentor_profiles").select("user_id").limit(1);
    if (!pe) {
      const { data, error } = await supabase
        .from("mentor_profiles")
        .select(
          "user_id, total_answers, cumulative_answers, answer_count, connected_students, student_count, avg_response_minutes, average_response_minutes, satisfaction_percent, satisfaction_score"
        )
        .in("user_id", mentorIds);
      if (!error) {
        for (const row of (data as Row[]) ?? []) {
          const mentorUserId = row.user_id != null ? String(row.user_id) : "";
          if (mentorUserId) applyProfileStatsRow(row, mentorUserId);
        }
      }
    }
  }

  for (const table of ["mentor_stats", "mentor_directory_stats"] as const) {
    const { error: pe } = await supabase.from(table).select("user_id").limit(1);
    if (pe) continue;
    const { column: idCol } = await pickExistingColumn(supabase, table, ["user_id", "mentor_id", "mentor_user_id"]);
    if (!idCol) continue;
    const { data, error } = await supabase.from(table).select("*").in(idCol, mentorIds);
    if (error) continue;
    for (const row of (data as Row[]) ?? []) {
      const mentorUserId = String(row[idCol]);
      applyProfileStatsRow(row, mentorUserId);
    }
    break;
  }

  for (const table of ["subscriptions", "mentor_subscriptions", "user_subscriptions"] as const) {
    const { error: pe } = await supabase.from(table).select("id").limit(1);
    if (pe) continue;
    const { column: mid } = await pickExistingColumn(supabase, table, ["mentor_id", "mentor_user_id", "creator_id"]);
    if (!mid) continue;
    const { data, error } = await supabase.from(table).select("*").in(mid, mentorIds).limit(3000);
    if (error) continue;
    const counts = new Map<string, number>();
    for (const row of (data as Row[]) ?? []) {
      const id = String(row[mid]);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, c] of counts) {
      const prev = out.get(id);
      if (prev && prev.connectedStudents == null) {
        out.set(id, { ...prev, connectedStudents: c });
      }
    }
    break;
  }

  const responseEntries = await Promise.all(
    mentorIds.map(async (id) => [id, await loadMentorAvgResponseHours(supabase, id)] as const)
  );
  for (const [id, hours] of responseEntries) {
    if (hours == null) continue;
    const label = formatAvgResponseHoursLabel(hours);
    if (label === "—") continue;
    const prev = out.get(id);
    if (prev) {
      out.set(id, { ...prev, avgResponseLabel: label });
    }
  }

  return out;
}

/**
 * 공개 멘토 목록: P0 v2 RPC whitelist only.
 * RLS로 행이 비면 cards는 빈 배열(더미 없음).
 */
export async function loadPublicMentorsList(
  supabase: SupabaseClient,
  filters: MentorsListFilters,
  opts?: PublicMentorsListOptions
): Promise<PublicMentorsListResult> {
  const fetchLimit = opts?.fetchLimit ?? 200;
  const pageSize = opts?.pageSize ?? MENTORS_PAGE_SIZE;
  const page = filters.page;
  const diagnostics: string[] = [];

  const { data: authData } = await supabase.auth.getUser();
  const authId = authData.user?.id ?? null;

  // Diagnostics
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  diagnostics.push(`supabase_config: URL=${Boolean(url)}, Key=${Boolean(anonKey)}`);

  const dir = await loadMentorDirectoryUserRows(supabase, fetchLimit);
  diagnostics.push(dir.probe);
  if (dir.error) {
    console.error("[mentors] loadPublicMentorsList: directory users failed", {
      error: dir.error,
      probe: dir.probe,
      usedRpc: dir.usedRpc,
      supabaseConfig: { url: Boolean(url), key: Boolean(anonKey) },
      diagnostics,
    });
    return {
      cards: [],
      totalCount: 0,
      page,
      pageSize,
      hasMore: false,
      usersError: dir.error,
      profilesError: null,
      onlySelfVisibleHint: false,
    };
  }

  const users = dir.users;
  diagnostics.push(`mentors(디렉터리): ${users.length}행`);

  const ids = users.map((u) => u.id);
  let profilesError: string | null = null;
  const profileByUser = new Map<string, Row>();

  if (ids.length) {
    const pBatch = await loadMentorProfilesForDirectory(supabase, ids);
    diagnostics.push(pBatch.probe);
    if (pBatch.error) {
      profilesError = pBatch.error;
    } else {
      for (const [uid, row] of pBatch.byUser) {
        profileByUser.set(uid, row);
      }
    }
  }

  const [revBatch, planBatch] =
    ids.length > 0
      ? await Promise.all([batchReviewStats(supabase, ids), batchPlanLabels(supabase, ids)])
      : [{ map: new Map<string, { count: number; avg: number | null }>(), probe: "skip" }, { byMentor: new Map(), probe: "skip" }];

  diagnostics.push(`reviews: ${revBatch.probe}`);
  diagnostics.push(`plans: ${planBatch.probe}`);

  const statsMap = await batchMentorListStats(supabase, ids, revBatch.map);
  const capMap =
    ids.length > 0 ? await loadMentorCapUsageBatch(ids) : new Map<string, MentorCapUsage>();

  const cards: MentorPublicListCard[] = [];
  for (const u of users) {
    const prow = profileByUser.get(u.id) ?? null;
    if (!mentorVerificationStatusAllowsActivity(prow?.verification_status)) {
      continue;
    }
    // [과목 필수 게이트] 담당 과목 0개 멘토는 공개 디렉터리에서 제외(활동하려면 과목 지정 필요).
    const prowSubjects = (prow as Record<string, unknown> | null)?.teaching_subjects;
    const hasSubject = Array.isArray(prowSubjects)
      ? prowSubjects.some((s) => typeof s === "string" && s.trim().length > 0)
      : false;
    if (!hasSubject) {
      continue;
    }
    const display = applySchoolClassificationLabels(buildMentorProfileDisplay(prow, u), {
      schoolTierLabels: opts?.schoolTierLabels ?? {},
      majorCategoryLabels: opts?.majorCategoryLabels ?? {},
    });
    const rev = revBatch.map.get(u.id) ?? { count: null, avg: null };
    const plan = planBatch.byMentor.get(u.id);
    const byTier = plan?.byTier ?? null;
    const { tierPrices, minPriceKrw } = buildTierPrices(byTier);
    const card: MentorPublicListCard = {
      mentorId: u.id,
      display,
      userStatus: u.status,
      userCreatedAt: u.created_at ?? null,
      reviewCount: rev.count,
      avgRating: rev.avg,
      priceLabel: plan?.label ? plan.label : null,
      byTier,
      tierPrices,
      minPriceKrw,
      stats: statsMap.get(u.id) ?? {
        totalAnswers: null,
        connectedStudents: null,
        avgResponseLabel: "—",
        satisfactionLabel: rev.avg != null ? `${Math.round((rev.avg / 5) * 100)}%` : "—",
      },
      subscriptionClosed: capMap.get(u.id)?.isFull ?? false,
    };
    if (cardMatchesFilters(filters, card)) {
      cards.push(card);
    }
  }

  cards.sort(sortKey(filters.sort));
  const totalCount = cards.length;
  const start = (page - 1) * pageSize;
  const sliced = cards.slice(start, start + pageSize);
  const hasMore = start + pageSize < totalCount;

  const onlySelfVisibleHint =
    Boolean(authId) &&
    sliced.length === 1 &&
    sliced[0]?.mentorId === authId &&
    !filters.q &&
    !filters.school &&
    !filters.university &&
    !filters.subject &&
    !filters.mentorTypes.length &&
    !filters.priceBand;

  return {
    cards: sliced,
    totalCount,
    page,
    pageSize,
    hasMore,
    usersError: null,
    profilesError,
    onlySelfVisibleHint,
  };
}
