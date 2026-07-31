import type { SupabaseClient } from "@supabase/supabase-js";
import { strictDeletionDecision } from "../appSession/appSurfaceAccountGate.ts";

/**
 * 계정 상태(active / suspended / banned) 판정 + 핵심 액션 차단 메시지.
 *
 * - suspended: 일시 정지. `suspended_until` 이 지난 경우 자동으로 active 로 간주(lazy).
 * - banned: 영구 차단.
 * - 차단 메시지는 학생/멘토 공통이며, 핵심 액션(질문·구독·커뮤니티 작성·캐시 출금 등)에서 사용.
 * - 쓰기 가드(assertAccountActive)는 **fail-closed** 다(계약 §11.5 — XW-15 해소, S2-2 C9).
 *   상태를 확인할 수 없으면(조회 오류·행 부재·예외·형식 오류) 통과시키지 않는다.
 */
export type AccountStatusInfo = {
  status?: string | null;
  suspended_until?: string | null;
};

export type EffectiveAccountStatus = "active" | "suspended" | "banned";

export function effectiveAccountStatus(
  info: AccountStatusInfo | null | undefined,
  now: Date = new Date()
): EffectiveAccountStatus {
  const raw = String(info?.status ?? "active").trim().toLowerCase();
  if (raw === "banned") return "banned";
  if (raw === "suspended") {
    const untilIso = info?.suspended_until;
    if (untilIso) {
      const until = new Date(untilIso);
      if (!Number.isNaN(until.getTime()) && until.getTime() <= now.getTime()) {
        return "active"; // 정지 기간 만료 → 자동 해제
      }
    }
    return "suspended";
  }
  return "active";
}

export function accountIsBlocked(
  info: AccountStatusInfo | null | undefined,
  now: Date = new Date()
): boolean {
  return effectiveAccountStatus(info, now) !== "active";
}

function formatUntil(untilIso: string | null | undefined): string | null {
  if (!untilIso) return null;
  const d = new Date(untilIso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function accountBlockMessage(
  info: AccountStatusInfo | null | undefined,
  now: Date = new Date()
): string | null {
  const status = effectiveAccountStatus(info, now);
  if (status === "active") return null;
  if (status === "banned") {
    return "계정이 영구 제한되어 이 작업을 할 수 없어요. 문의가 필요하면 고객센터로 연락해 주세요.";
  }
  const until = formatUntil(info?.suspended_until);
  return until
    ? `계정이 ${until}까지 일시 정지되어 이 작업을 할 수 없어요. 정지 해제 후 다시 이용해 주세요.`
    : "계정이 일시 정지되어 이 작업을 할 수 없어요. 정지 해제 후 다시 이용해 주세요.";
}

export type AccountGateDenyReason =
  | "banned"
  | "suspended"
  | "deletion_blocked" // 탈퇴 write-block (§11.5 ACCOUNT_DELETION_IN_PROGRESS 계열)
  | "row_missing" // users 행 부재 — 확인 불가는 곧 거부
  | "unverifiable"; // 조회 오류·예외·형식 오류 — 확인 불가는 곧 거부

export type AccountGateResult = { ok: true } | { ok: false; reason: AccountGateDenyReason; userMessage: string };

const UNVERIFIABLE_MESSAGE =
  "계정 상태를 확인하지 못해 요청을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.";
const DELETION_IN_PROGRESS_MESSAGE = "탈퇴 처리가 진행 중인 계정이라 이 작업을 할 수 없어요.";

function deny(reason: AccountGateDenyReason, userMessage: string): AccountGateResult {
  return { ok: false, reason, userMessage };
}

export type AccountActiveGateDeps = {
  fetchAccountRow: () => Promise<{ row: AccountStatusInfo | null; error: boolean }>;
  /** `public.account_deletion_status_self()` payload — 해석은 strictDeletionDecision 재사용 */
  fetchDeletionStatus: () => Promise<{ payload: unknown; error: boolean }>;
  now?: () => Date;
};

/**
 * DI 코어 — **fail-closed**(계약 §11.5). deps 예외 포함 모든 확인 불가를 거부로 수렴한다.
 * 판정식은 §11.5 그대로: banned → 거부, suspended AND (until NULL 또는 미래) → 거부(만료된
 * suspended 는 통과), 탈퇴 write-block → 거부. 그 외 상태 문자열은 §11.5 coalesce 식에 따라
 * 통과한다(effectiveAccountStatus). 오류 상세·원문 응답은 반환·기록하지 않는다.
 */
export async function assertAccountActiveCore(deps: AccountActiveGateDeps): Promise<AccountGateResult> {
  try {
    const account = await deps.fetchAccountRow();
    if (account.error) return deny("unverifiable", UNVERIFIABLE_MESSAGE);
    if (!account.row) return deny("row_missing", UNVERIFIABLE_MESSAGE);
    const now = deps.now ? deps.now() : new Date();
    const status = effectiveAccountStatus(account.row, now);
    if (status !== "active") {
      const msg = accountBlockMessage(account.row, now);
      return deny(status, msg ?? UNVERIFIABLE_MESSAGE);
    }
    const deletion = await deps.fetchDeletionStatus();
    const decision = strictDeletionDecision(deletion.payload, deletion.error);
    if (!decision.ok) {
      return decision.reason === "deletion_blocked"
        ? deny("deletion_blocked", DELETION_IN_PROGRESS_MESSAGE)
        : deny("unverifiable", UNVERIFIABLE_MESSAGE);
    }
    return { ok: true };
  } catch {
    return deny("unverifiable", UNVERIFIABLE_MESSAGE);
  }
}

/**
 * 서버 액션용 가드(supabase 어댑터). user 클라이언트로 본인 행(status, suspended_until)을 1회
 * 조회하고, 탈퇴 write-block 은 서버 정본 self RPC `account_deletion_status_self()`(SQL 161·175,
 * authenticated EXECUTE)로 확인한다. 구 status-only 재시도(스키마 추측 fallback)와 fail-open
 * (오류·행 부재·예외 → active) 은 제거됐다(S2-2 C9 — 계약 §11.5·XW-15).
 */
function isLikeText(v: unknown): v is string | null | undefined {
  return v === null || v === undefined || typeof v === "string";
}

/** 응답 형식 가드 — 형식 오류(비객체·비문자 필드)는 성공으로 바꾸지 않고 조회 오류로 취급한다. */
export function parseAccountRow(data: unknown): { row: AccountStatusInfo | null; error: boolean } {
  if (data === null || data === undefined) return { row: null, error: false };
  if (typeof data !== "object" || Array.isArray(data)) return { row: null, error: true };
  const candidate = data as { status?: unknown; suspended_until?: unknown };
  if (!isLikeText(candidate.status) || !isLikeText(candidate.suspended_until)) {
    return { row: null, error: true };
  }
  return {
    row: { status: candidate.status ?? null, suspended_until: candidate.suspended_until ?? null },
    error: false,
  };
}

export async function assertAccountActive(supabase: SupabaseClient, userId: string): Promise<AccountGateResult> {
  return assertAccountActiveCore({
    fetchAccountRow: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("status, suspended_until")
        .eq("id", userId)
        .maybeSingle();
      if (error) return { row: null, error: true };
      return parseAccountRow(data);
    },
    fetchDeletionStatus: async () => {
      const { data, error } = await supabase.rpc("account_deletion_status_self");
      return { payload: data ?? null, error: Boolean(error) };
    },
  });
}
