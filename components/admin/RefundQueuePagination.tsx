/**
 * 환불 목록 하단 — `첫–끝 / 전체` + 이전·다음(PR-3). Server Component.
 * 공용 `AdminListPagination` 대신 화면 전용 빌더(`buildRefundListUrl`)를 쓰는 이유: 공용 빌더가 `status=all` 을 지워
 * 전체 탭에서 페이지를 넘기면 대기 탭으로 튀기 때문(PR-2 와 같은 처리). PR-4 추출 입력.
 */
import Link from "next/link";
import type { AdminListParams } from "@/lib/admin/adminListParams";
import { buildRefundListUrl, refundQueueProgressRange } from "@/lib/admin/refundConsole";
import { cn } from "@/lib/utils/cn";

type Props = { params: AdminListParams; totalCount: number; rowsOnPage: number };

export function RefundQueuePagination({ params, totalCount, rowsOnPage }: Props) {
  const totalPages = Math.max(1, Math.ceil(totalCount / Math.max(1, params.pageSize)));
  const hasPrev = params.page > 1;
  const hasNext = params.page < totalPages;
  const progress = refundQueueProgressRange(params.page, params.pageSize, rowsOnPage, totalCount);
  const linkClass = (enabled: boolean) =>
    cn(
      "rounded-lg border px-2.5 py-1 text-[11px] font-extrabold",
      enabled ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "pointer-events-none border-slate-100 text-slate-300"
    );

  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2">
      <p className="text-[11px] font-semibold tabular-nums text-slate-600">
        {progress.first}–{progress.last} / 전체 {totalCount.toLocaleString("ko-KR")}
      </p>
      <div className="flex items-center gap-1">
        <Link href={hasPrev ? buildRefundListUrl(params, { page: params.page - 1 }) : "#"} aria-disabled={!hasPrev} className={linkClass(hasPrev)}>
          ← 이전
        </Link>
        <Link href={hasNext ? buildRefundListUrl(params, { page: params.page + 1 }) : "#"} aria-disabled={!hasNext} className={linkClass(hasNext)}>
          다음 →
        </Link>
      </div>
    </div>
  );
}
