/** 환불 관리 목록 스켈레톤 — 경고 배너 · 툴바 · 표 윤곽을 그대로 유지한다(PR-3). */
export default function AdminRefundsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="환불 관리 화면 불러오는 중">
      <header className="border-b border-slate-200 pb-5">
        <div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      </header>
      <div className="h-11 animate-pulse rounded-xl bg-amber-50" />
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="h-8 w-72 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-4 w-28 animate-pulse rounded bg-slate-100" />
        </div>
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-6 w-14 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="h-10 animate-pulse bg-slate-50" />
        <ul className="divide-y divide-slate-100">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="grid grid-cols-[2rem_1.5fr_1fr_1fr_2fr_1.2fr_0.8fr_1.2fr_1fr] gap-3 px-3 py-3">
              {Array.from({ length: 9 }).map((__, j) => (
                <div key={j} className="h-4 animate-pulse rounded bg-slate-100" />
              ))}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
