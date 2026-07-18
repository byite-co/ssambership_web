import Link from "next/link";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { fetchWalletBalanceByUserId } from "@/lib/cash/cashQueries";
import { parseWalletBalanceBreakdown } from "@/lib/cash/parseWalletBalanceKrw";
import { MentorSubscribeSummaryCard } from "@/components/subscribe/MentorSubscribeSummaryCard";
import { PromotionNoticeBox } from "@/components/subscribe/PromotionNoticeBox";
import { SubscribeCheckoutClient, type SubscribePlanOption } from "@/components/subscribe/SubscribeCheckoutClient";
import { loadStudentSubscribePage } from "@/lib/subscribe/subscribePageQueries";
import {
  SUBSCRIBE_PLAN_CATALOG,
  planIdFromRow,
} from "@/lib/subscribe/subscribePlanCatalog";
import { mentorPlanCashKrw } from "@/lib/subscribe/mentorPlanPricing";
import { loadMentorCapUsage, wouldExceedCap } from "@/lib/subscribe/mentorCapService";
import { USER_UI_LOAD_FAILED } from "@/lib/constants/userFacingMessages";
import { mentorVerificationStatusAllowsActivity } from "@/lib/mentor/mentorVerificationGate";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function one(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" && v ? v : undefined;
}

export default async function StudentSubscribePage(props: Props) {
  const { user } = await requireRole("student");
  const sp = (await props.searchParams) ?? {};
  const mentorId = one(sp, "mentorId") ?? null;

  const supabase = await createClient();

  if (!mentorId) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-black text-slate-900">멘토를 먼저 선택해 주세요</h1>
        <p className="mt-2 text-sm text-slate-600">멘토 목록에서 구독하기를 눌러 이 화면으로 이동할 수 있어요.</p>
        <Link href="/mentors" className="mt-6 inline-block font-bold text-blue-600 hover:underline">
          멘토 찾기 &rarr;
        </Link>
      </div>
    );
  }

  const [data, balance] = await Promise.all([
    loadStudentSubscribePage(supabase, { mentorId, studentId: user.id }),
    fetchWalletBalanceByUserId(supabase, user.id),
  ]);
  const breakdown = parseWalletBalanceBreakdown(balance.row);

  if (data.kind === "no_mentor" || data.kind === "mentor_error") {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-black text-slate-900">멘토 정보를 불러오지 못했어요</h1>
        <p className="mt-2 text-sm text-slate-600">{USER_UI_LOAD_FAILED}</p>
        <Link href="/mentors" className="mt-6 inline-block font-bold text-blue-600 hover:underline">
          멘토 찾기 &rarr;
        </Link>
      </div>
    );
  }

  if (!mentorVerificationStatusAllowsActivity(data.display.verification)) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-xl font-black text-slate-900">아직 구독할 수 없는 멘토입니다</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          관리자 승인 완료 전에는 구독을 받을 수 없습니다. 승인된 멘토를 찾아 주세요.
        </p>
        <Link href="/mentors" className="mt-6 inline-block font-bold text-blue-600 hover:underline">
          멘토 찾기 &rarr;
        </Link>
      </div>
    );
  }

  const capUsage = await loadMentorCapUsage(data.mentorId);
  const plans: SubscribePlanOption[] = SUBSCRIBE_PLAN_CATALOG.map((catalog) => ({
    ...catalog,
    cashKrw: mentorPlanCashKrw(data.byTier[catalog.tier] as Record<string, unknown> | null, catalog.tier),
    planId: planIdFromRow(data.byTier[catalog.tier] as Record<string, unknown> | null),
  }));
  // cap 마감: 학생에겐 구체 수치 노출 금지 — 마감된 tier 목록(boolean)만 전달
  const closedTiers = SUBSCRIBE_PLAN_CATALOG.filter((c) => wouldExceedCap(capUsage, c.tier)).map(
    (c) => c.tier,
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 antialiased">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4 lg:sticky lg:top-8">
          <MentorSubscribeSummaryCard mentorId={data.mentorId} display={data.display} />
        </div>

        <main className="min-w-0 space-y-6">
          <header>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">멘토 구독</h1>
            <p className="mt-1 text-sm text-slate-500">
              {data.display.displayName} 멘토와 연결할 플랜을 선택하세요.
            </p>
          </header>

          {balance.error ? (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="status">
              캐시 잔액을 불러오지 못했습니다. 표시된 잔액이 실제와 다를 수 있으니 새로고침 후 다시 확인해 주세요.
            </p>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <SubscribeCheckoutClient
              mentorId={data.mentorId}
              plans={plans}
              currentBalanceCash={breakdown.totalCash}
              closedTiers={closedTiers}
            />
          </section>

          <PromotionNoticeBox promotions={data.promotions} />
        </main>
      </div>
    </div>
  );
}
