import type { SupabaseClient } from "@supabase/supabase-js";

// 앱(WebView) 표면 전용 계정 게이트 — **fail-closed**.
//
// 일반 웹의 assertAccountActive(lib/auth/accountStatus.ts)도 S2-2 C9(계약 §11.5)로
// fail-closed 로 정합화됐다(확인 불가 = 거부). 두 게이트의 차이는 방향이 아니라 엄격도다:
// 이 모듈은 status **allowlist**(미지 값도 거부)를 쓰고, 웹 게이트는 §11.5 coalesce 판정식
// (banned/suspended 외 상태 문자열은 통과)을 쓴다. 앱 표면(bootstrap·서명 티켓·finalize)은
// 세션 쿠키와 쓰기 권한을 발급하는 진입점이므로 이 모듈의 strict 게이트만 사용한다.
//
// 3층 구조(계약 테스트는 순수 판정·DI 코어의 실제 반환값을 table-driven 으로 검증):
//   1) strictAccountStatusDecision / strictDeletionDecision / strictMentorRoleDecision — 순수
//   2) assertAppSurfaceAccountActiveStrictCore(deps) — DI(예외 포함) 코어
//   3) assertAppSurfaceAccountActiveStrict(supabase, userId) — supabase 어댑터
//
// 삭제 상태는 서버 정본 self RPC `account_deletion_status_self()`(SQL 161,
// SECURITY DEFINER·authenticated EXECUTE)를 재사용한다 — service_role 을 앱 표면에
// 추가·노출하지 않는다.

export type AppSurfaceGateDenyReason =
  | "query_error" // 조회 오류·예외 — 확인 불가는 곧 거부
  | "row_missing" // users 행 없음
  | "status_unknown" // NULL·비문자·allowlist 밖 status
  | "suspended" // 현재 유효한 일시 정지(suspended_until 부재 포함)
  | "suspended_until_invalid" // suspended_until 해석 불가
  | "banned"
  | "deletion_blocked" // write_blocked=true (pending/locked/purging/deleted 등)
  | "deletion_unknown"; // RPC 실패·payload 해석 불가 — 확인 불가는 곧 거부

export type AppSurfaceGateResult = { ok: true } | { ok: false; reason: AppSurfaceGateDenyReason };

export type AppSurfaceAccountRow = {
  status?: unknown;
  suspended_until?: unknown;
};

/**
 * users 상태 순수 판정 — raw status **allowlist** 우선.
 * 허용은 정확히 2가지: `active`, 그리고 `suspended` 인데 suspended_until 이 유효하게
 * 파싱되며 이미 지난 경우(만료된 정지). 그 외(유효 suspended·banned·미지/NULL status·
 * 행 없음·조회 오류·형식 오류)는 전부 거부한다.
 * effectiveAccountStatus() 의 "미지 값 → active" 폴백을 의도적으로 쓰지 않는다.
 */
export function strictAccountStatusDecision(
  row: AppSurfaceAccountRow | null | undefined,
  hadQueryError: boolean,
  now: Date = new Date(),
): AppSurfaceGateResult {
  if (hadQueryError) return { ok: false, reason: "query_error" };
  if (!row) return { ok: false, reason: "row_missing" };
  const raw = typeof row.status === "string" ? row.status.trim().toLowerCase() : null;
  if (raw === "active") return { ok: true };
  if (raw === "banned") return { ok: false, reason: "banned" };
  if (raw === "suspended") {
    const untilRaw = row.suspended_until;
    if (typeof untilRaw !== "string" || untilRaw.trim() === "") {
      return { ok: false, reason: "suspended" }; // 기한 미상 정지 — 유효 정지로 취급
    }
    const until = new Date(untilRaw);
    if (Number.isNaN(until.getTime())) return { ok: false, reason: "suspended_until_invalid" };
    if (until.getTime() <= now.getTime()) return { ok: true }; // 만료된 정지 → 허용
    return { ok: false, reason: "suspended" };
  }
  return { ok: false, reason: "status_unknown" };
}

/**
 * 계정 삭제 write-block 순수 판정 — `account_deletion_status_self()` payload 해석.
 * `ok===true && write_blocked===false` 만 통과. write_blocked=true(대기·잠금·삭제 중·완료)는
 * 거부, RPC 실패·형식 불명·필드 누락도 전부 거부(확인 불가 = 거부).
 */
export function strictDeletionDecision(payload: unknown, hadRpcError: boolean): AppSurfaceGateResult {
  if (hadRpcError) return { ok: false, reason: "deletion_unknown" };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, reason: "deletion_unknown" };
  }
  const p = payload as { ok?: unknown; write_blocked?: unknown };
  if (p.ok !== true) return { ok: false, reason: "deletion_unknown" };
  if (p.write_blocked === true) return { ok: false, reason: "deletion_blocked" };
  if (p.write_blocked === false) return { ok: true };
  return { ok: false, reason: "deletion_unknown" };
}

export type AppSurfaceRoleDecision = "ok" | "profile_unavailable" | "not_mentor";

/** mentor role 순수 판정 — 조회 실패·행 없음은 확인 불가(거부), mentor 외 role 전부 거부. */
export function strictMentorRoleDecision(
  profile: { role?: unknown } | null | undefined,
  hadQueryError: boolean,
): AppSurfaceRoleDecision {
  if (hadQueryError || !profile) return "profile_unavailable";
  return profile.role === "mentor" ? "ok" : "not_mentor";
}

export type AppSurfaceAccountGateDeps = {
  fetchAccountRow: () => Promise<{ row: AppSurfaceAccountRow | null; error: boolean }>;
  fetchDeletionStatus: () => Promise<{ payload: unknown; error: boolean }>;
  now?: () => Date;
};

/** DI 코어 — deps 의 예외까지 fail-closed 로 흡수한다(내부 오류 내용은 반환하지 않는다). */
export async function assertAppSurfaceAccountActiveStrictCore(
  deps: AppSurfaceAccountGateDeps,
): Promise<AppSurfaceGateResult> {
  try {
    const account = await deps.fetchAccountRow();
    const statusDecision = strictAccountStatusDecision(
      account.row,
      account.error,
      deps.now ? deps.now() : new Date(),
    );
    if (!statusDecision.ok) return statusDecision;
    const deletion = await deps.fetchDeletionStatus();
    return strictDeletionDecision(deletion.payload, deletion.error);
  } catch {
    return { ok: false, reason: "query_error" };
  }
}

/** supabase 어댑터 — 앱 표면 액션·라우트가 쓰기 전 매 요청 호출한다(부트스트랩 이후 정지·삭제도 차단). */
export async function assertAppSurfaceAccountActiveStrict(
  supabase: SupabaseClient,
  userId: string,
): Promise<AppSurfaceGateResult> {
  return assertAppSurfaceAccountActiveStrictCore({
    fetchAccountRow: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("status, suspended_until")
        .eq("id", userId)
        .maybeSingle();
      return { row: (data as AppSurfaceAccountRow | null) ?? null, error: Boolean(error) };
    },
    fetchDeletionStatus: async () => {
      const { data, error } = await supabase.rpc("account_deletion_status_self");
      return { payload: data ?? null, error: Boolean(error) };
    },
  });
}
