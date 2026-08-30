import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// .ts 확장자 명시: playwright 외에 node --experimental-strip-types 러너
// (scripts/e2e/runTossGateE2e.ts)도 이 모듈을 import 한다(확장자 없으면 node 해석 실패).
import { loadEnvLocal } from "./env.ts";

const env = loadEnvLocal();
const URL = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

let _admin: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  if (!URL || !SERVICE_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 필요합니다.");
  }
  if (!_admin) _admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
  return _admin;
}

export async function userIdByEmail(email: string): Promise<string> {
  const { data, error } = await admin().from("users").select("id").eq("email", email).maybeSingle();
  if (error) throw new Error(`userIdByEmail(${email}) error: ${error.message}`);
  if (!data?.id) throw new Error(`userIdByEmail(${email}): users 행 없음`);
  return data.id as string;
}

export async function walletBalance(userId: string): Promise<number> {
  const { data, error } = await admin()
    .from("cash_wallets")
    .select("balance_cents")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`walletBalance error: ${error.message}`);
  return Number(data?.balance_cents ?? 0);
}

/** 테스트 시드 충전 — 테스트 충전과 동일한 record_cash_topup RPC(서비스롤). idempotency에 e2e-test 표식. */
export async function seedCash(userId: string, amountCents: number): Promise<void> {
  const { error } = await admin().rpc("record_cash_topup", {
    p_user_id: userId,
    p_amount_cents: amountCents,
    p_idempotency_key: `e2e-test-topup:${userId}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
  });
  if (error) throw new Error(`seedCash(record_cash_topup) error: ${error.message}`);
}

export type IqRow = {
  id: string;
  status: string;
  question_type: string;
  price_cents: number;
  student_id: string;
  designated_mentor_id: string | null;
  claimed_mentor_id: string | null;
  hold_ledger_id: string | null;
  release_ledger_id: string | null;
  title: string;
};

export async function iqByTitle(title: string): Promise<IqRow | null> {
  const { data, error } = await admin()
    .from("individual_questions")
    .select("*")
    .eq("title", title)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`iqByTitle error: ${error.message}`);
  return (data as IqRow) ?? null;
}

export async function iqById(id: string): Promise<IqRow | null> {
  const { data, error } = await admin().from("individual_questions").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`iqById error: ${error.message}`);
  return (data as IqRow) ?? null;
}

export type LedgerRow = {
  delta_cents: number;
  reason: string | null;
  ref_type: string | null;
  ref_id: string | null;
  idempotency_key: string | null;
};

/** status가 기대값이 될 때까지 폴링(서버 액션 비동기 반영 대비). */
export async function waitForIqStatus(id: string, status: string, timeoutMs = 30_000): Promise<IqRow> {
  const start = Date.now();
  let last: IqRow | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await iqById(id);
    if (last && last.status === status) return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`waitForIqStatus(${id}, ${status}) timeout. 현재 status=${last?.status ?? "없음"}`);
}

/** 제목으로 IQ 생성될 때까지 폴링. */
export async function waitForIqByTitle(title: string, timeoutMs = 30_000): Promise<IqRow> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const iq = await iqByTitle(title);
    if (iq) return iq;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`waitForIqByTitle(${title}) timeout — 생성 안 됨`);
}

/** 학생의 기존 IQ id 집합(생성 전 스냅샷). */
export async function iqIdsForStudent(studentId: string): Promise<Set<string>> {
  const { data, error } = await admin()
    .from("individual_questions")
    .select("id")
    .eq("student_id", studentId);
  if (error) throw new Error(`iqIdsForStudent error: ${error.message}`);
  return new Set((data ?? []).map((r: { id: string }) => r.id));
}

/** 제목 마스킹 영향 없이 — 학생의 '새 IQ 행'이 생길 때까지 폴링(exclude에 없는 최신 행). */
export async function waitForNewIqForStudent(
  studentId: string,
  exclude: Set<string>,
  timeoutMs = 30_000
): Promise<IqRow> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await admin()
      .from("individual_questions")
      .select("*")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(`waitForNewIqForStudent error: ${error.message}`);
    const fresh = (data as IqRow[] | null)?.find((r) => !exclude.has(r.id));
    if (fresh) return fresh;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`waitForNewIqForStudent timeout — 새 IQ 생성 안 됨(학생 ${studentId})`);
}

export async function ledgerForRef(userId: string, refId: string): Promise<LedgerRow[]> {
  const { data, error } = await admin()
    .from("cash_ledger")
    .select("delta_cents,reason,ref_type,ref_id,idempotency_key")
    .eq("user_id", userId)
    .eq("ref_id", refId);
  if (error) throw new Error(`ledgerForRef error: ${error.message}`);
  return (data as LedgerRow[]) ?? [];
}
