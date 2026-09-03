import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SCHOOL_TIERS,
  VERIFIED_MAJOR_CATEGORIES,
  type SchoolTier,
  type VerifiedMajorCategory,
} from "@/lib/mentor/schoolVerificationConstants";
import type { MentorProfileDisplay } from "@/lib/mentor/mentorDisplayFields";

export type ClassificationOption<T extends string = string> = {
  code: T;
  label: string;
  displayOrder: number;
  isActive: boolean;
};

export type SchoolClassificationCatalogs = {
  schoolTiers: ClassificationOption<SchoolTier>[];
  majorCategories: ClassificationOption<VerifiedMajorCategory>[];
  schoolTierLabels: Record<string, string>;
  majorCategoryLabels: Record<string, string>;
  source: "database" | "fallback" | "mixed";
  errors: string[];
};

type CatalogRow = Record<string, unknown>;

export function isSchoolTier(value: string): value is SchoolTier {
  return (SCHOOL_TIERS as readonly string[]).includes(value);
}

export function isVerifiedMajorCategory(value: string): value is VerifiedMajorCategory {
  return (VERIFIED_MAJOR_CATEGORIES as readonly string[]).includes(value);
}

function fallbackSchoolTiers(): ClassificationOption<SchoolTier>[] {
  return SCHOOL_TIERS.map((code, index) => ({
    code,
    label: code,
    displayOrder: index + 1,
    isActive: true,
  }));
}

function fallbackMajorCategories(): ClassificationOption<VerifiedMajorCategory>[] {
  return VERIFIED_MAJOR_CATEGORIES.map((code, index) => ({
    code,
    label: code,
    displayOrder: index + 1,
    isActive: true,
  }));
}

function optionLabels<T extends string>(options: ClassificationOption<T>[]): Record<string, string> {
  return Object.fromEntries(options.map((option) => [option.code, option.label]));
}

function mapCatalogRow<T extends string>(
  row: CatalogRow,
  isAllowed: (value: string) => value is T
): ClassificationOption<T> | null {
  const code = typeof row.code === "string" ? row.code.trim() : "";
  if (!isAllowed(code)) return null;
  const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : code;
  const displayOrder = typeof row.display_order === "number" && Number.isFinite(row.display_order) ? row.display_order : 0;
  const isActive = typeof row.is_active === "boolean" ? row.is_active : true;
  return { code, label, displayOrder, isActive };
}

async function loadCatalogTable<T extends string>(
  supabase: SupabaseClient,
  table: "school_tier_catalog" | "major_category_catalog",
  isAllowed: (value: string) => value is T,
  fallback: ClassificationOption<T>[],
  includeInactive: boolean
): Promise<{ rows: ClassificationOption<T>[]; usedFallback: boolean; error: string | null }> {
  let query = supabase
    .from(table)
    .select("code, label, display_order, is_active")
    .order("display_order", { ascending: true })
    .order("code", { ascending: true });

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) {
    return { rows: fallback, usedFallback: true, error: error.message };
  }

  const rows = ((data as CatalogRow[] | null) ?? [])
    .map((row) => mapCatalogRow(row, isAllowed))
    .filter((row): row is ClassificationOption<T> => row != null);

  if (!rows.length) {
    return { rows: fallback, usedFallback: true, error: null };
  }

  return { rows, usedFallback: false, error: null };
}

export async function loadSchoolClassificationCatalogs(
  supabase: SupabaseClient,
  opts?: { includeInactive?: boolean }
): Promise<SchoolClassificationCatalogs> {
  const includeInactive = opts?.includeInactive === true;
  const [schoolTiers, majorCategories] = await Promise.all([
    loadCatalogTable(supabase, "school_tier_catalog", isSchoolTier, fallbackSchoolTiers(), includeInactive),
    loadCatalogTable(supabase, "major_category_catalog", isVerifiedMajorCategory, fallbackMajorCategories(), includeInactive),
  ]);

  const usedFallbackCount = Number(schoolTiers.usedFallback) + Number(majorCategories.usedFallback);
  const source: SchoolClassificationCatalogs["source"] =
    usedFallbackCount === 0 ? "database" : usedFallbackCount === 2 ? "fallback" : "mixed";

  return {
    schoolTiers: schoolTiers.rows,
    majorCategories: majorCategories.rows,
    schoolTierLabels: optionLabels(schoolTiers.rows),
    majorCategoryLabels: optionLabels(majorCategories.rows),
    source,
    errors: [schoolTiers.error, majorCategories.error].filter((error): error is string => Boolean(error)),
  };
}

export function applySchoolClassificationLabels(
  display: MentorProfileDisplay,
  catalogs: Pick<SchoolClassificationCatalogs, "schoolTierLabels" | "majorCategoryLabels">
): MentorProfileDisplay {
  return {
    ...display,
    schoolTierLabel: display.schoolTier ? catalogs.schoolTierLabels[display.schoolTier] ?? display.schoolTier : "",
    verifiedMajorCategoryLabel: display.verifiedMajorCategory
      ? catalogs.majorCategoryLabels[display.verifiedMajorCategory] ?? display.verifiedMajorCategory
      : "",
  };
}
