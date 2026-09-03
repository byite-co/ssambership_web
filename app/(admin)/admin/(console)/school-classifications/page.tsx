import Link from "next/link";
import { AdminPageLayout } from "@/components/admin/AdminPageLayout";
import {
  SchoolClassificationBranchCampusList,
  SchoolClassificationCatalog,
  SchoolClassificationDistribution,
  SchoolClassificationMappingTable,
  SchoolClassificationRulesTable,
  SchoolClassificationUnclassifiedTable,
} from "@/components/admin/SchoolClassificationPanels";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";
import { loadSchoolClassificationOverview } from "@/lib/admin/schoolClassificationQueries";
import { loadSchoolClassificationCatalogs, loadSchoolTierMappings } from "@/lib/mentor/schoolClassificationCatalog";
import { createClient } from "@/lib/supabase/server";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

const ACTION_LINK = "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-50";

function pick(value: string | string[] | undefined): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  return "";
}

/**
 * 관리자 · 등급 분류(PR-11 §3 · PR-W1 정정). 미분류 목록의 등급 정정 폼(기존 확정 RPC 액션 · 새 쓰기 경로 0) 외 편집 폼 0.
 *
 * §0-B 실측: 판정 트리거는 LIKE 하드코딩(매핑 표를 읽지 않는다). 확정된 등급의 정정은 PR-W1 부터 확정 RPC 한 경로(SQL 193 A-2). 그래서 이 화면은
 * 미분류 멘토 목록(맨 위 · `등급 정정` 버튼 = 같은 RPC · '그외'로) · 분포 · 트리거의 LIKE 패턴 표 · 카탈로그(CHECK 고정) · 매핑 표(읽기 전용)를 보여준다.
 * 구 화면의 카탈로그 라벨·순서 편집과 매핑 추가·수정 폼은 판정에 영향이 없어 내리지 않는다(§8-3). (admin)/layout.tsx + (console)/layout.tsx 의 이중 requireRole("admin") 가드 아래에 있다.
 */
export default async function AdminSchoolClassificationsPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const flashErrRaw = pick(sp.error) || null;
  const flashErr = flashErrRaw ? (toAdminDisplayError(flashErrRaw, "default") ?? "처리에 실패했습니다.") : null;

  const supabase = await createClient();
  const [overview, catalogs, mappings] = await Promise.all([
    loadSchoolClassificationOverview(supabase),
    loadSchoolClassificationCatalogs(supabase, { includeInactive: true }),
    loadSchoolTierMappings(supabase, { includeInactive: true }),
  ]);

  return (
    <AdminPageLayout
      title="등급 분류"
      description="학교 등급·전공 계열의 확정 현황을 봅니다. 자동 판정은 DB 트리거의 LIKE 규칙이고, 확정은 멘토 승인 화면·계정 상세(멘토 탭)에서 합니다. 미분류 멘토는 여기서 '그외'로 바로 정정할 수 있습니다(같은 확정 RPC). 그 밖에 이 화면에서 바꿀 수 있는 값은 없습니다."
      actions={
        <>
          <Link href="/admin/mentor-approval" className={ACTION_LINK} prefetch={false}>
            멘토 승인
          </Link>
          <Link href="/admin/users?role=mentor" className={ACTION_LINK} prefetch={false}>
            멘토 계정
          </Link>
        </>
      }
    >
      {flashErr ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-900">
          처리 실패 — {flashErr}
        </p>
      ) : null}
      {overview.error ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50/60 p-5 text-sm text-red-950">
          <p className="font-bold">확정 현황을 불러오지 못했습니다.</p>
          <p className="mt-1 text-xs text-red-900/90">{toAdminDisplayError(overview.error, "default") ?? "잠시 후 다시 시도해 주세요."}</p>
        </div>
      ) : null}

      <SchoolClassificationUnclassifiedTable items={overview.unclassified} />
      <SchoolClassificationDistribution rows={overview.distribution} approvedCount={overview.approvedCount} />
      <SchoolClassificationRulesTable />
      <SchoolClassificationCatalog schoolTiers={catalogs.schoolTiers} majorCategories={catalogs.majorCategories} />
      <SchoolClassificationMappingTable rows={mappings.rows} error={mappings.error} />
      <SchoolClassificationBranchCampusList items={overview.branchCampus} />
    </AdminPageLayout>
  );
}
