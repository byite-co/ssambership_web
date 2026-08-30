import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelPaysyncChargeAction } from "@/lib/paysync/paysyncChargeActions";
import { PAYSYNC_INVOICE_COLUMNS, type PaysyncInvoiceRow } from "@/lib/paysync/paysyncInvoiceService";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";

// 원장 화면의 "진행 중 무통장 주문" 섹션 (§5).
// 서버 컴포넌트다 — 기존 WalletLedgerPageBody(클라이언트)를 건드리지 않고 위에 얹는다.
// 진행 중 주문이 없으면 아무것도 렌더하지 않는다(빈 상태 박스로 화면을 채우지 않는다).

export async function PaysyncPendingLedgerSection({
  admin,
  userId,
}: {
  admin: SupabaseClient;
  userId: string;
}) {
  const { data, error } = await admin
    .from("paysync_invoices")
    .select(PAYSYNC_INVOICE_COLUMNS)
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("issued_at", { ascending: false });

  if (error) {
    console.error("[paysync/ledgerSection]", error.code);
    return null;
  }
  const rows = (data ?? []) as PaysyncInvoiceRow[];
  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-[#fcd34d] bg-[#fffbeb] p-5">
      <h2 className="text-sm font-extrabold text-[#92400e]">진행 중인 무통장입금</h2>
      <p className="mt-1 text-xs font-medium leading-relaxed text-[#a16207]">
        입금이 확인되면 자동으로 캐시가 충전됩니다.
      </p>

      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border border-[#fde68a] bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-base font-black tabular-nums text-[#0f172a]">
                {row.pay_krw.toLocaleString("ko-KR")}원
              </span>
              <span className="text-sm font-bold text-slate-700">
                → {row.cash_krw.toLocaleString("ko-KR")}캐시
              </span>
            </div>
            <dl className="mt-2 grid gap-1 text-xs">
              <div className="flex gap-2">
                <dt className="font-bold text-[#64748B]">입금자명</dt>
                <dd className="font-extrabold text-[#0f172a]">{row.depositor_name}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="font-bold text-[#64748B]">입금 마감</dt>
                <dd className="font-bold text-slate-700">
                  {row.expires_at ? formatKoreanDate(row.expires_at) : "제한 없음"}
                </dd>
              </div>
            </dl>

            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/wallet/charge/pending?id=${encodeURIComponent(row.id)}`}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-extrabold text-white transition hover:bg-[#1d4ed8]"
              >
                입금 안내 보기
              </Link>
              <form action={cancelPaysyncChargeAction}>
                <input type="hidden" name="localId" value={row.id} />
                <button
                  type="submit"
                  className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-[#e2e8f2] bg-white px-4 py-2 text-xs font-extrabold text-slate-700 transition hover:border-[#cbd5e1]"
                >
                  주문 취소
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
