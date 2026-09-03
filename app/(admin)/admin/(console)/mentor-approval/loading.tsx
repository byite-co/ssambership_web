/** 멘토 승인 작업대 스켈레톤 — 3분할(목록 · 뷰어 · 패널) 윤곽을 그대로 유지한다(PR-2 §9). */
export default function AdminMentorApprovalLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="멘토 승인 화면 불러오는 중">
      <header className="border-b border-slate-200 pb-5">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      </header>
      <div className="grid grid-cols-1 gap-3 lg:h-[calc(100dvh-14rem)] lg:min-h-[600px] lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[300px_minmax(0,1fr)_380px]">
        <div className="hidden rounded-2xl border border-slate-200 bg-white p-3 xl:block">
          <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
          <div className="mt-3 h-8 animate-pulse rounded-lg bg-slate-100" />
          <div className="mt-2 flex gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-6 w-12 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
          <ul className="mt-3 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="space-y-1.5 rounded-lg border border-slate-100 p-2">
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
              </li>
            ))}
          </ul>
        </div>
        <div className="flex min-h-[420px] flex-col gap-2">
          <div className="h-7 w-32 animate-pulse rounded-lg bg-slate-100" />
          <div className="flex-1 animate-pulse rounded-2xl bg-slate-800" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="h-5 w-1/2 animate-pulse rounded bg-slate-200" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-slate-100" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="mt-5 space-y-2">
              <div className="h-4 w-20 animate-pulse rounded bg-slate-200" />
              <div className="h-3 animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
          <div className="mt-8 grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
