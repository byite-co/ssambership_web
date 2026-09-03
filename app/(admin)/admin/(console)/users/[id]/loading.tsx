export default function AdminAccountDetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="계정 상세 불러오는 중">
      <div className="border-b border-slate-200 pb-5">
        <div className="h-7 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-72 max-w-full animate-pulse rounded bg-slate-100" />
      </div>
      <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-slate-100" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      </div>
      <div className="flex gap-1">
        {[0, 1].map((i) => (
          <div key={i} className="h-7 w-20 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      ))}
    </div>
  );
}
