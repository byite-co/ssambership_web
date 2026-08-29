import {
  requestMentorTerminationAction,
  requestMentorPauseAction,
  resumeMentorActivityAction,
} from "@/lib/mentor/mentorActivityActions";
import {
  mentorActivityState,
  MENTOR_MAX_PAUSE_DAYS,
  type MentorActivityInfo,
} from "@/lib/mentor/mentorActivity";
// TZ-FIX R3 #23: 로컬 fmt 제거 — KST 달력 날짜 정본 위임.
import { formatKoreanDate } from "@/lib/utils/formatDisplay";

export function MentorActivityControls(props: {
  info: MentorActivityInfo & { termination_effective_at?: string | null; pause_reason?: string | null };
  flashOk?: string | null;
  flashErr?: string | null;
}) {
  const { info, flashOk, flashErr } = props;
  const state = mentorActivityState(info);

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-black text-slate-900">활동 관리</h2>
        <span
          className={[
            "rounded-lg border px-2.5 py-1 text-xs font-bold",
            state === "active"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : state === "paused"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-red-200 bg-red-50 text-red-700",
          ].join(" ")}
        >
          {state === "active"
            ? "활동 중"
            : state === "paused"
              ? `일시 휴식${info.pause_until ? ` (~${formatKoreanDate(info.pause_until)})` : ""}`
              : state === "terminating"
                ? `활동 종료 예정${info.termination_effective_at ? ` (${formatKoreanDate(info.termination_effective_at)})` : ""}`
                : "활동 종료됨"}
        </span>
      </div>

      {flashOk ? (
        <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-900">
          {flashErr}
        </p>
      ) : null}

      {state === "active" ? (
        <div className="grid items-stretch gap-4 md:grid-cols-2">
          {/* 일시 중단 */}
          <form action={requestMentorPauseAction} className="flex h-full flex-col rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <p className="text-xs font-extrabold text-slate-800">일시 중단 (최대 {MENTOR_MAX_PAUSE_DAYS}일)</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              <span className="md:hidden">쉰 기간만큼 구독이 자동 연장돼요.</span>
              <span className="hidden md:inline">시험기간엔 학생 질문이 가장 많습니다. 가능하면 시험기간 휴식은 피해주세요. 쉰 기간만큼 구독자 기간이 자동 연장됩니다.</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-[11px] font-bold text-slate-600">
                일수
                <input
                  type="number"
                  name="days"
                  min={1}
                  max={MENTOR_MAX_PAUSE_DAYS}
                  defaultValue={MENTOR_MAX_PAUSE_DAYS}
                  className="ml-1 w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                />
              </label>
              <label className="text-[11px] font-bold text-slate-600">
                사유
                <select name="reason" defaultValue="rest" className="ml-1 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                  <option value="rest">일반 휴식 (6개월 1회)</option>
                  <option value="illness">질병 등 (관리자 확인)</option>
                </select>
              </label>
            </div>
            <button type="submit" className="mt-auto w-full rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600">
              일시 중단 신청
            </button>
          </form>

          {/* 완전 종료 */}
          <form action={requestMentorTerminationAction} className="flex h-full flex-col rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <p className="text-xs font-extrabold text-slate-800">활동 종료 (2주 사전 공지)</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              <span className="md:hidden">2주 뒤 정리·남은 기간 100% 환불돼요.</span>
              <span className="hidden md:inline">신청 즉시 신규 구독이 중단되고, 2주 뒤 기존 구독이 정리되며 남은 기간은 100% 환불됩니다. 유예 기간 동안에는 학생 질문에 계속 응대해 주세요.</span>
            </p>
            <button type="submit" className="mt-auto w-full rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white hover:bg-slate-900">
              활동 종료 신청
            </button>
          </form>
        </div>
      ) : state === "paused" ? (
        <form action={resumeMentorActivityAction} className="rounded-xl border border-amber-100 bg-amber-50/60 p-4">
          <p className="text-xs leading-relaxed text-amber-800">
            <span className="md:hidden">복귀일이 지나면 자동 재개돼요.</span>
            <span className="hidden md:inline">
              현재 일시 휴식 중입니다{info.pause_until ? ` (복귀 예정 ${formatKoreanDate(info.pause_until)})` : ""}. 복귀 예정일이 지나면 자동으로 활동이 재개됩니다.
            </span>
          </p>
          <button type="submit" className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700">
            지금 바로 복귀하기
          </button>
        </form>
      ) : (
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <p className="text-xs leading-relaxed text-slate-600">
            {state === "terminating" ? (
              <>
                <span className="md:hidden">종료 예정 · 유예 동안 응대 부탁드려요.</span>
                <span className="hidden md:inline">
                  활동 종료가 예약되어 신규 구독을 받지 않습니다{info.termination_effective_at ? ` (${formatKoreanDate(info.termination_effective_at)} 정리 예정)` : ""}. 유예 기간 동안 학생 응대를 부탁드려요.
                </span>
              </>
            ) : (
              "활동이 종료되었습니다. 재개가 필요하면 관리자에게 문의해 주세요."
            )}
          </p>
        </div>
      )}
    </section>
  );
}
