"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { recentMentorCount } from "@/lib/mentor/recentMentorsStorage";

export function MentorsListQuickLinks(props: { favoriteCount: number }) {
  const [recentCount, setRecentCount] = useState(0);

  useEffect(() => {
    // 최근 본 목록은 localStorage(클라이언트 전용)라 마운트 후에만 읽는다(SSR 하이드레이션 안전).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentCount(recentMentorCount());
  }, []);

  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {/* P2-27: 두 퀵링크가 동일 URL(view=list)이던 문제 수정. 목적별 scope 로 분기.
          recent=클라이언트 localStorage 최근 본 목록, favorite=서버 찜 조회. */}
      <Link
        href="/mentors?scope=recent"
        className="inline-flex min-h-[44px] items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 hover:bg-slate-50 sm:px-4 sm:text-sm"
      >
        최근 본 멘토 {recentCount}
      </Link>
      <Link
        href="/mentors?scope=favorite"
        className="inline-flex min-h-[44px] items-center rounded-xl border border-[#2563EB]/30 bg-blue-50/50 px-3 text-xs font-extrabold text-[#2563EB] hover:bg-blue-50 sm:px-4 sm:text-sm"
      >
        찜한 멘토 {props.favoriteCount}
      </Link>
    </div>
  );
}
