import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { FREE_QUESTION_POLICY_SHORT } from "@/lib/mentor/freeQuestionPolicy";
import { formatIndividualQuestionPrice } from "@/lib/individualQuestion/individualQuestionFormat";

const GUARANTEES = [
  { label: "안전한 연결", desc: "검증된 멘토와만 연결" },
  { label: "검증된 멘토", desc: "학교·본인 인증 절차" },
  { label: "안심 결제", desc: "캐시 기반 구독 결제" },
  { label: "환불 보장", desc: "정책에 따른 환불 지원" },
] as const;

export function MentorDetailCTASection(props: {
  mentorName: string;
  mentorId: string;
  subscribeHref: string;
  freeQuestionHref: string;
  individualQuestionHref: string;
  freeQuestionRemaining?: number | null;
  subscriptionClosed?: boolean;
  individualQuestionPriceCents?: number | null;
}) {
  const freeLabel =
    props.freeQuestionRemaining != null
      ? `무료 질문권 사용하기 [${props.freeQuestionRemaining}]`
      : "무료 질문 7개 받기";

  return (
    <section className="overflow-hidden rounded-2xl border border-[#2563EB]/20 bg-gradient-to-br from-blue-50 via-sky-50/80 to-white p-6 sm:p-8">
      <h2 className="text-center text-xl font-black text-slate-900 sm:text-2xl">
        지금 <span className="text-[#2563EB]">{props.mentorName}</span> 멘토와 함께 공부를 시작하세요!
      </h2>
      <p className="mt-2 text-center text-sm font-medium text-slate-600">
        궁금한 건 바로 질문하고, 성장해요.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
        {props.subscriptionClosed ? (
          <span className="inline-flex min-h-[52px] cursor-not-allowed items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-8 text-sm font-extrabold text-slate-400">
            구독 마감
          </span>
        ) : (
          <Link
            href={props.subscribeHref}
            className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-[#2563EB] px-8 text-sm font-extrabold text-white shadow-md transition hover:bg-[#1D4ED8]"
          >
            구독하기
          </Link>
        )}
        <Link
          href={props.freeQuestionHref}
          className="inline-flex min-h-[52px] items-center justify-center rounded-xl border-2 border-[#2563EB] bg-white px-8 text-sm font-extrabold text-[#2563EB] transition hover:bg-blue-50/50"
        >
          {freeLabel}
        </Link>
        {props.individualQuestionPriceCents ? (
          <Link
            href={props.individualQuestionHref}
            className="inline-flex min-h-[52px] items-center justify-center rounded-xl border-2 border-emerald-500 bg-white px-8 text-sm font-extrabold text-emerald-700 transition hover:bg-emerald-50/50"
          >
            개별 질문하기 · {formatIndividualQuestionPrice(props.individualQuestionPriceCents)}
          </Link>
        ) : (
          <span className="inline-flex min-h-[52px] cursor-not-allowed items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-8 text-sm font-extrabold text-slate-400">
            이 멘토는 개별 질문을 받지 않아요
          </span>
        )}
      </div>

      <p className="mt-4 text-center text-xs font-medium text-slate-600">{FREE_QUESTION_POLICY_SHORT}</p>

      <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {GUARANTEES.map((g) => (
          <li
            key={g.label}
            className="flex flex-col items-center rounded-xl border border-white/80 bg-white/70 px-2 py-3 text-center shadow-sm"
          >
            <ShieldCheck className="h-5 w-5 text-[#2563EB]" aria-hidden />
            <p className="mt-1.5 text-[11px] font-black text-slate-900">{g.label}</p>
            <p className="mt-0.5 text-[10px] font-medium text-slate-500">{g.desc}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
