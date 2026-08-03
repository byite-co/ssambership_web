import Link from "next/link";
import { LegalDocLayout, LegalList, LegalSection } from "@/components/legal/LegalDocLayout";
import {
  COMPANY,
  PRIVACY_ANNOUNCED_DATE,
  PRIVACY_EFFECTIVE_DATE,
  PROCESSORS,
} from "@/lib/legal/companyInfo";

export const metadata = {
  title: "개인정보처리방침",
  description: "쌤버십 개인정보처리방침입니다.",
};

export default function LegalPrivacyPage() {
  return (
    <LegalDocLayout
      title="개인정보처리방침"
      effectiveDate={PRIVACY_EFFECTIVE_DATE}
      intro={
        <>
          {COMPANY.name}(이하 &lsquo;회사&rsquo;)은 「개인정보 보호법」 등 관련 법령을 준수하며, 이용자의 개인정보를 보호하기
          위해 다음과 같이 개인정보처리방침을 수립·공개합니다.
        </>
      }
    >
      <LegalSection title="제1조 (수집하는 개인정보 항목)">
        <p>회사는 서비스 제공을 위해 다음의 최소한의 개인정보를 수집합니다.</p>
        <LegalList
          items={[
            <><strong>회원 공통(필수)</strong>: 이메일, 비밀번호(암호화 저장), 닉네임, 역할(학생/멘토), 서비스 이용기록</>,
            <><strong>학생(선택)</strong>: 학년 등 학습 지원에 필요한 정보</>,
            <><strong>멘토(필수)</strong>: 대학명·학과·담당 과목 등 프로필 정보, 재학 확인을 위한 학생증 이미지</>,
            <><strong>이용자 작성 콘텐츠(필수)</strong>: 게시글, 질문, 답변, 첨부파일 등 이용자가 서비스에 작성·업로드하는 콘텐츠</>,
            <><strong>사진·카메라 접근(선택)</strong>: 이미지 업로드 시 이용자가 직접 선택하거나 촬영한 사진(권한을 거부해도 이미지 업로드 외의 기능은 이용할 수 있습니다)</>,
            <><strong>결제 시</strong>: 결제 승인 정보·결제 내역(카드번호 등 민감 결제정보는 결제대행사가 처리하며 회사는 저장하지 않습니다)</>,
            <><strong>자동 생성·수집</strong>: 접속 로그, 기기·브라우저 정보, 서비스 이용 중 생성되는 정산·캐시 원장 등 거래기록</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="제2조 (개인정보의 수집·이용 목적)">
        <LegalList
          items={[
            "회원 식별·인증 및 계정 관리, 멘토 자격 검증",
            "질문방·개별질문·맞춤의뢰·커뮤니티 등 서비스 제공, 학생·멘토 간 매칭 및 연결",
            "이용자가 작성한 게시글·질문·답변의 저장 및 표시",
            "캐시 충전·결제·환불·정산 등 요금 처리",
            "고객 문의 대응, 공지·중요 안내 전달",
            "부정 이용 방지, 분쟁 조정, 서비스 안정성 확보 및 관련 법령상 의무 이행",
          ]}
        />
      </LegalSection>

      <LegalSection title="제3조 (개인정보의 보유 및 이용기간)">
        <p>
          회사는 원칙적으로 회원 탈퇴 시 개인정보를 지체 없이 파기하거나 익명화합니다. 이용자 작성 콘텐츠는 탈퇴 시 다음과
          같이 처리됩니다.
        </p>
        <LegalList
          items={[
            "첨부파일·이미지: 탈퇴 처리 완료 시 지체 없이 삭제합니다 (탈퇴 요청 후 30분 이내에는 탈퇴를 취소할 수 있습니다)",
            "게시글·질문·답변 본문: 작성자 정보를 익명 처리하여 작성자를 식별할 수 없는 상태로 보존됩니다",
          ]}
        />
        <p>다만 관련 법령에 따라 보존이 필요한 경우 아래 기간 동안 해당 정보를 보관합니다.</p>
        <LegalList
          items={[
            "계약 또는 청약철회 등에 관한 기록: 5년 (전자상거래 등에서의 소비자보호에 관한 법률)",
            "대금결제 및 재화 등의 공급에 관한 기록: 5년 (동법)",
            "소비자의 불만 또는 분쟁처리에 관한 기록: 3년 (동법)",
            "서비스 접속 기록: 3개월 (통신비밀보호법)",
          ]}
        />
        <p>
          위 거래기록(결제·캐시 원장·정산·주문 등)은 개인을 식별할 수 없도록 익명 처리한 상태로 보존됩니다.
        </p>
      </LegalSection>

      <LegalSection title="제4조 (개인정보의 제3자 제공)">
        <p>
          회사는 이용자의 개인정보를 본 방침에서 고지한 범위를 넘어 제3자에게 제공하지 않습니다. 다만 이용자가 사전에
          동의한 경우 또는 법령에 따라 요구되는 경우에 한하여 제공할 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제5조 (개인정보 처리의 위탁)">
        <p>회사는 원활한 서비스 제공을 위해 다음과 같이 개인정보 처리 업무를 위탁하고 있습니다.</p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[420px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-600">
                <th className="py-2 pr-4 font-semibold">수탁업체</th>
                <th className="py-2 font-semibold">위탁 업무</th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map((p) => (
                <tr key={p.name} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-4 font-medium text-slate-800">{p.name}</td>
                  <td className="py-2 text-slate-600">{p.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500">
          회사는 위탁계약 시 개인정보가 안전하게 처리되도록 관련 법령에 따라 필요한 사항을 규정하고 관리·감독합니다.
        </p>
      </LegalSection>

      <LegalSection title="제6조 (이용자 및 법정대리인의 권리와 행사 방법)">
        <LegalList
          items={[
            "이용자는 언제든지 자신의 개인정보를 조회·수정할 수 있으며, 마이페이지에서 정보 수정 및 회원 탈퇴(개인정보 삭제)를 요청할 수 있습니다.",
            "만 14세 미만 아동의 법정대리인은 아동의 개인정보에 대한 열람·정정·삭제·처리정지를 요구할 수 있습니다.",
            <>개인정보 관련 권리 행사는 아래 문의처(<a href={`mailto:${COMPANY.contactEmail}`} className="font-semibold text-[#2563EB] hover:underline">{COMPANY.contactEmail}</a>)를 통해서도 요청할 수 있으며, 회사는 지체 없이 조치합니다.</>,
          ]}
        />
      </LegalSection>

      <LegalSection title="제7조 (개인정보의 파기 절차 및 방법)">
        <LegalList
          items={[
            "보유기간이 경과하거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다.",
            "전자적 파일 형태의 정보는 복구·재생이 불가능한 방법으로 삭제하며, 법령상 보존이 필요한 정보는 개인을 식별할 수 없도록 익명 처리하여 분리 보관합니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제8조 (개인정보의 안전성 확보 조치)">
        <LegalList
          items={[
            "비밀번호 등 인증정보의 암호화 저장 및 전송 구간 암호화",
            "데이터베이스 접근 권한 통제 및 행 수준 보안(RLS) 등 접근 제어",
            "비정상 접근 탐지·차단 및 접속기록의 보관·점검",
          ]}
        />
      </LegalSection>

      <LegalSection title="제9조 (만 14세 미만 아동의 개인정보)">
        <p>
          서비스는 만 14세 미만 아동의 회원가입을 허용하지 않으며, 미성년자의 경우 법정대리인의 동의를 받아 가입·이용하도록
          합니다. 관련 안내는 <Link href="/legal/minor-consent" className="font-semibold text-[#2563EB] hover:underline">만 14세 미만 보호자 동의</Link> 페이지를 참고하십시오.
        </p>
      </LegalSection>

      <LegalSection title="제10조 (쿠키 등 자동 수집 장치의 운영)">
        <p>
          회사는 로그인 세션 유지 등 서비스 제공에 필요한 범위에서 쿠키·세션 등 자동 수집 장치를 사용합니다. 이용자는
          브라우저 설정을 통해 쿠키 저장을 거부할 수 있으나, 이 경우 로그인 등 일부 서비스 이용이 제한될 수 있습니다.
        </p>
      </LegalSection>

      <LegalSection title="제11조 (개인정보 보호 문의)">
        <p>
          개인정보 처리에 관한 문의·불만·피해구제는 아래 창구로 접수하실 수 있으며, 회사는 신속하고 충분하게 답변·처리하겠습니다.
        </p>
        <LegalList
          items={[
            <>개인정보 문의: <a href={`mailto:${COMPANY.contactEmail}`} className="font-semibold text-[#2563EB] hover:underline">{COMPANY.contactEmail}</a></>,
            "기타 개인정보 침해에 대한 신고·상담은 개인정보분쟁조정위원회(1833-6972), 개인정보침해신고센터(118), 대검찰청(1301), 경찰청(182) 등에 문의할 수 있습니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제12조 (개인정보처리방침의 변경)">
        <p>
          본 방침은 {PRIVACY_ANNOUNCED_DATE} 공지되어 {PRIVACY_EFFECTIVE_DATE}부터 적용되며, 시행일 전까지는 종전 방침(
          {COMPANY.effectiveDate} 시행)이 적용됩니다. 법령·서비스의 변경에 따라 내용이 추가·삭제·수정되는 경우 변경 사항을
          시행 최소 7일 전부터 공지사항을 통해 고지합니다.
        </p>
      </LegalSection>
    </LegalDocLayout>
  );
}
