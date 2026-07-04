import Link from "next/link";
import { Gauge, Inbox, Star, Users } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { loadMentorHubDashboardData } from "@/lib/mentor/dashboard/mentorHubDashboardQueries";
import type {
  MentorHubDashboardData,
  MentorHubOrderRow,
} from "@/lib/mentor/dashboard/mentorHubDashboardTypes";
import { MentorRevenueChart, type MonthlyRevenue } from "@/components/mentor/mypage/MentorRevenueChart";
import { MentorActivityControls } from "@/components/mentor/mypage/MentorActivityControls";
import { MentorSubscribeOpenToggle } from "@/components/mentor/mypage/MentorSubscribeOpenToggle";
import { loadMentorSubscribeOpen } from "@/lib/mentor/mentorSubscribeOpen";
import { loadMentorCapUsage, type MentorCapUsage } from "@/lib/subscribe/mentorCapService";
import { listMentorReceivedReviews, type ReviewCardItem } from "@/lib/reviews/reviewQueries";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { PAGE_COL_GAP, SURFACE_CARD } from "@/lib/ui/surfaceCard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MONTHS_BACK = 5;

const SAFE_KPI_FALLBACK: MentorHubDashboardData["kpis"] = {
  newQuestions: 0,
  activeSubscribers: 0,
  newRequestsOpen: 0,
  newRequestsToday: 0,
  monthlyRevenue: 0,
  monthlyRevenueMomPct: null,
  avgRating: null,
  reviewCount: 0,
};

type VerificationToken = { label: string; tone: "ok" | "pending" | "none" };

function verificationLabel(status: string | null): VerificationToken {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "approved" || s === "verified") return { label: "인증 완료", tone: "ok" };
  if (s === "pending" || s === "in_review" || s === "submitted") return { label: "인증 검토중", tone: "pending" };
  if (s === "rejected") return { label: "인증 반려", tone: "none" };
  return { label: "미인증", tone: "none" };
}

