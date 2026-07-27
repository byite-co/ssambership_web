"use server";

import { redirect } from "next/navigation";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { checkAccountDeletionPreconditions } from "@/lib/account/accountDeletionPreconditions";
import { isAccountDeletionFeatureEnabled } from "@/lib/shell/featureFlags";
import { createServiceRoleClient } from "@/lib/supabase/admin";

/**
 * 회원 탈퇴 서버 액션 — **saga 요청 생성 정본**(W5 §3-5).
 *
 * ── 무엇이 바뀌었나 ──────────────────────────────────────────────────────────
 * 이전에는 이 액션이 그 자리에서 파괴를 끝냈다:
 *   몰수 원장 insert → anonymize_user_for_deletion RPC → profile-avatars remove →
 *   student-id-images remove → auth.admin.deleteUser(uid, true).
 * 반면 앱·self RPC 는 saga job 을 만든다. **두 정본이 공존**했고, 웹 즉시 경로가 청소하는
 * 버킷은 2개뿐이라 나머지 11개 버킷의 사용자 객체는 조용히 남았다.
 *
 * 이제 웹도 **saga job 하나만 만든다**. 실제 파괴는 worker 가
 * (kill switch ON + dryRun=false 일 때만) 단계별 게이트를 통과하며 수행한다.
 * 즉시 삭제를 기대하던 호출부는 `components/account/AccountDeletionForm.tsx` 하나뿐이며,
 * 그 폼은 이제 "요청 접수 + 취소 창 안내" 동선을 받는다.
 *
 * ── 유지되는 것(§3-5-A(a)) ───────────────────────────────────────────────────
 * 비밀번호 재인증 · 사전조건 · 고지 동의(`understood`) 는 saga 전환 후에도 그대로 강제한다.
 * 이 세 관문을 통과한 뒤에만 사용자·job·동의 금액을 결합한 **서버 기록**을 만든다.
 *
 * ── 정본 익명화 RPC 선택(§3-5 계약 1) ────────────────────────────────────────
 * `account_deletion_forfeit_and_anonymize` 를 정본으로 삼는다. 이 함수는
 * `anonymize_user_for_deletion`(115) 의 **상위 집합**이다 —
 *   · state='storage_purged' 게이트(Storage 성공 전 금융·익명화 금지)
 *   · 몰수 원장 append-only + 지갑 0화(멱등키 `acct_del_forfeit:{uid}`)
 *   · 176 의 동의 3층 재검증
 *   · 그리고 마지막에 115 를 그대로 호출해 PII 익명화·감사 로그를 수행
 * 115 는 폐기하지 않고 하위 단계로 존속한다.
 */

const CANCELABLE_MINUTES = 30;

