"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { insertAdminNoticeDraft, setAdminNoticeActive } from "@/lib/admin/adminNoticesMutations";

const PATH = "/admin/notices";

function errQ(msg: string) {
  const q = new URLSearchParams();
  q.set("error", msg);
  return `${PATH}?${q.toString()}`;
}

export async function submitAdminNoticeDraft(formData: FormData) {
  const { user } = await requireRole("admin");
  const supabase = await createClient();

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const resource = String(formData.get("resource") ?? "notice") === "promotion" ? "promotion" : "notice";
  const target = String(formData.get("target") ?? "").trim();
  const start = String(formData.get("start") ?? "").trim();
  const end = String(formData.get("end") ?? "").trim();
  const active = formData.get("active") === "on";

  if (!title) {
    redirect(errQ("제목을 입력해 주세요."));
  }

  const r = await insertAdminNoticeDraft(supabase, {
    resource,
    title,
    body,
    target,
    start,
    end,
    active,
    actorUserId: user?.id ?? null,
  });

  if (!r.ok) {
    const safe = toAdminDisplayError(r.error, "notices") ?? "저장에 실패했습니다. 잠시 후 다시 시도해 주세요.";
    redirect(errQ(safe));
  }

  await logAdminAction(supabase, {
    adminId: user.id,
    actionType: `notice_created_${resource}`,
    targetType: resource === "promotion" ? "promotion_campaign" : "app_notice",
    targetId: r.id,
    detail: { title, active },
  });

  revalidatePath(PATH);
  redirect(`${PATH}?ok=1&new=${encodeURIComponent(r.id)}`);
}

/** 공지·이벤트 활성/비활성 토글 — 생성 후 노출 중단·재개용. */
export async function toggleAdminNoticeActiveAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const supabase = await createClient();

  const id = String(formData.get("id") ?? "").trim();
  const resource = String(formData.get("resource") ?? "notice") === "promotion" ? "promotion" : "notice";
  const nextActive = String(formData.get("nextActive") ?? "") === "true";

  if (!id) {
    redirect(errQ("대상을 식별할 수 없습니다."));
  }

  const r = await setAdminNoticeActive(supabase, { resource, id, active: nextActive, actorUserId: user.id });
  if (!r.ok) {
    const safe = toAdminDisplayError(r.error, "notices") ?? "변경에 실패했습니다. 잠시 후 다시 시도해 주세요.";
    redirect(errQ(safe));
  }

  await logAdminAction(supabase, {
    adminId: user.id,
    actionType: nextActive ? `notice_activated_${resource}` : `notice_deactivated_${resource}`,
    targetType: resource === "promotion" ? "promotion_campaign" : "app_notice",
    targetId: id,
    detail: { active: nextActive },
  });

  revalidatePath(PATH);
  redirect(`${PATH}?ok=1`);
}
