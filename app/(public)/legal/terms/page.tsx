import type { ReactNode } from "react";
import Link from "next/link";
import { LegalDocLayout, LegalList, LegalSection } from "@/components/legal/LegalDocLayout";
import { COMPANY } from "@/lib/legal/companyInfo";

export const metadata = {
  title: "이용약관",
  description: "쌤버십 서비스 이용약관입니다.",
};

export default function LegalTermsPage() {
  return (
    <LegalDocLayout
      title="이용약관"
      intro={
        <>
          본 약관은 {COMPANY.name}(이하 &lsquo;회사&rsquo;)이 제공하는 구독형 질문 멘토링·교육형 커뮤니티 서비스
          &lsquo;{COMPANY.serviceName}&rsquo;(이하 &lsquo;서비스&rsquo;)의 이용 조건과 절차, 회사와 회원 간의 권리·의무 및
          책임사항을 규정합니다.
        </>
      }
    >
      <LegalSection title="제1조 (목적)">
        <p>
          본 약관은 회사가 제공하는 서비스를 이용함에 있어 회사와 회원 간의 권리·의무 및 책임사항, 서비스 이용 조건과
          절차 등 기본적인 사항을 규정하는 것을 목적으로 합니다.
        </p>
      </LegalSection>

      <LegalSection title="제2조 (정의)">
        <LegalList
          items={[
            <><strong>회원</strong>: 본 약관에 동의하고 회사와 이용계약을 체결하여 서비스를 이용하는 자를 말하며, 역할에 따라 &lsquo;학생&rsquo;과 &lsquo;멘토&rsquo;로 구분됩니다.</>,
            <><strong>학생</strong>: 멘토를 구독하거나 질문을 등록하여 학습 지원을 받는 회원을 말합니다.</>,
            <><strong>멘토</strong>: 회사의 검증 절차를 거쳐 학생에게 질문 답변·학습 피드백 등을 제공하는 현직 대학생 회원을 말합니다.</>,
            <><strong>캐시</strong>: 서비스 내 결제에 사용하는 선불 전자적 지급수단으로, 1캐시는 1원에 해당합니다.</>,
            <><strong>구독</strong>: 학생이 특정 멘토의 질문방을 정기 결제로 이용하는 서비스를 말합니다.</>,
            <><strong>질문방·개별질문·맞춤의뢰·커뮤니티</strong>: 회사가 서비스 내에서 제공하는 각 기능을 말하며, 세부 이용 방법은 각 화면의 안내에 따릅니다.</>,
            <><strong>콘텐츠</strong>: 회원이 서비스에 게시·전송한 질문·답변·연결노트·게시물·영상·첨부파일 등 일체의 자료를 말합니다.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="제3조 (약관의 게시와 개정)">
        <LegalList
          items={[
            "회사는 본 약관의 내용을 회원이 쉽게 확인할 수 있도록 서비스 화면에 게시합니다.",
            "회사는 관련 법령을 위배하지 않는 범위에서 본 약관을 개정할 수 있으며, 개정 시 적용일자와 개정 사유를 명시하여 적용일 7일 전(회원에게 불리하거나 중대한 변경은 30일 전)부터 공지합니다.",
            "회원이 개정 약관의 적용일 이후에도 서비스를 계속 이용하는 경우 개정 약관에 동의한 것으로 봅니다. 개정 약관에 동의하지 않는 회원은 이용계약을 해지할 수 있습니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제4조 (이용계약의 성립 및 계정)">
        <LegalList
          items={[
            "이용계약은 회원이 되고자 하는 자가 본 약관에 동의하고 회사가 정한 절차에 따라 가입을 신청하면, 회사가 이를 승낙함으로써 성립합니다.",
            "만 14세 미만의 아동은 서비스에 가입할 수 없으며, 미성년자는 법정대리인의 동의를 받아야 합니다.",
            <>계정은 본인 명의로만 이용하여야 하며, 회원은 계정 정보를 제3자에게 양도·대여할 수 없습니다. 계정 관리 소홀로 발생한 책임은 회원에게 있습니다. 관련 안내는 <PolicyLink href="/legal/minor-consent">만 14세 미만 보호자 동의</PolicyLink> 페이지를 참고하십시오.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="제5조 (서비스의 제공)">
        <p>회사는 다음의 서비스를 제공합니다.</p>
        <LegalList
          items={[
            "멘토 찾기: 검증된 멘토 프로필의 열람·검색",
            "질문방(구독): 구독한 멘토에게 질문을 누적하고 답변·연결노트로 학습을 관리하는 기능",
            "개별질문: 멘토를 지정하거나 공개하여 건별로 질문을 등록하는 기능",
            "커뮤니티: 게시판·숏폼 등 교육형 콘텐츠 열람·작성 기능",
            "맞춤의뢰: 학습 자료 정리·피드백 등 멘토에게 작업을 의뢰하는 기능",
            "캐시: 서비스 결제를 위한 캐시 충전·사용·조회 기능",
          ]}
        />
        <p>
          회사는 운영상·기술상 필요에 따라 제공하는 서비스의 내용을 변경할 수 있으며, 무료로 제공되는 서비스의 일부 또는
          전부를 회사의 정책에 따라 수정·중단할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제6조 (캐시)">
        <LegalList
          items={[
            "캐시는 1캐시당 1원의 가치를 가지는 선불 지급수단이며, 회원은 회사가 정한 방법으로 캐시를 충전하여 서비스 결제에 사용할 수 있습니다.",
            "충전한 캐시의 미사용분은 환불받을 수 있으며, 무상으로 지급된 캐시(이벤트·프로모션 등)는 환불 대상에서 제외됩니다. 자세한 내용은 환불 정책에 따릅니다.",
            "캐시의 사용 내역은 캐시 원장에서 확인할 수 있습니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제7조 (구독)">
        <LegalList
          items={[
            <>구독 요금제는 <strong>베이직(주 4회)</strong>, <strong>스탠다드(주 9회, 추천)</strong>, <strong>프리미엄(공정 사용 정책, FUP)</strong>으로 구성되며, 요금과 주간 질문 한도는 멘토별 설정 및 구독 화면의 안내에 따릅니다.</>,
            "구독은 결제일을 기준으로 갱신되며, 회원은 다음 결제일 전까지 언제든지 해지할 수 있습니다.",
            "주간 질문 한도는 구독 플랜에 따라 적용되며, 프리미엄의 공정 사용 정책(FUP)은 통상적인 학습 이용 범위를 초과하는 과도한 사용을 제한하기 위한 기준입니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제8조 (수수료 및 정산)">
        <LegalList
          items={[
            <>회사는 멘토에게 지급되는 대금에서 서비스 운영을 위한 플랫폼 수수료를 공제합니다. 수수료율은 <strong>구독 15%, 개별질문 15%, 맞춤의뢰 5%</strong>이며, 이에 따라 멘토는 각각 대금의 <strong>85% · 85% · 95%</strong>를 수령합니다.</>,
            "정산 예정 금액·정산 내역은 멘토 정산 화면에서 확인할 수 있으며, 정산 주기·방법은 회사의 정산 정책에 따릅니다.",
            <>멘토 정산에 관한 자세한 안내는 <PolicyLink href="/legal/payout-guide">정산 안내</PolicyLink> 페이지를 참고하십시오.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="제9조 (회원의 의무 및 금지행위)">
        <p>회원은 다음 각 호의 행위를 하여서는 안 됩니다.</p>
        <LegalList
          items={[
            <>세부능력 및 특기사항(세특)·자기소개서 등 학교 제출용 문서의 <strong>대필·대행</strong>. 서비스는 소재 정리·문장/구조 피드백 등 코칭 범위로 제한되며, 제출용 완성본 대필은 금지됩니다(<PolicyLink href="/legal/no-ghostwriting">대필 금지 정책</PolicyLink>).</>,
            <>거래 성립 전 카카오·전화·SNS 등 <strong>외부 연락처의 교환</strong> 및 플랫폼 외부 거래 유도(<PolicyLink href="/legal/no-offplatform-contact">외부 연락처 교환 금지</PolicyLink>).</>,
            <>타인의 저작권 등 권리를 침해하거나 출처를 표기하지 않은 콘텐츠의 게시(<PolicyLink href="/legal/copyright">저작권·업로드 가이드</PolicyLink>).</>,
            <>혐오·불법·광고성 스팸 등 <PolicyLink href="/legal/community-guidelines">커뮤니티 이용규칙</PolicyLink>에 위반되는 콘텐츠의 게시.</>,
            "타인의 명의·계정 도용, 서비스 운영을 방해하는 행위, 관련 법령·본 약관·이용안내를 위반하는 행위.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제10조 (콘텐츠의 권리 및 관리)">
        <LegalList
          items={[
            "회원이 서비스에 게시한 콘텐츠의 저작권은 해당 회원에게 귀속됩니다. 다만 회사는 서비스의 운영·개선·홍보를 위해 필요한 범위에서 콘텐츠를 사용할 수 있습니다.",
            "회사는 회원의 콘텐츠가 관련 법령 또는 본 약관·운영정책에 위반된다고 판단되는 경우 사전 통지 없이 게시 중단·삭제·비공개 처리할 수 있으며, 위반 정도에 따라 이용을 제한할 수 있습니다.",
            "질문·답변 메시지 및 첨부는 기록 보존을 위해 수정·삭제가 제한될 수 있습니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제11조 (결제 및 환불)">
        <p>
          유료 서비스의 결제는 회사가 제공하는 결제수단(신용카드·간편결제 등) 또는 캐시로 이루어집니다. 결제 유형(구독·개별질문·맞춤의뢰·캐시)별
          환불 조건은 <PolicyLink href="/legal/refund">환불 정책</PolicyLink>에 따르며, 「전자상거래 등에서의 소비자보호에 관한 법률」 등
          관련 법령에서 정한 소비자의 권리는 그대로 보장됩니다.
        </p>
      </LegalSection>

      <LegalSection title="제12조 (이용계약의 해지 및 자격 제한)">
        <LegalList
          items={[
            "회원은 마이페이지 하단 &lsquo;회원 탈퇴&rsquo;를 통해 언제든지 이용계약을 해지할 수 있습니다.",
            "회사는 회원이 본 약관 또는 관련 법령을 위반하는 경우 서비스 이용을 경고·정지하거나 이용계약을 해지할 수 있습니다.",
            "탈퇴 시 회원의 개인정보는 개인정보처리방침에 따라 파기·익명화되며, 법령상 보존 의무가 있는 거래기록은 익명 상태로 별도 보존됩니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제13조 (회사의 책임과 면책)">
        <LegalList
          items={[
            "회사는 멘토와 학생 간 학습 지원이 원활히 이루어지도록 서비스를 제공하는 중개적 지위에 있으며, 멘토가 제공하는 답변·피드백의 정확성·적합성 자체를 보증하지 않습니다.",
            "회사는 천재지변, 회원의 귀책사유, 제3자 서비스(결제·인프라 등)의 장애 등 회사의 통제 범위를 벗어난 사유로 인한 손해에 대하여 책임을 지지 않습니다.",
            "회사는 관련 법령이 허용하는 범위에서 무료로 제공되는 서비스의 이용과 관련하여 발생한 손해에 대해 책임을 지지 않습니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제14조 (준거법 및 관할)">
        <p>
          본 약관은 대한민국 법령에 따라 해석되며, 서비스 이용과 관련하여 회사와 회원 간에 발생한 분쟁에 관한 소송은
          민사소송법상 관할법원(회사의 본점 소재지를 관할하는 법원)에 제기합니다.
        </p>
      </LegalSection>

      <LegalSection title="부칙">
        <p>본 약관은 {COMPANY.effectiveDate}부터 시행합니다.</p>
      </LegalSection>
    </LegalDocLayout>
  );
}

function PolicyLink(props: { href: string; children: ReactNode }) {
  return (
    <Link href={props.href} className="font-semibold text-[#2563EB] hover:underline">
      {props.children}
    </Link>
  );
}
