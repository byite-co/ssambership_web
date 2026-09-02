"use client";

/**
 * 표 래퍼(제목 + 건수 칩 + overflow) — 맞춤의뢰 주문 목록(custom-request-orders)만 쓴다.
 * PR-4 이전에는 `AdminDataTable` 이라는 이름이었으나, 그 이름은 멘토 승인·환불 목록 공용 부품
 * (`components/admin/AdminDataTable.tsx`)이 가져갔다. 개명만 했고 렌더 결과는 그대로다.
 */
import type { ReactNode } from "react";

type Props = {
  title?: string;
  count?: number;
  filters?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

export function AdminTableCard(props: Props) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {(props.title || props.filters) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
          <div className="flex items-center gap-2">
            {props.title ? <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">{props.title}</h2> : null}
            {props.count != null ? (
              <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-bold text-[#2563EB]">{props.count}건</span>
            ) : null}
          </div>
          {props.filters}
        </div>
      )}
      <div className="overflow-x-auto">{props.children}</div>
      {props.footer ? <div className="border-t border-slate-100 px-5 py-3">{props.footer}</div> : null}
    </section>
  );
}
