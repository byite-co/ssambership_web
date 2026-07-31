import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { findActiveSubscriptionForPair } from "@/lib/subscribe/subscribeCheckoutService";
import { loadStudentSubscribePage, isSubscribePlanTier } from "@/lib/subscribe/subscribePageQueries";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function one(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function SubscribeSuccessPage({ searchParams }: Props) {
  const { user } = await requireRole("student");
  const sp = (await searchParams) ?? {};

  const mentorId = one(sp, "mentorId");
  const planTierRaw = one(sp, "planTier");

  if (!mentorId || !planTierRaw || !isSubscribePlanTier(planTierRaw)) {
    redirect("/subscribe?error=" + encodeURIComponent("구독 정보가 올바르지 않습니다."));
  }

  const supabase = await createClient();
  const [data, activeSub] = await Promise.all([
    loadStudentSubscribePage(supabase, { mentorId, studentId: user.id }),
    findActiveSubscriptionForPair(supabase, user.id, mentorId),
  ]);
  const mentorName = data.kind === "ok" ? data.display.displayName : "멘토";
  if (activeSub.error) {
    // W4(C10): display-only degrade — 구독 확인 조회 실패를 성공으로 위장하지 않고,
    // 기존 "결제 정보를 확인할 수 없습니다" 경고 화면(fail-closed)을 그대로 보여준다.
    // (표시 전용 경로 — 주문·차감·구독 상태에는 영향 없음. 오류는 로그로 남긴다.)
    console.error("[SubscribeSuccessPage] findActiveSubscriptionForPair", activeSub.error);
  }
  const verified = activeSub.active !== null;

  if (!verified) {
    const retryHref = `/subscribe?mentorId=${encodeURIComponent(mentorId)}`;
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center sm:p-10">
          <AlertCircle className="mx-auto h-14 w-14 text-amber-500" strokeWidth={2} aria-hidden />
          <h1 className="mt-4 text-xl font-black text-slate-900">결제 정보를 확인할 수 없습니다</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            <span className="font-bold text-slate-800">{mentorName}</span> 멘토에 대한 활성 구독을 찾지
            못했어요. 구독 결제를 완료하지 않았거나, 처리 중일 수 있습니다.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href={retryHref}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-500"
            >
              구독 다시 시도
            </Link>
            <Link
              href="/mypage"
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              마이페이지
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <section className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm sm:p-10">
        <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" strokeWidth={2.25} aria-hidden />
        <h1 className="mt-4 text-2xl font-black text-slate-900">구독이 완료되었습니다!</h1>
        <p className="mt-4 text-base font-medium text-slate-700">
          <span className="font-bold text-slate-900">{mentorName}</span>님과 함께 공부를 시작해보세요.
        </p>

        <div className="mt-8">
          <Link
            href="/question-room"
            className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-500 sm:w-auto sm:min-w-[220px]"
          >
            질문방으로 이동하기
          </Link>
        </div>
      </section>
    </div>
  );
}
