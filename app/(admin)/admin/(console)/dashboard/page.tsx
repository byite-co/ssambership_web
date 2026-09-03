import { AdminDashboardActivity } from "@/components/admin/AdminDashboardActivity";
import { AdminDashboardStatusBar } from "@/components/admin/AdminDashboardStatusBar";
import { AdminDashboardTodoGrid } from "@/components/admin/AdminDashboardTodoGrid";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { ADMIN_DASHBOARD_SHOW_VIEWS_PARAM, resolveAdminDashboardShowViews } from "@/lib/admin/adminDashboardConsole";
import { loadAdminDashboardData } from "@/lib/admin/adminDashboardQueries";
import { createClient } from "@/lib/supabase/server";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * 관리자 · 대시보드(PR-12 §1) — "오늘 할 일" 8칸 · 현황 · 최근 활동 세 블록.
 *
 * 8칸의 숫자는 각 화면의 건수 함수(`adminDashboardQueries.ts` 참조)를 그대로 쓰므로 그 화면 탭의 숫자와 같다. 칸을 누르면 그 화면으로 간다.
 * 구 화면의 일정 섹션(핸들러 없는 `+ 일정 추가` · 영구 빈 배열)·장식 차트·오링크 KPI(신규 가입 → 감사 로그, 거래액 → 환불)는 지웠다.
 * 쿼리: `showViews`(최근 활동에 열람 기록 포함 — 기본 제외). 조회 전용.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminDashboardPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const showViews = resolveAdminDashboardShowViews(sp[ADMIN_DASHBOARD_SHOW_VIEWS_PARAM]);
  const supabase = await createClient();
  const data = await loadAdminDashboardData(supabase, { showViews });

  return (
    <AdminPageLayout title="대시보드" description="오늘 처리할 일과 운영 현황, 최근 관리자 조치를 한 화면에서 봅니다. 칸을 누르면 그 화면으로 이동합니다.">
      {data.errors.length ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-bold">일부 건수를 불러오지 못했습니다. 표시된 0 이 실제 0 이 아닐 수 있습니다.</p>
          <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
            {data.errors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <AdminDashboardTodoGrid cards={data.todo} />
      <AdminDashboardStatusBar items={data.status} />
      <AdminDashboardActivity rows={data.activity.rows} error={data.activity.error} showViews={data.activity.showViews} />
    </AdminPageLayout>
  );
}
