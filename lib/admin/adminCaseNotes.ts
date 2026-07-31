import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAdminUsersDisplayByIds } from "@/lib/admin/adminQueries";

const TABLE = "admin_case_notes" as const;

export type AdminCaseNoteTarget =
  | { kind: "dispute"; id: string }
  | { kind: "content_report"; id: string };

export type AdminCaseNote = {
  id: string;
  note: string;
  adminId: string | null;
  adminDisplay: string;
  createdAt: string;
  createdAtLabel: string;
};

export type AdminCaseNotesResult = {
  status: "ready" | "missing" | "error";
  notes: AdminCaseNote[];
  error: string | null;
};

export type InsertAdminCaseNoteResult = {
  ok: boolean;
  missing: boolean;
  error: string | null;
};

function targetColumn(target: AdminCaseNoteTarget): "dispute_id" | "report_id" {
  return target.kind === "dispute" ? "dispute_id" : "report_id";
}

// W4(C10): isMissingNotesTable(스키마 오류 → "missing" 상태 변환) 제거 — admin_case_notes 는
// 187 baseline 실존(084)이라 해당 분기는 도달 불가 레거시였다. 모든 조회·기록 오류는 error 로
// 전파한다. status "missing" 리터럴 타입은 UI 호환을 위해 유지(발생 경로 0).

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}...` : id;
}

function formatTsKo(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw || "-";
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function adminDisplay(
  adminId: string | null,
  userMap: Map<string, { nickname: string | null; full_name: string | null }>
): string {
  if (!adminId) return "관리자";
  const u = userMap.get(adminId);
  return u?.full_name?.trim() || u?.nickname?.trim() || `관리자 ${shortId(adminId)}`;
}

export async function loadAdminCaseNotes(
  supabase: SupabaseClient,
  target: AdminCaseNoteTarget,
  limit = 50
): Promise<AdminCaseNotesResult> {
  const col = targetColumn(target);
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, note, admin_id, created_at")
    .eq(col, target.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return { status: "error", notes: [], error: error.message };
  }

  const rows = (data ?? []) as Array<{
    id?: unknown;
    note?: unknown;
    admin_id?: unknown;
    created_at?: unknown;
  }>;
  const adminIds = rows
    .map((row) => (typeof row.admin_id === "string" ? row.admin_id : ""))
    .filter(Boolean);
  const userMap = await fetchAdminUsersDisplayByIds(supabase, adminIds);

  return {
    status: "ready",
    error: null,
    notes: rows.map((row, i) => {
      const id = row.id != null ? String(row.id) : String(i);
      const note = typeof row.note === "string" ? row.note : "";
      const adminId = typeof row.admin_id === "string" ? row.admin_id : null;
      const createdAt = row.created_at != null ? String(row.created_at) : "";
      return {
        id,
        note,
        adminId,
        adminDisplay: adminDisplay(adminId, userMap),
        createdAt,
        createdAtLabel: formatTsKo(createdAt),
      };
    }),
  };
}

export function loadAdminDisputeNotes(
  supabase: SupabaseClient,
  disputeId: string,
  limit?: number
): Promise<AdminCaseNotesResult> {
  return loadAdminCaseNotes(supabase, { kind: "dispute", id: disputeId }, limit);
}

export function loadAdminReportNotes(
  supabase: SupabaseClient,
  reportId: string,
  limit?: number
): Promise<AdminCaseNotesResult> {
  return loadAdminCaseNotes(supabase, { kind: "content_report", id: reportId }, limit);
}

export async function insertAdminCaseNote(
  supabase: SupabaseClient,
  input: AdminCaseNoteTarget & { note: string; adminId: string }
): Promise<InsertAdminCaseNoteResult> {
  const note = input.note.trim();
  if (!note) return { ok: false, missing: false, error: "메모 내용을 입력해 주세요." };

  const payload: Record<string, unknown> = {
    dispute_id: null,
    report_id: null,
    note,
    admin_id: input.adminId,
  };
  payload[targetColumn(input)] = input.id;

  const { error } = await supabase.from(TABLE).insert(payload);
  if (error) {
    return {
      ok: false,
      missing: false,
      error: error.message,
    };
  }
  return { ok: true, missing: false, error: null };
}

export function insertAdminDisputeNote(
  supabase: SupabaseClient,
  input: { disputeId: string; note: string; adminId: string }
): Promise<InsertAdminCaseNoteResult> {
  return insertAdminCaseNote(supabase, {
    kind: "dispute",
    id: input.disputeId,
    note: input.note,
    adminId: input.adminId,
  });
}

export function insertAdminReportNote(
  supabase: SupabaseClient,
  input: { reportId: string; note: string; adminId: string }
): Promise<InsertAdminCaseNoteResult> {
  return insertAdminCaseNote(supabase, {
    kind: "content_report",
    id: input.reportId,
    note: input.note,
    adminId: input.adminId,
  });
}

/** best-effort 메모 기록 — 부모 액션의 성패와 분리(문서화된 열화). 조치 자체의 정본 감사 기록은
 *  admin_action_logs(logAdminAction)가 담당한다.
 *  W4(C10): missing(스키마 부재) 에러만 로그를 생략하던 분기 제거 — admin_case_notes 는 187 baseline 에
 *  실존(084 SQL)하므로 모든 실패를 예외 없이 console.error 로 표면화한다. */
export async function tryInsertAdminDisputeNote(
  supabase: SupabaseClient,
  input: { disputeId: string; note: string; adminId: string }
): Promise<void> {
  if (!input.note.trim()) return;
  const result = await insertAdminDisputeNote(supabase, input);
  if (!result.ok) {
    console.error("[tryInsertAdminDisputeNote]", result.error);
  }
}

export async function tryInsertAdminReportNote(
  supabase: SupabaseClient,
  input: { reportId: string; note: string; adminId: string }
): Promise<void> {
  if (!input.note.trim()) return;
  const result = await insertAdminReportNote(supabase, input);
  if (!result.ok) {
    console.error("[tryInsertAdminReportNote]", result.error);
  }
}
