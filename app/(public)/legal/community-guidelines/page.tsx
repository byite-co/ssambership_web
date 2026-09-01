import Link from "next/link";
import { PolicyDraftBanner } from "@/components/legal/PolicyDraftBanner";

export const metadata = {
  title: "커뮤니티 이용규칙",
  description: "쌤버십 게시판·숏폼 커뮤니티의 이용 규칙과 영역별 검수·신고 정책을 안내합니다.",
};

export default function LegalCommunityGuidelinesPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <PolicyDraftBanner />
      <header>
        <h1 className="text-2xl font-black text-slate-900">커뮤니티 이용규칙 (안내 초안)</h1>
        <p className="mt-2 text-sm text-slate-600">게시판과 숏폼은 분리되어 운영되며, 각 영역의 검수·신고 정책을 따릅니다.</p>
      </header>
      <ul className="list-inside list-disc space-y-2 text-sm text-slate-700">
        <li>타인의 권리를 침해하는 콘텐츠, 연락처·광고성 스팸, 혐오·불법 콘텐츠는 제재 대상입니다.</li>
        <li>업로드 시 출처 표기와 권리 확인은 멘토 작성 화면의 필수 절차를 따릅니다.</li>
      </ul>
      <p className="text-sm">
        <Link href="/community" className="font-bold text-blue-700 underline">
          커뮤니티 홈
        </Link>
      </p>
    </div>
  );
}
