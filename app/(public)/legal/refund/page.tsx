import Link from "next/link";
import { LegalDocLayout, LegalList, LegalSection } from "@/components/legal/LegalDocLayout";
import { COMPANY } from "@/lib/legal/companyInfo";

export const metadata = {
  title: "환불 정책",
  description: "쌤버십 캐시·구독·개별질문·맞춤의뢰 환불 정책입니다.",
};

export default function LegalRefundPage() {
  return (
    <LegalDocLayout
      title="환불 정책"
      intro={
        <>
          {COMPANY.serviceName}의 결제는 캐시·구독·개별질문·맞춤의뢰로 구분되며, 결제 유형에 따라 환불 조건이 다릅니다. 본
          정책은 「전자상거래 등에서의 소비자보호에 관한 법률」 등 관련 법령을 준수하며, 법령이 보장하는 소비자의 권리를
          제한하지 않습니다.
        </>
      }
    >
      <LegalSection title="제1조 (캐시 충전 환불)">
        <LegalList
          items={[
            "유상으로 충전한 캐시 중 사용하지 않은 잔액은 환불받을 수 있습니다.",
            "이벤트·프로모션 등으로 무상 지급된 캐시(보너스 캐시)는 환불 대상에서 제외됩니다.",
            "충전 후 미사용 캐시의 환불은 관련 법령이 정한 기간(최대 5년) 내에 신청할 수 있으며, 환불 시 결제대행사·약관에 따른 수수료가 공제될 수 있습니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제2조 (구독 환불)">
        {/* 환불 산정 기준의 정본은 서버 계산(학원법 시행령 별표 4 분기형)이다 — 웹 lib/subscribe/subscriptionRefundProration.ts ·
            DB core_private.subscription_refund_estimate_impl(SQL 200 · api_app_v1.refund_estimate). 숫자·구간을 바꿀 때는 정본과 함께 바꾼다. */}
        <LegalList
          items={[
            "정기 구독은 다음 결제일 전까지 해지를 예약할 수 있으며, 해지 시 다음 회차부터 결제가 중단됩니다. 이미 결제된 회차의 구독은 환불을 신청하지 않는 한 잔여 기간 동안 계속 이용할 수 있습니다.",
            <>
              이미 결제된 회차의 환불을 원하는 경우 구독 관리 화면 또는 고객센터의 환불 신청 화면에서 환불을 신청할 수 있습니다. 환불 금액은 「학원의 설립·운영 및
              과외교습에 관한 법률 시행령」 별표 4의 교습비 반환 기준을 준용하여, 해당 회차의 결제 금액과 결제 기간의 경과 정도에 따라
              다음과 같이 산정합니다.
              <div className="mt-1.5">
                <LegalList
                  items={[
                    "이용 개시 전(해당 결제 기간에 질문방에 질문을 등록하지 않은 경우): 결제 금액 전액",
                    "이용 개시 후 결제 기간의 1/3이 지나기 전: 결제 금액의 2/3",
                    "결제 기간의 1/2이 지나기 전: 결제 금액의 1/2",
                    "결제 기간의 1/2이 지난 후: 환불 없음",
                  ]}
                />
              </div>
            </>,
            "환불 금액은 신청 시점을 기준으로 산정되어 고정되며, 회사의 검토·승인 후 환불됩니다. 환불 신청이 접수된 구독은 처리가 끝날 때까지 새 질문 등록이 제한될 수 있습니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제3조 (개별질문 환불)">
        <LegalList
          items={[
            "개별질문 결제 금액은 멘토 답변 완료 시점까지 안전하게 예치(에스크로)됩니다.",
            "멘토가 답변을 완료하기 전에 취소하는 경우 예치 금액은 전액 환불됩니다.",
            "멘토의 답변이 완료된 이후에는 용역이 제공된 것으로 보아 환불이 제한됩니다. 답변에 관한 이의는 고객센터를 통해 접수하여 별도 심사를 거칠 수 있습니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제4조 (맞춤의뢰 환불)">
        <LegalList
          items={[
            "맞춤의뢰 대금은 결제 시 예치(에스크로)되며, 멘토의 납품과 학생의 수락을 거쳐 정산됩니다.",
            "납품 전 또는 분쟁 발생 시에는 주문 상태·진행 단계에 따라 분쟁 조정을 거쳐 환불 여부와 범위가 결정됩니다.",
            "학생이 납품물을 수락하여 정산이 완료된 이후에는 환불이 제한됩니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제5조 (환불 신청 방법 및 처리)">
        <LegalList
          items={[
            <>환불은 마이페이지의 해당 결제·주문 내역에서 요청하거나, 고객센터 이메일(<a href={`mailto:${COMPANY.contactEmail}`} className="font-semibold text-[#2563EB] hover:underline">{COMPANY.contactEmail}</a>)로 신청할 수 있습니다.</>,
            "환불 승인 시 원결제수단으로의 취소 또는 캐시 반환의 방법으로 처리되며, 통상 영업일 기준 3~5일 이내에 처리됩니다. 카드 취소 반영 시점은 카드사 정책에 따라 달라질 수 있습니다.",
            "회원의 귀책사유(약관·운영정책 위반 등)로 인한 이용 제한·해지의 경우 환불이 제한될 수 있습니다.",
          ]}
        />
      </LegalSection>

      <LegalSection title="제6조 (청약철회의 제한)">
        <p>
          「전자상거래 등에서의 소비자보호에 관한 법률」 제17조에 따라, 이미 제공이 완료된 용역 또는 디지털 콘텐츠(멘토
          답변·납품물 등)에 대하여는 소비자의 청약철회가 제한될 수 있습니다. 이 경우 회사는 청약철회가 제한된다는 사실을
          결제 과정에서 안내합니다.
        </p>
      </LegalSection>

      <LegalSection title="문의">
        <p>
          환불·결제 관련 분쟁이나 문의는{" "}
          <Link href="/support#contact" className="font-semibold text-[#2563EB] hover:underline">
            고객센터
          </Link>
          로 접수해 주시면 순차적으로 안내드립니다.
        </p>
      </LegalSection>
    </LegalDocLayout>
  );
}
