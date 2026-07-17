import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { toggleCashTopupPackageActiveAction } from "@/lib/admin/adminTopupPackageActions";
import { SUBSCRIBE_PLAN_CATALOG } from "@/lib/subscribe/subscribePlanCatalog";
import { MENTOR_SUBSCRIPTION_PRICE_RULES, SUBSCRIBE_PLAN_TIERS } from "@/lib/subscribe/mentorPlanPricing";
import {
  SUBSCRIPTION_PLATFORM_FEE_LABEL,
  CUSTOM_REQUEST_PLATFORM_FEE_LABEL,
  INDIVIDUAL_QUESTION_PLATFORM_FEE_LABEL,
  PAYOUT_WITHHOLDING_LABEL,
} from "@/lib/mentor/mentorPayoutsConstants";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

type TopupPackageRow = {
  id: string;
  label: string | null;
  amount_cents: number | null;
  price_cents: number | null;
  display_order: number | null;
  active: boolean | null;
};

function won(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return `${Math.round(cents / 100).toLocaleString("ko-KR")}원`;
}

function cash(krw: number): string {
  return `${krw.toLocaleString("ko-KR")}캐시`;
}

export default async function AdminSettingsPage(props: PageProps) {
  await requireRole("admin");
  const sp = (await props.searchParams) ?? {};
  const flashOk = sp.ok === "1";
  const flashErr = typeof sp.error === "string" && sp.error.length ? sp.error : null;

  const supabase = await createClient();
  const { data: packagesData, error: packagesError } = await supabase
    .from("cash_topup_packages")
    .select("id, label, amount_cents, price_cents, display_order, active")
    .order("display_order", { ascending: true });
  const packages = ((packagesData as TopupPackageRow[] | null) ?? []).filter((p) => p.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-black text-slate-900">시스템 설정</h1>
        <p className="mt-1 text-sm text-slate-600">
          플랫폼 운영 설정을 관리합니다. 요금제·수수료는 코드 정본 잠금값이라 이 화면에서는 열람만 가능합니다.
        </p>
      </header>

      {flashOk ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
          변경을 저장했습니다.
        </p>
      ) : null}
      {flashErr ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">{flashErr}</p>
      ) : null}

      {/* 캐시 충전 패키지 — 이 화면에서 유일하게 수정 가능한 실운영 설정 */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">캐시 충전 패키지</h2>
          <p className="mt-1 text-xs text-slate-500">
            캐시 충전 화면(/wallet/charge)에 노출되는 패키지입니다. 비활성화하면 즉시 노출이 중단됩니다.
          </p>
        </div>
        {packagesError ? (
          <p className="px-5 py-6 text-sm font-semibold text-red-800">충전 패키지 목록을 불러오지 못했습니다.</p>
        ) : packages.length === 0 ? (
          <p className="px-5 py-6 text-sm font-semibold text-slate-500">등록된 충전 패키지가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">이름</th>
                  <th className="px-5 py-3">지급 캐시</th>
                  <th className="px-5 py-3">결제 금액</th>
                  <th className="px-5 py-3">노출 순서</th>
                  <th className="px-5 py-3">상태</th>
                  <th className="px-5 py-3">조치</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {packages.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3.5 font-bold text-slate-900">{p.label ?? "—"}</td>
                    <td className="px-5 py-3.5 tabular-nums text-slate-800">{won(p.amount_cents)}</td>
                    <td className="px-5 py-3.5 tabular-nums text-slate-800">{won(p.price_cents)}</td>
                    <td className="px-5 py-3.5 tabular-nums text-slate-500">{p.display_order ?? "—"}</td>
                    <td className="px-5 py-3.5">
                      {p.active ? (
                        <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                          노출 중
                        </span>
                      ) : (
                        <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-600">
                          비활성
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <form action={toggleCashTopupPackageActiveAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="nextActive" value={p.active ? "false" : "true"} />
                        <button
                          type="submit"
                          className={
                            p.active
                              ? "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                              : "rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                          }
                        >
                          {p.active ? "비활성화" : "활성화"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 요금제 잠금값 — 정본은 코드(lib/subscribe/*). 읽기 전용 */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">구독 요금제 (잠금값 · 읽기 전용)</h2>
          <p className="mt-1 text-xs text-slate-500">
            정본: <code className="font-mono">lib/subscribe/subscribePlanCatalog.ts</code> ·{" "}
            <code className="font-mono">lib/subscribe/mentorPlanPricing.ts</code> — 변경은 코드 수정·배포로만 가능합니다.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-extrabold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">플랜</th>
                <th className="px-5 py-3">주간 질문</th>
                <th className="px-5 py-3">카탈로그 표시가</th>
                <th className="px-5 py-3">멘토 가격 밴드 (min · 권장 · max)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {SUBSCRIBE_PLAN_TIERS.map((tier) => {
                const catalog = SUBSCRIBE_PLAN_CATALOG.find((c) => c.tier === tier);
                const band = MENTOR_SUBSCRIPTION_PRICE_RULES[tier];
                return (
                  <tr key={tier}>
                    <td className="px-5 py-3.5 font-bold text-slate-900">
                      {catalog?.label ?? tier}
                      {catalog?.recommend ? (
                        <span className="ml-2 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-extrabold text-blue-700">추천</span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700">{catalog?.weeklyLabel ?? "—"}</td>
                    <td className="px-5 py-3.5 tabular-nums text-slate-800">{catalog ? cash(catalog.cashKrw) : "—"}</td>
                    <td className="px-5 py-3.5 tabular-nums text-slate-800">
                      {cash(band.minCashKrw)} · {cash(band.recommendedCashKrw)} · {cash(band.maxCashKrw)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 수수료 잠금값 */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">수수료 정책 (잠금값 · 읽기 전용)</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <dt className="text-xs font-black text-slate-500">구독</dt>
            <dd className="mt-1 font-bold text-slate-900">{SUBSCRIPTION_PLATFORM_FEE_LABEL}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <dt className="text-xs font-black text-slate-500">맞춤의뢰</dt>
            <dd className="mt-1 font-bold text-slate-900">{CUSTOM_REQUEST_PLATFORM_FEE_LABEL}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <dt className="text-xs font-black text-slate-500">개별 질문</dt>
            <dd className="mt-1 font-bold text-slate-900">{INDIVIDUAL_QUESTION_PLATFORM_FEE_LABEL}</dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <dt className="text-xs font-black text-slate-500">정산 지급</dt>
            <dd className="mt-1 font-bold text-slate-900">{PAYOUT_WITHHOLDING_LABEL}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          정본: <code className="font-mono">lib/mentor/mentorPayoutsConstants.ts</code> — cap 1.0 / 2.5 / 4.5, 1캐시 = 1원.
        </p>
      </section>
    </div>
  );
}
