export default function AdminDisputesListLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="분쟁 목록 불러오는 중">
      <div className="space-y-2 border-b border-slate-200 pb-5">
        <div className="h-8 w-24 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="h-8 w-1/2 animate-pulse rounded bg-slate-100" />
        <div className="flex gap-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-6 w-16 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
      <div className="h-72 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />
    </div>
  );
}
