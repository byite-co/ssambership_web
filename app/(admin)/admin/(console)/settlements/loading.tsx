/** 정산 관리 스켈레톤 — 안내 · 탭 · 합계 카드 4개 · 표 윤곽(PR-9). */
export default function AdminSettlementsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="정산 관리 화면 불러오는 중">
      <header className="border-b border-slate-200 pb-5">
        <div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      </header>
      <div className="h-11 animate-pulse rounded-xl bg-blue-50" />
      <div className="flex gap-1 border-b border-slate-200 pb-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-7 w-24 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="h-5 w-64 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="mt-4 h-16 animate-pulse rounded-xl bg-slate-50" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="h-10 animate-pulse bg-slate-50" />
        <ul className="divide-y divide-slate-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="grid grid-cols-[1.5fr_2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-3 py-3">
              {Array.from({ length: 8 }).map((__, j) => (
                <div key={j} className="h-4 animate-pulse rounded bg-slate-100" />
              ))}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
