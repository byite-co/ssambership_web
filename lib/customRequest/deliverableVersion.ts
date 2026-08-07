/**
 * D-CR-1: 납품 버전 채번 순수부.
 * custom_order_deliverables.version 목록에서 다음 버전(max+1, 최소 1)을 계산한다.
 *
 * 앱에서의 read-max+1 은 완전한 원자성이 없어(동시 납품 시 같은 version → unique 23505) 재시도 루프의
 * 매 시도마다 재채번에 사용된다. 완전한 원자성은 DB 함수(INSERT ... SELECT coalesce(max)+1)로만 보장된다.
 */
export function nextDeliverableVersionFromRows(
  rows: ReadonlyArray<{ version?: unknown }> | null | undefined
): number {
  const list = rows ?? [];
  if (list.length === 0) return 1;
  return (
    Math.max(
      1,
      ...list.map((r) => (typeof r.version === "number" ? r.version : Number(r.version) || 0))
    ) + 1
  );
}
