/**
 * 계정 삭제 worker 러너 설정 — 순수 함수(테스트 가능, 네트워크·DB 접근 0).
 *
 * 실측 전제(W4-B preflight):
 *   - worker 를 켜고 끄는 env 스위치는 **존재하지 않았다**(`WORKER_ENABLED`·
 *     `ACCOUNT_DELETION_WORKER_ENABLED` 모두 repo 전체 0건). 여기서 신설한다.
 *   - dry-run 은 job 행의 `account_deletion_jobs.dry_run`(DB 기본 true)에만 있었고
 *     러너 차원의 강제 수단이 없었다. 실제 삭제는 **세 조건이 모두 참**일 때만
 *     허용한다: 기능 플래그 ON + 러너 enabled + 명시적 dryRun=false.
 *   - 기존 cron 라우트 2종은 `RAW === "true" || RAW === "1"` 로만 켜진다(trim·소문자
 *     처리 없음). 같은 관례를 따르되, kill switch 이므로 **기본값은 off** 다.
 */

export const ACCOUNT_DELETION_WORKER_ENABLED_ENV = "ACCOUNT_DELETION_WORKER_ENABLED";

/** 기본 off — 명시적으로 "true"/"1" 일 때만 켜진다(기존 cron 라우트와 동일 파싱). */
export function isAccountDeletionWorkerEnabled(raw: string | undefined): boolean {
  const value = raw ?? "";
  return value === "true" || value === "1";
}

export type DeletionRunMode = {
  /** 러너가 job 을 집어도 되는가. false 면 아무 것도 claim 하지 않는다. */
  enabled: boolean;
  /** true 면 파괴적 단계(삭제·몰수·익명화·auth 삭제) 이전에 멈춘다. */
  dryRun: boolean;
  /** 왜 이 모드가 됐는지 — 응답·로그용(비밀 미포함). */
  reason: string;
};

/**
 * 실제 삭제(dryRun=false)는 세 조건이 **모두** 참일 때만.
 *   ① worker enabled  ② 요청이 명시적으로 dryRun=false  ③ 기능 플래그 ON
 * 하나라도 어긋나면 dry-run 으로 강등한다(파괴 동작 기본 금지).
 */
export function resolveDeletionRunMode(input: {
  workerEnabledRaw: string | undefined;
  featureEnabled: boolean;
  /** 쿼리스트링 등에서 온 명시 요청. 미지정이면 dry-run 이 기본. */
  requestedDryRun: boolean | undefined;
}): DeletionRunMode {
  const enabled = isAccountDeletionWorkerEnabled(input.workerEnabledRaw);
  if (!enabled) {
    return { enabled: false, dryRun: true, reason: "worker_disabled" };
  }
  if (!input.featureEnabled) {
    return { enabled: false, dryRun: true, reason: "feature_disabled" };
  }
  if (input.requestedDryRun !== false) {
    return { enabled: true, dryRun: true, reason: "dry_run_default" };
  }
  return { enabled: true, dryRun: false, reason: "real_run" };
}

/**
 * `?dryRun=` 파싱. 실제 삭제로 내려가는 값은 정확히 "false"/"0" 뿐이며,
 * 파라미터가 없으면 undefined(=dry-run 기본)로 남긴다.
 */
export function parseRequestedDryRun(raw: string | null): boolean | undefined {
  if (raw === null) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "false" || value === "0") return false;
  if (value === "true" || value === "1") return true;
  return undefined;
}

/** job 행의 dry_run 과 러너 모드를 합성 — 어느 한쪽이라도 dry 면 dry. */
export function effectiveJobDryRun(jobDryRun: boolean, mode: DeletionRunMode): boolean {
  return jobDryRun || mode.dryRun;
}

export const DEFAULT_DELETION_CLAIM_LIMIT = 5;
export const DEFAULT_DELETION_LEASE_SECONDS = 300;

/** claim 파라미터 정규화 — 상한을 둬 한 번에 과도하게 집지 않는다. */
export function resolveClaimParams(input: {
  limitRaw?: string | null;
  leaseSecondsRaw?: string | null;
}): { limit: number; leaseSeconds: number } {
  const limit = clampInt(input.limitRaw, DEFAULT_DELETION_CLAIM_LIMIT, 1, 20);
  const leaseSeconds = clampInt(input.leaseSecondsRaw, DEFAULT_DELETION_LEASE_SECONDS, 60, 3600);
  return { limit, leaseSeconds };
}

function clampInt(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  if (raw === null || raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
