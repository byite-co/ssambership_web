/** 공지·이벤트 스켈레톤 — 툴바 · 표 · 폼 윤곽(PR-10). */
export default function AdminNoticesLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="공지·이벤트 화면 불러오는 중">
      <header className="border-b border-slate-200 pb-5">
        <div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      </header>
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
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="grid grid-cols-[2fr_0.8fr_0.8fr_0.8fr_1.6fr_0.8fr_0.5fr] gap-3 px-3 py-3">
              {Array.from({ length: 7 }).map((__, j) => (
                <div key={j} className="h-4 animate-pulse rounded bg-slate-100" />
              ))}
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="h-4 w-20 animate-pulse rounded bg-slate-200" />
        <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-9 animate-pulse rounded-lg bg-slate-100" />
        </div>
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}
