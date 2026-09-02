import Link from "next/link";
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { AdminStatusPill } from "@/components/admin/AdminStatusPill";
import { AdminTableCard } from "@/components/admin/AdminTableCard";
import { CustomRequestOrderQueueToolbar, type CustomRequestOrderTabCounts } from "@/components/admin/CustomRequestOrderQueueToolbar";
import { EmptyState } from "@/components/common/EmptyState";
import { requireRole } from "@/lib/auth/routeGuard";
import {
  countAdminCustomRequestOrdersByStatus,
  fetchAdminUsersDisplayByIds,
  loadAdminCustomRequestOrdersListPaged,
} from "@/lib/admin/adminQueries";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  CUSTOM_REQUEST_ORDER_BASE_PATH,
  CUSTOM_REQUEST_ORDER_DEFAULT_PAGE_SIZE,
  CUSTOM_REQUEST_ORDER_DEFAULT_TAB,
  CUSTOM_REQUEST_ORDER_DISABLED_BANNER,
  CUSTOM_REQUEST_ORDER_EMPTY_STATE,
  CUSTOM_REQUEST_ORDER_ROW_KEYS,
  CUSTOM_REQUEST_ORDER_TABS,
  CUSTOM_REQUEST_ORDER_TAB_VALUES,
  buildCustomRequestOrderListUrl,
  customRequestOrderEmptyVariant,
  customRequestOrderMoney,
  customRequestOrderText,
  resolveCustomRequestOrderTab,
  type CustomRequestOrderRow,
} from "@/lib/admin/customRequestOrderConsole";
import { formatKoDateTimeKst } from "@/lib/utils/kstTime";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function userLabel(userById: Map<string, { nickname: string | null; full_name: string | null }>, id: string): string {
  const row = userById.get(id);
  return row?.full_name?.trim() || row?.nickname?.trim() || id.slice(0, 8);
}

async function loadOrders(params: { search: string; status: string; page: number; pageSize: number }) {
  let db = await createClient();
  try {
    // 관리자 운영 목록은 RLS로 막힐 수 있어 service_role을 우선 사용한다(이관 전과 동일 — 그대로 둔다).
    // 이 페이지는 requireRole("admin") 아래에서만 렌더된다.
    db = createServiceRoleClient();
  } catch {
    /* session client fallback */
  }

  const paged = await loadAdminCustomRequestOrdersListPaged(db, params);
  return { db, rows: paged.rows as CustomRequestOrderRow[], error: paged.error, totalCount: paged.totalCount };
}

