import type { ReactNode } from "react";
import { BUSINESS_NO, COMPANY } from "@/lib/legal/companyInfo";

/** 법률 문서(약관·방침·정책) 공통 레이아웃 — 제목·시행일·본문·사업자 정보 블록. */
export function LegalDocLayout(props: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header className="border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-black text-slate-900 sm:text-3xl">{props.title}</h1>
        {props.intro ? (
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{props.intro}</p>
        ) : null}
        <p className="mt-3 text-xs font-semibold text-slate-500">시행일: {COMPANY.effectiveDate}</p>
      </header>
      <div className="mt-8 space-y-8">{props.children}</div>
      <LegalCompanyInfo />
    </article>
  );
}

/** 문서 내 조/절 블록. */
export function LegalSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-extrabold text-slate-900">{props.title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{props.children}</div>
    </section>
  );
}

/** 순서 없는 목록(들여쓰기·간격 통일). */
export function LegalList(props: { items: ReactNode[] }) {
  return (
    <ul className="list-outside list-disc space-y-1.5 pl-5">
      {props.items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** 사업자 정보 공통 표기 블록 (문서 하단). */
export function LegalCompanyInfo() {
  return (
    <footer className="mt-10 border-t border-slate-200 pt-6">
      <p className="text-xs font-extrabold text-slate-700">사업자 정보</p>
      <dl className="mt-2 space-y-1 text-xs leading-relaxed text-slate-500">
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-slate-600">상호</dt>
          <dd>{COMPANY.name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-slate-600">사업자등록번호</dt>
          <dd>{BUSINESS_NO}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-slate-600">업종</dt>
          <dd>{COMPANY.industry}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-semibold text-slate-600">고객센터</dt>
          <dd>
            <a href={`mailto:${COMPANY.contactEmail}`} className="font-semibold text-[#2563EB] hover:underline">
              {COMPANY.contactEmail}
            </a>{" "}
            · {COMPANY.supportHours}
          </dd>
        </div>
      </dl>
    </footer>
  );
}
