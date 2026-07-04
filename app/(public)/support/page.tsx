import Link from "next/link";
import { SupportContactSection, SupportFaqAccordion, type FaqItem } from "@/components/support/SupportFaqAccordion";

export const metadata = {
  title: "고객센터 · 자주 묻는 질문",
  description: "쌤버십 이용 FAQ와 1:1 문의 안내입니다.",
};

const FAQ_ITEMS: FaqItem[] = [
  {
    id: "cash",
    question: "캐시는 어떻게 충전하고 사용하나요?",
    answer: (
      <>
        캐시는 구독·맞춤의뢰 등 서비스 결제에 사용하는 선불 잔액입니다. 로그인 후{" "}
        <Link href="/wallet/charge" className="font-bold text-[#2563EB] hover:underline">
          캐시 충전
        </Link>
        메뉴에서 금액을 선택해 충전할 수 있습니다. 사용 내역은 캐시 원장에서 확인할 수 있어요.
      </>
    ),
  },
  {
    id: "subscribe",
    question: "멘토 구독은 어떻게 시작하나요?",
    answer: (
      <>
        <Link href="/mentors" className="font-bold text-[#2563EB] hover:underline">
          멘토 찾기
        </Link>
        에서 관심 있는 멘토를 고른 뒤 구독 플랜을 선택하면 질문방이 열립니다. 플랜별 질문 한도·혜택은{" "}
        <Link href="/subscribe" className="font-bold text-[#2563EB] hover:underline">
          구독 안내
        </Link>
        화면에서 확인해 주세요.
      </>
    ),
  },
  {
    id: "question-limit",
    question: "질문은 얼마나 자주 할 수 있나요?",
    answer: (
      <>
        구독 플랜마다 주간 질문 가능 횟수와 공정 사용(FUP) 기준이 다릅니다. 자세한 한도는 멘토별 구독 화면과
        질문방 안내를 참고해 주세요. 한도는 플랜·멘토 설정에 따라 달라질 수 있습니다.
      </>
    ),
  },
  {
    id: "mentor-answer",
    question: "멘토 답변은 얼마나 걸리나요?",
    answer: (
      <>
        멘토마다 응답 시간이 다릅니다. 질문방에 글을 남기면 멘토가 순차적으로 답변하며, 급한 공지는{" "}
        <Link href="/notices" className="font-bold text-[#2563EB] hover:underline">
          공지사항
        </Link>
        을 확인해 주세요.
      </>
    ),
  },
  {
    id: "free-question",
    question: "무료 질문권이 있나요?",
    answer: (
      <>
        신규 가입·프로모션 등으로 제공되는 무료 질문 혜택은 기간·조건이 있을 수 있습니다. 현재 진행 중인
        이벤트는 공지사항과 멘토 상세 페이지 안내를 확인해 주세요.
      </>
    ),
  },
  {
    id: "refund",
    question: "환불은 어떻게 신청하나요?",
    answer: (
      <>
        구독·맞춤의뢰·캐시는 결제 유형별로 환불 조건이 다릅니다.{" "}
        <Link href="/legal/refund" className="font-bold text-[#2563EB] hover:underline">
          환불 정책
        </Link>
        을 먼저 확인하신 뒤, 필요하면 하단 고객센터 이메일로 문의해 주세요.
      </>
    ),
  },
  {
    id: "account",
    question: "학생·멘토 계정을 바꾸거나 탈퇴하려면?",
    answer: (
      <>
        역할(학생/멘토)은 가입 시 선택하며, 계정 정보 변경은 마이페이지에서 할 수 있습니다. 탈퇴는 마이페이지 하단
        &lsquo;회원 탈퇴&rsquo;에서 직접 할 수 있어요. 거래·정산 기록은 법령에 따라 익명화되어 보존됩니다.
      </>
    ),
  },
  {
    id: "custom-request",
    question: "맞춤의뢰는 어떤 서비스인가요?",
    answer: (
      <>
        학습 자료 정리, 피드백 등 멘토에게 맞춤 작업을 의뢰하는 기능입니다.{" "}
        <span className="font-bold text-slate-700">맞춤의뢰</span>에서 요청을 올리고 멘토 제안을 비교할 수 있어요(곧 오픈 예정). 대필·제출용 대행 등은 허용되지 않습니다.
      </>
    ),
  },
];

export default function SupportPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-10 sm:px-6">
      <header>
        <p className="text-xs font-extrabold uppercase tracking-wide text-[#2563EB]">고객 지원</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900">고객센터</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          자주 묻는 질문을 확인하거나, 문의가 필요하면 아래 연락처로 보내 주세요.
        </p>
      </header>

      <section aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-lg font-extrabold text-slate-900">
          자주 묻는 질문
        </h2>
        <div className="mt-4">
          <SupportFaqAccordion items={FAQ_ITEMS} />
        </div>
      </section>

      <SupportContactSection />
    </div>
  );
}
