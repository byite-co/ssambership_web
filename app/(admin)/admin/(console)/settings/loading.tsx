/** 시스템 설정 스켈레톤 — 섹션 카드 4개 윤곽(PR-10). */
export default function AdminSettingsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="시스템 설정 불러오는 중">
      <header className="border-b border-slate-200 pb-5">
        <div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      </header>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="h-11 animate-pulse bg-slate-50" />
          <ul className="divide-y divide-slate-100">
            {Array.from({ length: 3 }).map((__, j) => (
              <li key={j} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 px-3 py-3">
                {Array.from({ length: 4 }).map((___, k) => (
                  <div key={k} className="h-4 animate-pulse rounded bg-slate-100" />
                ))}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
