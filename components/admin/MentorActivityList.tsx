/**
 * 멘토 활동 목록(PR-11 §4-1) — 검색(닉네임·이름·이메일) · 상태 탭(공용 `AdminDataTable.Tabs` — 활동 중 · 일시정지 · 종료 예정 · 이탈 의심 · 전체) · `N / M` · 표 ·
 * 페이지네이션 · 탭별 빈 상태. Server Component.
 *
 * - 열: 멘토(→ 계정 상세 멘토 탭) · 담당 학생 · 미답변 · 최장 미답변(24h 주의색 · 48h 위험색) · 활동 상태 · 최근 활동(출처는 툴팁) · 조치.
 * - **미답변이 오래된 멘토가 위** — 정렬은 조회 모듈이 `compareMentorActivityItems` 로 한다.
 * - 조치는 `MentorActivityActionButtons`(기존 3경로만).
 */
import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { EmptyState } from "@/components/common/EmptyState";
import { MentorActivityActionButtons } from "@/components/admin/MentorActivityActionButtons";
import { StatusBadge } from "@/components/design-system/StatusBadge";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { splitAdminListBasePath, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  MENTOR_ACTIVITY_BASE_PATH,
  MENTOR_ACTIVITY_DEFAULT_TAB,
  MENTOR_ACTIVITY_LAST_SOURCE_LABELS,
  MENTOR_ACTIVITY_TABS,
  buildMentorActivityListUrl,
  mentorActivityAccountUrl,
  mentorActivityEmptyState,
  mentorActivityStateDetail,
  mentorActivityStateLabel,
  mentorActivityStateTone,
  mentorUnansweredToneClass,
  type MentorActivityListItem,
  type MentorActivityTab,
} from "@/lib/admin/mentorActivityConsole";
import type { MentorActivityTabCounts } from "@/lib/admin/mentorActivityQueries";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";
import { cn } from "@/lib/utils/cn";

type Props = {
  items: MentorActivityListItem[];
  params: AdminListParams;
  tab: MentorActivityTab;
  counts: MentorActivityTabCounts;
  /** 필터(탭·검색) 후 건수 */
  totalCount: number;
  error: string | null;
  /** 서버 렌더 시각(ms) — 조치 가능 판정 */
  now: number;
};

export function MentorActivityList({ items, params, tab, counts, totalCount, error, now }: Props) {
  const { path: actionPath } = splitAdminListBasePath(MENTOR_ACTIVITY_BASE_PATH);
  const empty = mentorActivityEmptyState(tab, params.search);

  return (
    <div className="space-y-4" data-mentor-activity-list>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form action={actionPath} method="GET" className="flex min-w-0 flex-1 items-center gap-1.5" role="search">
            <input
              type="search"
              name="q"
              defaultValue={params.search}
              placeholder="닉네임 · 이름 · 이메일"
              autoComplete="off"
              aria-label="멘토 검색"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:max-w-xs"
            />
            {tab !== MENTOR_ACTIVITY_DEFAULT_TAB ? <input type="hidden" name="status" value={tab} /> : null}
            <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-slate-800">
              검색
            </button>
            {params.search ? (
              <Link href={buildMentorActivityListUrl(params, { search: "" })} className="text-xs font-bold text-blue-700 hover:underline" prefetch={false}>
                초기화
              </Link>
            ) : null}
          </form>
          {/* 건수 줄 — 공용 Counts 는 대기 키 전용이라 직접 그린다(prop 추가 0). */}
          <p className="text-xs font-bold text-slate-600" aria-live="polite" data-mentor-activity-counts>
            <span className="tabular-nums text-slate-900">{totalCount.toLocaleString("ko-KR")}</span>
            {" / "}
            전체 <span className="tabular-nums text-slate-900">{counts.all.toLocaleString("ko-KR")}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AdminDataTable.Tabs basePath={MENTOR_ACTIVITY_BASE_PATH} params={params} tabs={MENTOR_ACTIVITY_TABS} activeTab={tab} counts={counts} />
          {params.search ? (
            <p className="text-[11px] font-semibold text-slate-500">
              &lsquo;{params.search}&rsquo; 검색 결과 <span className="tabular-nums text-slate-800">{totalCount}</span>건
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">멘토 활동을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{toAdminDisplayError(error, "default") ?? "잠시 후 다시 시도하거나 담당자에게 문의해 주세요."}</p>
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description}>
          {params.search ? (
            <Link href={buildMentorActivityListUrl(params, { search: "" })} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" prefetch={false}>
              검색 초기화
            </Link>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-bold text-slate-600">
                  <th scope="col" className="px-3 py-3">멘토</th>
                  <th scope="col" className="px-3 py-3">담당 학생</th>
                  <th scope="col" className="px-3 py-3">미답변</th>
                  <th scope="col" className="px-3 py-3">최장 미답변</th>
                  <th scope="col" className="px-3 py-3">활동 상태</th>
                  <th scope="col" className="px-3 py-3">최근 활동</th>
                  <th scope="col" className="px-3 py-3">조치</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const detail = mentorActivityStateDetail(item, formatKoreanDate);
                  return (
                    <tr key={item.mentorId} className="transition-colors hover:bg-slate-50/60" data-mentor-activity-row={item.mentorId} data-mentor-activity-state={item.state}>
                      <td className="max-w-[240px] px-3 py-3 align-top">
                        <Link href={mentorActivityAccountUrl(item.mentorId)} className="block truncate font-extrabold text-slate-900 hover:underline" prefetch={false} title="계정 상세(멘토 탭)">
                          {item.name}
                        </Link>
                        <p className="truncate text-[11px] text-slate-500">{item.email ?? "이메일 없음"}</p>
                        {item.abandonmentFlaggedAt ? (
                          <StatusBadge label={`이탈 의심 · ${formatKoreanDate(item.abandonmentFlaggedAt)}`} tone="danger" size="sm" className="mt-1" />
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-800" title="mentor_student_rooms 수">
                        {item.studentCount}명
                      </td>
                      <td className={cn("whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums", item.unansweredCount > 0 ? "font-extrabold text-red-700" : "text-slate-600")}>
                        {item.unansweredCount}건
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 align-top">
                        <span
                          className={cn("inline-block rounded-md border px-1.5 py-0.5 text-[11px] font-bold tabular-nums", mentorUnansweredToneClass(item.elapsed.tone))}
                          data-unanswered-tone={item.elapsed.tone}
                          title={item.oldestUnansweredAt ? `가장 오래된 미답변 ${formatKoDateTimeKst(item.oldestUnansweredAt)}` : undefined}
                        >
                          {item.elapsed.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <StatusBadge label={mentorActivityStateLabel(item.state)} tone={mentorActivityStateTone(item.state)} size="sm" />
                        {detail ? <p className="mt-0.5 text-[11px] font-semibold text-slate-500">{detail}</p> : null}
                      </td>
                      <td
                        className="whitespace-nowrap px-3 py-3 align-top text-xs tabular-nums text-slate-600"
                        title={item.lastActivitySource ? MENTOR_ACTIVITY_LAST_SOURCE_LABELS[item.lastActivitySource] : undefined}
                        data-last-activity-source={item.lastActivitySource ?? ""}
                      >
                        {formatKoDateTimeKst(item.lastActivityAt)}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <MentorActivityActionButtons item={item} now={now} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <AdminDataTable.Pagination className="rounded-2xl border border-slate-200 bg-white px-4 py-2" basePath={MENTOR_ACTIVITY_BASE_PATH} params={params} totalCount={totalCount} rowsOnPage={items.length} />
        </>
      )}
    </div>
  );
}
