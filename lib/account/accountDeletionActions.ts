"use server";

import { redirect } from "next/navigation";
import { createClient as createBareClient } from "@supabase/supabase-js";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { checkAccountDeletionPreconditions } from "@/lib/account/accountDeletionPreconditions";
import { isAccountDeletionFeatureEnabled } from "@/lib/shell/featureFlags";
import { MENTOR_AVATAR_BUCKET } from "@/lib/storage/mentorAvatarStorage";
import { STUDENT_ID_IMAGES_BUCKET } from "@/lib/storage/studentIdImageStorage";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * 회원 탈퇴 서버 액션 (스펙 docs/plans/account-deletion-spec.md §2).
 * 흐름: 세션 확인 → 비밀번호 재인증 → 사전조건 → (동의 시) 잔액 소멸 상계 →
 *       익명화 RPC → 아바타 삭제 → auth soft-delete → 전역 로그아웃 → /goodbye.
 * 물리 삭제 없음 — cash_ledger는 append-only 상계 라인 1건(소멸 동의 시)만 추가.
 * ※ soft-delete 사용자의 동일 이메일 재가입 정책은 스펙 외(추후 결정).
 */
export async function requestAccountDeletion(formData: FormData): Promise<void> {
  const back = (msg: string): never => redirect(`/account/delete?error=${encodeURIComponent(msg)}`);

  if (!isAccountDeletionFeatureEnabled()) redirect("/mypage");

  // 1) 세션 확인
  const { user, profile } = await getServerUserWithProfile();
  if (!user || !profile) redirect(`/login/student?next=${encodeURIComponent("/account/delete")}`);
  const role = profile.role === "mentor" ? "mentor" : "student";
  if (profile.role === "admin") back("관리자 계정은 이 화면에서 탈퇴할 수 없습니다.");

  // 2) 입력 검증
  const password = String(formData.get("password") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
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

  // 5) 잔액 소멸 상계 (동의 시) — append-only: 원장 -상계 라인 1건 + 지갑 0화 (멱등)
  if (pre.walletBalanceCents > 0 && forfeitConsent) {
    const { data: forfeitRow, error: forfeitErr } = await admin
      .from("cash_ledger")
      .insert({
        user_id: user.id,
        delta_cents: -pre.walletBalanceCents,
        reason: "forfeit_on_deletion",
        ref_type: "account_deletion",
        ref_id: user.id,
        idempotency_key: `forfeit_on_deletion:${user.id}`,
      })
      .select("id")
      .maybeSingle();
    if (forfeitErr && !forfeitErr.message.includes("duplicate")) {
      back("잔액 소멸 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (forfeitRow) {
      await admin.from("cash_wallets").update({ balance_cents: 0 }).eq("user_id", user.id);
    }
  }

  // 6) PII 익명화 RPC (service_role 전용, 멱등 — SQL 115)
  const { error: rpcErr } = await admin.rpc("anonymize_user_for_deletion", {
    p_user_id: user.id,
    p_reason: reason,
  });
  if (rpcErr) back("탈퇴 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");

  // 7) 아바타 객체 삭제 (profile-avatars/{userId}/*) — RPC 밖 storage API (스펙 §1-3)
  try {
    const { data: objects } = await admin.storage.from(MENTOR_AVATAR_BUCKET).list(user.id);
    const paths = (objects ?? []).map((o) => `${user.id}/${o.name}`);
    if (paths.length > 0) await admin.storage.from(MENTOR_AVATAR_BUCKET).remove(paths);
  } catch {
    // best-effort — 스토리지 실패가 탈퇴 자체를 막지 않는다 (PII 익명화는 이미 완료)
  }

  // 7-1) 인증 서류 삭제 (student-id-images/{userId}/** — 학생증·학교인증·학적변경 서류)
  //      민감 PII이므로 탈퇴 시 스토리지에서도 제거한다. list는 비재귀라 하위 폴더를 함께 순회.
  try {
    const dirs = [user.id, `${user.id}/school-verifications`, `${user.id}/academic-record-changes`];
    const docPaths: string[] = [];
    for (const dir of dirs) {
      const { data: objects } = await admin.storage.from(STUDENT_ID_IMAGES_BUCKET).list(dir);
      for (const o of objects ?? []) {
        // list는 하위 폴더를 파일처럼 돌려줄 수 있다 — metadata 없는 항목(폴더)은 제외
        if (o.id || o.metadata) docPaths.push(`${dir}/${o.name}`);
      }
    }
    if (docPaths.length > 0) await admin.storage.from(STUDENT_ID_IMAGES_BUCKET).remove(docPaths);
  } catch {
    // best-effort — 위와 동일
  }

  // 8) auth soft-delete (행 보존·로그인 영구 차단 — 하드삭제 금지, 스펙 §0)
  const { error: authErr } = await admin.auth.admin.deleteUser(user.id, true);
  if (authErr) back("계정 비활성화에 실패했습니다. 고객센터로 문의해 주세요.");

  // 9) 전역 로그아웃 → 안내 페이지
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "global" });
  redirect("/goodbye");
}
