"use server";

// 무통장입금 충전 서버 액션 (Phase 3 §5).
// 판정은 전부 paysyncInvoiceService 가 정본이고, 여기서는 인증·폼 파싱·리다이렉트만 한다.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWalletChargeAccess } from "@/lib/auth/routeGuard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import {
  cancelPaysyncInvoice,
  issuePaysyncInvoice,
  refreshPaysyncInvoice,
} from "@/lib/paysync/paysyncInvoiceService";

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 충전 요청 — 주문 발급 후 입금 안내 화면으로 보낸다. */
export async function requestPaysyncChargeAction(formData: FormData): Promise<void> {
  const { user } = await requireWalletChargeAccess();

  const payKrw = Number(textFromForm(formData.get("payKrw")));
  const depositorName = textFromForm(formData.get("depositorName"));

  const admin = createServiceRoleClient();
  const result = await issuePaysyncInvoice({ admin, userId: user.id, payKrw, depositorName });

  if (!result.ok) {
    redirect(`/wallet/charge?error=${encodeURIComponent(result.message)}`);
  }

  revalidatePath("/wallet/charge");
  revalidatePath("/wallet/ledger");
  redirect(`/wallet/charge/pending?id=${encodeURIComponent(result.invoice.id)}`);
}

/** 진행 중 주문 취소. */
export async function cancelPaysyncChargeAction(formData: FormData): Promise<void> {
  const { user } = await requireWalletChargeAccess();
  const localId = textFromForm(formData.get("localId"));

  const admin = createServiceRoleClient();
  const result = await cancelPaysyncInvoice({ admin, userId: user.id, localId });

  revalidatePath("/wallet/charge");
  revalidatePath("/wallet/ledger");

  if (!result.ok) {
    redirect(`/wallet/charge/pending?id=${encodeURIComponent(localId)}&error=${encodeURIComponent(result.message)}`);
  }
  redirect("/wallet/charge?canceled=1");
}

/** "입금했는데 확인이 안 돼요" — 크론과 같은 경로로 즉시 재확인. */
export async function refreshPaysyncChargeAction(formData: FormData): Promise<void> {
  const { user } = await requireWalletChargeAccess();
  const localId = textFromForm(formData.get("localId"));

  const admin = createServiceRoleClient();
  const result = await refreshPaysyncInvoice({ admin, userId: user.id, localId });

  revalidatePath("/wallet/charge/pending");
  revalidatePath("/wallet/ledger");
  revalidatePath("/wallet");

  const key = result.ok && result.credited ? "credited" : result.ok ? "notice" : "error";
  redirect(
    `/wallet/charge/pending?id=${encodeURIComponent(localId)}&${key}=${encodeURIComponent(result.message)}`,
  );
}
