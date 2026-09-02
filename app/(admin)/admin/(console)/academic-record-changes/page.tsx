import { AcademicRecordChangeQueueList } from "@/components/admin/AcademicRecordChangeQueueList";
import { AcademicRecordChangeReviewPanel } from "@/components/admin/AcademicRecordChangeReviewPanel";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  ACADEMIC_RECORD_CHANGE_DEFAULT_PAGE_SIZE,
  ACADEMIC_RECORD_CHANGE_DEFAULT_TAB,
  ACADEMIC_RECORD_CHANGE_SELECTED_PARAM,
  academicRecordChangeFlashOkMessage,
  resolveAcademicRecordChangeTab,
} from "@/lib/admin/academicRecordChangeConsole";
import { countAcademicRecordChangeTabs, loadAcademicRecordChangeDetail, loadAcademicRecordChangeQueue } from "@/lib/admin/academicRecordChangeQueries";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * 관리자 · 학적 변경 요청(PR-5 §2) — 멘토 승인 작업대의 축소판. `AdminPageLayout` + `AdminDataTable` 위에 있다.
 *
 * 쿼리: `status`(탭 — CHECK 4종 + all) · `q`(멘토 이름·이메일·대학) · `page` · `request`(선택 요청). 목록·검색·탭은 전부 서버 조회고,
 * 심사 패널은 선택 1건만 조회한다(서류 서명 URL 도 1건만 발급 — 구 화면은 페이지의 모든 행에 발급했다).
 * 전체 탭 링크는 `status=all` 을 유지한다(PR #111 §8 결함, 이 화면에서 해소). 결정 후 서버 액션은 `?ok=…` 로 돌아오고 선택이 비므로 첫 행이 선택된다.
 */
export default async function AdminAcademicRecordChangesPage(props: PageProps) {
  await requireRole("admin");
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: ACADEMIC_RECORD_CHANGE_DEFAULT_PAGE_SIZE, defaultStatus: ACADEMIC_RECORD_CHANGE_DEFAULT_TAB });
  const tab = resolveAcademicRecordChangeTab(rawParams.status);
  const selectedParam = pick(sp[ACADEMIC_RECORD_CHANGE_SELECTED_PARAM]);
  // 선택 요청 키는 탭·검색·페이지 링크에 실리지 않게 목록 파라미터에서 뺀다.
  const { [ACADEMIC_RECORD_CHANGE_SELECTED_PARAM]: _selectedExtra, ...extraWithoutSelected } = rawParams.extra;
  const params: AdminListParams = { ...rawParams, status: tab, extra: extraWithoutSelected };

  const flashOk = academicRecordChangeFlashOkMessage(pick(sp.ok));
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "default") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const supabase = await createClient();
  const [queue, counts] = await Promise.all([
    loadAcademicRecordChangeQueue(supabase, { tab, search: params.search, page: params.page, pageSize: params.pageSize }),
    countAcademicRecordChangeTabs(supabase),
  ]);
  const selectedId = selectedParam || queue.rows[0]?.id || null;
  const detail = selectedId ? await loadAcademicRecordChangeDetail(supabase, selectedId) : null;

  return (
    <AdminPageLayout
      title="학적 변경 요청"
      description="멘토가 제출한 학적 변동 증빙 서류를 보고 변경 전후를 확인한 뒤 승인·반려·재제출을 결정합니다. 승인하면 멘토 프로필 학교가 갱신됩니다."
    >
      {flashOk ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          {flashOk}
        </p>
      ) : null}
      {flashErr ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          처리 실패 — {flashErr} 대상은 그대로이니 같은 버튼으로 다시 시도할 수 있습니다.
        </p>
      ) : null}

      <AcademicRecordChangeQueueList
        items={queue.rows}
        params={params}
        tab={tab}
        counts={counts}
        totalCount={queue.totalCount}
        selectedId={selectedId}
        error={queue.error}
      />

      {queue.rows.length > 0 || selectedParam ? (
        <AcademicRecordChangeReviewPanel key={detail?.id ?? "none"} detail={detail} flashError={flashErr} />
      ) : null}
    </AdminPageLayout>
  );
}
