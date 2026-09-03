/** 탈퇴 요청 스켈레톤 — 안내 · 툴바 · 표 윤곽(PR-13). */
export default function AdminAccountDeletionsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="탈퇴 요청 화면 불러오는 중">
      <header className="border-b border-slate-200 pb-5">
        <div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      </header>
      <div className="h-11 animate-pulse rounded-xl bg-blue-50" />
      <div className="h-9 animate-pulse rounded-xl bg-slate-100" />
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-6 w-16 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
        <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="h-10 animate-pulse bg-slate-50" />
        <ul className="divide-y divide-slate-100">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="grid grid-cols-[1.2fr_0.6fr_1fr_1fr_1fr_0.5fr_1.4fr_1fr_0.3fr] gap-3 px-3 py-3">
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
