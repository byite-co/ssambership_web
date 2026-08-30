// 보정 크론 대상 선별 — 순수 모듈(node --test 대상).
//
// 크론 라우트에서 이 판정만 떼어낸 이유: "언제 만료로 내리는가"는 돈이 걸린 판정이고
// (만료로 내린 뒤 입금이 오면 회수 경로가 흐려진다) 시각 경계 버그가 나기 쉬워
// 계약 테스트로 고정해야 한다.
//
// 판정 규칙:
//   * expires_at 이 지났으면 → 만료 마킹 대상. 재조회하지 않는다.
//     (만료된 주문은 페이싱크가 더 이상 매칭하지 않으므로 적립될 일이 없다.)
//   * 그 외 pending → 재조회 대상.
//   * expires_at 이 null 이면 만료 없음 — 계속 재조회 대상으로 둔다.
//
// 만료 판정을 재조회보다 **먼저** 하는 이유: 만료된 주문까지 매번 API 를 때리면
// 오래된 pending 이 쌓일수록 크론이 느려지고 배치 상한을 만료 건이 잠식한다.

export type ReconcileCandidate = {
  id: string;
  paysync_invoice_id: string;
  issued_at: string;
  expires_at: string | null;
  status: string;
};

export type ReconcileSelection = {
  /** 페이싱크 재조회 후 적립 시도할 주문. */
  toRecover: ReconcileCandidate[];
  /** 로컬 expired 마킹만 할 주문(재조회 없음). */
  toExpire: ReconcileCandidate[];
};

function isExpiredAt(expiresAt: string | null, nowIso: string): boolean {
  if (!expiresAt) return false;
  const exp = Date.parse(expiresAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(exp) || !Number.isFinite(now)) return false;
  // 경계값(정확히 만료 시각)은 아직 만료가 아니다 — 그 순간 도착한 입금을 살린다.
  return now > exp;
}

export function selectReconcileTargets(
  candidates: ReconcileCandidate[],
  nowIso: string,
): ReconcileSelection {
  const toRecover: ReconcileCandidate[] = [];
  const toExpire: ReconcileCandidate[] = [];

  for (const c of candidates ?? []) {
    // pending 이 아닌 행이 섞여 들어오면 건드리지 않는다(쿼리가 이미 거르지만 이중 방어).
    if (c?.status !== "pending") continue;
    if (isExpiredAt(c.expires_at, nowIso)) {
      toExpire.push(c);
    } else {
      toRecover.push(c);
    }
  }

  return { toRecover, toExpire };
}
