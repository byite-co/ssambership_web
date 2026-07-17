import type { SupabaseClient } from "@supabase/supabase-js";

const TABLE_NOTICE = "app_notices" as const;
const TABLE_PROMOTION = "promotion_campaigns" as const;

function toTimestamptzOrNull(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  return t;
}

export type AdminNoticeInsertInput = {
  resource: "notice" | "promotion";
  title: string;
  body: string;
  target: string;
  start: string;
  end: string;
  active: boolean;
  actorUserId: string | null;
};

export async function insertAdminNoticeDraft(
  supabase: SupabaseClient,
  input: AdminNoticeInsertInput
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
    const id = data && typeof (data as { id?: unknown }).id === "string" ? (data as { id: string }).id : null;
    if (!id) return { ok: false, error: "저장 후 식별자를 확인할 수 없습니다." };
    return { ok: true, id };
  }

  const { data, error } = await supabase
    .from(TABLE_NOTICE)
    .insert({
      title: input.title,
      body: input.body,
      type: "notice",
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
  const id = data && typeof (data as { id?: unknown }).id === "string" ? (data as { id: string }).id : null;
  if (!id) return { ok: false, error: "저장 후 식별자를 확인할 수 없습니다." };
  return { ok: true, id };
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
