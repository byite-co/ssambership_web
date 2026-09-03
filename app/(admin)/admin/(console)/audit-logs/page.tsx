import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { AuditLogTable } from "@/components/admin/AuditLogTable";
import { AuditLogToolbar } from "@/components/admin/AuditLogToolbar";
import { EmptyState } from "@/components/common/EmptyState";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  AUDIT_LOG_BASE_PATH,
  AUDIT_LOG_DEFAULT_PAGE_SIZE,
  AUDIT_LOG_HARD_DELETE_NOTICE,
  auditLogEmptyState,
  auditLogFilterExtra,
  buildAuditLogActorOptions,
  resolveAuditLogFilters,
} from "@/lib/admin/auditLogConsole";
import { countAuditLogTotal, loadAuditLogAdmins, loadAuditLogList } from "@/lib/admin/auditLogQueries";
import { createClient } from "@/lib/supabase/server";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

/**
 * 관리자 · 감사 로그(PR-10 §2 · 패턴 A · 조회 전용) — `admin_action_logs` 만.
 *
 * 쿼리: `q`(대상) · `actor`(관리자 uuid | system) · `action`(사전 계열) · `period`(today · 7d · 30d) · `hideViews`(question_body_viewed 제외) · `page`. 전부 서버 조회.
 * 구 화면의 9소스 통합 뷰는 각 화면으로 이관돼 폐기했다. 사용자 하드 삭제는 이 로그에 남지 않는다(상시 안내).
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminAuditLogsPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: AUDIT_LOG_DEFAULT_PAGE_SIZE });
  const filters = resolveAuditLogFilters(rawParams.extra);
  // 링크에 실을 extra 는 이 화면이 아는 네 키(정규화된 값)만 — 알 수 없는 키가 따라다니지 않게.
  const params: AdminListParams = { ...rawParams, status: "", extra: auditLogFilterExtra(filters) };
  const nowIso = new Date().toISOString();

  const supabase = await createClient();
  const [list, admins, allCount] = await Promise.all([loadAuditLogList(supabase, params, filters, nowIso), loadAuditLogAdmins(supabase), countAuditLogTotal(supabase)]);
  const actorOptions = buildAuditLogActorOptions(admins.map((a) => ({ id: a.id, name: a.name })));
  const empty = auditLogEmptyState(filters, params.search);

  return (
    <AdminPageLayout
      title="감사 로그"
      description="관리자 조치와 시스템(웹훅·배치) 기록을 시간순으로 봅니다. 이 화면에서는 아무것도 바뀌지 않으며, 조치는 각 화면에서 합니다."
      actions={
        <>
          <Link href="/admin/users" className={ACTION_LINK} prefetch={false}>
            계정 관리
          </Link>
          <Link href="/admin/mentor-approval" className={ACTION_LINK} prefetch={false}>
            멘토 승인
          </Link>
        </>
      }
    >
      <p role="note" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900" data-audit-hard-delete-notice>
        ⓘ {AUDIT_LOG_HARD_DELETE_NOTICE}
      </p>

      <AuditLogToolbar params={params} filters={filters} actorOptions={actorOptions} totalCount={list.totalCount} allCount={allCount} />

      {list.error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">감사 로그를 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{list.error}</p>
        </div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description}>
          {params.search || Object.keys(params.extra).length ? (
            <Link href={AUDIT_LOG_BASE_PATH} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" prefetch={false}>
              필터 초기화
            </Link>
          ) : null}
        </EmptyState>
      ) : (
        <AuditLogTable items={list.rows} params={params} totalCount={list.totalCount} />
      )}
    </AdminPageLayout>
  );
}
