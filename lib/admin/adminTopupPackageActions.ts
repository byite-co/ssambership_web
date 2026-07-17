"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/admin/adminActionLog";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";

const PATH = "/admin/settings";

function errQ(msg: string) {
  const q = new URLSearchParams();
  q.set("error", msg);
  return `${PATH}?${q.toString()}`;
}

/** 캐시 충전 패키지 노출 on/off — cash_topup_packages.active 토글(관리자 RLS). */
export async function toggleCashTopupPackageActiveAction(formData: FormData) {
  const { user } = await requireRole("admin");
  const id = String(formData.get("id") ?? "").trim();
  const nextActive = String(formData.get("nextActive") ?? "") === "true";
  if (!id) {
    redirect(errQ("대상 패키지를 식별할 수 없습니다."));
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cash_topup_packages")
    .update({ active: nextActive })
    .eq("id", id)
    .select("id");
  if (error) {
    redirect(errQ(toAdminDisplayError(error.message, "default") ?? "변경에 실패했습니다. 잠시 후 다시 시도해 주세요."));
  }
  if (!data?.length) {
    redirect(errQ("대상 패키지를 찾을 수 없습니다."));
  }

  await logAdminAction(supabase, {
    adminId: user.id,
    actionType: nextActive ? "topup_package_activated" : "topup_package_deactivated",
    targetType: "cash_topup_package",
    targetId: id,
    detail: { active: nextActive },
  });

  revalidatePath(PATH);
  revalidatePath("/wallet/charge");
  redirect(`${PATH}?ok=1`);
}
