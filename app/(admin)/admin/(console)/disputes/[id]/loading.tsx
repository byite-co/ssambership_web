export default function AdminDisputeDetailLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="분쟁 상세 불러오는 중">
      <div className="space-y-2 border-b border-slate-200 pb-5">
        <div className="h-8 w-2/3 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />
          <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />
          <div className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />
        </div>
        <div className="space-y-4">
          <div className="h-40 animate-pulse rounded-2xl border border-slate-200 bg-slate-50" />
          <div className="h-56 animate-pulse rounded-2xl border border-amber-100 bg-amber-50/50" />
        </div>
      </div>
    </div>
  );
}
