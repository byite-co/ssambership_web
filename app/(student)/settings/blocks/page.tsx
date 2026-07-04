import { redirect } from "next/navigation";
import { EmptyState } from "@/components/common/EmptyState";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import { PageScaffold } from "@/components/shell/PageScaffold";
import { getServerUserWithProfile } from "@/lib/auth/getServerUserWithProfile";
import { unblockUserAction } from "@/lib/blocks/userBlocksActions";
import { isUserBlocksEnabled } from "@/lib/shell/featureFlags";
import { createClient } from "@/lib/supabase/server";
import { formatKoreanDate } from "@/lib/utils/formatDisplay";

export const dynamic = "force-dynamic";

/**
 * 차단 관리 (스펙 §4) — 차단 목록·해제. 학생·멘토 공용(로그인 가드는 레이아웃 예외).
 * 플래그 OFF: /mypage 리다이렉트(레이아웃에서 선차단, 여기서도 방어).
 */
export default async function BlocksSettingsPage() {
  if (!isUserBlocksEnabled()) redirect("/mypage");

  const { user } = await getServerUserWithProfile();
  if (!user) redirect(`/login/student?next=${encodeURIComponent("/settings/blocks")}`);

  const supabase = await createClient();
  // RLS(ub_select_own)가 본인 행만 허용. 닉네임은 users 조인 대신 별도 조회(익명화 회원 호환).
  const { data } = await supabase
    .from("user_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", user.id)
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Array<{ blocked_id: string; created_at: string | null }>;

  const nickMap = new Map<string, string>();
  if (rows.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, nickname, full_name")
      .in("id", rows.map((r) => r.blocked_id));
    for (const u of (users ?? []) as Array<{ id: string; nickname: string | null; full_name: string | null }>) {
      nickMap.set(u.id, u.nickname?.trim() || u.full_name?.trim() || "회원");
    }
  }

  return (
    <PageScaffold
      hideFooterPlaceholderCards
      eyebrow="설정"
      title="차단 관리"
      description="차단한 사용자의 게시글·댓글·숏폼은 내 화면에서 보이지 않아요. 차단은 상대의 기능을 제한하지 않으며 언제든 해제할 수 있어요."
      ctas={[{ href: "/mypage", label: "마이페이지", tone: "slate" }]}
    >
      <div className="mx-auto max-w-2xl">
        {rows.length === 0 ? (
          <EmptyState
            compact
            title="차단한 사용자가 없어요"
            description="게시글·숏폼 상세 화면에서 '이 사용자 차단'으로 추가할 수 있어요."
          />
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => (
              <li
                key={r.blocked_id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{nickMap.get(r.blocked_id) ?? "회원"}</p>
                  <p className="text-[11px] text-slate-400">
                    차단일 {r.created_at ? formatKoreanDate(r.created_at) : "—"}
                  </p>
                </div>
                <form action={unblockUserAction}>
                  <input type="hidden" name="blockedUserId" value={r.blocked_id} />
                  <input type="hidden" name="returnTo" value="/settings/blocks" />
                  <FormSubmitButton
                    idleLabel="차단 해제"
                    pendingLabel="해제 중…"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  />
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageScaffold>
  );
}
