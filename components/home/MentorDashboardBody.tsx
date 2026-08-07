import Link from "next/link";
import { EmptyState } from "@/components/common/EmptyState";
import {
  customOrderLine,
  mentorCustomOrderWorkroomHref,
  type MentorDashboardData,
} from "@/lib/home/mentorDashboardQueries";
import { pickDisplayField } from "@/lib/customRequest/customRequestQueries";
import { formatCashKrw } from "@/lib/utils/formatDisplay";

function formatOrderDate(row: Record<string, unknown>): string {
  const raw = pickDisplayField(row, ["updated_at", "created_at", "accepted_at"]);
  if (raw === "—") return "";
  const match = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : raw.slice(0, 10);
}

function KpiStatCard(props: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "amber";
}) {
  const border =
    props.tone === "amber" ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white";
  return (
    <article className={`flex flex-col justify-between rounded-2xl border p-5 shadow-sm ${border}`}>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{props.label}</p>
        <p className="mt-2 text-3xl font-black tabular-nums text-slate-900">{props.value}</p>
      </div>
      <p className={`mt-3 text-xs font-semibold ${props.tone === "amber" ? "text-amber-800" : "text-slate-500"}`}>
        {props.sub}
      </p>
    </article>
  );
}

export function MentorDashboardBody({ data }: { data: MentorDashboardData }) {
  const { threadStats, customRecent, payouts, activeStudentCount, disputeCount, monthlyRevenueCash } =
    data;
  const customErr = customRecent.error;

  const newQuestions = threadStats.error ? "—" : String(threadStats.mentorQueueEstimate);
  const monthlyAnswers = threadStats.error ? "—" : String(threadStats.openThreads);
  const students = String(activeStudentCount);
  // D-MT-3: 사문 payoutError/monthExpectedCents 제거. 이번 달 수익은 cash_ledger 기반
  // monthlyRevenueCash 를 그대로 쓰고, 경보는 settlementPayouts 의 실제 조회 오류로만 판정한다.
  const settlementLoadFailed = Boolean(payouts.settlementPayouts.error);
  const revenue = formatCashKrw(monthlyRevenueCash);
  const disputes = String(disputeCount);

  const recentOrders = customRecent.rows.slice(0, 3);

  const quickLinks = [
    { href: "/mentor/question-room", label: "질문방" },
    { href: "/mentor/profile/edit", label: "프로필 관리" },
    { href: "/mentor/payouts", label: "정산 관리" },
    { href: "/notifications", label: "알림 설정" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12 text-sm text-slate-800">
      <header>
        <p className="text-xs font-extrabold uppercase tracking-wide text-[#2563EB]">멘토 홈</p>
        <h1 className="mt-1 text-2xl font-black text-slate-900 sm:text-3xl">멘토 대시보드</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          오늘 처리할 질문·의뢰·알림을 한눈에 확인하세요.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiStatCard
          label="새 질문"
          value={`${newQuestions}건`}
          sub={threadStats.error ? "집계를 불러오지 못했어요" : `오늘 +${newQuestions}건`}
        />
        <KpiStatCard
          label="이번 달 답변"
          value={`${monthlyAnswers}건`}
          sub="답변 완료"
        />
        <KpiStatCard
          label="구독 학생"
          value={`${students}명`}
          sub="활성 구독"
        />
        <KpiStatCard
          label="이번 달 수익"
          value={revenue}
          sub={settlementLoadFailed ? "정산 내역 확인 필요" : "지난 달 대비 —"}
        />
        <KpiStatCard
          label="분쟁/신고"
          value={`${disputes}건`}
          sub="확인 필요"
          tone="amber"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900">맞춤의뢰</h2>
            <Link href="/mentor/custom-request/orders" className="text-xs font-bold text-[#2563EB] hover:underline">
              전체 보기 &gt;
            </Link>
          </div>
          <p className="mt-1 text-xs text-slate-500">진행 중인 의뢰 최대 3건</p>
          {customErr ? (
            <p className="mt-4 text-sm text-red-700">맞춤의뢰를 불러오지 못했어요.</p>
          ) : recentOrders.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="아직 진행 중인 의뢰가 없어요"
                description="새 의뢰에 제안하면 여기에 표시돼요."
              >
                <Link
                  href="/mentor/custom-request/posts"
                  className="rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                >
                  의뢰 둘러보기
                </Link>
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {recentOrders.map((r, i) => {
                const row = r as Record<string, unknown>;
                const oid = typeof row.id === "string" && row.id.trim() ? row.id.trim() : null;
                const title = pickDisplayField(row, ["title", "subject", "label", "name"]);
                const titleLine = title !== "—" ? title : customOrderLine(row, customRecent.activeDisputeOrderIds);
                const dateStr = formatOrderDate(row);
                return (
                  <li key={oid ?? i} className="flex items-start justify-between gap-3 py-3 first:pt-0">
                    <div className="min-w-0 flex-1">
                      {oid ? (
                        <Link
                          href={mentorCustomOrderWorkroomHref(oid)}
                          className="block truncate text-sm font-bold text-slate-900 hover:text-[#2563EB] hover:underline"
                        >
                          {titleLine}
                        </Link>
                      ) : (
                        <p className="truncate text-sm font-bold text-slate-900">{titleLine}</p>
                      )}
                      <p className="mt-0.5 text-xs text-slate-500">
                        {customOrderLine(row, customRecent.activeDisputeOrderIds)}
                      </p>
                    </div>
                    {dateStr ? <span className="shrink-0 text-xs tabular-nums text-slate-400">{dateStr}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-slate-900">빠른 링크</h2>
          <p className="mt-1 text-sm text-slate-600">자주 쓰는 메뉴로 바로 이동하세요.</p>
          <ul className="mt-4 space-y-2">
            {quickLinks.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex min-h-[44px] items-center justify-between rounded-xl border border-slate-100 bg-slate-50/80 px-4 text-sm font-bold text-slate-800 transition hover:border-slate-200 hover:bg-white"
                >
                  {item.label}
                  <span className="text-slate-400">&gt;</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
