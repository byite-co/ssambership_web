/**
 * 환불 목록 하단 — `첫–끝 / 전체` + 이전·다음(PR-3). Server Component.
 * 공용 `AdminDataTable.Pagination`(PR-4) 에 이 화면의 경로(`REFUND_BASE_PATH` — 전체 탭 `status=all` 유지)와
 * 독립 카드 배치 클래스를 묶은 것. 공용 `AdminListPagination` 을 쓰지 않는 이유는 그 빌더가 `status=all` 을 지워
 * 전체 탭에서 페이지를 넘기면 대기 탭으로 튀기 때문(PR-2 와 같은 처리).
 */
import { AdminDataTable } from "@/components/admin/AdminDataTable";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { REFUND_BASE_PATH } from "@/lib/admin/refundConsole";

type Props = { params: AdminListParams; totalCount: number; rowsOnPage: number };

export function RefundQueuePagination({ params, totalCount, rowsOnPage }: Props) {
  return (
    <AdminDataTable.Pagination
      className="rounded-2xl border border-slate-200 bg-white px-4 py-2"
      basePath={REFUND_BASE_PATH}
      params={params}
      totalCount={totalCount}
      rowsOnPage={rowsOnPage}
    />
  );
}
