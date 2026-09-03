import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { EmptyState } from "@/components/common/EmptyState";
import { TopupQueueTable } from "@/components/admin/TopupQueueTable";
import { TopupQueueToolbar } from "@/components/admin/TopupQueueToolbar";
import { parseAdminListParams, type AdminListParams } from "@/lib/admin/adminListParams";
import { TOPUP_DEFAULT_PAGE_SIZE, TOPUP_DEFAULT_TAB, TOPUP_READ_ONLY_NOTICE, buildTopupListUrl, resolveTopupTab, topupEmptyState } from "@/lib/admin/topupConsole";
import { countTopupTabs, loadTopupList } from "@/lib/admin/topupConsoleQueries";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

/**
 * 관리자 · 충전 관리(PR-9 §2 · 패턴 A · **조회 전용**) — 무통장입금(페이싱크) 주문 목록.
 *
 * §0 결론: 관리자가 통장을 보고 캐시를 직접 지급하는 RPC·액션이 없다(`record_cash_topup` 은 테스트 충전 전용). 적립은
 * 웹훅·보정 크론·학생 재확인이 쓰는 한 경로(`recordPaysyncTopup`)만이 하므로, 이 화면은 새 쓰기 경로를 만들지 않고 상태·확인 경로를 보여준다.
 * 쿼리: `status`(탭 — 사전 4값 + 전체) · `q`(입금자명·요청자) · `page`. 정렬 기본값은 만료 임박순(대기 탭).
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminTopupsPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const rawParams = parseAdminListParams(sp, { defaultPageSize: TOPUP_DEFAULT_PAGE_SIZE, defaultStatus: TOPUP_DEFAULT_TAB });
  const tab = resolveTopupTab(rawParams.status);
  const params: AdminListParams = { ...rawParams, status: tab, extra: {} };
  const nowIso = new Date().toISOString();

  const [list, counts] = await Promise.all([loadTopupList(params, tab), countTopupTabs()]);
  const empty = topupEmptyState(tab, params.search);

  return (
    <AdminPageLayout
      title="충전 관리"
      description="계좌이체(무통장입금) 충전 요청과 입금 확인 상태를 봅니다. 확인·적립은 자동이며 이 화면에서 캐시를 지급하지 않습니다."
      actions={
        <>
          <Link href="/admin/refunds" className={ACTION_LINK} prefetch={false}>
            환불 관리
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
      <p role="note" className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-900" data-topup-notice>
        ⓘ {TOPUP_READ_ONLY_NOTICE} 페이싱크 대시보드에서 수동 매칭·승인한 건도 웹훅으로 들어와 자동 적립되며, 확인 경로 열에서 구분됩니다.
      </p>

      <TopupQueueToolbar params={params} tab={tab} counts={counts} totalCount={list.totalCount} />

      {list.error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">목록을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{list.error}</p>
        </div>
      ) : list.rows.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description}>
          {params.search ? (
            <Link href={buildTopupListUrl(params, { search: "" })} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50" prefetch={false}>
              검색 초기화
            </Link>
          ) : null}
        </EmptyState>
      ) : (
        <TopupQueueTable items={list.rows} params={params} totalCount={list.totalCount} nowIso={nowIso} />
      )}
    </AdminPageLayout>
  );
}
