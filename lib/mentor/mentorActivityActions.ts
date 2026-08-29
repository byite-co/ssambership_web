"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/routeGuard";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";
import {
  startMentorTermination,
  startMentorPause,
  resumeMentorActivity,
  flagMentorAbandonment,
} from "@/lib/mentor/mentorActivityService";

const MYPAGE = "/mentor/mypage";

function textFromForm(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
function backWith(key: "ok" | "error", msg: string): string {
  return `${MYPAGE}?${key}=${encodeURIComponent(msg)}`;
}

/** 완전 종료 신청(2주 공지 시작). */
export async function requestMentorTerminationAction() {
  const { user } = await requireRole("mentor");
  const admin = createServiceRoleClient();
  const res = await startMentorTermination(admin, user.id);
  revalidatePath(MYPAGE);
  if (!res.ok) redirect(backWith("error", res.error ?? "활동 종료 신청에 실패했습니다."));
  redirect(
    backWith(
      "ok",
      "활동 종료를 신청했습니다. 신규 구독이 중단되고, 2주 뒤 남은 기간 환불과 함께 정리됩니다. 유예 기간 동안 학생 응대를 부탁드려요."
    )
  );
}

/** 일시 중단 신청(최대 1주). reason: rest | illness, days: 1~7 */
export async function requestMentorPauseAction(formData: FormData) {
  const { user } = await requireRole("mentor");
  const reasonRaw = textFromForm(formData.get("reason")).toLowerCase();
  const reason = reasonRaw === "illness" ? "illness" : "rest";
  const days = Number.parseInt(textFromForm(formData.get("days")) || "7", 10);

  const admin = createServiceRoleClient();
  const res = await startMentorPause(admin, user.id, days, reason, new Date());
  revalidatePath(MYPAGE);
  if (!res.ok) redirect(backWith("error", res.error ?? "일시 중단 신청에 실패했습니다."));
  // TZ-FIX R3 #30: UTC ISO 앞 10자 절단 → KST 달력일 (formatKoreanDate, P-C).
  const until =
    res.summary && typeof res.summary.pauseUntil === "string"
      ? formatKoreanDate(res.summary.pauseUntil)
      : "";
  redirect(
    backWith(
      "ok",
      `일시 휴식이 시작됐어요${until ? ` (복귀 예정 ${until})` : ""}. 쉰 기간만큼 구독자 기간이 자동 연장됩니다.`
    )
  );
}

/** 조기 복귀. */
export async function resumeMentorActivityAction() {
  const { user } = await requireRole("mentor");
  const admin = createServiceRoleClient();
  const res = await resumeMentorActivity(admin, user.id);
  revalidatePath(MYPAGE);
  if (!res.ok) redirect(backWith("error", res.error ?? "복귀 처리에 실패했습니다."));
  redirect(backWith("ok", "활동을 재개했습니다. 다시 신규 구독을 받을 수 있어요."));
}

/** 즉시 떠남(무단 이탈) — 정산 보류 + 관리자 검토 큐. */
export async function requestMentorImmediateLeaveAction() {
  const { user } = await requireRole("mentor");
  const admin = createServiceRoleClient();
  const res = await flagMentorAbandonment(admin, user.id, "mentor_immediate_leave", new Date());
  revalidatePath(MYPAGE);
  if (!res.ok) redirect(backWith("error", res.error ?? "처리에 실패했습니다."));
  redirect(
    backWith(
      "ok",
      "즉시 종료 요청이 접수되었습니다. 2주 공지 없이 떠나는 경우 정산이 보류되며 관리자 확인 후 처리됩니다."
    )
  );
}
