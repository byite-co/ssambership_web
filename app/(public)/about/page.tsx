import Link from "next/link";
import { COMPANY } from "@/lib/legal/companyInfo";

export const metadata = {
  title: "서비스 소개",
  description: "쌤버십은 전국 현직 대학생 멘토와 1:1로 연결되는 구독형 질문 멘토링·교육형 커뮤니티 서비스입니다.",
};

const FEATURES: { title: string; desc: string; href: string; cta: string }[] = [
  {
    title: "멘토 찾기",
    desc: "대학·학과·과목으로 검증된 현직 대학생 멘토를 찾고, 프로필과 후기를 비교해 나에게 맞는 멘토를 선택하세요.",
    href: "/mentors",
    cta: "멘토 둘러보기",
  },
  {
    title: "질문방 구독",
    desc: "멘토를 구독하면 전용 질문방이 열립니다. 질문을 누적하고, 연결노트로 장기적인 학습 흐름을 함께 관리합니다.",
    href: "/subscribe",
    cta: "구독 안내 보기",
  },
  {
    title: "커뮤니티",
    desc: "게시판과 숏폼으로 학습법·내신·진로·대학생활 이야기를 나눕니다. 검증된 멘토들의 교육 콘텐츠를 만나보세요.",
    href: "/community",
    cta: "커뮤니티 가기",
  },
];

const VALUES: { title: string; desc: string }[] = [
  {
    title: "검증된 멘토",
    desc: "재학 확인 등 검증 절차를 거친 현직 대학생만 멘토로 활동합니다.",
  },
  {
    title: "정직한 코칭",
    desc: "세특·자소서 대필은 제공하지 않습니다. 소재 정리·구조·문장 피드백 등 코칭 범위 안에서 스스로의 성장을 돕습니다.",
  },
  {
    title: "안전한 결제",
    desc: "1캐시=1원의 캐시로 결제하며, 개별질문·맞춤의뢰 대금은 완료 시점까지 예치(에스크로)되어 안전하게 정산됩니다.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-14 px-4 py-12 sm:px-6">
      <header className="text-center">
        <p className="text-xs font-extrabold uppercase tracking-wide text-[#2563EB]">서비스 소개</p>
        <h1 className="mt-2 break-keep text-3xl font-black leading-tight text-slate-900 sm:text-4xl">
          현직 대학생 멘토와 1:1로,<br className="hidden sm:block" /> 질문하고 배우고 함께 성장하세요
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
          {COMPANY.serviceName}은 학생이 대학생 멘토를 구독하고, 멘토별 질문방에서 질문을 누적하며, 연결노트로 장기 학습을
          관리받는 <strong className="font-bold text-slate-800">구독형 질문 멘토링·교육형 커뮤니티</strong> 서비스입니다.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/mentors"
            className="rounded-xl bg-[#1A56DB] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#1E40AF]"
          >
            멘토 찾기
          </Link>
          <Link
            href="/subscribe"
            className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-[#2563EB] hover:text-[#2563EB]"
          >
            구독 안내
          </Link>
        </div>
      </header>

      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="text-center text-lg font-extrabold text-slate-900">
          이렇게 이용해요
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-base font-extrabold text-slate-900">{f.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{f.desc}</p>
              <Link href={f.href} className="mt-4 text-sm font-bold text-[#2563EB] hover:underline">
                {f.cta} →
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="values-heading">
        <h2 id="values-heading" className="text-center text-lg font-extrabold text-slate-900">
          쌤버십이 지키는 것
        </h2>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {VALUES.map((v) => (
            <div key={v.title} className="rounded-2xl bg-slate-50 p-5">
              <h3 className="text-sm font-extrabold text-slate-900">{v.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{v.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <h2 className="text-lg font-extrabold text-slate-900">멘토로 함께하고 싶다면</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          검증을 거쳐 멘토로 활동하며 질문 답변·맞춤의뢰로 정산받을 수 있습니다.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-xl bg-[#1A56DB] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#1E40AF]"
          >
            멘토 가입하기
          </Link>
          <Link
            href="/legal/mentor-guide"
            className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-[#2563EB] hover:text-[#2563EB]"
          >
            멘토 가이드
          </Link>
        </div>
      </section>

      <p className="text-center text-sm text-slate-600">
        더 궁금한 점은{" "}
        <Link href="/support" className="font-bold text-[#2563EB] hover:underline">
          자주 묻는 질문 · 고객센터
        </Link>
        에서 확인하세요.
      </p>
    </div>
  );
}
