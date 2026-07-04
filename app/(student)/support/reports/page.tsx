import { PageScaffold } from "@/components/shell/PageScaffold";
import { EmptyState } from "@/components/common/EmptyState";
import { StudentSupportTabs } from "@/components/support/StudentSupportTabs";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import {
  loadMyContentReports,
  reportStatusDisplay,
  reportTargetTypeLabel,
} from "@/lib/support/studentReportsQueries";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";

/**
 * W-06: "내 신고 내역" 실화면 복구 — 기존 redirect 스텁(목록 API 미연결) 해제.
 * 조회는 RLS `content_reports_select_reporter`(032)가 본인 행만 허용 — 사용자 세션
 * 클라이언트 사용(타계정 노출 구조적 차단, service-role 미사용).
 */
export default async function StudentSupportReportsPage() {
  const { user } = await requireRole("student");
  const supabase = await createClient();
  const { rows, error } = await loadMyContentReports(supabase, user.id);

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="지원 · 신고"
      title="내 신고 내역"
      description={
        <>
          <span className="md:hidden">제출한 신고의 처리 상태를 확인하세요.</span>
          <span className="hidden md:inline">
            커뮤니티·숏폼 등에서 제출한 신고와 관리자 처리 상태를 확인할 수 있습니다.
          </span>
        </>
      }
    >
      <StudentSupportTabs active="reports" />

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          신고 내역을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          title="제출한 신고가 없어요"
          description="게시글·숏폼 화면의 신고 버튼으로 부적절한 콘텐츠를 알릴 수 있어요."
        />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => {
            const st = reportStatusDisplay(r.status);
            const toneClass =
              st.tone === "done"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : st.tone === "muted"
                  ? "border-slate-200 bg-slate-100 text-slate-500"
                  : "border-amber-200 bg-amber-50 text-amber-900";
            return (
              <li key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">
                    {reportTargetTypeLabel(r.targetType)}
                  </span>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${toneClass}`}>
                    {st.label}
                  </span>
                </div>
                <p className="mt-2 break-keep text-sm font-semibold text-slate-800">
                  {r.reason?.trim() || "사유 미기재"}
                </p>
                {r.description?.trim() ? (
                  <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-slate-500">{r.description}</p>
                ) : null}
                <p className="mt-2 text-[11px] font-medium text-slate-400">
                  접수 {r.createdAt ? formatKoreanDate(r.createdAt) : "—"}
                  {r.resolvedAt ? ` · 처리 ${formatKoreanDate(r.resolvedAt)}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </PageScaffold>
  );
}
