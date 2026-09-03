/**
 * 시스템 설정 · 요금제·수수료(읽기 전용) · 정산 설정(읽기 전용) — PR-10 §3-2. Server Component.
 * 값은 화면(page)이 정본(`lib/subscribe/*` · `mentorPayoutsConstants` · DB 함수)에서 읽어 넘기고, 여기서는 그리기만 한다.
 */
import { SETTINGS_READ_ONLY_NOTE, SETTINGS_SCHEDULER_NOTE, formatCash, schedulerStateLabel, schedulerWarning, type SettingsPlanRow } from "@/lib/admin/settingsConsole";

type Props = {
  planRows: SettingsPlanRow[];
  /** `라이트 29,900~69,900 · 스탠다드 84,900~149,900 · 프리미엄 174,900~329,900` — 표의 한 줄 요약 */
  planBandLine: string;
  /** `구독 15% · 개별질문 15% · 맞춤의뢰 5%` */
  feeLine: string;
  /** `한도 50 · 가중치 1.0 / 2.25 / 4.75` */
  capLine: string;
  schedulerEnabled: boolean | null;
  /** `매월 23일` */
  payoutDayLabel: string;
};

const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";
const NOTE = "mt-3 text-[11px] text-slate-500";

function ReadOnlyTag() {
  return <span className="ml-2 rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-extrabold text-slate-600">읽기 전용</span>;
}

export function SettingsPolicyCards({ planRows, planBandLine, feeLine, capLine, schedulerEnabled, payoutDayLabel }: Props) {
  const warning = schedulerWarning(schedulerEnabled);
  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" data-settings-section="plans-fees">
        <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            요금제·수수료
            <ReadOnlyTag />
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50/40">
              <tr>
                <th className={TH}>구독 요금제</th>
                <th className={TH}>주간 질문</th>
                <th className={`${TH} text-right`}>카탈로그 표시가</th>
                <th className={`${TH} text-right`}>멘토 가격 밴드(최소 ~ 최대 · 권장)</th>
              </tr>
            </thead>
            <tbody>
              {planRows.map((r) => (
                <tr key={r.tier} className="border-t border-slate-100" data-settings-plan={r.tier}>
                  <td className={`${TD} font-bold text-slate-900`}>
                    {r.label}
                    {r.recommend ? <span className="ml-2 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-extrabold text-blue-700">추천</span> : null}
                  </td>
                  <td className={TD}>{r.weeklyLabel}</td>
                  <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{formatCash(r.catalogCashKrw)}캐시</td>
                  <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>
                    {formatCash(r.minCashKrw)} ~ {formatCash(r.maxCashKrw)} <span className="text-slate-500">· 권장 {formatCash(r.recommendedCashKrw)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="grid gap-3 border-t border-slate-100 px-5 py-4 text-sm sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <dt className="text-[11px] font-black text-slate-500">구독 요금제(멘토 밴드)</dt>
            <dd className="mt-1 font-bold text-slate-900" data-settings-plan-band-line>
              {planBandLine}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <dt className="text-[11px] font-black text-slate-500">수수료(플랫폼 공제)</dt>
            <dd className="mt-1 font-bold text-slate-900" data-settings-fee-line>
              {feeLine}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <dt className="text-[11px] font-black text-slate-500">정원(cap)</dt>
            <dd className="mt-1 font-bold text-slate-900" data-settings-cap-line>
              {capLine}
            </dd>
          </div>
        </dl>
        <p className={`${NOTE} px-5 pb-4`}>ⓘ {SETTINGS_READ_ONLY_NOTE}</p>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-settings-section="payout">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
          정산 설정
          <ReadOnlyTag />
        </h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <dt className="text-[11px] font-black text-slate-500">자동 정산 스케줄러</dt>
            <dd className="mt-1 font-bold text-slate-900" data-settings-scheduler={schedulerEnabled === null ? "unknown" : schedulerEnabled ? "on" : "off"}>
              {schedulerStateLabel(schedulerEnabled)}
            </dd>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <dt className="text-[11px] font-black text-slate-500">지급일</dt>
            <dd className="mt-1 font-bold text-slate-900">{payoutDayLabel}</dd>
          </div>
        </dl>
        {warning ? (
          <p role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
            ⚠️ {warning}
          </p>
        ) : null}
        <p className={NOTE}>ⓘ {SETTINGS_SCHEDULER_NOTE}</p>
      </section>
    </>
  );
}
