import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountDeletionForm } from "@/components/account/AccountDeletionForm";
import { AccountDeletionPendingPanel } from "@/components/account/AccountDeletionPendingPanel";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { checkAccountDeletionPreconditions } from "@/lib/account/accountDeletionPreconditions";
import { ACCOUNT_DELETION_ACTIVE_STATES } from "@/lib/account/accountDeletionJobStates";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { isAccountDeletionFeatureEnabled } from "@/lib/shell/featureFlags";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { formatCashKrw } from "@/lib/utils/formatDisplay";

export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

/**
 * 회원 탈퇴 페이지 (스펙 §3) — 학생·멘토 공용(role 분기 렌더), 로그인 가드.
 * 플래그 OFF: /mypage 리다이렉트 (스펙 §7 — OFF에서 접근 불가).
 */
export default async function AccountDeletePage({ searchParams }: Props) {
  if (!isAccountDeletionFeatureEnabled()) redirect("/mypage");

  const { user, profile } = await getServerUserWithProfile();
  if (!user || !profile) redirect(`/login/student?next=${encodeURIComponent("/account/delete")}`);
  if (profile.role === "admin") redirect("/admin");
  const role = profile.role === "mentor" ? "mentor" : "student";

  const admin = createServiceRoleClient();
  const pre = await checkAccountDeletionPreconditions(admin, user.id, role);
  const balanceCash = Math.round(pre.walletBalanceCents / 100);

  const sp = (await searchParams) ?? {};
  const actionError = typeof sp.error === "string" && sp.error ? sp.error : null;
  const justCanceled = sp.canceled === "1";

  // 활성 saga job — 있으면 폼 대신 "요청 접수 + 취소 창" 패널을 보여준다(W5 §3-5).
  // 웹 즉시 삭제 경로를 폐지하면서 사용자 동선이 "즉시 완료" → "요청 접수 후 취소 가능"으로 바뀐다.
  const { data: activeJob } = await admin
    .from("account_deletion_jobs")
    .select("id, state, cancelable_until")
    .eq("user_id", user.id)
    .in("state", ACCOUNT_DELETION_ACTIVE_STATES)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const job = (activeJob ?? null) as { state?: string; cancelable_until?: string | null } | null;

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="계정"
      title="회원 탈퇴"
      description="탈퇴 전 아래 내용을 꼭 확인해 주세요."
      ctas={[{ href: role === "mentor" ? "/mentor/mypage" : "/mypage", label: "마이페이지", tone: "slate" }]}
    >
      <div className="mx-auto max-w-2xl space-y-5">
        {actionError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">
            {actionError}
          </p>
        ) : null}

        {justCanceled && !job ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
            탈퇴 요청을 취소했습니다. 계정은 그대로 유지됩니다.
          </p>
        ) : null}

        {job ? (
          <AccountDeletionPendingPanel
            state={job.state ?? "pending"}
            cancelableUntil={job.cancelable_until ?? null}
          />
        ) : null}

        {/* 보존·익명화 고지 (스펙 §5 공용 문구) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-extrabold text-slate-900">탈퇴 시 처리 안내</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
            탈퇴를 요청하면 30분의 취소 창이 열리고, 창이 지나면 계정이 잠긴 뒤 순서대로 처리됩니다(세션 종료 → 업로드
            파일 삭제 → 남은 캐시 소멸·개인정보 익명화 → 로그인 영구 차단). 결제·캐시 원장·정산·주문
            기록은 관련 법령(전자상거래법·세법)에 따라 익명 상태로 보존됩니다. 작성한 게시글·후기는 &lsquo;탈퇴회원&rsquo;
            표기로 남으며, 삭제를 원하면 탈퇴 전에 직접 삭제해 주세요. 남은 캐시는 환불 신청을 먼저 진행하거나, 소멸에
            동의해야 탈퇴할 수 있습니다.
          </p>
        </section>

        {/* 사전조건 결과 (미충족 항목은 해결 경로 링크) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-extrabold text-slate-900">탈퇴 사전조건</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {pre.items.map((item) => (
              <li key={item.key} className="flex items-start justify-between gap-3">
                <span className={item.ok ? "font-medium text-slate-600" : "font-bold text-red-600"}>
                  {item.ok ? "✓" : "✗"} {item.label}
                </span>
                <span className="text-right text-xs text-slate-500">
                  {item.ok ? "통과" : item.detail}{" "}
                  {!item.ok && item.resolveHref ? (
                    <Link href={item.resolveHref} className="font-bold text-[#1A56DB] hover:underline">
                      해결하기 →
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
            <li className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2">
              <span className={balanceCash === 0 ? "font-medium text-slate-600" : "font-bold text-amber-700"}>
                {balanceCash === 0 ? "✓" : "!"} 지갑 잔액 {formatCashKrw(balanceCash, { unit: "캐시" })}
              </span>
              <span className="text-right text-xs text-slate-500">
                {balanceCash === 0 ? (
                  "통과"
                ) : (
                  <>
                    <Link href="/support/refunds" className="font-bold text-[#1A56DB] hover:underline">
                      환불 신청
                    </Link>{" "}
                    또는 아래 소멸 동의 필요
                  </>
                )}
              </span>
            </li>
          </ul>
        </section>

        {!job ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <AccountDeletionForm
              blockersOk={pre.blockersOk}
              requiresForfeitConsent={balanceCash > 0}
              balanceLabel={balanceCash > 0 ? formatCashKrw(balanceCash, { unit: "캐시" }) : null}
            />
            {!pre.blockersOk ? (
              <p className="mt-3 text-center text-xs font-semibold text-slate-500">
                위 미충족 항목을 해결하면 탈퇴를 진행할 수 있어요.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </PageScaffold>
  );
}
