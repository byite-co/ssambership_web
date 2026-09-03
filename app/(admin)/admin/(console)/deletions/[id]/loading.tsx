/** 탈퇴 요청 상세 스켈레톤 — 타임라인 · 처리 상태 카드 윤곽(PR-13). */
export default function AdminAccountDeletionJobLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="탈퇴 요청 상세 불러오는 중">
      <header className="border-b border-slate-200 pb-5">
        <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
        <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-slate-100" />
      </header>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
