"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { COMPANY } from "@/lib/legal/companyInfo";

export type FaqItem = { id: string; question: string; answer: ReactNode };

export function SupportFaqAccordion(props: { items: FaqItem[] }) {
  const [openId, setOpenId] = useState<string | null>(props.items[0]?.id ?? null);

  return (
    <div className="space-y-2">
      {props.items.map((item) => {
        const open = openId === item.id;
        return (
          <div key={item.id} className="rounded-2xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : item.id)}
              className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left sm:px-5"
              aria-expanded={open}
            >
              <span className="text-sm font-extrabold text-slate-900">{item.question}</span>
              <span className="shrink-0 text-lg leading-none text-slate-400" aria-hidden>
                {open ? "−" : "+"}
              </span>
            </button>
            {open ? (
              <div className="border-t border-slate-100 px-4 pb-4 pt-3 text-sm leading-relaxed text-slate-700 sm:px-5 sm:pb-5">
                {item.answer}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function SupportContactSection() {
  return (
    <section id="contact" className="scroll-mt-8 rounded-2xl border border-slate-200 bg-slate-50/80 p-5 sm:p-6">
      <h2 className="text-lg font-extrabold text-slate-900">1:1 문의 · 고객센터</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        계정·결제·이용 문의는 아래 이메일로 보내 주세요. 영업일 기준 순차 답변드립니다.
      </p>
      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="font-extrabold text-slate-800">이메일</dt>
          <dd className="mt-0.5">
            <a
              href={`mailto:${COMPANY.contactEmail}`}
              className="font-semibold text-[#2563EB] hover:underline"
            >
              {COMPANY.contactEmail}
            </a>
          </dd>
        </div>
        <div>
          <dt className="font-extrabold text-slate-800">운영 시간</dt>
          <dd className="mt-0.5 text-slate-600">{COMPANY.supportHours} · 답변은 순차 처리됩니다</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-slate-500">
        환불·분쟁 관련 정책은{" "}
        <Link href="/legal/refund" className="font-bold text-[#2563EB] hover:underline">
          환불 정책
        </Link>
        을 참고해 주세요.
      </p>
    </section>
  );
}
