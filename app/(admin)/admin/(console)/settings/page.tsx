import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import { SettingsAdminAccountList } from "@/components/admin/SettingsAdminAccountList";
import { SettingsAppVersionTable } from "@/components/admin/SettingsAppVersionTable";
import { SettingsPolicyCards } from "@/components/admin/SettingsPolicyCards";
import { SettingsTopupPackageTable } from "@/components/admin/SettingsTopupPackageTable";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { buildCapLine, buildFeeLine, buildSettingsPlanRows, formatPlanBandLine } from "@/lib/admin/settingsConsole";
import { loadSettingsAdminAccounts, loadSettingsAppVersionPolicies, loadSettingsCapPolicy, loadSettingsPayoutScheduler, loadSettingsTopupPackages } from "@/lib/admin/settingsQueries";
import { PAYOUT_DAY_LABEL } from "@/lib/payout/payoutComputation";
import { PLATFORM_FEE_POLICY } from "@/lib/payout/platformFeePolicy";
import { MENTOR_SUBSCRIPTION_PRICE_RULES } from "@/lib/subscribe/mentorPlanPricing";
import { SUBSCRIBE_PLAN_CATALOG } from "@/lib/subscribe/subscribePlanCatalog";
import { createClient } from "@/lib/supabase/server";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * 관리자 · 시스템 설정(PR-10 §3) — 섹션 4개 + 관리자 계정.
 *
 * - 편집은 **충전 패키지 토글 하나**(기존 액션 · stateChange 확인). 요금제·수수료·정원·정산 설정·앱 버전 정책·관리자 계정은 읽기 전용.
 * - 읽기 전용 값은 정본에서 온다: 카탈로그·밴드 `lib/subscribe/*` · 수수료 정책 요율 `lib/payout/platformFeePolicy.ts` · 지급일 `PAYOUT_DAY_LABEL` ·
 *   정원 가중치·기본 한도는 DB 함수(`subscription_cap_weight` · `mentor_cap_limit`). TS 에 숫자를 박지 않는다.
 * (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminSettingsPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const flashOk = pick(sp.ok) === "1";
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "default") ?? "처리에 실패했습니다. 잠시 후 다시 시도해 주세요.") : null;

  const supabase = await createClient();
  const [packages, cap, schedulerEnabled, appVersion, admins] = await Promise.all([
    loadSettingsTopupPackages(supabase),
    loadSettingsCapPolicy(),
    loadSettingsPayoutScheduler(),
    loadSettingsAppVersionPolicies(),
    loadSettingsAdminAccounts(),
  ]);

  const planRows = buildSettingsPlanRows(SUBSCRIBE_PLAN_CATALOG, MENTOR_SUBSCRIPTION_PRICE_RULES);
  const feeLine = buildFeeLine(PLATFORM_FEE_POLICY);
  const capLine = buildCapLine(cap);
  const planBandLine = formatPlanBandLine(planRows);

  return (
    <AdminPageLayout
      title="시스템 설정"
      description="운영 설정을 한 화면에서 봅니다. 이 화면에서 바꿀 수 있는 것은 충전 패키지 노출뿐이며, 나머지는 코드·DB 함수·배치가 관리하는 읽기 전용 값입니다."
      actions={
        <>
          <Link href="/admin/settlements" className={ACTION_LINK} prefetch={false}>
            정산 관리
          </Link>
          <Link href="/admin/audit-logs" className={ACTION_LINK} prefetch={false}>
            감사 로그
          </Link>
        </>
      }
    >
      {flashOk ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
          변경을 저장했습니다.
        </p>
      ) : null}
      {flashErr ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          처리 실패 — {flashErr}
        </p>
      ) : null}

      <SettingsTopupPackageTable rows={packages.rows} error={packages.error} />
      <SettingsPolicyCards planRows={planRows} planBandLine={planBandLine} feeLine={feeLine} capLine={capLine} schedulerEnabled={schedulerEnabled} payoutDayLabel={PAYOUT_DAY_LABEL} />
      <SettingsAppVersionTable rows={appVersion.rows} error={appVersion.error} />
      <SettingsAdminAccountList rows={admins.rows} error={admins.error} />
    </AdminPageLayout>
  );
}
