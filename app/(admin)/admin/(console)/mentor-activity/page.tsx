import { PageScaffold } from "@/components/shell/PageScaffold";
import { loadMentorActivityEvents } from "@/lib/admin/mentorActivityQueries";
import {
  approveMentorAbandonmentHoldAction,
  releaseMentorSettlementHoldAction,
  finalizeMentorTerminationAdminAction,
} from "@/lib/admin/mentorActivityAdminActions";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

function fmt(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return formatKoDateTimeKst(v);
}

const EVENT_LABEL: Record<string, string> = {
  termination_requested: "활동 종료 신청",
  termination_finalized: "활동 종료 정리됨",
  pause_started: "일시 중단 시작",
  pause_resumed: "활동 재개",
  abandonment_suspected: "무단 이탈 의심",
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  logged: { label: "기록", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  pending_review: { label: "검토 대기", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  approved: { label: "보류 확정", cls: "bg-red-50 text-red-700 border-red-200" },
  released: { label: "구제(해제)", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminMentorActivityPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const flashOk = typeof sp.ok === "string" ? sp.ok : null;
  const flashErr = typeof sp.error === "string" ? sp.error : null;

  const { rows, error } = await loadMentorActivityEvents({ limit: 100 });
  const pendingCount = rows.filter((r) => r.status === "pending_review").length;

  return (
    <PageScaffold
      eyebrow="관리자 / 멘토 활동"
      title="멘토 활동 관리"
      description="멘토의 활동 종료·일시 중단·무단 이탈 이벤트를 검토합니다. 무단 이탈 의심 건은 자동으로 0 처리하지 않고 정산을 보류하며, 여기서 보류 확정 또는 구제(해제)를 결정합니다."
      ctas={[
        { href: "/admin/refunds", label: "환불·정산", tone: "blue" },
        { href: "/admin/settlements", label: "정산 관리", tone: "slate" },
        { href: "/admin", label: "대시보드", tone: "slate" },
      ]}
      sections={[
        {
          title: "처리 원칙",
          body: "무단 이탈은 정산 자동 0 처리 금지 — 보류 후 관리자가 최종 확인합니다. 불가피한 사유는 구제로 정산을 복원하세요.",
          status: "connected",
        },
      ]}
      emptyState=""
      dataPoints={[]}
      hideFooterPlaceholderCards
    >
      <div className="mx-auto max-w-6xl space-y-6 pb-12">
        {flashOk ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{flashOk}</p>
        ) : null}
        {flashErr ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">{flashErr}</p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">검토 대기</p>
            <p className="mt-2 text-2xl font-black text-amber-600">{pendingCount}건</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase text-slate-500">전체 이벤트</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{rows.length}건</p>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
            <p className="font-bold">목록을 불러오지 못했습니다.</p>
            <p className="mt-1 text-xs">{error}</p>
          </div>
        ) : !rows.length ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-8 text-center text-sm text-slate-500">
            <p className="font-bold text-slate-700">멘토 활동 이벤트가 아직 없습니다.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/40">
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">멘토</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">이벤트</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">상태</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">발생일</th>
                  <th className="px-5 py-3 text-xs font-bold text-slate-600">처리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const meta = STATUS_META[row.status] ?? STATUS_META.logged;
                  const isAbandon = row.event_type === "abandonment_suspected";
                  const canReview = row.status === "pending_review";
                  return (
                    <tr key={row.id} className="align-top hover:bg-slate-50/30">
                      <td className="px-5 py-4">
                        <p className="font-bold text-slate-900">{row.mentor_name || "(이름 없음)"}</p>
                        <p className="text-xs text-slate-500">{row.mentor_email || "—"}</p>
                      </td>
                      <td className="px-5 py-4 text-xs">
                        <p className="font-bold text-slate-800">{EVENT_LABEL[row.event_type] ?? row.event_type}</p>
                        {row.reason ? <p className="mt-0.5 text-slate-500">사유: {row.reason}</p> : null}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-block rounded-lg border px-2.5 py-1 text-xs font-bold ${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500">{fmt(row.created_at)}</td>
                      <td className="px-5 py-4">
                        {isAbandon && canReview ? (
                          <div className="flex flex-wrap gap-2">
                            <form>
                              <input type="hidden" name="eventId" value={row.id} />
                              <button
                                type="submit"
                                formAction={approveMentorAbandonmentHoldAction}
                                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
                              >
                                보류 확정
                              </button>
                            </form>
                            <form>
                              <input type="hidden" name="eventId" value={row.id} />
                              <button
                                type="submit"
                                formAction={releaseMentorSettlementHoldAction}
                                className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
                              >
                                구제(해제)
                              </button>
                            </form>
                          </div>
                        ) : row.event_type === "termination_requested" ? (
                          <form>
                            <input type="hidden" name="mentorId" value={row.mentor_id} />
                            <button
                              type="submit"
                              formAction={finalizeMentorTerminationAdminAction}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                            >
                              유예 만료 정리(환불 생성)
                            </button>
                          </form>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageScaffold>
  );
}
