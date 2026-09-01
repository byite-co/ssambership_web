import { PolicyDraftBanner } from "@/components/legal/PolicyDraftBanner";

export const metadata = {
  title: "외부 연락처 교환 금지 정책",
  description: "맞춤의뢰에서 멘토 선택·거래 성립 전 카카오·전화·SNS 등 외부 연락처 교환을 허용하지 않는 기준을 안내합니다.",
};

export default function LegalNoOffplatformContactPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <PolicyDraftBanner />
      <header>
        <h1 className="text-2xl font-black text-slate-900">외부 연락처 교환 금지 (맞춤의뢰)</h1>
        <p className="mt-2 text-sm text-slate-600">멘토가 선택되고 거래가 성립하기 전에는 카카오·전화·SNS 등 외부 연락처 교환을 허용하지 않습니다.</p>
      </header>
      <p className="text-sm leading-relaxed text-slate-700">
        플랫폼 내 메시지와 주문 흐름을 사용해 주세요. 위반 탐지·제재 로직은 백엔드 연동 시 강화됩니다.
      </p>
      <p className="text-sm text-slate-500">
        <span className="font-bold text-slate-700">맞춤의뢰</span>는 곧 오픈 예정입니다.
      </p>
    </div>
  );
}
