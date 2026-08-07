import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMentorProfilesForDirectory, type PublicMentorProfileRow } from "@/lib/auth/mentorPublicRead";
import { API_WEB_V1_SCHEMA } from "@/lib/apiWebV1/rpc";
import type { UserRow } from "@/lib/types/user";
import { buildMentorProfileDisplay, type MentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";
import type { MentorsListFilters, MentorsListSort } from "@/lib/mentor/mentorsListSearchParams";
import { MENTORS_PAGE_SIZE } from "@/lib/mentor/mentorsListSearchParams";
import { mentorIsVerified } from "@/lib/mentor/mentorPublicProfileDisplay";
import { rowsFromSupabaseData } from "@/lib/qna/safeSelect";
import { assignPlansByTier, type PlansByTier, type SubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";
import { loadMentorCapUsageBatch, type MentorCapUsage } from "@/lib/subscribe/mentorCapService";
import { mentorVerificationStatusAllowsActivity } from "@/lib/mentor/mentorVerificationGate";
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

// D-ST-8: 인메모리 200행 캡을 제거하기 위한 상수·유틸.
// PostgREST 기본 max-rows(1000)와 URL 길이 상한 때문에 디렉터리 전량은 range 로 순회하고,
// 다운스트림 `.in()` 배치는 청크로 나눈다.
const DIRECTORY_BATCH = 1000;
const DIRECTORY_SAFETY_MAX = 10000;
const IN_CHUNK = 200;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** mentor_directory_v1 행 → 최소 UserRow(목록이 소비하는 id·status·created_at·nickname 만). */
function directoryRowToUserRow(row: Row): UserRow {
  const createdAt = row.created_at == null ? new Date().toISOString() : String(row.created_at);
  return {
    id: String(row.mentor_id),
    role: "mentor",
    status: "active",
    full_name: null,
    nickname: typeof row.nickname === "string" ? row.nickname : null,
    email: null,
    grade_level: null,
    student_status: null,
    birth_date: null,
    terms_agreed_at: null,
    privacy_agreed_at: null,
    marketing_agreed: false,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

/**
 * D-ST-8: mentor_directory_v1 전량을 created_at desc 로 range 순회한다(구: `.limit(200)` 캡으로
 * 201번째 이후 멘토가 어떤 검색·필터·페이지로도 안 나오던 버그). 안전 상한(10000) 도달 시
 * truncated=true 로 표면화한다.
 */
async function fetchAllDirectoryUserRows(
  supabase: SupabaseClient
): Promise<{ users: UserRow[]; error: string | null; probe: string; truncated: boolean }> {
  const users: UserRow[] = [];
  let truncated = false;
  for (let offset = 0; offset < DIRECTORY_SAFETY_MAX; offset += DIRECTORY_BATCH) {
    const end = Math.min(offset + DIRECTORY_BATCH, DIRECTORY_SAFETY_MAX) - 1;
    const { data, error } = await supabase
      .schema(API_WEB_V1_SCHEMA)
      .from("mentor_directory_v1")
      .select("mentor_id, nickname, created_at")
      .order("created_at", { ascending: false })
      .range(offset, end);
    if (error) {
      console.error("[mentors] mentor_directory_v1 range read failed", {
        message: error.message,
        code: error.code,
        offset,
      });
      return { users: [], error: error.message || "mentor_directory_v1 failed", probe: `api_web_v1.mentor_directory_v1: ${error.message}`, truncated: false };
    }
    const rows = rowsFromSupabaseData(data) as Row[];
    for (const row of rows) {
      if (row.mentor_id != null) users.push(directoryRowToUserRow(row));
    }
    if (rows.length < end - offset + 1) break; // 더 없음
    if (offset + DIRECTORY_BATCH >= DIRECTORY_SAFETY_MAX) truncated = true;
  }
  return { users, error: null, probe: `api_web_v1.mentor_directory_v1(V3) · 전량 순회 ${users.length}행`, truncated };
}

/**
 * D-ST-8: 프로필 배치 조회를 청크로 나눈다(단일 `.in()` 은 PostgREST max-rows 로 1000행에서
 * 잘려 멘토가 1000명을 넘으면 프로필이 누락됐다). Wave0 loadMentorProfilesForDirectory 재사용.
 */
async function loadProfilesForDirectoryChunked(
  supabase: SupabaseClient,
  ids: string[]
): Promise<{ byUser: Map<string, PublicMentorProfileRow>; error: string | null; probe: string }> {
  const byUser = new Map<string, PublicMentorProfileRow>();
  if (!ids.length) return { byUser, error: null, probe: "skip" };
  let firstError: string | null = null;
  for (const idChunk of chunk(ids, 500)) {
    const batch = await loadMentorProfilesForDirectory(supabase, idChunk);
    if (batch.error) {
      firstError = firstError ?? batch.error;
      continue;
    }
    for (const [uid, row] of batch.byUser) byUser.set(uid, row);
  }
  return { byUser, error: firstError, probe: "api_web_v1.mentor_directory_v1(V3) · 청크 배치" };
}

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

// W4(C10): PLAN_TABLES/PLAN_FK 후보 배열 제거 — 정본은 public.mentor_plans(mentor_id) 단일 테이블(187 baseline 실측).

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

/**
 * W4(C10): reviews_summary 계열(부재 테이블) 프로빙 루프와 reviews 계열 후보 테이블/컬럼
 * 프로빙 제거 — 정본 public.reviews(mentor_id, rating, is_hidden, is_blinded) 단일 쿼리로 고정
 * (187 baseline 실측 · hidden/blinded 고정 컬럼 필터, fail-open 프로빙 폐기).
 * 오류 시 console.error 후 빈 map 반환 — 목록 카드 리뷰 수치 표기 전용 degrade(성공 아님),
 * probe 문자열로 오류를 진단 로그에 남긴다.
 */
async function batchReviewStats(
  supabase: SupabaseClient,
  mentorIds: string[]
): Promise<{ map: Map<string, { count: number | null; avg: number | null }>; probe: string }> {
  const empty = new Map<string, { count: number | null; avg: number | null }>();
  if (!mentorIds.length) return { map: empty, probe: "멘토 id 없음" };

  // D-ST-8: id 청크로 나눠 조회(단일 `.in()` + limit 2500 은 멘토 다수 시 잘렸다).
  const acc = new Map<string, { c: number; rs: number; rn: number }>();
  let totalRows = 0;
  for (const idChunk of chunk(mentorIds, IN_CHUNK)) {
    const { data, error } = await supabase
      .from("reviews")
      .select("mentor_id, rating")
      .in("mentor_id", idChunk)
      .eq("is_hidden", false)
      .eq("is_blinded", false);
    if (error) {
      // 표시 전용 degrade: 리뷰 통계 없이 카드 렌더(빈 결과와 구분되도록 로그·probe에 오류 기록)
      console.error("[mentors] batchReviewStats: reviews query failed", error.message);
      return { map: empty, probe: `reviews.mentor_id 오류: ${error.message}` };
    }
    const reviewRows = rowsFromSupabaseData(data) as Row[];
    totalRows += reviewRows.length;
    for (const row of reviewRows) {
      const id = String(row.mentor_id);
      const s = acc.get(id) ?? { c: 0, rs: 0, rn: 0 };
      s.c += 1;
      if (typeof row.rating === "number") {
        s.rs += row.rating;
        s.rn += 1;
      }
      acc.set(id, s);
    }
  }
  const map = new Map<string, { count: number | null; avg: number | null }>();
  for (const [id, s] of acc) {
    map.set(id, { count: s.c, avg: s.rn ? s.rs / s.rn : null });
  }
  return { map, probe: `reviews.mentor_id · hidden/blinded 제외 · ${totalRows}행 집계` };
}

type MentorPlanBatch = { label: string; byTier: PlansByTier; probe: string };

/**
 * W4(C10): 4테이블×4FK 프로빙 루프 제거 — 정본 public.mentor_plans(mentor_id, plan_tier,
 * amount_cents, label) 단일 쿼리로 고정(187 baseline 실측).
 * 오류 시 console.error 후 빈 map 반환 — 목록 카드 가격 라벨은 카탈로그 표시가 폴백으로
 * 렌더되는 표시 전용 degrade(성공 아님 · 실차감액 경로는 fetchPlansForMentor가 별도 담당).
 */
async function batchPlanLabels(
  supabase: SupabaseClient,
  mentorIds: string[]
): Promise<{ byMentor: Map<string, MentorPlanBatch>; probe: string }> {
  // D-ST-8: id 청크로 나눠 조회(단일 `.in()` + limit 800 은 멘토 다수 시 플랜이 잘려 가격
  // 라벨·priceBand 필터가 틀렸다).
  const mentorIdSet = new Set(mentorIds);
  const rowsByMentor = new Map<string, Row[]>();
  let totalRows = 0;
  for (const idChunk of chunk(mentorIds, IN_CHUNK)) {
    const { data, error } = await supabase
      .from("mentor_plans")
      .select("*")
      .in("mentor_id", idChunk);
    if (error) {
      console.error("[mentors] batchPlanLabels: mentor_plans query failed", error.message);
      return { byMentor: new Map(), probe: `mentor_plans.mentor_id 오류: ${error.message}` };
    }
    const rows = rowsFromSupabaseData(data) as Row[];
    totalRows += rows.length;
    for (const row of rows) {
      const mid = String(row.mentor_id);
      if (!mentorIdSet.has(mid)) continue;
      const list = rowsByMentor.get(mid) ?? [];
      list.push(row);
      rowsByMentor.set(mid, list);
    }
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
      probe: "mentor_plans.mentor_id",
    });
  }
  return { byMentor: out, probe: `mentor_plans.mentor_id · 행 ${totalRows}` };
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

// D-ST-9: 목록 카드(MentorCard)는 stats.connectedStudents 를 렌더하지 않는다(카드 통계 문구는
// totalAnswers>=5 일 때만 나오는데 totalAnswers 는 항상 null 이라 항상 "신규 멘토 …" 고정 문구다).
// 따라서 렌더에 쓰이지 않는 (1) subscriptions 최대 3000행 스캔(connectedStudents) 과
// (2) 멘토 1인당 get_mentor_avg_response_hours RPC N+1 을 제거한다.
// satisfactionLabel 만 이미 조회한 reviewMap 으로 계산한다(추가 왕복 없음).
// D-ST-9 회귀 수정: 데이터 소스가 사라져 "—" 고정이던 평균 응답 라벨과 그 라벨을 파싱하던
// 응답속도 정렬(전 행 동률 no-op)을 함께 제거 — sort=response 는 기본 정렬로 폴백한다.
function buildMentorListStats(
  mentorIds: string[],
  reviewMap: Map<string, { count: number | null; avg: number | null }>
): Map<string, MentorListStats> {
  const out = new Map<string, MentorListStats>();
  for (const id of mentorIds) {
    const rev = reviewMap.get(id);
    const satisfactionLabel =
      rev?.avg != null && Number.isFinite(rev.avg) ? `${Math.round((rev.avg / 5) * 100)}%` : "—";
    out.set(id, {
      totalAnswers: null,
      connectedStudents: null,
      satisfactionLabel,
    });
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
  // D-ST-8: fetchLimit(구 인메모리 캡)은 더 이상 캡으로 쓰지 않는다 — 디렉터리 전량을 순회한다.
  void opts?.fetchLimit;
  const pageSize = opts?.pageSize ?? MENTORS_PAGE_SIZE;
  const page = filters.page;
  const diagnostics: string[] = [];

  const { data: authData } = await supabase.auth.getUser();
  const authId = authData.user?.id ?? null;

  // Diagnostics
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  diagnostics.push(`supabase_config: URL=${Boolean(url)}, Key=${Boolean(anonKey)}`);

  const dir = await fetchAllDirectoryUserRows(supabase);
  diagnostics.push(dir.probe);
  if (dir.error) {
    console.error("[mentors] loadPublicMentorsList: directory users failed", {
      error: dir.error,
      probe: dir.probe,
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
  if (dir.truncated) {
    console.warn("[mentors] loadPublicMentorsList: directory truncated at safety cap", DIRECTORY_SAFETY_MAX);
  }

  const users = dir.users;
  diagnostics.push(`mentors(디렉터리): ${users.length}행`);

  const ids = users.map((u) => u.id);
  let profilesError: string | null = null;
  const profileByUser = new Map<string, Row>();

  if (ids.length) {
    const pBatch = await loadProfilesForDirectoryChunked(supabase, ids);
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

  const statsMap = buildMentorListStats(ids, revBatch.map);
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
