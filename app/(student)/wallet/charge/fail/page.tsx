import { requireRole } from "@/lib/auth/routeGuard";
import { createClient } from "@/lib/supabase/server";
import { fetchWalletBalanceByUserId } from "@/lib/cash/cashQueries";
import { parseWalletBalanceKrw } from "@/lib/cash/parseWalletBalanceKrw";
import { StudentDashboardShell } from "@/components/mypage/StudentDashboardShell";
import { WalletChargeFailClient } from "@/components/cash/WalletChargeFailClient";
import { mapTossErrorCode, userMessageForConfirmCode } from "@/lib/toss/tossTopupCore";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function one(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export default async function WalletChargeFailPage({ searchParams }: Props) {
  const { user, profile } = await requireRole("student");
  const sp = (await searchParams) ?? {};
  // D-ST-14: Toss 원문(message)·코드를 화면에 노출하지 않는다(PG 내부 문구 유출·임의 문구 주입
  // 소셜 엔지니어링 표면 차단). code 는 allowlist(mapTossErrorCode) 로만 검증해 고정 한글 문구로
  // 매핑하고, message 쿼리스트링은 무시한다. 성공 확정 경로(CONFIRM_ERROR_MESSAGES)와 동일 계약.
  const code = one(sp, "code");
  const message = code
    ? userMessageForConfirmCode(mapTossErrorCode(code).code)
    : "결제가 취소되었거나 승인되지 않았습니다.";

  const supabase = await createClient();
  const balance = await fetchWalletBalanceByUserId(supabase, user.id);
  const cashBalanceKrw = parseWalletBalanceKrw(balance.row);

  return (
    <StudentDashboardShell activeTab="wallet" user={user} profile={profile} profileLoadError={null} cashBalanceKrw={cashBalanceKrw}>
      <WalletChargeFailClient message={message} />
    </StudentDashboardShell>
  );
}
