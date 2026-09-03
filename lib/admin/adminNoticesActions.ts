"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { NOTICE_BASE_PATH, NOTICE_EDIT_PARAM, validateNoticeFormInput } from "@/lib/admin/noticeConsole";
import { insertAdminNoticeDraft, setAdminNoticeActive, updateAdminNotice } from "@/lib/admin/adminNoticesMutations";

const PATH = NOTICE_BASE_PATH;
/** 공개 공지 목록 — 저장·토글 직후 반영 */
const PUBLIC_NOTICES_PATH = "/notices";

function errQ(msg: string, editId?: string | null) {
  const q = new URLSearchParams();
  q.set("error", msg);
  if (editId) q.set(NOTICE_EDIT_PARAM, editId);
  return `${PATH}?${q.toString()}#notice-editor`;
}

function fieldStr(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/** 새 공지(PR-10 §1-3: 제목·유형·대상·기간·본문·노출 방식) — 프로모션은 구 폼 경로 그대로(실사용 0 · 삭제는 오너 결정 후). */
export async function submitAdminNoticeDraft(formData: FormData) {
  const { user } = await requireRole("admin");
  const supabase = await createClient();

  const resource = fieldStr(formData, "resource") === "promotion" ? "promotion" : "notice";

  if (resource === "promotion") {
    const title = fieldStr(formData, "title");
    if (!title) redirect(errQ("제목을 입력해 주세요."));
    const r = await insertAdminNoticeDraft(supabase, {
      resource: "promotion",
      title,
      body: fieldStr(formData, "body"),
      target: fieldStr(formData, "target"),
      start: fieldStr(formData, "start"),
      end: fieldStr(formData, "end"),
      active: formData.get("active") === "on",
      actorUserId: user?.id ?? null,
    });
    if (!r.ok) redirect(errQ(toAdminDisplayError(r.error, "notices") ?? "저장에 실패했습니다. 잠시 후 다시 시도해 주세요."));
    await logAdminAction(supabase, {
      adminId: user.id,
      actionType: "notice_created_promotion",
      targetType: "promotion_campaign",
      targetId: r.id,
      detail: { title, active: formData.get("active") === "on" },
    });
    revalidatePath(PATH);
    redirect(`${PATH}?ok=created&new=${encodeURIComponent(r.id)}`);
  }

  const validated = validateNoticeFormInput({
    title: fieldStr(formData, "title"),
    body: fieldStr(formData, "body"),
    type: fieldStr(formData, "type") || "notice",
    target: fieldStr(formData, "target") || "all",
    display_mode: fieldStr(formData, "display_mode") || "page",
    start: fieldStr(formData, "start"),
    end: fieldStr(formData, "end"),
    active: formData.get("active") === "on" ? "on" : "",
  });
  if (!validated.ok) redirect(errQ(validated.error));
  const v = validated.value;

  const r = await insertAdminNoticeDraft(supabase, {
    resource: "notice",
    title: v.title,
    body: v.body,
    type: v.type,
    target: v.target,
    displayMode: v.displayMode,
    start: v.start,
    end: v.end,
    active: v.active,
    actorUserId: user?.id ?? null,
  });

  if (!r.ok) {
    const safe = toAdminDisplayError(r.error, "notices") ?? "저장에 실패했습니다. 잠시 후 다시 시도해 주세요.";
    redirect(errQ(safe));
  }

  await logAdminAction(supabase, {
    adminId: user.id,
    actionType: "notice_created_notice",
    targetType: "app_notice",
    targetId: r.id,
    detail: { title: v.title, active: v.active, type: v.type, target: v.target, displayMode: v.displayMode },
  });

  revalidatePath(PATH);
  revalidatePath(PUBLIC_NOTICES_PATH);
  redirect(`${PATH}?ok=created&new=${encodeURIComponent(r.id)}`);
}

/** 공지 수정(PR-10 §1-3) — 같은 폼, 같은 검증. 감사 로그 `notice_updated_notice`. */
export async function updateAdminNoticeAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const supabase = await createClient();

  const id = fieldStr(formData, "id");
  if (!id) redirect(errQ("수정할 공지를 식별할 수 없습니다."));

  const validated = validateNoticeFormInput({
    title: fieldStr(formData, "title"),
    body: fieldStr(formData, "body"),
    type: fieldStr(formData, "type") || "notice",
    target: fieldStr(formData, "target") || "all",
    display_mode: fieldStr(formData, "display_mode") || "page",
    start: fieldStr(formData, "start"),
    end: fieldStr(formData, "end"),
    active: formData.get("active") === "on" ? "on" : "",
  });
  if (!validated.ok) redirect(errQ(validated.error, id));
  const v = validated.value;

  const r = await updateAdminNotice(supabase, {
    id,
    title: v.title,
    body: v.body,
    type: v.type,
    target: v.target,
    displayMode: v.displayMode,
    start: v.start,
    end: v.end,
    active: v.active,
    actorUserId: user.id,
  });
  if (!r.ok) {
    const safe = toAdminDisplayError(r.error, "notices") ?? "수정에 실패했습니다. 잠시 후 다시 시도해 주세요.";
    redirect(errQ(safe, id));
  }

  await logAdminAction(supabase, {
    adminId: user.id,
    actionType: "notice_updated_notice",
    targetType: "app_notice",
    targetId: id,
    detail: { title: v.title, active: v.active, type: v.type, target: v.target, displayMode: v.displayMode },
  });

  revalidatePath(PATH);
  revalidatePath(PUBLIC_NOTICES_PATH);
  redirect(`${PATH}?ok=updated`);
}

/** 공지·이벤트 활성/비활성 토글 — 생성 후 노출 중단·재개용. 팝업 공지의 활성화 확인(stateChange)은 화면(`NoticeListTable`)이 한다. */
export async function toggleAdminNoticeActiveAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const supabase = await createClient();

  const id = fieldStr(formData, "id");
  const resource = fieldStr(formData, "resource") === "promotion" ? "promotion" : "notice";
  const nextActive = fieldStr(formData, "nextActive") === "true";

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
  revalidatePath(PUBLIC_NOTICES_PATH);
  redirect(`${PATH}?ok=toggled`);
}
