import type { WalletBalanceBreakdown } from "@/lib/cash/parseWalletBalanceKrw";
import { USER_UI_LOAD_FAILED } from "@/lib/constants/userFacingMessages";

const SIDEBAR_FAQ = [
  {
    q: "캐시는 어디에 사용하나요?",
    a: "멤버십 구독, 맞춤의뢰 결제 등 서비스 이용 시 캐시로 결제할 수 있습니다.",
  },
  {
    q: "캐시 유효기간이 있나요?",
    a: "충전 캐시는 별도 소멸 정책이 적용될 수 있습니다. 소멸 예정 캐시는 좌측에서 확인하세요.",
  },
  {
    q: "환불은 어떻게 하나요?",
    a: "미사용 캐시 환불은 고객센터·분쟁 메뉴를 통해 신청할 수 있습니다.",
  },
] as const;

function fmtCash(n: number): string {
  return `${n.toLocaleString("ko-KR")}캐시`;
}

export function WalletChargeSidebar(props: {
  breakdown: WalletBalanceBreakdown;
  balanceError?: string | null;
  /** 구독 페이지 등: 잔액 카드만 */
  variant?: "full" | "balance-only";
}) {
  const { breakdown, balanceError, variant = "full" } = props;
  const balanceOnly = variant === "balance-only";

  return (
    <aside className="space-y-4 lg:sticky lg:top-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">내 캐시</p>
        {balanceError ? (
          <p className="mt-3 text-xs font-medium text-red-700">{USER_UI_LOAD_FAILED}</p>
        ) : (
          <>
            <p className="mt-2 text-3xl font-black tabular-nums text-slate-900">{fmtCash(breakdown.totalCash)}</p>
            <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">사용 가능 캐시</dt>
                <dd className="font-bold text-slate-800">{fmtCash(breakdown.usableCash)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">보너스 캐시</dt>
                <dd className="font-bold text-emerald-700">{fmtCash(breakdown.bonusCash)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">소멸 예정 캐시</dt>
                <dd className="font-bold text-amber-700">{fmtCash(breakdown.expiringCash)}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      {balanceOnly ? null : (
      <>
      <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5">
        <h2 className="text-sm font-extrabold text-blue-900">충전 혜택</h2>
        <ul className="mt-3 space-y-2 text-xs leading-relaxed text-blue-800">
          <li>
            <span className="font-bold">200,000원</span> 충전 시 <span className="font-bold">+6,000캐시</span> (3% 보너스)
          </li>
          <li>
            <span className="font-bold">300,000원</span> 충전 시 <span className="font-bold">+15,000캐시</span> (5% 보너스)
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-blue-700/90">200,000원 이상 충전 시 보너스 캐시가 추가 지급됩니다.</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-extrabold text-slate-800">자주 묻는 질문</h2>
        <ul className="mt-3 space-y-3">
          {SIDEBAR_FAQ.map((item) => (
            <li key={item.q}>
              <p className="text-xs font-bold text-slate-800">{item.q}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.a}</p>
            </li>
          ))}
        </ul>
      </section>
      </>
      )}
    </aside>
  );
}
