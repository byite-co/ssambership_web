"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { requireRole } from "@/lib/auth/routeGuard";
import { isSchoolTier, isVerifiedMajorCategory } from "@/lib/mentor/schoolClassificationCatalog";
import { createClient } from "@/lib/supabase/server";
import { mapDataErrorMessage } from "@/lib/utils/mapDataError";

const PATH = "/admin/school-classifications";

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function errUrl(message: string): string {
  const q = new URLSearchParams();
  q.set("error", message);
  return `${PATH}?${q.toString()}`;
}

function okUrl(kind: string): string {
  return `${PATH}?ok=${encodeURIComponent(kind)}`;
}

function displayOrderFromForm(formData: FormData): number {
  const raw = textFromForm(formData.get("displayOrder"));
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

async function logClassificationAction(
  supabase: SupabaseClient,
  adminId: string,
  actionType: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown>
): Promise<void> {
  await logAdminAction(supabase, {
    adminId,
    actionType,
    targetType,
    targetId,
    detail,
  });
}

async function updateCatalogRow(
  formData: FormData,
  args: {
    table: "school_tier_catalog" | "major_category_catalog";
    actionType: string;
    targetType: string;
    validateCode: (value: string) => boolean;
  }
) {
  const { user } = await requireRole("admin");
  const code = textFromForm(formData.get("code"));
  const label = textFromForm(formData.get("label"));
  const displayOrder = displayOrderFromForm(formData);
  const isActive = formData.get("isActive") === "on";

  if (!args.validateCode(code)) {
    redirect(errUrl("분류 코드를 확인할 수 없습니다."));
  }
  if (!label) {
    redirect(errUrl("라벨을 입력해 주세요."));
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(args.table)
    .update({
      label,
      display_order: displayOrder,
      is_active: isActive,
    })
    .eq("code", code)
    .select("code")
    .maybeSingle();

  if (error) {
    redirect(errUrl(mapDataErrorMessage(error.message)));
  }
  if (!data) {
    redirect(errUrl("저장할 분류 행을 찾지 못했습니다. 079 SQL 적용 여부를 확인해 주세요."));
  }

  await logClassificationAction(supabase, user.id, args.actionType, args.targetType, code, {
    label,
    displayOrder,
    isActive,
  });

  revalidatePath(PATH);
  revalidatePath("/admin/mentor-approval");
  revalidatePath("/mentors");
  redirect(okUrl("catalog"));
}

export async function updateSchoolTierCatalogAction(formData: FormData) {
  await updateCatalogRow(formData, {
    table: "school_tier_catalog",
    actionType: "school_tier_catalog_update",
    targetType: "school_tier_catalog",
    validateCode: isSchoolTier,
  });
}

export async function updateMajorCategoryCatalogAction(formData: FormData) {
  await updateCatalogRow(formData, {
    table: "major_category_catalog",
    actionType: "major_category_catalog_update",
    targetType: "major_category_catalog",
    validateCode: isVerifiedMajorCategory,
  });
}
