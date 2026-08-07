// 개별질문 만료 스캔의 순수(pure) 판정 로직. 네트워크·"server-only"·경로 alias 의존이 없어
// node --test 계약 테스트가 직접 import 할 수 있다(D-IQ-1 / D-IQ-2 회귀 고정용).

export type ExpiryScanRow = Record<string, unknown>;

// status별 만료 환불 대상. answered/released/refunded/canceled/escrowed는 제외.
export const EXPIRABLE_STATUSES = ["open", "assigned", "claimed"] as const;

export function getExpiryScanQuestionId(row: ExpiryScanRow): string | null {
  return typeof row.id === "string" && row.id.trim() ? row.id : null;
}

/**
 * [D-IQ-1] expires_at 가 NULL 로 남은 행(생성/claim 직후 best-effort UPDATE 가 경합·오류로 실패)은
 * `lte(expires_at)` 스캔에 영원히 걸리지 않아 에스크로 홀드가 무기한 유지된다 → 학생 캐시 영구 잠금.
 * created_at + status별 기본 만료시간을 폴백 기준으로 삼아 만료 여부를 판정한다.
 * hoursForStatus 를 주입받아(config 의존 제거) 순수 함수로 유지한다.
 */
export function isNullExpiryRowDue(
  row: ExpiryScanRow,
  at: Date,
  hoursForStatus: (status: string) => number
): boolean {
  const status = typeof row.status === "string" ? row.status : "";
  if (!(EXPIRABLE_STATUSES as readonly string[]).includes(status)) return false;
  const createdRaw = typeof row.created_at === "string" ? row.created_at : "";
  if (!createdRaw) return false;
  const createdAt = new Date(createdRaw);
  if (Number.isNaN(createdAt.getTime())) return false;
  const hours = hoursForStatus(status);
  if (!Number.isFinite(hours) || hours <= 0) return false;
  const dueAtMs = createdAt.getTime() + hours * 60 * 60 * 1000;
  return dueAtMs <= at.getTime();
}

/** NULL-expires 행들 중 폴백 기준으로 만료 도달한 것만 추린다(순수). */
export function selectDueNullExpiryRows(
  rows: ExpiryScanRow[],
  at: Date,
  hoursForStatus: (status: string) => number
): ExpiryScanRow[] {
  return rows.filter(
    (row) =>
      (row.expires_at === null || row.expires_at === undefined) && isNullExpiryRowDue(row, at, hoursForStatus)
  );
}

/** 이미 처리한 id 는 제외하며 primary + fallback 행을 배치 한도 안에서 병합한다(순수). */
export function mergeExpiryScanRows(
  primary: ExpiryScanRow[],
  fallback: ExpiryScanRow[],
  limit: number
): ExpiryScanRow[] {
  const out: ExpiryScanRow[] = [];
  const seen = new Set<string>();
  for (const row of [...primary, ...fallback]) {
    const id = getExpiryScanQuestionId(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}
