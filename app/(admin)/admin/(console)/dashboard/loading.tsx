/** 대시보드 스켈레톤 — 오늘 할 일 8칸 · 현황 · 최근 활동 윤곽(PR-12). */
export default function AdminDashboardLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="대시보드 불러오는 중">
      <header className="border-b border-slate-200 pb-5">
        <div className="h-8 w-28 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      </header>
      <section>
        <div className="h-4 w-20 animate-pulse rounded bg-slate-200" />
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
              <div className="mt-3 h-8 w-10 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      </section>
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
        <div className="h-4 w-12 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="h-12 animate-pulse bg-slate-50" />
        <ul className="divide-y divide-slate-100">
          {Array.from({ length: 6 }).map((_, i) => (
            <li key={i} className="grid grid-cols-[160px_140px_1fr_1.2fr] gap-3 px-5 py-3">
              {Array.from({ length: 4 }).map((__, j) => (
                <div key={j} className="h-4 animate-pulse rounded bg-slate-100" />
              ))}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
