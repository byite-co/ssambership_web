"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * 정산 데이터 로드 실패 화면 — fail-closed. RPC 오류·스키마 위반 시 0 을 렌더하지 않고
 * 이 화면만 그린다(PR #75 zero-row 무음 흡수 패턴 재발 금지).
 */
export function MentorSettlementLoadError() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-6">
      <header className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">멘토 정산</h1>
      </header>
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-red-200 bg-red-50/60 px-6 py-16 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
          <TriangleAlert className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <p className="text-base font-extrabold text-red-900">정산 정보를 불러오지 못했습니다</p>
          <p className="mt-1 text-sm text-red-800/80">잠시 후 다시 시도해 주세요.</p>
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => router.refresh())}
          className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-800 hover:bg-red-50 disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          {isPending ? "다시 불러오는 중…" : "다시 시도"}
        </button>
      </div>
    </div>
  );
}
