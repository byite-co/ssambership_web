/**
 * 환불 목록 빈 상태(PR-3 §6). Server Component.
 *
 * - `first`: 환불 요청이 아직 한 건도 없다(학생 유입 전) — 고장처럼 보이면 안 되므로 처리 순서 3단계를 함께 보인다.
 * - `tab`: 이 탭에 해당하는 건이 없다.
 * - `search`: 검색 조건에 맞는 건이 없다 — 초기화 링크.
 */
import Link from "next/link";
import { EmptyState } from "@/components/common/EmptyState";
import { REFUND_EMPTY_STATE } from "@/lib/admin/refundConsole";

type Props = {
  variant: "first" | "tab" | "search";
  tabLabel: string;
  search: string;
  resetHref: string;
};

export function RefundEmptyState({ variant, tabLabel, search, resetHref }: Props) {
  if (variant === "search") {
    return (
      <EmptyState title="조건에 맞는 환불 요청이 없습니다" description={`'${search}' 검색 결과가 없습니다. 검색어를 바꾸거나 초기화해 주세요.`}>
        <Link href={resetHref} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
          검색 초기화
        </Link>
      </EmptyState>
    );
  }
  if (variant === "tab") {
    return (
      <EmptyState
        title={tabLabel === "대기" ? "대기 중인 환불 요청이 없습니다" : `'${tabLabel}' 상태의 환불 요청이 없습니다`}
        description={tabLabel === "대기" ? "새 요청이 들어오면 이 탭 맨 위에 오래된 것부터 보입니다." : "다른 탭에서 처리된 건을 확인할 수 있습니다."}
      />
    );
  }
  return (
    <div className="space-y-4" data-refund-empty="first">
      <EmptyState title={REFUND_EMPTY_STATE.title} description={REFUND_EMPTY_STATE.description} />
      <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <h3 className="text-sm font-extrabold text-slate-900">{REFUND_EMPTY_STATE.stepsTitle}</h3>
        <ol className="mt-3 space-y-2 text-sm text-slate-700">
          {REFUND_EMPTY_STATE.steps.map((step, i) => (
            <li key={step} className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-black text-white">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
