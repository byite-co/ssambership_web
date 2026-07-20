import Link from "next/link";
import { FormSubmitButton } from "@/components/common/FormSubmitButton";
import {
  updateMajorCategoryCatalogAction,
  updateSchoolTierCatalogAction,
  upsertSchoolTierMappingAction,
} from "@/lib/admin/schoolClassificationActions";
import {
  loadSchoolClassificationCatalogs,
  loadSchoolTierMappings,
  type ClassificationOption,
  type SchoolTierMappingRow,
} from "@/lib/mentor/schoolClassificationCatalog";
import type { SchoolTier, VerifiedMajorCategory } from "@/lib/mentor/schoolVerificationConstants";
import { createClient } from "@/lib/supabase/server";
import { toAdminDisplayError } from "@/lib/admin/adminDisplayError";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function firstParam(v: string | string[] | undefined): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

function okMessage(kind: string | null): string | null {
  if (kind === "catalog") return "분류표를 저장했습니다.";
  if (kind === "mapping") return "학교군 매핑을 저장했습니다.";
  return null;
}

function CatalogEditor<T extends string>(props: {
  title: string;
  description: string;
  rows: ClassificationOption<T>[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">{props.title}</h2>
          <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">{props.description}</p>
        </div>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-[#2563EB]">
          {props.rows.length}개
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {props.rows.map((row) => (
          <form
            key={row.code}
            action={props.action}
            className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:grid-cols-[92px_minmax(0,1fr)_84px_88px_92px] sm:items-end"
          >
            <input type="hidden" name="code" value={row.code} />
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">code</p>
              <p className="mt-1 rounded-lg bg-white px-2 py-2 text-xs font-black text-slate-800">{row.code}</p>
            </div>
            <label className="text-xs font-bold text-slate-700">
              라벨
              <input
                name="label"
                required
                defaultValue={row.label}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              />
            </label>
            <label className="text-xs font-bold text-slate-700">
              순서
              <input
                name="displayOrder"
                type="number"
                inputMode="numeric"
                defaultValue={row.displayOrder}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              />
            </label>
            <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">
              <input type="checkbox" name="isActive" defaultChecked={row.isActive} className="accent-[#2563EB]" />
              활성
            </label>
            <FormSubmitButton
              idleLabel="저장"
              pendingLabel="저장 중"
              className="min-h-[40px] rounded-lg bg-[#2563EB] px-3 text-sm font-extrabold text-white disabled:opacity-60"
            />
          </form>
        ))}
      </div>
    </section>
  );
}

function MappingForm(props: {
  mapping?: SchoolTierMappingRow;
  schoolTiers: ClassificationOption<SchoolTier>[];
}) {
  const mapping = props.mapping;
  return (
    <form
      action={upsertSchoolTierMappingAction}
      className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3 lg:grid-cols-[minmax(0,1.2fr)_150px_minmax(0,1fr)_88px_92px] lg:items-end"
    >
      {mapping ? <input type="hidden" name="mappingId" value={mapping.id} /> : null}
      <label className="text-xs font-bold text-slate-700">
        학교명
        <input
          name="schoolName"
          required
          defaultValue={mapping?.school_name ?? ""}
          placeholder="예: 건국대학교"
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        />
      </label>
      <label className="text-xs font-bold text-slate-700">
        학교군
        <select
          name="schoolTierCode"
          required
          defaultValue={mapping?.school_tier_code ?? "미분류"}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        >
          {props.schoolTiers.map((tier) => (
            <option key={tier.code} value={tier.code}>
              {tier.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-bold text-slate-700">
        메모
        <input
          name="note"
          defaultValue={mapping?.note ?? ""}
          placeholder="운영 참고"
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
        />
      </label>
      <label className="flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">
        <input type="checkbox" name="isActive" defaultChecked={mapping?.is_active ?? true} className="accent-[#2563EB]" />
        활성
      </label>
      <FormSubmitButton
        idleLabel={mapping ? "저장" : "추가"}
        pendingLabel="처리 중"
        className="min-h-[40px] rounded-lg bg-[#2563EB] px-3 text-sm font-extrabold text-white disabled:opacity-60"
      />
    </form>
  );
}

export default async function AdminSchoolClassificationsPage(props: PageProps) {
  const sp = (await props.searchParams) ?? {};
  const error = toAdminDisplayError(firstParam(sp.error), "default");
  const ok = okMessage(firstParam(sp.ok));
  const supabase = await createClient();
  const [catalogs, mappings] = await Promise.all([
    loadSchoolClassificationCatalogs(supabase, { includeInactive: true }),
    loadSchoolTierMappings(supabase, { includeInactive: true }),
  ]);

  const schoolTiers = catalogs.schoolTiers as ClassificationOption<SchoolTier>[];
  const majorCategories = catalogs.majorCategories as ClassificationOption<VerifiedMajorCategory>[];

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">관리자 / 인증 분류</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">학교군·전공계열 분류</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-slate-600">
              077 검증값과 호환되는 code를 유지하면서 라벨, 순서, 활성 상태와 학교명 매핑을 관리합니다.
            </p>
          </div>
          <Link
            href="/admin/mentor-approval"
            className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            멘토 심사
          </Link>
        </div>
      </header>

      {ok ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">{ok}</p> : null}
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-900">{error}</p> : null}
      {catalogs.errors.length ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          079 catalog 표가 아직 없거나 읽을 수 없어 상수 fallback을 표시합니다.
        </p>
      ) : null}

      <section className="rounded-2xl border border-blue-100 bg-blue-50/50 px-4 py-3 text-sm font-semibold text-slate-700">
        새 분류 code 추가는 운영 협의와 SQL 검토가 필요합니다. 이 화면에서는 기존 code의 라벨·순서·활성만 바꿀 수 있습니다.
      </section>

      <div className="grid gap-5 2xl:grid-cols-2">
        <CatalogEditor
          title="학교군 catalog"
          description="저장 code는 077 CHECK 허용값과 같아야 합니다. 건동홍은 중경외시와 그외 사이에 배치합니다."
          rows={schoolTiers}
          action={updateSchoolTierCatalogAction}
        />
        <CatalogEditor
          title="전공계열 catalog"
          description="전공계열 8종은 기존 077 CHECK 값을 유지합니다. 라벨과 노출 순서만 조정합니다."
          rows={majorCategories}
          action={updateMajorCategoryCatalogAction}
        />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">학교명 → 학교군 매핑</h2>
            <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
              관리자 심사에서 학교군을 추천하기 위한 내부 매핑입니다. 공개/anon에는 노출하지 않습니다.
            </p>
          </div>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-[#2563EB]">
            {mappings.rows.length}개
          </span>
        </div>

        {mappings.error ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
            매핑 표를 불러오지 못했습니다. 079 SQL 적용 후 다시 확인해 주세요.
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          <MappingForm schoolTiers={schoolTiers} />
          {mappings.rows.length ? (
            <div className="space-y-2 border-t border-slate-100 pt-3">
              {mappings.rows.map((mapping) => (
                <MappingForm key={mapping.id} mapping={mapping} schoolTiers={schoolTiers} />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm font-semibold text-slate-500">
              등록된 학교군 매핑이 없습니다.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs font-medium leading-relaxed text-slate-600">
        현재 옵션 출처: {catalogs.source === "database" ? "catalog DB" : catalogs.source === "mixed" ? "DB + fallback" : "fallback 상수"}
      </section>
    </div>
  );
}
