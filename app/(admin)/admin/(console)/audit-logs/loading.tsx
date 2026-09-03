/** 감사 로그 스켈레톤 — 안내 · 툴바 · 표 윤곽(PR-10). */
export default function AdminAuditLogsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="감사 로그 불러오는 중">
      <header className="border-b border-slate-200 pb-5">
        <div className="h-8 w-28 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      </header>
      <div className="h-11 animate-pulse rounded-xl bg-blue-50" />
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-8 w-64 animate-pulse rounded-lg bg-slate-100" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 w-28 animate-pulse rounded-lg bg-slate-100" />
          ))}
          <div className="ml-auto h-4 w-20 animate-pulse rounded bg-slate-100" />
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="h-10 animate-pulse bg-slate-50" />
        <ul className="divide-y divide-slate-100">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="grid grid-cols-[1.2fr_1fr_1.4fr_1.6fr_1.6fr_0.3fr] gap-3 px-3 py-3">
              {Array.from({ length: 6 }).map((__, j) => (
                <div key={j} className="h-4 animate-pulse rounded bg-slate-100" />
              ))}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
