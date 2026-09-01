import Link from "next/link";
import { PolicyDraftBanner } from "@/components/legal/PolicyDraftBanner";

export const metadata = {
  title: "저작권·업로드 가이드",
  description: "쌤버십 게시글·영상 업로드 시 지켜야 할 저작권 원칙과 원 출처·이용 권한 표기 기준을 안내합니다.",
};

export default function LegalCopyrightPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <PolicyDraftBanner />
      <header>
        <h1 className="text-2xl font-black text-slate-900">저작권·업로드 가이드 (안내 초안)</h1>
        <p className="mt-2 text-sm text-slate-600">게시·영상에는 원 출처와 이용 권한을 명시해야 합니다.</p>
      </header>
      <ul className="list-inside list-disc space-y-2 text-sm text-slate-700">
        <li>제3자 창작물은 허용 범위 내에서만 인용·게시합니다.</li>
        <li>출처 미표기·무단 복제로 인한 분쟁은 작성자 책임으로 처리될 수 있습니다.</li>
      </ul>
      <p className="text-sm">
        <Link href="/legal/community-guidelines" className="font-bold text-blue-700 underline">
          커뮤니티 이용규칙
        </Link>
      </p>
    </div>
  );
}
