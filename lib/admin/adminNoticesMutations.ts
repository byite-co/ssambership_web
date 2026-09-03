import type { SupabaseClient } from "@supabase/supabase-js";
import type { NoticeDisplayMode, NoticeTarget, NoticeType } from "@/lib/admin/noticeConsole";

const TABLE_NOTICE = "app_notices" as const;
const TABLE_PROMOTION = "promotion_campaigns" as const;

/** datetime-local(YYYY-MM-DDTHH:mm) — 관리자 노출기간 입력 폼의 KST 벽시계 값 */
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function toTimestamptzOrNull(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  // 무오프셋 datetime-local 입력은 KST 벽시계이므로 +09:00 을 부여해 저장한다
  // (TZ-FIX R2 #2 — 이미 오프셋(+, Z)이 붙은 값은 그대로 통과).
  if (DATETIME_LOCAL_RE.test(t)) return `${t}:00+09:00`;
  return t;
}

function idFromRow(data: unknown): string | null {
  return data && typeof (data as { id?: unknown }).id === "string" ? (data as { id: string }).id : null;
}

export type AdminPromotionInsertInput = {
  resource: "promotion";
  title: string;
  body: string;
  /** 프로모션은 구 폼의 자유 문자열 그대로(실사용 0 — 삭제는 오너 결정 후) */
  target: string;
  start: string;
  end: string;
  active: boolean;
  actorUserId: string | null;
};

/** PR-10: 공지는 `type` · `target`(사전 3값) · `display_mode`(page·popup) 를 함께 저장한다. 이미지 첨부 컬럼은 없다(DB 보류). */
export type AdminNoticeInsertInput = {
  resource: "notice";
  title: string;
  body: string;
  type: NoticeType;
  target: NoticeTarget;
  displayMode: NoticeDisplayMode;
  start: string;
  end: string;
  active: boolean;
  actorUserId: string | null;
};

export async function insertAdminNoticeDraft(
  supabase: SupabaseClient,
  input: AdminNoticeInsertInput | AdminPromotionInsertInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const uid = input.actorUserId;
  const startsAt = toTimestamptzOrNull(input.start);
  const endsAt = toTimestamptzOrNull(input.end);

  if (input.resource === "promotion") {
    const { data, error } = await supabase
      .from(TABLE_PROMOTION)
      .insert({
        title: input.title,
        body: input.body,
        target: input.target.trim() || null,
        is_active: input.active,
        starts_at: startsAt,
        ends_at: endsAt,
        created_by: uid,
        updated_by: uid,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    const id = idFromRow(data);
    if (!id) return { ok: false, error: "저장 후 식별자를 확인할 수 없습니다." };
    return { ok: true, id };
  }

  const { data, error } = await supabase
    .from(TABLE_NOTICE)
    .insert({
      title: input.title,
      body: input.body,
      type: input.type,
      target: input.target,
      display_mode: input.displayMode,
      is_active: input.active,
      starts_at: startsAt,
      ends_at: endsAt,
      created_by: uid,
      updated_by: uid,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  const id = idFromRow(data);
  if (!id) return { ok: false, error: "저장 후 식별자를 확인할 수 없습니다." };
  return { ok: true, id };
}

export type AdminNoticeUpdateInput = Omit<AdminNoticeInsertInput, "resource"> & { id: string };

/** 공지 수정(PR-10 §1-3) — `app_notices_update_admin` RLS(관리자) 아래에서 같은 열을 갱신한다. */
export async function updateAdminNotice(
  supabase: SupabaseClient,
  input: AdminNoticeUpdateInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from(TABLE_NOTICE)
    .update({
      title: input.title,
      body: input.body,
      type: input.type,
      target: input.target,
      display_mode: input.displayMode,
      is_active: input.active,
      starts_at: toTimestamptzOrNull(input.start),
      ends_at: toTimestamptzOrNull(input.end),
      updated_by: input.actorUserId,
    })
    .eq("id", input.id)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "대상을 찾을 수 없습니다." };
  return { ok: true };
}

export async function setAdminNoticeActive(
  supabase: SupabaseClient,
  input: { resource: "notice" | "promotion"; id: string; active: boolean; actorUserId: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const table = input.resource === "promotion" ? TABLE_PROMOTION : TABLE_NOTICE;
  const { data, error } = await supabase
    .from(table)
    .update({ is_active: input.active, updated_by: input.actorUserId })
    .eq("id", input.id)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "대상을 찾을 수 없습니다." };
  return { ok: true };
}
