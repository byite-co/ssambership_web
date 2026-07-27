import Link from "next/link";
import type { MentorsListScope } from "@/lib/mentor/mentorsListSearchParams";

// P2-27: scope 배너(찜/최근) + 전체 보기 복귀. 서버 컴포넌트(정적 표시).
export function MentorsScopeBanner(props: { scope: Exclude<MentorsListScope, "all">; count?: number }) {
  const label = props.scope === "favorite" ? "찜한 멘토" : "최근 본 멘토";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#2563EB]/20 bg-blue-50/40 px-4 py-2.5">
      <p className="text-sm font-extrabold text-[#2563EB]">
        {label}
        {typeof props.count === "number" ? ` ${props.count}` : ""}
      </p>
      <Link href="/mentors" className="text-xs font-bold text-slate-600 underline hover:text-slate-900">
        전체 멘토 보기
      </Link>
    </div>
  );
}

export function MentorsScopeLoginNeeded() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
      <p className="text-lg font-black text-slate-900">로그인이 필요해요</p>
      <p className="mt-2 text-sm text-slate-600">찜한 멘토는 로그인 후 확인할 수 있어요.</p>
      <Link
        href={`/login?next=${encodeURIComponent("/mentors?scope=favorite")}`}
        className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2563EB] px-5 text-sm font-extrabold text-white hover:bg-[#1D4ED8]"
      >
        로그인하기
      </Link>
    </div>
  );
}

export function MentorsScopeEmptyFavorites() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
      <p className="text-lg font-black text-slate-900">아직 찜한 멘토가 없어요</p>
      <p className="mt-2 text-sm text-slate-600">멘토 카드의 하트를 눌러 찜해두면 여기에 모여요.</p>
      <Link href="/mentors" className="mt-4 inline-block text-sm font-bold text-[#2563EB] underline">
        멘토 둘러보기
      </Link>
    </div>
  );
}
