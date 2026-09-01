import Link from "next/link";
import { PolicyDraftBanner } from "@/components/legal/PolicyDraftBanner";

export const metadata = {
  title: "세특·자소서 대필 금지 정책",
  description: "쌤버십은 학교 제출용 문서의 대필·대행을 제공하지 않습니다. 멘토링 운영 범위와 그 경계를 안내합니다.",
};

export default function LegalNoGhostwritingPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <PolicyDraftBanner />
      <header>
        <h1 className="text-2xl font-black text-slate-900">세특·자소서 대필 금지 (운영 범위)</h1>
        <p className="mt-2 text-sm text-slate-600">학교 제출용 문서의 대필·대행은 제공하지 않습니다.</p>
      </header>
      <ul className="list-inside list-disc space-y-2 text-sm text-slate-700">
        <li>허용: 소재 정리, 문장·구조 피드백, 논리 흐름 코멘트 등 코칭 범위.</li>
        <li>금지: 제출용 최종본 작성 대행, 학교 서식에 맞춘 완성 대필.</li>
      </ul>
      <p className="text-sm">
        <Link href="/legal/terms" className="font-bold text-blue-700 underline">
          이용약관
        </Link>
      </p>
    </div>
  );
}