export async function requestAccountDeletion(formData: FormData): Promise<void> {
  const back = (msg: string): never => redirect(`/account/delete?error=${encodeURIComponent(msg)}`);

  if (!isAccountDeletionFeatureEnabled()) redirect("/mypage");

  // 1) 세션 확인
  const { user, profile } = await getServerUserWithProfile();
  if (!user || !profile) redirect(`/login/student?next=${encodeURIComponent("/account/delete")}`);
  const role = profile.role === "mentor" ? "mentor" : "student";
  if (profile.role === "admin") back("관리자 계정은 이 화면에서 탈퇴할 수 없습니다.");

  // 2) 입력 검증 — 고지 동의는 saga 전환 후에도 그대로 필수
  const password = String(formData.get("password") ?? "");
  const understood = formData.get("understood") === "on";
  const forfeitConsent = formData.get("forfeitConsent") === "on";
  if (!understood) back("고지 내용을 확인하고 동의 체크가 필요합니다.");
  if (!password) back("비밀번호를 입력해 주세요.");
  const email = user.email;
  if (!email) back("이메일 정보가 없어 재인증할 수 없습니다. 고객센터로 문의해 주세요.");

  // 3) 비밀번호 재인증 — 세션 쿠키를 건드리지 않는 일회용 클라이언트로 검증만
  const bare = createBareClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const reauth = await bare.auth.signInWithPassword({ email: email as string, password });
  if (reauth.error) back("비밀번호가 일치하지 않습니다.");

  // 4) 사전조건
  const admin = createServiceRoleClient();
  const pre = await checkAccountDeletionPreconditions(admin, user.id, role);
  if (!pre.blockersOk) back("탈퇴 사전조건이 충족되지 않았습니다. 미충족 항목을 해결한 뒤 다시 시도해 주세요.");
  if (pre.walletBalanceCents > 0 && !forfeitConsent) {
    back("남은 캐시가 있습니다. 환불 신청을 먼저 진행하거나, 잔액 소멸에 동의해야 탈퇴할 수 있습니다.");
  }

  // 5) saga 요청 생성 — 즉시 파괴 단계 없음.
  //    잔액이 양수면 동의를 job 행에 박제한다(서버가 잔액을 다시 읽고, 화면에서 본 금액과
  //    어긋나면 STALE 로 거절). 잔액 0 이면 동의 없이 진행한다.
  const { data, error } = await admin.rpc("account_deletion_request_consented", {
    p_user_id: user.id,
    p_cancelable_minutes: CANCELABLE_MINUTES,
    p_dry_run: false,
    p_forfeit_consent: pre.walletBalanceCents > 0 ? forfeitConsent : false,
    p_acknowledged_balance_cents: pre.walletBalanceCents > 0 ? pre.walletBalanceCents : null,
  });
  if (error) back("탈퇴 요청 접수에 실패했습니다. 잠시 후 다시 시도해 주세요.");

  const row = (data ?? {}) as { ok?: boolean; code?: string };
  if (row.ok !== true) {
    back(deletionRequestErrorMessage(row.code));
  }

  // 6) 접수 완료 — 취소 창 안내로 이동(즉시 로그아웃하지 않는다: 창 안에서 취소할 수 있어야 한다).
  redirect("/account/delete?requested=1");
}

/** 취소 창 안에서 본인 탈퇴 요청을 철회한다(pending + cancelable_until 이내만). */
export async function cancelAccountDeletion(): Promise<void> {
  const back = (msg: string): never => redirect(`/account/delete?error=${encodeURIComponent(msg)}`);

  if (!isAccountDeletionFeatureEnabled()) redirect("/mypage");

  const { user, profile } = await getServerUserWithProfile();
  if (!user || !profile) redirect(`/login/student?next=${encodeURIComponent("/account/delete")}`);

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("account_deletion_cancel", { p_user_id: user.id });
  if (error) back("탈퇴 취소에 실패했습니다. 잠시 후 다시 시도해 주세요.");

  const row = (data ?? {}) as { ok?: boolean; code?: string };
  if (row.ok !== true) {
    if (row.code === "CANCEL_WINDOW_PASSED") back("취소 가능 시간이 지났습니다.");
    if (row.code === "NOT_CANCELABLE") back("이미 삭제가 시작되어 취소할 수 없습니다.");
    back("취소할 탈퇴 요청이 없습니다.");
  }

  redirect("/account/delete?canceled=1");
}

function deletionRequestErrorMessage(code: string | undefined): string {
  switch (code) {
    case "FORFEIT_CONSENT_REQUIRED":
      return "남은 캐시가 있습니다. 환불 신청을 먼저 진행하거나, 잔액 소멸에 동의해야 탈퇴할 수 있습니다.";
    case "FORFEIT_CONSENT_STALE":
      return "잔액이 변경되었습니다. 화면을 새로고침한 뒤 다시 동의해 주세요.";
    case "ALREADY_COMPLETED":
      return "이미 탈퇴가 완료된 계정입니다.";
    default:
      return "탈퇴 요청 접수에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }
}