function initialOf(name: string): string {
  const t = name.trim();
  return t ? t.charAt(0).toUpperCase() : "M";
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * cash_ledger에서 멘토(user_id=mentorId)의 정산 인입 금액을 최근 N개월 월별 합산.
 * - append-only 원장. ref_type 컬럼 기준 (이름은 04* 스키마 정의대로).
 * - delta_cents 양수만 인입으로 간주(차감 제외).
 * - 빈 달은 0으로 채워 정확히 MONTHS_BACK개 반환.
 * - delta_cents는 cents(×100). KRW로 변환해 캐시(=원) 단위로 노출.
 * - RLS/스키마 실패 시 0 배열 폴백 → UI 깨지지 않음.
 */
async function loadRecentMonthlyRevenue(
  supabase: SupabaseClient,
  mentorId: string,
): Promise<MonthlyRevenue[]> {
  const now = new Date();
  const buckets = new Map<string, number>();
  for (let i = MONTHS_BACK - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.set(monthKey(d), 0);
  }
  const start = new Date(now.getFullYear(), now.getMonth() - (MONTHS_BACK - 1), 1);

  try {
    const { data, error } = await supabase
      .from("cash_ledger")
      .select("created_at, delta_cents, ref_type")
      .eq("user_id", mentorId)
      .gt("delta_cents", 0)
      .gte("created_at", start.toISOString());
    if (!error && Array.isArray(data)) {
      for (const row of data as Array<{ created_at?: unknown; delta_cents?: unknown }>) {
        const at = row.created_at;
        if (typeof at !== "string") continue;
        const d = new Date(at);
        if (Number.isNaN(d.getTime())) continue;
        const key = monthKey(d);
        if (!buckets.has(key)) continue;
        const cents = typeof row.delta_cents === "number" ? row.delta_cents : Number(row.delta_cents ?? 0);
        if (Number.isFinite(cents) && cents > 0) {
          // cents → KRW (캐시 = 원)
          buckets.set(key, (buckets.get(key) ?? 0) + Math.round(cents / 100));
        }
      }
    }
  } catch {
    /* 0 배열 폴백 */
  }

  return Array.from(buckets.entries()).map(([key, total]) => ({
    month: `${parseInt(key.slice(5), 10)}월`,
    total,
  }));
}

/**
 * 멘토 마이페이지 v2 — 데스크탑 2컬럼.
 * 좌: 수익 카드(차트 포함) + 진행 의뢰 / 우: KPI 2.
 * 프로필 헤더는 상단 전체폭. 빠른 이동/프로필 CTA 카드는 네비·헤더와 중복이라 제외.
 */
type MypageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function MentorMypagePage(props: MypageProps) {
  const { user, profile } = await requireRole("mentor");
  const supabase = await createClient();
  const sp = (await props.searchParams) ?? {};
  const flashOk = typeof sp.ok === "string" ? sp.ok : null;
  const flashErr = typeof sp.error === "string" ? sp.error : null;

  let hub: MentorHubDashboardData | null = null;
  try {
    hub = await loadMentorHubDashboardData(supabase, user.id);
  } catch {
    hub = null;
  }

  let verificationStatus: string | null = null;
  let activityInfo: {
    activity_status?: string | null;
    pause_until?: string | null;
    termination_effective_at?: string | null;
    pause_reason?: string | null;
    last_pause_at?: string | null;
  } = {};
  try {
    const { data: row, error } = await supabase
      .from("mentor_profiles")
      .select("verification_status, activity_status, pause_until, termination_effective_at, pause_reason, last_pause_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!error && row) {
      const r = row as Record<string, unknown>;
      verificationStatus = typeof r.verification_status === "string" ? r.verification_status : null;
      activityInfo = {
        activity_status: typeof r.activity_status === "string" ? r.activity_status : null,
        pause_until: typeof r.pause_until === "string" ? r.pause_until : null,
        termination_effective_at: typeof r.termination_effective_at === "string" ? r.termination_effective_at : null,
        pause_reason: typeof r.pause_reason === "string" ? r.pause_reason : null,
        last_pause_at: typeof r.last_pause_at === "string" ? r.last_pause_at : null,
      };
    }
  } catch {
    /* fallback: 미인증 */
  }

  const monthlyRevenue = await loadRecentMonthlyRevenue(supabase, user.id);
  const currentMonthLabel = monthlyRevenue[monthlyRevenue.length - 1]?.month ?? "이번 달";
  const capUsage = await loadMentorCapUsage(user.id);
  const subscribeOpen = await loadMentorSubscribeOpen(supabase, user.id);
  const recentReviews = await listMentorReceivedReviews(supabase, user.id, 3);

  const displayName = profile?.nickname?.trim() || profile?.full_name?.trim() || "멘토";
  const verification = verificationLabel(verificationStatus);
  const kpis = hub?.kpis ?? SAFE_KPI_FALLBACK;
  const ratingAvg = hub?.rating?.avg ?? kpis.avgRating ?? null;
  const reviewCount = Math.max(hub?.rating?.count ?? kpis.reviewCount, recentReviews.length);
  const activeOrdersTop = (hub?.activeOrders ?? []).slice(0, 3);
  const revenue = hub?.revenuePanel;

  return (
    <main className="mx-auto w-full max-w-6xl bg-[#fcfcfd] px-10 py-9">
      <ProfileHeader
        displayName={displayName}
        verification={verification}
        reviewCount={reviewCount}
        ratingAvg={ratingAvg}
      />

      {verification.tone !== "ok" ? (
        <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
          <p className="font-black">승인 대기 중입니다.</p>
          <p className="mt-1 leading-relaxed">
            관리자 승인 완료 전에는 질문 답변, 맞춤의뢰 지원, 멘토 찾기 노출, 구독 받기가 제한됩니다.
            학생증 또는 프로필 정보를 수정해야 한다면 인증 상태 화면을 확인해 주세요.
          </p>
          <Link href="/mentor/verification" className="mt-2 inline-flex font-extrabold text-amber-900 underline underline-offset-2">
            인증 상태 확인하기 →
          </Link>
        </section>
      ) : null}

      <MentorActivityControls info={activityInfo} flashOk={flashOk} flashErr={flashErr} />

      <MentorSubscribeOpenToggle open={subscribeOpen} />

      <div className={`grid grid-cols-1 items-start lg:grid-cols-[1fr_300px] ${PAGE_COL_GAP}`}>
        {/* 좌 컬럼 */}
        <div className={`flex min-w-0 flex-col ${PAGE_COL_GAP}`}>
          <RevenueCard
            currentMonthLabel={currentMonthLabel}
            totalExpected={revenue?.totalExpected ?? 0}
            inProgress={revenue?.inProgress ?? 0}
            completedPending={revenue?.completedPending ?? 0}
            monthlyRevenue={monthlyRevenue}
          />

          <ActiveOrdersSection orders={activeOrdersTop} />
        </div>

        {/* 우 컬럼 */}
        <aside className={`flex flex-col self-start ${PAGE_COL_GAP}`}>
          <SubscribersStatCard activeSubscribers={kpis.activeSubscribers} />
          <RatingStatCard ratingAvg={ratingAvg} reviewCount={reviewCount} />
          <RecentReviewsCard reviews={recentReviews} />
          <CapStatCard usage={capUsage} />
          <MentorSupportCard />
        </aside>
      </div>
    </main>
  );
}

/* ───────────────── Profile Header (전체폭) ───────────────── */

function ProfileHeader(props: {
  displayName: string;
  verification: VerificationToken;
  reviewCount: number;
  ratingAvg: number | null;
}) {
  const { displayName, verification, reviewCount, ratingAvg } = props;
  const initial = initialOf(displayName);
  const verifBadgeClass =
    verification.tone === "ok"
      ? "text-[#059669] bg-[#ECFDF5]"
      : verification.tone === "pending"
        ? "text-amber-700 bg-amber-50"
        : "text-slate-500 bg-slate-100";
  const subline =
    reviewCount > 0 && ratingAvg != null
      ? `후기 ${reviewCount}개 · 평균 ${ratingAvg.toFixed(1)}`
      : reviewCount > 0
        ? `후기 ${reviewCount}개`
        : "아직 등록된 후기가 없어요";

  return (
    <header className="mb-7 flex items-center gap-3.5">
      <div
        className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-[#059669] text-xl font-semibold text-white"
        aria-hidden
      >
        {initial}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold tracking-tight text-[#1e2430]">{displayName}</h1>
          <span className={`rounded-[5px] px-2 py-0.5 text-[11px] font-medium ${verifBadgeClass}`}>
            {verification.label}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] text-slate-400">{subline}</p>
      </div>
    </header>
  );
}

/* ───────────────── Revenue Card (with 5-month chart) ───────────────── */

function RevenueCard(props: {
  currentMonthLabel: string;
  totalExpected: number;
  inProgress: number;
  completedPending: number;
  monthlyRevenue: MonthlyRevenue[];
}) {
  return (
    <section className={SURFACE_CARD}>
      <div className="mb-[18px] flex items-center justify-between">
        <p className="text-[13px] font-medium text-slate-400">
          이번 달 수익 · {props.currentMonthLabel}
        </p>
        <Link
          href="/mentor/payouts"
          className="text-[12px] font-medium text-[#059669] hover:underline"
        >
          정산 내역 보기 →
        </Link>
      </div>

      <p className="text-[42px] font-semibold leading-none tracking-[-1.6px] text-[#1e2430]">
        {Math.max(0, Math.round(props.totalExpected)).toLocaleString("ko-KR")}
        <span className="ml-1.5 text-base font-normal text-slate-400">캐시</span>
      </p>

      <div className="mt-3.5 flex gap-[26px]">
        <p className="text-[12px] text-slate-400">
          진행 중<span className="ml-1 font-semibold text-slate-600">{Math.round(props.inProgress).toLocaleString("ko-KR")}</span>
        </p>
        <p className="text-[12px] text-slate-400">
          정산 예정
          <span className="ml-1 font-semibold text-slate-600">
            {Math.round(props.completedPending).toLocaleString("ko-KR")}
          </span>
        </p>
      </div>

      <div className="-mx-2 mt-[22px] h-[130px]">
        <MentorRevenueChart monthlyRevenue={props.monthlyRevenue} />
      </div>
    </section>
  );
}

/* ───────────────── Active Orders ───────────────── */

function ActiveOrdersSection({ orders }: { orders: MentorHubOrderRow[] }) {
  return (
    <section>
      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-[#1e2430]">진행 중 의뢰</h2>
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">
          곧 오픈 예정
        </span>
      </div>
      {orders.length === 0 ? <EmptyOrders /> : <OrderList orders={orders} />}
    </section>
  );
}

function EmptyOrders() {
  return (
    <div className={`${SURFACE_CARD} py-12 text-center`}>
      <div className="inline-flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-slate-50">
        <Inbox className="h-5 w-5 text-slate-300" aria-hidden />
      </div>
      <p className="mt-3 text-[14px] font-medium text-slate-600">맞춤의뢰는 곧 오픈 예정이에요</p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-slate-400">
        서비스 준비가 끝나면 여기에서 의뢰를 확인하고 관리할 수 있어요
      </p>
    </div>
  );
}

function OrderList({ orders }: { orders: MentorHubOrderRow[] }) {
  return (
    <ul className="space-y-4">
      {orders.map((order) => (
        <li key={order.id}>
          <article
            className={`${SURFACE_CARD} transition-[box-shadow,border-color] duration-150 hover:border-emerald-300 hover:shadow-[0_2px_8px_rgba(0,0,0,0.09)]`}
          >
            <div className="flex items-start gap-4">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ECFDF5] text-[13px] font-semibold text-[#059669]"
                aria-hidden
              >
                {order.studentInitial}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-[14px] font-semibold text-[#1e2430]">{order.title}</h3>
                  <span className="rounded-[5px] bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    {order.categoryLabel}
                  </span>
                </div>
                <p className="mt-1 text-[12px] text-slate-400">
                  {order.studentName} · 최근 활동 {order.recentActivity}
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-[5px] px-2 py-0.5 text-[11px] font-medium ${
                      order.ddayUrgent ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-600"
                    }`}
                  >
                    {order.dday}
                    {order.deadlineDate ? <span className="ml-1 opacity-70">· {order.deadlineDate}</span> : null}
                  </span>
                  <span className={`rounded-[5px] border px-2 py-0.5 text-[11px] font-medium ${order.statusClassName}`}>
                    {order.statusLabel}
                  </span>
                </div>
              </div>
              <Link
                href={order.workroomHref}
                className="hidden shrink-0 items-center gap-1 self-start rounded-[8px] bg-[#059669] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#047857] sm:inline-flex"
              >
                바로가기 →
              </Link>
            </div>
            <Link
              href={order.workroomHref}
              className="mt-3 inline-flex w-full items-center justify-center rounded-[8px] bg-[#059669] px-3 py-2 text-[12px] font-semibold text-white sm:hidden"
            >
              바로가기 →
            </Link>
          </article>
        </li>
      ))}
    </ul>
  );
}

/* ───────────────── 우측 통계 카드 (구독 학생 / 평균 평점 / 구독 수용량) ─────────────────
   3카드 동일 크기·패딩·구조로 통일. 공통 카드 + 상단 아이콘/라벨 row. */

function fmtCap(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function StatCard(props: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <article className={SURFACE_CARD}>
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className={`flex h-9 w-9 items-center justify-center rounded-[10px] ${props.iconClass}`}>
          {props.icon}
        </span>
        <p className="text-[13px] font-medium text-slate-500">{props.label}</p>
      </div>
      {props.children}
    </article>
  );
}

function SubscribersStatCard({ activeSubscribers }: { activeSubscribers: number }) {
  return (
    <StatCard
      icon={<Users className="h-4 w-4" />}
      iconClass="bg-[#ECFDF5] text-[#059669]"
      label="구독 학생"
    >
      <p className="text-[28px] font-bold tracking-tight text-[#1e2430]">
        {activeSubscribers.toLocaleString("ko-KR")}
        <span className="ml-1 text-[13px] font-normal text-slate-400">명</span>
      </p>
    </StatCard>
  );
}

function RatingStatCard({ ratingAvg, reviewCount }: { ratingAvg: number | null; reviewCount: number }) {
  const dim = ratingAvg == null;
  return (
    <StatCard
      icon={<Star className="h-4 w-4" />}
      iconClass="bg-[#fefce8] text-[#ca8a04]"
      label="평균 평점"
    >
      <p className={`text-[28px] font-bold tracking-tight ${dim ? "text-slate-300" : "text-[#1e2430]"}`}>
        {ratingAvg != null ? ratingAvg.toFixed(1) : "—"}
        <span className="ml-1 text-[13px] font-normal text-slate-400">/ 5.0</span>
      </p>
      {reviewCount > 0 ? <p className="mt-1 text-[11px] text-slate-400">리뷰 {reviewCount}개 기준</p> : null}
    </StatCard>
  );
}

/* W-07: 멘토 분쟁·지원 진입 — 알림 딥링크 외 상시 진입점(헤더 네비 잠금값 대신 마이페이지 카드) */
function MentorSupportCard() {
  return (
    <section className={SURFACE_CARD}>
      <p className="text-[13px] font-semibold text-slate-700">분쟁·지원</p>
      <p className="mt-1 text-[12px] leading-relaxed text-slate-500">
        진행 중인 주문 분쟁 현황을 확인하고 관리자 중재 진행 상황을 볼 수 있어요.
      </p>
      <Link
        href="/mentor/support/disputes"
        className="mt-3 inline-flex text-[12px] font-bold text-[#059669] hover:underline"
      >
        분쟁 현황 보기 →
      </Link>
    </section>
  );
}

function RecentReviewsCard({ reviews }: { reviews: ReviewCardItem[] }) {
  return (
    <article className={SURFACE_CARD}>
      <p className="text-[13px] font-medium text-slate-500">최근 후기</p>
      {reviews.length === 0 ? (
        <p className="mt-3 text-[12px] leading-relaxed text-slate-400">아직 등록된 후기가 없어요</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {reviews.map((r) => (
            <li key={r.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-bold text-amber-500">★ {r.rating.toFixed(1)}</span>
                <span className="truncate text-[11px] text-slate-400">{formatKoreanDate(r.createdAt)}</span>
              </div>
              <p className="mt-0.5 text-[12px] font-semibold text-slate-700">{r.studentMaskedName}</p>
              <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-600">{r.content}</p>
            </li>
          ))}
        </ul>
      )}
      <Link href="/mentor/reviews" className="mt-3 inline-block text-[12px] font-bold text-[#059669] hover:underline">
        후기 전체보기 →
      </Link>
    </article>
  );
}

function CapStatCard({ usage }: { usage: MentorCapUsage }) {
  const { usedCap, capLimit, pct, isFull } = usage;
  // 상태별 색: 마감(빨강) > 여유 적음 80%↑(앰버) > 여유 있음(초록)
  const tone = isFull || pct >= 100 ? "full" : pct >= 80 ? "warn" : "ok";
  const color = tone === "full" ? "#dc2626" : tone === "warn" ? "#e08a2f" : "#059669";
  const statusLabel = tone === "full" ? "구독 마감" : tone === "warn" ? "여유 적음" : "여유 있음";

  return (
    <StatCard
      icon={<Gauge className="h-4 w-4" />}
      iconClass="bg-[#eef9f1] text-[#059669]"
      label="구독 수용량"
    >
      <p className="text-[28px] font-bold tracking-tight" style={{ color }}>
        {pct}
        <span className="ml-1 text-[13px] font-normal text-slate-400">%</span>
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-[5px] bg-[#eef0f3]">
        <div
          className="h-full rounded-[5px] transition-all"
          style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">
        <span className="font-semibold text-slate-500">
          {fmtCap(usedCap)} / {fmtCap(capLimit)}
        </span>{" "}
        · {statusLabel}
      </p>
    </StatCard>
  );
}
