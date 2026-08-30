import { redirect } from "next/navigation";
import Link from "next/link";
import { requireWalletChargeAccess } from "@/lib/auth/routeGuard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { PAYSYNC_INVOICE_COLUMNS, type PaysyncInvoiceRow } from "@/lib/paysync/paysyncInvoiceService";
import { PaysyncPendingView } from "@/components/cash/PaysyncPendingView";

// 무통장입금 안내 화면 (§5). 입금 계좌는 env 가 정본이다(서버 전용 — 클라이언트로는
// 값만 내려간다). 상태 폴링은 클라이언트가 router.refresh() 로 이 서버 컴포넌트를
// 다시 가져오는 방식이라 별도 API 표면을 만들지 않는다.

export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function one(sp: Record<string, string | string[] | undefined>, key: string): string | null {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.length > 0 ? s : null;
}

export default async function WalletChargePendingPage({ searchParams }: Props) {
  const { user } = await requireWalletChargeAccess();
  const sp = (await searchParams) ?? {};
  const localId = one(sp, "id");
  if (!localId) redirect("/wallet/charge");

  const admin = createServiceRoleClient();
  const { data } = await admin
    .from("paysync_invoices")
    .select(PAYSYNC_INVOICE_COLUMNS)
    .eq("id", localId)
    .eq("user_id", user.id) // 본인 주문만
    .maybeSingle();

  if (!data) {
    return (
      <div className="min-h-screen bg-white px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[720px] rounded-2xl border border-[#e2e8f2] bg-white p-6 text-center">
          <p className="text-sm font-extrabold text-slate-700">입금 주문을 찾을 수 없습니다.</p>
          <Link
            href="/wallet/charge"
            className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-[#1d4ed8]"
          >
            충전 화면으로
          </Link>
        </div>
      </div>
    );
  }

  const invoice = data as PaysyncInvoiceRow;

  return (
    <div className="min-h-screen bg-white px-4 py-8 antialiased sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[720px]">
        <header>
          <span className="inline-block rounded-full bg-[#e9f0ff] px-3.5 py-1.5 text-[13px] font-extrabold text-[#2563EB]">
            무통장입금
          </span>
          <h1 className="mt-3 text-[clamp(1.35rem,2.5vw,1.75rem)] font-extrabold leading-tight tracking-[-0.03em] text-[#0f172a]">
            입금 안내
          </h1>
        </header>

        <div className="mt-5">
          <PaysyncPendingView
            localId={invoice.id}
            payKrw={invoice.pay_krw}
            cashKrw={invoice.cash_krw}
            bonusKrw={invoice.bonus_krw}
            depositorName={invoice.depositor_name}
            status={invoice.status}
            expiresAt={invoice.expires_at}
            bankName={process.env.PAYSYNC_DEPOSIT_BANK_NAME ?? "-"}
            accountNumber={process.env.PAYSYNC_DEPOSIT_ACCOUNT_NUMBER ?? "-"}
            accountHolder={process.env.PAYSYNC_DEPOSIT_ACCOUNT_HOLDER ?? "-"}
            notice={one(sp, "notice")}
            credited={one(sp, "credited")}
            error={one(sp, "error")}
          />
        </div>
      </div>
    </div>
  );
}
