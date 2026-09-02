/** 환불 상세 스켈레톤 — 헤더(제목·우상단 버튼) · 경고 배너 · 2열 카드 윤곽(PR-3). */
export default function AdminRefundDetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="환불 상세 불러오는 중">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="h-8 w-72 animate-pulse rounded bg-slate-200" />
          <div className="mt-2 h-4 w-56 animate-pulse rounded bg-slate-100" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-24 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-11 w-20 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-11 w-20 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </header>
      <div className="h-11 animate-pulse rounded-xl bg-amber-50" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 4 }).map((__, j) => (
                <div key={j} className="h-3.5 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
