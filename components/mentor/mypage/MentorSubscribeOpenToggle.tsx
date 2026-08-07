import { setMentorSubscribeOpenAction } from "@/lib/mentor/mentorSubscribeOpenActions";

/**
 * 멘토 self "신규 구독 받기 / 그만 받기" 토글.
 * 표시·flag 쓰기만 — 기존 학생 구독·정산·환불·cap 과 무관.
 *
 * D-MT-9: `available=false`(조회 실패로 현재 상태 확정 불가)면 fail-closed 표시 +
 * 토글 비활성 + 재시도 안내. 확정하지 못한 상태에서 토글을 눌러 잘못된 값으로 덮어쓰는 것을 막는다.
 */
export function MentorSubscribeOpenToggle({ open, available = true }: { open: boolean; available?: boolean }) {
  if (!available) {
    return (
      <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <h2 className="text-sm font-black text-amber-900">신규 구독 받기</h2>
        <p className="mt-1 text-xs font-medium leading-relaxed text-amber-800">
          구독 받기 설정을 불러오지 못했어요. 새 학생 유입을 막기 위해 잠시 마감으로 표시하고 있어요.
          잠시 후 새로고침해 다시 확인해 주세요.
        </p>
      </section>
    );
  }
  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-slate-900">신규 구독 받기</h2>
          <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
            {open ? (
              <>
                <span className="md:hidden">정원 안에서 새 학생을 받는 중이에요.</span>
                <span className="hidden md:inline">현재 신규 구독을 받는 중이에요. 정원 안에서 새 학생이 구독할 수 있어요.</span>
              </>
            ) : (
              "신규 구독을 받지 않는 중 · 기존 학생 구독은 그대로 유지돼요."
            )}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-bold ${
            open
              ? "border-emerald-200 bg-emerald-50 text-[#059669]"
              : "border-slate-200 bg-slate-50 text-slate-600"
          }`}
        >
          {open ? "받는 중" : "마감"}
        </span>
      </div>
      <form action={setMentorSubscribeOpenAction} className="mt-3">
        <input type="hidden" name="open" value={open ? "false" : "true"} />
        <button
          type="submit"
          className={
            open
              ? "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              : "w-full rounded-lg bg-[#059669] px-3 py-2 text-xs font-bold text-white hover:bg-[#047857]"
          }
        >
          {open ? "신규 구독 그만 받기" : "신규 구독 받기"}
        </button>
      </form>
    </section>
  );
}
