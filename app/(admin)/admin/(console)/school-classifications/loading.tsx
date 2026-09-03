/** 등급 분류 스켈레톤 — 미분류 표 · 분포 · 규칙 표 윤곽(PR-11). */
export default function AdminSchoolClassificationsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="등급 분류 화면 불러오는 중">
      <header className="border-b border-slate-200 pb-5">
        <div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      </header>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="h-5 w-40 animate-pulse rounded bg-slate-200" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
          <ul className="divide-y divide-slate-100">
            {Array.from({ length: 4 }).map((__, j) => (
              <li key={j} className="grid grid-cols-[1fr_1.2fr_1fr_0.8fr_0.8fr_0.8fr] gap-3 py-3">
                {Array.from({ length: 6 }).map((___, k) => (
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
