import Link from "next/link";

import { BrandSymbol } from "@/components/brand/BrandLogo";

type LoginPageFooterProps = {
  termsUrl?: string;
  privacyUrl?: string;
  /** 고객센터/문의 페이지 URL. 없으면 비강조 텍스트만 표시 */
  supportUrl?: string;
};

function ShieldCheck({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M12 3.2 19 5.5v4.5c0 3.1-1.5 5.6-3.2 7.1A10.2 10.2 0 0 1 12 20a10.1 10.1 0 0 1-3.8-2.2C6.5 15.6 5 13.1 5 10V5.5L12 3.2Z"
        fill="#d1fae5"
        stroke="#059669"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M9.2 11.3 11.1 13.1 15.1 8.3"
        stroke="#059669"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LoginPageFooter({ termsUrl, privacyUrl, supportUrl }: LoginPageFooterProps) {
  return (
    <footer
      className="mx-auto mt-6 w-full border-t border-slate-200/90 bg-white/80 pt-6 sm:mt-8 sm:pt-7 md:mt-8 md:pt-8"
      role="contentinfo"
      aria-label="로그인 페이지 하단"
    >
      <div className="mx-auto flex w-full flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8 md:gap-10">
        <div className="min-w-0 flex-1">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-lg font-extrabold tracking-[-0.02em] text-slate-950 sm:text-xl"
          >
            <BrandSymbol className="h-7 w-7" />
            쌤버십
          </Link>
          <p className="mt-1 text-sm font-medium text-slate-500 sm:text-base">SsamBership</p>
          <nav
            className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600 sm:mt-4 sm:text-base"
            aria-label="약관·고객"
          >
            {termsUrl ? (
              <a
                className="font-semibold text-slate-700 underline decoration-slate-300/80 underline-offset-[3px] hover:text-slate-900"
                href={termsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                이용약관
              </a>
            ) : (
              <Link className="font-semibold text-slate-700 underline decoration-slate-300/80 underline-offset-[3px] hover:text-slate-900" href="/legal/terms">
                이용약관(안내)
              </Link>
            )}
            <span className="text-slate-300" aria-hidden>
              ·
            </span>
            {privacyUrl ? (
              <a
                className="font-semibold text-slate-700 underline decoration-slate-300/80 underline-offset-[3px] hover:text-slate-900"
                href={privacyUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                개인정보처리방침
              </a>
            ) : (
              <Link
                className="font-semibold text-slate-700 underline decoration-slate-300/80 underline-offset-[3px] hover:text-slate-900"
                href="/legal/privacy"
              >
                개인정보(안내)
              </Link>
            )}
            <span className="text-slate-300" aria-hidden>
              ·
            </span>
            {supportUrl ? (
              <a
                className="font-semibold text-slate-700 underline decoration-slate-300/80 underline-offset-[3px] hover:text-slate-900"
                href={supportUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                고객센터
              </a>
            ) : (
              <Link
                className="font-semibold text-slate-700 underline decoration-slate-300/80 underline-offset-[3px] hover:text-slate-900"
                href="/support#contact"
              >
                고객센터
              </Link>
            )}
          </nav>
        </div>
        <div className="w-full max-w-sm shrink-0 sm:max-w-xs">
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200/80 bg-emerald-50/60 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_20px_-8px_rgba(5,150,105,0.15)] sm:px-4 sm:py-3.5">
            <div className="shrink-0 rounded-lg bg-white p-1.5 shadow-sm" aria-hidden>
              <ShieldCheck className="h-7 w-7 sm:h-8 sm:w-8" />
            </div>
            <div>
              <p className="text-sm font-extrabold text-emerald-950 sm:text-[0.95rem]">안전한 결제 시스템</p>
              <p className="mt-0.5 text-xs font-medium leading-snug text-emerald-900/85 sm:text-[0.8125rem] sm:leading-5">
                결제·정산은 약관·정책·보안 설정에 따릅니다.
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
