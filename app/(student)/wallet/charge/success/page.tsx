import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { findChargePackageByPayKrw } from "@/lib/cash/chargePackages";
import { parseWalletBalanceBreakdown } from "@/lib/cash/parseWalletBalanceKrw";
import { fetchWalletBalanceByUserId } from "@/lib/cash/cashQueries";
import { confirmCashTopupForCurrentUser } from "@/lib/toss/confirmCashTopupServer";
import { WalletChargeSidebar } from "@/components/cash/WalletChargeSidebar";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function one(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function fmtCash(n: number): string {
  return `${n.toLocaleString("ko-KR")}캐시`;
}

export default async function WalletChargeSuccessPage({ searchParams }: Props) {
  const { user } = await requireRole("student");
  const sp = (await searchParams) ?? {};

  const paymentKey = one(sp, "paymentKey");
  const orderId = one(sp, "orderId");
  const amountRaw = one(sp, "amount");
  const payKrw = amountRaw ? Number(amountRaw) : Number.NaN;

  if (!paymentKey || !orderId || !Number.isFinite(payKrw) || payKrw <= 0) {
    redirect("/wallet/charge?error=" + encodeURIComponent("결제 정보가 올바르지 않습니다."));
  }

  // confirm 라우트와 같은 서버 코어를 '직접' 호출한다 — 공개 URL 경유·서버 내부
  // self-fetch·쿠키 문자열 재전달 경로는 제거됐다(사이트 URL 환경변수 의존 없음).
  // 세션은 현재 요청 컨텍스트의 서버 클라이언트가 그대로 읽는다.
  const result = await confirmCashTopupForCurrentUser({ paymentKey, orderId, amount: payKrw });
  if (!result.ok) {
    redirect("/wallet/charge?error=" + encodeURIComponent(result.message || "충전 확인에 실패했습니다."));
  }

  const pkg = findChargePackageByPayKrw(payKrw);
  const cashKrw = pkg?.cashKrw ?? payKrw;
  const bonusKrw = pkg?.bonusKrw ?? 0;

  const supabase = await createClient();
  const balance = await fetchWalletBalanceByUserId(supabase, user.id);
  const breakdown = parseWalletBalanceBreakdown(balance.row);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 antialiased">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <WalletChargeSidebar breakdown={breakdown} balanceError={balance.error} />

        <main className="min-w-0">
          <section className="rounded-2xl border border-emerald-200 bg-white p-8 shadow-sm sm:p-10">
            <div className="flex flex-col items-center text-center">
              <CheckCircle2 className="h-16 w-16 text-emerald-500" strokeWidth={2.25} aria-hidden />
              <h1 className="mt-4 text-2xl font-black text-slate-900">충전이 완료됐습니다</h1>

              <p className="mt-4 text-base text-slate-700">
                <span className="font-bold text-slate-900">{payKrw.toLocaleString("ko-KR")}원</span> 결제 완료
              </p>
              <p className="mt-2 text-lg font-bold text-slate-900">{fmtCash(cashKrw)} 적립</p>

              {bonusKrw > 0 ? (
                <p className="mt-2 text-base font-extrabold text-emerald-600">
                  + {fmtCash(bonusKrw)} 보너스 추가 적립!
                </p>
              ) : null}
              <p className="mt-1 text-xs text-slate-500">총 {fmtCash(cashKrw)} 지급</p>

              <p className="mt-6 text-sm text-slate-600">
                현재 잔액{" "}
                <span className="text-base font-black text-slate-900">{fmtCash(breakdown.totalCash)}</span>
              </p>

              <div className="mt-8 flex w-full max-w-sm flex-col gap-3 sm:flex-row sm:justify-center">
                <Link
                  href="/wallet/ledger"
                  className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-500"
                >
                  사용 내역 보기 &rarr;
                </Link>
                <Link
                  href="/wallet/charge"
                  className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50"
                >
                  충전 페이지로
                </Link>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
