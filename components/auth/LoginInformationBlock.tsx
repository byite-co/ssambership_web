import type { ReactNode } from "react";
import {
  FREE_QUESTION_EXPIRY_DAYS,
  FREE_QUESTION_PER_MENTOR_LIMIT,
  FREE_QUESTION_TOTAL_LIMIT,
} from "@/lib/mentor/freeQuestionPolicy";

function Cell({
  title,
  children,
  icon,
  emphasis,
}: {
  title: string;
  children: ReactNode;
  icon: ReactNode;
  /** 첫 칸(안내)을 넓은 카드 느낌으로 */
  emphasis?: "wide";
}) {
  return (
    <li
      className={`flex h-full min-h-0 flex-col gap-2 rounded-2xl border border-sky-200/60 bg-white/95 p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)] sm:min-h-[7.5rem] sm:gap-2.5 sm:rounded-2xl sm:p-5 md:min-h-0 md:gap-3 md:p-6 ${
        emphasis === "wide" ? "md:row-span-1" : ""
      }`}
    >
      <div className="flex items-start gap-3.5 sm:gap-4">
        <span
          className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-200/90 bg-sky-50 text-sky-700 sm:h-12 sm:w-12"
          aria-hidden
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-extrabold tracking-tight text-slate-950 sm:text-[1.02rem] md:text-lg">
            {title}
          </h3>
          <div className="mt-2.5 text-sm font-medium leading-relaxed text-slate-600 sm:mt-3 sm:text-base sm:leading-7">
            {children}
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * 최종 시안: 안내 4칸(무료 질문권 7 / 멘토당 3 / 복수 멘토) — 복제 시안용 노출
 */
export function LoginInformationBlock() {
  return (
    <section
      className="w-full overflow-hidden rounded-2xl border border-slate-200/50 bg-slate-50/95 px-4 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_-10px_rgba(15,23,42,0.08)] sm:rounded-3xl sm:px-6 sm:py-6 md:px-7 md:py-6 lg:px-8"
      aria-label="무료 질문권 안내"
    >
      <div className="mb-4 flex items-center gap-3 border-b border-slate-200/50 pb-4 sm:mb-5 sm:gap-4 sm:pb-4">
        <span
          className="flex h-11 w-11 items-center justify-center rounded-full border border-sky-200/90 bg-sky-100 text-sm font-extrabold text-sky-800 sm:h-12 sm:w-12"
          aria-hidden
        >
          i
        </span>
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-slate-950 sm:text-2xl md:text-[1.4rem]">
          이용 안내
        </h2>
      </div>
      <ol className="grid list-none grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4 md:grid-cols-2 md:gap-4 lg:grid-cols-4">
        <Cell
          emphasis="wide"
          title="안내 사항"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-sky-600" aria-hidden>
              <path
                d="M12 2v4M12 18v4M2 12h4M18 12h4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
              <circle cx="12" cy="12" r="3.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          }
        >
          학생·멘토 유형에 따라 화면·기능이 달라집니다. 아래는 무료 질문권이 어떻게 쓰이는지 요약이에요. 자세한 조건은 약관·정책·요금
          안내를 봐 주세요.
        </Cell>
        <Cell
          title={`무료 질문권 ${FREE_QUESTION_TOTAL_LIMIT}장 제공`}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-sky-600" aria-hidden>
              <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M4 9h16" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          }
        >
          회원가입·정책이 정한 절차를 완료하면, 안내에 따라{" "}
          <strong className="font-extrabold text-slate-800">{FREE_QUESTION_TOTAL_LIMIT}장</strong>이 부여돼요. 가입 후{" "}
          {FREE_QUESTION_EXPIRY_DAYS}일간 사용할 수 있어요.
        </Cell>
        <Cell
          title="한 멘토당 최대 3개 질문"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-sky-600" aria-hidden>
              <path
                d="M7 4h4l1 1h4a2 2 0 0 1 2 2v1a2 2 0 0 0 2 2H6a2 2 0 0 0-2 2v3H4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
          }
        >
          무료 질문권을 쓰는 <strong className="font-extrabold text-slate-800">같은 멘토</strong>에게는, 무료로 남기는
          질문을 최대 3개까지 쓸 수 있어요.
        </Cell>
        <Cell
          title="여러 멘토에게 사용 가능"
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-sky-600" aria-hidden>
              <path
                d="M8.5 12a2.5 2.5 0 1 0 0-5.1 2.5 2.5 0 0 0 0 5zM3 19.5v-1.2A4.2 4.2 0 0 1 6.2 15h4.1"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
              <path
                d="M16 9.2a2.5 2.5 0 1 0-2-4.6L14 4.2M13 20h-1.5v-1.1A4.2 4.2 0 0 1 14.3 16"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        >
          {FREE_QUESTION_TOTAL_LIMIT}장은 <strong className="font-extrabold text-slate-800">다른 멘토들</strong>에게로 나누어 쓰며, 한 멘토당
          {FREE_QUESTION_PER_MENTOR_LIMIT}개 한도는 멘토마다 별도로 집계돼요.
        </Cell>
      </ol>
    </section>
  );
}
