import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { RefundEmptyState } from "@/components/admin/RefundEmptyState";
import { RefundPgManualWarning } from "@/components/admin/RefundPgManualWarning";
import { RefundQueuePagination } from "@/components/admin/RefundQueuePagination";
import { RefundQueueTable } from "@/components/admin/RefundQueueTable";
import { RefundQueueToolbar } from "@/components/admin/RefundQueueToolbar";
import { createClient } from "@/lib/supabase/server";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import {
  REFUND_BASE_PATH,
  REFUND_DEFAULT_PAGE_SIZE,
  REFUND_DEFAULT_TAB,
  REFUND_TABS,
  buildRefundListUrl,
  refundDetailPath,
  resolveRefundTab,
} from "@/lib/admin/refundConsole";
import { countRefundTabs, loadRefundQueue } from "@/lib/admin/refundConsoleQueries";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

/**
 * 관리자 · 환불 관리 — 목록(PR-3 §1). 패턴 A.
 *
 * 쿼리: `status`(탭 — 유일한 필터 키) · `q`(요청자 이름·이메일) · `page`. 목록·검색·탭·건수는 전부 서버 조회다.
 * 구 화면의 `type`/`sort` 키는 받지도 실어 나르지도 않는다(대기 건은 항상 위·오래된 것부터 고정 정렬이라 필요 없다).
 * 구 딥링크 `?refundId=…`(분쟁 상세·활동 로그)는 상세 페이지로 보낸다.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminRefundsPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const focusRefundId = pick(sp.refundId);
  if (focusRefundId) redirect(refundDetailPath(focusRefundId));

  const rawParams = parseAdminListParams(sp, { defaultPageSize: REFUND_DEFAULT_PAGE_SIZE, defaultStatus: REFUND_DEFAULT_TAB });
  const tab = resolveRefundTab(rawParams.status);
  // 구 키(type·sort)는 탭·검색·페이지 링크에 실리지 않게 뺀다 — 탭 키는 status 하나.
  const { type: _legacyType, sort: _legacySort, ...extra } = rawParams.extra;
  const params: AdminListParams = { ...rawParams, status: tab, extra };

  const flashOk = pick(sp.ok) || null;
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "default") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const supabase = await createClient();
  const [queue, counts] = await Promise.all([
    loadRefundQueue(supabase, { tab, search: params.search, page: params.page, pageSize: params.pageSize }),
    countRefundTabs(supabase),
  ]);

  const tabLabel = REFUND_TABS.find((t) => t.value === tab)?.label ?? "대기";
  const emptyVariant = params.search ? "search" : counts.all === 0 ? "first" : "tab";

  return (
    <AdminPageLayout
      title="환불 관리"
      description="환불 요청의 기준(학원법)과 금액을 확인한 뒤 승인·반려합니다. 승인은 학생 캐시로 즉시 환불되며 되돌릴 수 없습니다."
      actions={
        <>
          <Link href="/admin/disputes" className={ACTION_LINK} prefetch={false}>
            분쟁 관리
          </Link>
          <Link href="/admin/settlements" className={ACTION_LINK} prefetch={false}>
            정산 관리
          </Link>
          <Link href="/admin/audit-logs" className={ACTION_LINK} prefetch={false}>
            감사 로그
          </Link>
        </>
      }
    >
      <RefundPgManualWarning />

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

      <RefundQueueToolbar params={params} tab={tab} counts={counts} totalCount={queue.totalCount} />

      {queue.error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">
            {toAdminDisplayError(queue.error, "default") ?? "잠시 후 다시 시도하거나 담당자에게 문의해 주세요."}
          </p>
        </div>
      ) : queue.rows.length === 0 ? (
        <RefundEmptyState variant={emptyVariant} tabLabel={tabLabel} search={params.search} resetHref={buildRefundListUrl(params, { search: "" })} />
      ) : (
        <>
          <RefundQueueTable items={queue.rows} returnTo={REFUND_BASE_PATH} />
          <RefundQueuePagination params={params} totalCount={queue.totalCount} rowsOnPage={queue.rows.length} />
        </>
      )}
    </AdminPageLayout>
  );
}
