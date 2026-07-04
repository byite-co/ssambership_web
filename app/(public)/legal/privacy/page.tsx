import Link from "next/link";
import { PolicyDraftBanner } from "@/components/legal/PolicyDraftBanner";

export default function LegalPrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <PolicyDraftBanner />
      <header>
        <h1 className="text-2xl font-black text-slate-900">개인정보처리방침 (안내 초안)</h1>
        <p className="mt-2 text-sm text-slate-600">수집 항목·보관 기간·제3자 제공은 실제 서비스 오픈 전 확정 고지로 갱신됩니다.</p>
      </header>
      <ul className="list-inside list-disc space-y-2 text-sm text-slate-700">
        <li>회원가입·로그인·결제·문의 처리에 필요한 최소 범위의 정보를 처리할 수 있습니다.</li>
        <li>알림·로그는 보안·분쟁 대응 목적의 보관 정책을 따릅니다.</li>
        <li>
          탈퇴 시 개인정보는 익명화하며, 전자상거래·세법상 거래기록(결제·캐시 원장·정산·주문)은 익명 상태로 별도
          보존합니다. 탈퇴는 마이페이지 하단 &lsquo;회원 탈퇴&rsquo;에서 직접 진행할 수 있습니다.
        </li>
      </ul>
      <p className="text-sm">
        <Link href="/legal/terms" className="font-bold text-blue-700 underline">
          이용약관
        </Link>
      </p>
    </div>
  );
}
