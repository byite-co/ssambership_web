/**
 * PG 수동 취소 경고(PR-3 §1) — 목록·상세 상단에 **상시 노출**. 닫기 버튼 없음. Server Component.
 * 시스템은 캐시 크레딧만 돌려준다(PG 미연동). 카드 결제 건의 실제 취소는 PG사 콘솔에서 사람이 한다.
 */
import { REFUND_PG_MANUAL_WARNING } from "@/lib/admin/refundConsole";

export function RefundPgManualWarning() {
  return (
    <p
      role="note"
      data-refund-pg-warning
      className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950"
    >
      <span aria-hidden="true">⚠️</span>
      <span>{REFUND_PG_MANUAL_WARNING}</span>
    </p>
  );
}
