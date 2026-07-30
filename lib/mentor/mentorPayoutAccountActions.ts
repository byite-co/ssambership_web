"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/routeGuard";
import { callApiWebV1Rpc } from "@/lib/apiWebV1/rpc";
import { createClient } from "@/lib/supabase/server";

const PATH = "/mentor/payouts";

/** F13 오류코드(계약 §7 F13) → 사용자 문구. 원문 계좌번호는 어떤 경로에도 싣지 않는다. */
function f13CodeToUserMessage(code: string): string {
  switch (code) {
    case "AUTH_REQUIRED":
      return "로그인 정보가 만료되었어요. 다시 로그인해 주세요.";
    case "ROLE_NOT_MENTOR":
      return "멘토만 정산 계좌를 등록할 수 있어요.";
    case "MENTOR_NOT_APPROVED":
      return "멘토 승인 완료 후 정산 계좌를 등록할 수 있어요.";
    case "PAYOUT_BANK_NAME_INVALID":
      return "지원하지 않는 은행이에요. 목록에서 은행을 선택해 주세요.";
    case "PAYOUT_ACCOUNT_NUMBER_INVALID":
      return "계좌번호는 숫자 8~24자리로 입력해 주세요.";
    case "ACCOUNT_BANNED":
    case "ACCOUNT_SUSPENDED":
    case "ACCOUNT_DELETION_IN_PROGRESS":
      return "현재 계정 상태에서는 계좌 정보를 변경할 수 없어요.";
    default:
      return "계좌 정보를 저장하지 못했습니다.";
  }
}

/**
 * S2-2 전환 W2(C11): 정산계좌 저장 — F13
 * `api_web_v1.mentor_payout_account_update_self(p_bank_name, p_account_number)`
 * (계약 §7 F13 · §17 #31). 대상 행은 서버가 `auth.uid()` 로 도출하고(사용자 id 인자
 * 없음), 승인 멘토·은행 allowlist·계좌 형식 판정은 **DB 가 정본**이다. 구
 * `mentor_profiles.payout_*` 직접 UPDATE·컬럼 프로빙은 제거했고, 실패 시 직접
 * UPDATE fallback 을 만들지 않는다. 응답의 `account_masked` 외에는 계좌 원문을
 * 응답·로그·오류 문구 어디에도 싣지 않는다(§7 F13 — 원문 비반환).
 */
export async function updateMentorPayoutAccountAction(formData: FormData) {
  await requireRole("mentor");
  const bankName = String(formData.get("bankName") ?? "").trim();
  const accountNumber = String(formData.get("accountNumber") ?? "").replace(/\D/g, "").trim();

  if (!bankName) {
    return { ok: false as const, error: "은행을 선택해 주세요." };
  }
  if (!accountNumber) {
    return { ok: false as const, error: "계좌번호를 입력해 주세요." };
  }

  const supabase = await createClient();
  const res = await callApiWebV1Rpc(supabase, "mentor_payout_account_update_self", {
    p_bank_name: bankName,
    p_account_number: accountNumber,
  });
  if (!res.ok) {
    // 계좌 원문 비노출 — 코드만 로깅한다(메시지 원문에 인자가 없음은 F13 계약).
    console.error("[updateMentorPayoutAccountAction] mentor_payout_account_update_self", {
      code: res.code,
    });
    return { ok: false as const, error: f13CodeToUserMessage(res.code) };
  }

  revalidatePath(PATH);
  const masked = typeof res.row.account_masked === "string" ? res.row.account_masked : null;
  return { ok: true as const, accountMasked: masked };
}
