/** SLA 대시보드 스켈레톤 — KPI 3 · 임박순 표 윤곽(PR-12). */
export default function AdminSlaLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="SLA 대시보드 불러오는 중">
      <header className="border-b border-slate-200 pb-5">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
            <div className="mt-3 h-7 w-20 animate-pulse rounded bg-slate-100" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded bg-slate-100" />
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="h-12 animate-pulse bg-slate-50" />
        <ul className="divide-y divide-slate-100">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="grid grid-cols-[0.6fr_2fr_1fr_1.2fr_1fr_0.8fr_0.3fr] gap-3 px-3 py-3">
              {Array.from({ length: 7 }).map((__, j) => (
                <div key={j} className="h-4 animate-pulse rounded bg-slate-100" />
              ))}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