async function loadPostTitles(db: Awaited<ReturnType<typeof createClient>>, postIds: string[]) {
  const ids = [...new Set(postIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const { data } = await db.from("custom_request_posts").select("id, title, subject").in("id", ids);
  for (const row of (data ?? []) as CustomRequestOrderRow[]) {
    const id = customRequestOrderText(row, ["id"], "");
    if (!id) continue;
    map.set(id, customRequestOrderText(row, ["title", "subject"], id.slice(0, 8)));
  }
  return map;
}

/**
 * 관리자 · 맞춤의뢰 주문(PR-5 §3) — 기능이 꺼져 있어 **이관 + 비활성 배너만**. `AdminPageLayout` + `AdminDataTable` 위에 있다.
 * 읽기 전용(조치 버튼 없음). 컬럼 동의어는 이관 전 그대로(`CUSTOM_REQUEST_ORDER_ROW_KEYS`). 기본 탭은 전체(`all`).
 */
export default async function AdminCustomRequestOrdersPage(props: PageProps) {
  await requireRole("admin");
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: CUSTOM_REQUEST_ORDER_DEFAULT_PAGE_SIZE, defaultStatus: CUSTOM_REQUEST_ORDER_DEFAULT_TAB });
  const tab = resolveCustomRequestOrderTab(rawParams.status);
  const params: AdminListParams = { ...rawParams, status: tab };

  const { db, rows, error, totalCount } = await loadOrders({ search: params.search, status: tab, page: params.page, pageSize: params.pageSize });
  const postTitles = await loadPostTitles(db, rows.map((r) => customRequestOrderText(r, CUSTOM_REQUEST_ORDER_ROW_KEYS.postId, "")));
  // 상태별 카운트 — 동일 db 클라이언트로 안전하게. 실패하면 전체만 채운다.
  let byStatus: Record<string, number> = {};
  try {
    byStatus = await countAdminCustomRequestOrdersByStatus(db);
  } catch {
    byStatus = { all: totalCount };
  }
  const counts = Object.fromEntries(
    CUSTOM_REQUEST_ORDER_TAB_VALUES.map((value) => [value, byStatus[value] ?? (value === "all" ? totalCount : 0)])
  ) as CustomRequestOrderTabCounts;

  const userIds = new Set<string>();
  for (const row of rows) {
    const studentId = customRequestOrderText(row, CUSTOM_REQUEST_ORDER_ROW_KEYS.studentId, "");
    const mentorId = customRequestOrderText(row, CUSTOM_REQUEST_ORDER_ROW_KEYS.mentorId, "");
    if (studentId) userIds.add(studentId);
    if (mentorId) userIds.add(mentorId);
  }
  const userById = await fetchAdminUsersDisplayByIds(mentorProfilesAdminReadClient(db), [...userIds]);

  const tabLabel = CUSTOM_REQUEST_ORDER_TABS.find((t) => t.value === tab)?.label ?? "전체";
  const emptyVariant = customRequestOrderEmptyVariant(params.search, counts.all);

  return (
    <AdminPageLayout
      title="맞춤의뢰 주문"
      description="맞춤의뢰 주문을 읽기 전용으로 확인합니다. 분쟁·환불·정산 처리는 각 전용 화면에서 진행합니다."
      actions={
        <>
          <Link href="/admin/disputes" className={ACTION_LINK} prefetch={false}>
            분쟁 관리
          </Link>
          <Link href="/admin/refunds" className={ACTION_LINK} prefetch={false}>
            환불 관리
          </Link>
          <Link href="/admin/dashboard" className={ACTION_LINK} prefetch={false}>
            대시보드
          </Link>
        </>
      }
    >
      <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900" data-custom-request-order-disabled>
        {CUSTOM_REQUEST_ORDER_DISABLED_BANNER}
      </p>

      {error ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-950">
          주문 목록을 불러오지 못했습니다.
        </p>
      ) : null}

      <CustomRequestOrderQueueToolbar params={params} tab={tab} counts={counts} totalCount={totalCount} />

      {rows.length === 0 && !error ? (
        emptyVariant === "search" ? (
          <EmptyState title="조건에 맞는 주문이 없습니다" description={`'${params.search}' 검색 결과가 없습니다. 검색어를 바꾸거나 초기화해 주세요.`}>
            <Link href={buildCustomRequestOrderListUrl(params, { search: "" })} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              검색 초기화
            </Link>
          </EmptyState>
        ) : emptyVariant === "tab" ? (
          <EmptyState title={`'${tabLabel}' 상태의 주문이 없습니다`} description="다른 탭에서 주문을 확인할 수 있습니다." />
        ) : (
          <EmptyState title={CUSTOM_REQUEST_ORDER_EMPTY_STATE.title} description={CUSTOM_REQUEST_ORDER_EMPTY_STATE.description} />
        )
      ) : (
        <>
          <AdminTableCard title="주문 목록">
            <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
              <thead className="bg-slate-50 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">주문</th>
                  <th className="px-4 py-3">상태</th>
                  <th className="px-4 py-3">금액</th>
                  <th className="px-4 py-3">학생</th>
                  <th className="px-4 py-3">멘토</th>
                  <th className="px-4 py-3">생성일</th>
                  <th className="px-4 py-3">연결</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.map((row) => {
                  const orderId = customRequestOrderText(row, ["id"], "");
                  const postId = customRequestOrderText(row, CUSTOM_REQUEST_ORDER_ROW_KEYS.postId, "");
                  const studentId = customRequestOrderText(row, CUSTOM_REQUEST_ORDER_ROW_KEYS.studentId, "");
                  const mentorId = customRequestOrderText(row, CUSTOM_REQUEST_ORDER_ROW_KEYS.mentorId, "");
                  return (
                    <tr key={orderId} className="align-top">
                      <td className="px-4 py-3">
                        <p className="font-extrabold text-slate-900">{postTitles.get(postId) ?? orderId.slice(0, 8)}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{orderId}</p>
                      </td>
                      <td className="px-4 py-3">
                        <AdminStatusPill table="custom_request_orders" column="status" value={customRequestOrderText(row, CUSTOM_REQUEST_ORDER_ROW_KEYS.status, "")} size="sm" />
                      </td>
                      <td className="px-4 py-3 font-semibold tabular-nums text-slate-800">{customRequestOrderMoney(row)}</td>
                      <td className="px-4 py-3 text-slate-700">{studentId ? userLabel(userById, studentId) : "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{mentorId ? userLabel(userById, mentorId) : "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{formatKoDateTimeKst(row.created_at)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/disputes?orderId=${encodeURIComponent(orderId)}`} className="font-extrabold text-blue-700 underline underline-offset-2">
                          분쟁 보기
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </AdminTableCard>
          <AdminDataTable.Pagination
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2"
            basePath={CUSTOM_REQUEST_ORDER_BASE_PATH}
            params={params}
            totalCount={totalCount}
            rowsOnPage={rows.length}
          />
        </>
      )}
    </AdminPageLayout>
  );
}
