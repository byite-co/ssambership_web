/**
 * 관리자 쓰기 클라이언트 해석 — **fail-closed**.
 *
 * 배경(W4-A): 일부 관리자 액션이 아래처럼 service role 생성 실패를 삼키고
 * 일반 세션 클라이언트로 계속 진행했다.
 *
 *   try { return createServiceRoleClient(); } catch { return createClient(); }
 *
 * 이 폴백은 권한 상승은 아니지만(대상 테이블에 `is_admin()` 관리자 정책이 있고
 * 액션 첫 줄이 `requireRole("admin")` 이다) 두 가지 실질 피해가 있다.
 *   1. `SUPABASE_SERVICE_ROLE_KEY` 누락이 조용히 가려진다 — 운영 설정 사고가 드러나지 않는다.
 *   2. 의도한 service role 신뢰 경계가 사라진다. 실제로 `mentor_profiles` 에는 관리자 UPDATE
 *      정책이 없어(정책 4종: mentor_insert_own·mentor_select_own·mp_admin_select_all·
 *      mentor_update_own), 세션 클라이언트로 내려간 학적변경 승인은 요청 행만 approved 로 바꾸고
 *      `university_name` 은 0행 갱신으로 조용히 넘어가 성공으로 로깅된다(데이터 발산).
 *
 * 그래서 폴백을 없애고, service role 을 못 만들면 **처리하지 않는다**.
 * 저장소에 이미 같은 fail-closed 패턴이 있다(refundActions·adminReportActions·
 * walletTopupActions·confirmCashTopupServer) — 본 모듈은 그 관례로의 수렴이다.
 *
 * 세션 클라이언트를 인자로 받지 않으므로 **폴백이 구조적으로 불가능**하다.
 */

export const ADMIN_SERVICE_ROLE_UNAVAILABLE_MESSAGE =
  "서버 설정 오류로 처리할 수 없습니다. 관리자에게 문의해 주세요.";

export type AdminWriteClientResult<T> =
  | { ok: true; client: T }
  | { ok: false; message: string };

/**
 * service role 클라이언트만 반환한다. 생성 실패 시 `ok:false` —
 * 호출부는 반드시 중단해야 하며, 다른 클라이언트로 대체하지 않는다.
 */
export function resolveAdminWriteClient<T>(
  serviceRoleFactory: () => T
): AdminWriteClientResult<T> {
  try {
    return { ok: true, client: serviceRoleFactory() };
  } catch {
    return { ok: false, message: ADMIN_SERVICE_ROLE_UNAVAILABLE_MESSAGE };
  }
}
