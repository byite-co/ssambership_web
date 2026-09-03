/**
 * [멘토별] 탭(PR-9 §1-4) — 닉네임 검색 → 멘토 선택 → 그 멘토의 정산 항목 전체(구독·개별질문·맞춤의뢰). Server Component, 조회 전용.
 * `mentor_settlement_lines` RPC 는 auth.uid() 고정이라 관리자가 부를 수 없어 원천 테이블을 읽는다(조회 모듈 주석).
 */
import Link from "next/link";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { accountDetailPath } from "@/lib/admin/accountDetailConsole";
import {
  SETTLEMENT_TAB_PARAM,
  buildSettlementUrl,
  formatSettlementWon,
  mentorLineStatusLabel,
  mentorLineStatusTone,
  summarizeMentorLines,
} from "@/lib/admin/settlementConsole";
import type { MentorSettlementLoad, SettlementMentorSearchHit } from "@/lib/admin/settlementConsoleQueries";
import { settlementFeeRateLabel } from "@/lib/payout/settlementFeeRate";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { cn } from "@/lib/utils/cn";

type Props = {
  q: string;
  search: { hits: SettlementMentorSearchHit[]; error: string | null };
  selected: MentorSettlementLoad | null;
  selectedId: string | null;
};

const TH = "px-3 py-2 text-left text-[11px] font-black uppercase tracking-wide text-slate-500";
const TD = "px-3 py-2.5 align-top text-xs text-slate-800";
const NUM = "whitespace-nowrap text-right tabular-nums";

export function SettlementMentorPanel({ q, search, selected, selectedId }: Props) {
  const mentor = selected?.mentor ?? null;
  const summary = selected ? summarizeMentorLines(selected.lines) : null;

  return (
    <div className="space-y-4" data-settlement-mentor-panel>
      <form action="/admin/settlements" method="GET" className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3" role="search">
        <input type="hidden" name={SETTLEMENT_TAB_PARAM} value="mentor" />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="멘토 닉네임 · 이름 · 이메일"
          autoComplete="off"
          aria-label="멘토 검색"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-sm"
        />
        <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
          검색
        </button>
        {q ? (
          <Link href={buildSettlementUrl({ tab: "mentor" })} className="text-xs font-bold text-blue-700 hover:underline" prefetch={false}>
            초기화
          </Link>
        ) : null}
      </form>

      {search.error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          {search.error}
        </p>
      ) : q && search.hits.length === 0 ? (
        <EmptyState title="검색 결과가 없습니다" description={`'${q}' 에 맞는 멘토가 없습니다. 닉네임·이름·이메일로 다시 검색해 주세요.`} />
      ) : search.hits.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white" aria-label="검색된 멘토">
          {search.hits.map((h) => (
            <li key={h.id} className={cn("flex items-center justify-between gap-3 px-4 py-2.5 text-sm", h.id === selectedId ? "bg-blue-50/60" : "")}>
              <span className="min-w-0 truncate">
                <span className="font-extrabold text-slate-900">{h.name}</span>
                {h.email ? <span className="ml-2 text-xs text-slate-500">{h.email}</span> : null}
              </span>
              <Link href={buildSettlementUrl({ tab: "mentor", mentor: h.id, q })} className="shrink-0 text-xs font-extrabold text-blue-700 hover:underline" prefetch={false}>
                정산 항목 보기
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {selectedId && selected && !mentor && !selected.error ? (
        <EmptyState title="멘토를 찾을 수 없습니다" description="계정이 없거나 탈퇴한 사용자입니다." />
      ) : null}

      {selected && mentor && summary ? (
        <section className="space-y-3" aria-label={`${mentor.name} 정산 항목`} data-settlement-mentor-lines={mentor.id}>
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-slate-900">
                  <Link href={accountDetailPath(mentor.id)} className="hover:underline" prefetch={false}>
                    {mentor.name}
                  </Link>
                </h2>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">
                  {mentor.email ?? "이메일 없음"} · 정산 계좌{" "}
                  {mentor.accountRegistered ? <span className="text-slate-700">{mentor.accountDisplay}</span> : <span className="font-black text-amber-800">미등록 — 지급 보류</span>}
                </p>
              </div>
              <Link href={accountDetailPath(mentor.id)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50" prefetch={false}>
                계정 상세
              </Link>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              {[
                ["지급 대기", `${summary.pendingCount}건 · ${formatSettlementWon(summary.pendingCents)}`],
                ["적립중", `${summary.accruingCount}건 · ${formatSettlementWon(summary.accruingCents)}`],
                ["보류", `${summary.heldCount}건 · ${formatSettlementWon(summary.heldCents)}`],
                ["지급 완료", `${summary.paidCount}건 · ${formatSettlementWon(summary.paidCents)}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <dt className="font-bold text-slate-500">{label}</dt>
                  <dd className="mt-0.5 font-black tabular-nums text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {selected.error ? (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-900">
              {selected.error}
            </p>
          ) : null}

          {selected.lines.length === 0 ? (
            <EmptyState title="정산 항목이 없습니다" description="이 멘토에게 구독·개별질문·맞춤의뢰 정산 항목이 아직 없습니다." />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-slate-50/40">
                  <tr>
                    <th className={TH}>발생일</th>
                    <th className={TH}>항목</th>
                    <th className={cn(TH, "text-right")}>결제액</th>
                    <th className={cn(TH, "text-right")}>수수료(요율)</th>
                    <th className={cn(TH, "text-right")}>멘토 정산금</th>
                    <th className={TH}>상태</th>
                    <th className={TH}>지급일</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((l) => (
                    <tr key={l.key} className="border-t border-slate-100" data-settlement-line={l.key}>
                      <td className={cn(TD, "whitespace-nowrap")}>{formatKoreanDate(l.occurredAt)}</td>
                      <td className={TD}>
                        <span className="font-semibold">{l.description}</span>
                        {l.holdReason ? <span className="ml-1 text-[11px] text-amber-800">({l.holdReason})</span> : null}
                      </td>
                      <td className={cn(TD, NUM)}>{formatSettlementWon(l.grossCents)}</td>
                      <td className={cn(TD, NUM)}>
                        {formatSettlementWon(l.platformFeeCents)} <span className="text-slate-400">({settlementFeeRateLabel(l.feeRate)})</span>
                      </td>
                      <td className={cn(TD, NUM, "font-black text-slate-900")}>{formatSettlementWon(l.mentorCents)}</td>
                      <td className={TD}>
                        <StatusBadge label={mentorLineStatusLabel(l.status)} tone={mentorLineStatusTone(l.status)} size="sm" />
                      </td>
                      <td className={cn(TD, "whitespace-nowrap")}>{l.paidRunDate ?? (l.paidAt ? formatKoreanDate(l.paidAt) : "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {!q && !selectedId ? <EmptyState title="멘토를 검색해 주세요" description="닉네임·이름·이메일로 찾은 멘토의 정산 항목 전체(구독·개별질문·맞춤의뢰)를 봅니다. 계정 상세 멘토 탭의 '정산 항목 보기'로도 올 수 있습니다." /> : null}
    </div>
  );
}
