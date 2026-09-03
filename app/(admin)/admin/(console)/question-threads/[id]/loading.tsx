export default function AdminQuestionDrilldownLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="질문 데이터 불러오는 중">
      <div className="border-b border-slate-200 pb-5">
        <div className="h-7 w-64 max-w-full animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-80 max-w-full animate-pulse rounded bg-slate-100" />
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
        <div className="h-5 w-56 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-full max-w-xl animate-pulse rounded bg-slate-100" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl border border-slate-200 bg-white" />
          ))}
        </div>
      </div>
    </div>
  );
}
