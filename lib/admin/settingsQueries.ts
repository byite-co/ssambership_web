import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  SETTINGS_CAP_PROBE_MENTOR_ID,
  parseAppVersionPolicyRow,
  parseTopupPackageRow,
  type AdminAccountRow,
  type AppVersionPolicyRow,
  type SettingsCapInput,
  type TopupPackageRow,
} from "@/lib/admin/settingsConsole";
import { createSupabaseMentorCapDataSource, loadCapWeightByTier } from "@/lib/subscribe/mentorCapUsageCore";

/**
 * 관리자 · 시스템 설정(PR-10 §3) 서버 조회 — **조회 전용**(이 모듈에 쓰기 없음. 유일한 쓰기는 기존 `adminTopupPackageActions` 토글).
 * - 충전 패키지: 세션(관리자 RLS `pkg_*_admin`).
 * - 정원 가중치·기본 한도: DB 함수(`subscription_cap_weight` · `mentor_cap_limit`) — `mentorCapUsageCore` 어댑터(RPC 이름은 그 한 곳). 기본 한도는
 *   존재하지 않는 멘토 id 로 `mentor_cap_limit` 을 불러 함수의 행 부재 폴백을 그대로 읽는다(TS 사본 금지).
 * - 정산 설정(`payout_settings`)·앱 버전 정책(`mobile_app_version_policies`)·관리자 계정(`users`)은 관리자 RLS 가 없어 service_role 읽기
 *   (이중 requireRole admin 가드 뒤). 키가 없으면 `null`/빈 목록 — 화면이 `확인 불가` 로 그린다.
 */

type Row = Record<string, unknown>;

function serviceRoleOrNull(): SupabaseClient | null {
  try {
    return createServiceRoleClient();
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

export async function loadSettingsTopupPackages(session: SupabaseClient): Promise<{ rows: TopupPackageRow[]; error: string | null }> {
  const { data, error } = await session
    .from("cash_topup_packages")
    .select("id, label, amount_cents, price_cents, display_order, active")
    .order("display_order", { ascending: true });
  if (error) {
    console.error("[settings] cash_topup_packages 조회 실패:", error.message);
    return { rows: [], error: "충전 패키지 목록을 불러오지 못했습니다." };
  }
  const rows = ((data as Row[] | null) ?? []).map(parseTopupPackageRow).filter((x): x is TopupPackageRow => Boolean(x));
  return { rows, error: null };
}

/** 정원 정본 — DB 함수 값 그대로. 판정 불가면 null(추측값 금지). */
export async function loadSettingsCapPolicy(): Promise<SettingsCapInput> {
  const db = serviceRoleOrNull();
  if (!db) return { weights: null, defaultLimit: null };
  const source = createSupabaseMentorCapDataSource(db);
  const [weights, defaultLimit] = await Promise.all([loadCapWeightByTier(source), source.capLimit(SETTINGS_CAP_PROBE_MENTOR_ID)]);
  return { weights, defaultLimit };
}

/** `payout_settings.scheduler_enabled`(싱글턴 id=1) — 읽기만. 없거나 실패면 null. */
export async function loadSettingsPayoutScheduler(): Promise<boolean | null> {
  const db = serviceRoleOrNull();
  if (!db) return null;
  const { data, error } = await db.from("payout_settings").select("scheduler_enabled").eq("id", 1).maybeSingle();
  if (error) {
    console.error("[settings] payout_settings 조회 실패:", error.message);
    return null;
  }
  const v = (data as Row | null)?.scheduler_enabled;
  return typeof v === "boolean" ? v : null;
}

export async function loadSettingsAppVersionPolicies(): Promise<{ rows: AppVersionPolicyRow[]; error: string | null }> {
  const db = serviceRoleOrNull();
  if (!db) return { rows: [], error: "서버 설정(서비스 키)이 없어 앱 버전 정책을 읽을 수 없습니다." };
  const { data, error } = await db
    .from("mobile_app_version_policies")
    .select("platform, min_supported_build, latest_build, minimum_version_name, store_url, message, updated_at")
    .order("platform", { ascending: true });
  if (error) {
    console.error("[settings] mobile_app_version_policies 조회 실패:", error.message);
    return { rows: [], error: "앱 버전 정책을 불러오지 못했습니다." };
  }
  const rows = ((data as Row[] | null) ?? []).map(parseAppVersionPolicyRow).filter((x): x is AppVersionPolicyRow => Boolean(x));
  return { rows, error: null };
}

async function countLogsByAdmin(db: SupabaseClient, adminId: string): Promise<number | null> {
  const { count, error } = await db.from("admin_action_logs").select("id", { count: "exact", head: true }).eq("admin_id", adminId);
  if (error) {
    console.error("[settings] admin_action_logs 건수 조회 실패:", error.message);
    return null;
  }
  return count ?? 0;
}

/** 관리자 계정(`users.role='admin'`) + 각자 실행한 감사 로그 건수 — 조회만(추가·삭제 없음). */
export async function loadSettingsAdminAccounts(): Promise<{ rows: AdminAccountRow[]; error: string | null }> {
  const db = serviceRoleOrNull();
  if (!db) return { rows: [], error: "서버 설정(서비스 키)이 없어 관리자 계정을 읽을 수 없습니다." };
  const { data, error } = await db.from("users").select("id, email, full_name, nickname, created_at").eq("role", "admin").order("created_at", { ascending: true });
  if (error) {
    console.error("[settings] 관리자 계정 조회 실패:", error.message);
    return { rows: [], error: "관리자 계정을 불러오지 못했습니다." };
  }
  const base = ((data as Row[] | null) ?? [])
    .map((r) => ({ id: str(r.id), email: strOrNull(r.email), fullName: strOrNull(r.full_name), nickname: strOrNull(r.nickname), createdAt: strOrNull(r.created_at) }))
    .filter((r) => r.id);
  const counts = await Promise.all(base.map((r) => countLogsByAdmin(db, r.id)));
  return { rows: base.map((r, i) => ({ ...r, logCount: counts[i] ?? null })), error: null };
}
