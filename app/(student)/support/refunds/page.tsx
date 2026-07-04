import Link from "next/link";
import { redirect } from "next/navigation";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { StudentSupportTabs } from "@/components/support/StudentSupportTabs";
import { FormSubmitButton } from "@/components/qna/FormSubmitButton";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { createClient } from "@/lib/supabase/server";
import { requestSubscriptionProratedRefundAction } from "@/lib/subscribe/subscriptionCancelActions";
import { loadStudentSubscriptionManagementList } from "@/lib/subscribe/studentSubscriptionManagement";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

export default async function StudentSupportRefundsPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const selectedSubscriptionId = firstParam(sp.subscriptionId);
  const flashOk = firstParam(sp.ok);
  const flashError = firstParam(sp.error);
  const { user } = await getServerUserWithProfile();
  if (!user) {
    redirect(`/login/student?next=${encodeURIComponent("/support/refunds")}`);
  }

  const supabase = await createClient();
  const subscriptionList = await loadStudentSubscriptionManagementList(supabase, user.id);
  const refundableItems = subscriptionList.items.filter((item) => item.canRequestRefund || item.pendingRefundId);

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="고객지원"
      title="구독 환불 신청"
      description={
        <>
          <span className="md:hidden">관리자 승인 후 환불 처리돼요.</span>
          <span className="hidden md:inline">잔여기간 환불을 예상 금액으로 신청하면 관리자 승인 후 처리됩니다.</span>
        </>
      }
      sections={[]}
      dataPoints={[
        "학원법 시행령 별표4 기준 — 이용 개시 전 전액 / 기간 1/3 전 2/3 / 1/2 전 1/2 / 1/2 경과 후 환불 없음",
        "환불 금액은 신청 시점에 고정되며 관리자 승인 전에는 캐시가 환불되지 않습니다.",
      ]}
    >
      <div className="mx-auto max-w-4xl space-y-5">
        <StudentSupportTabs active="refunds" />
        {flashOk ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
            {flashOk}
          </p>
        ) : null}
        {flashError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">
            {flashError}
          </p>
        ) : null}

        {subscriptionList.error ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            구독 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
        ) : null}

        {refundableItems.length === 0 ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-base font-black text-slate-900">환불 신청 가능한 구독이 없습니다</h2>
            <p className="mt-2 text-sm text-slate-500">
              잔여기간이 있는 활성 구독만 환불 신청할 수 있습니다. 구독 해지는 구독 현황에서 먼저 진행할 수 있어요.
            </p>
            <Link href="/subscriptions" className="mt-5 inline-flex rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-blue-700">
              구독 현황으로 이동
            </Link>
          </section>
        ) : (
          <section className="space-y-4">
            {refundableItems.map((item) => {
              const selected = selectedSubscriptionId === item.subscriptionId;
              return (
                <article
                  key={item.subscriptionId}
                  className={`rounded-2xl border bg-white p-5 shadow-sm ${
                    selected ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"
                  }`}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-black text-slate-900">{item.mentorName}</h2>
                        <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-extrabold text-blue-700">
                          {item.planLabel}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        현재 기간 종료일은 <strong className="text-slate-900">{item.currentPeriodEndLabel}</strong>입니다.
                      </p>
                    </div>
                    <div className="w-full shrink-0 rounded-xl bg-slate-50 px-4 py-3 text-right md:w-56">
                      <p className="text-xs font-bold text-slate-500">예상 환불액 (학원법 기준)</p>
                      <p className="mt-1 text-xl font-black text-slate-900">{item.refundEstimateLabel}</p>
                      <p className="mt-1 text-[11px] font-semibold text-slate-600">
                        {item.refundEstimateBracketLabel}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        남은 {item.refundEstimate.remainingDays}일 / 전체 {item.refundEstimate.totalDays}일
                      </p>
                    </div>
                  </div>

                  {item.pendingRefundId ? (
                    <p className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-800">
                      이미 접수된 환불 신청이 관리자 검토 대기 중입니다.
                    </p>
                  ) : (
                    <form action={requestSubscriptionProratedRefundAction} className="mt-4 space-y-3">
                      <input type="hidden" name="subscriptionId" value={item.subscriptionId} />
                      <label className="block text-xs font-bold text-slate-700">
                        신청 사유 <span className="text-red-500">*필수</span>
                        <textarea
                          name="reason"
                          rows={3}
                          required
                          minLength={5}
                          placeholder="환불이 필요한 이유를 간단히 적어 주세요. (5자 이상)"
                          className="mt-1 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
                        />
                      </label>
                      <p className="text-xs leading-relaxed text-slate-500">
                        학원법 시행령 별표4 기준으로 산정된 예상치입니다. <strong>신청 시점의 금액으로 고정</strong>되며,
                        관리자가 결제·이용 내역을 확인한 뒤 승인합니다.
                      </p>
                      <FormSubmitButton
                        idleLabel="잔여기간 환불 신청"
                        pendingLabel="접수 중..."
                        className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </form>
                  )}
                </article>
              );
            })}
          </section>
        )}

        <p className="text-xs text-slate-500">
          환불 승인 후 캐시 원장 반영은 <Link href="/wallet/ledger" className="font-bold text-blue-700 underline">캐시 원장</Link>에서 확인할 수 있습니다.
        </p>
      </div>
    </PageScaffold>
  );
}
