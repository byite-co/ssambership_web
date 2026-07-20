import { getMajorSubjects } from "@/lib/subjects/subjectCatalog";
import {
  SCHOOL_TIERS,
  VERIFIED_MAJOR_CATEGORIES,
  type SchoolTier,
  type VerifiedMajorCategory,
} from "@/lib/mentor/schoolVerificationConstants";

export type MentorsListSort =
  | "popular"
  | "new"
  | "review"
  | "price_asc"
  | "price_desc"
  | "rating"
  | "response";

export type MentorsListView = "list" | "grid";

// 컬렉션 범위(퀵링크 계약). all=전체, recent=최근 본(클라이언트 localStorage), favorite=찜(서버 조회).
export type MentorsListScope = "all" | "recent" | "favorite";

// 과목 정본(subjectCatalog) 대분류 라벨 기반. teaching_subjects(자유 텍스트) 라벨 매칭 호환.
export type MentorSubjectFilter = string;

export type MentorGradeFilter = "중등" | "고등" | "N수";

export type MentorTypeFilter = VerifiedMajorCategory;

export type MentorPriceBandFilter = "3to5" | "5to10" | "10to20" | "over20";

export type MentorSchoolFilter = "" | SchoolTier;

export type MentorsListFilters = {
  q: string;
  subject: MentorSubjectFilter;
  school: MentorSchoolFilter;
  university: string;
  verification: string;
  verifiedOnly: boolean;
  grades: MentorGradeFilter[];
  mentorTypes: MentorTypeFilter[];
  priceBand: MentorPriceBandFilter | null;
  sort: MentorsListSort;
  view: MentorsListView;
  scope: MentorsListScope;
  page: number;
};

export const MENTORS_PAGE_SIZE = 12;

export function defaultMentorsListFilters(overrides?: Partial<MentorsListFilters>): MentorsListFilters {
  return {
    q: "",
    subject: "",
    school: "",
    university: "",
    verification: "",
    verifiedOnly: false,
    grades: [],
    mentorTypes: [],
    priceBand: null,
    sort: "popular",
    view: "list",
    scope: "all",
    page: 1,
    ...overrides,
  };
}

// 대분류 라벨을 필터 id로 사용(매칭은 소분류 라벨까지 확장 — publicMentorsListQueries). 기타 제외.
export const MENTOR_SUBJECT_OPTIONS: { id: MentorSubjectFilter; label: string }[] = [
  { id: "", label: "전체" },
  ...getMajorSubjects()
    .filter((m) => m.code !== "etc")
    .map((m) => ({ id: m.label, label: m.label })),
];

export const MENTOR_GRADE_OPTIONS: { id: MentorGradeFilter; label: string }[] = [
  { id: "중등", label: "중등" },
  { id: "고등", label: "고등" },
  { id: "N수", label: "N수" },
];

export const MENTOR_TYPE_OPTIONS: { id: MentorTypeFilter; label: string }[] = [
  ...VERIFIED_MAJOR_CATEGORIES.map((id) => ({ id, label: id })),
];

export const MENTOR_PRICE_BAND_OPTIONS: {
  id: MentorPriceBandFilter;
  label: string;
  min: number | null;
  max: number | null;
}[] = [
  { id: "3to5", label: "3~5만", min: 30_000, max: 49_999 },
  { id: "5to10", label: "5~10만", min: 50_000, max: 99_999 },
  { id: "10to20", label: "10~20만", min: 100_000, max: 199_999 },
  { id: "over20", label: "20만 이상", min: 200_000, max: null },
];

// 공개 필터에서는 "그외"를 노출하지 않음 — 그외로 분류된 멘토는 "미분류"에 종속(표시·매칭 모두 mentorDisplayFields에서 정규화)
export const MENTOR_SCHOOL_OPTIONS: { id: MentorSchoolFilter; label: string }[] = [
  { id: "", label: "전체" },
  ...SCHOOL_TIERS.filter((id) => id !== "그외").map((id) => ({ id, label: id })),
];

export const MENTOR_SORT_OPTIONS: { id: MentorsListSort; label: string }[] = [
  { id: "popular", label: "인기순" },
  { id: "new", label: "최신순" },
  { id: "review", label: "리뷰많은순" },
  { id: "price_asc", label: "가격낮은순" },
];

const SORTS: MentorsListSort[] = ["popular", "new", "review", "price_asc", "price_desc", "rating", "response"];

function pickSort(v: string | undefined): MentorsListSort {
  if (v === "reviews" || v === "rating") return "review";
  if (v === "price") return "price_asc";
  if (SORTS.includes(v as MentorsListSort)) return v as MentorsListSort;
  return "popular";
}

function pickSubject(v: string): MentorSubjectFilter {
  const found = MENTOR_SUBJECT_OPTIONS.find((o) => o.id === v);
  return found ? found.id : "";
}

function pickSchool(v: string): MentorSchoolFilter {
  const found = MENTOR_SCHOOL_OPTIONS.find((o) => o.id === v);
  return found ? found.id : "";
}

function parseIntParam(v: string): number | null {
  if (!v) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function parseListParam(v: string, allowed: readonly string[]): string[] {
  if (!v.trim()) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allowed.includes(s));
}

function pickPriceBand(v: string): MentorPriceBandFilter | null {
  if (v && MENTOR_PRICE_BAND_OPTIONS.some((o) => o.id === v)) {
    return v as MentorPriceBandFilter;
  }
  return null;
}

function many(sp: Record<string, string | string[] | undefined>, k: string): string {
  const v = sp[k];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean).join(",");
  return typeof v === "string" ? v.trim() : "";
}

export function parseMentorsListFilters(sp: Record<string, string | string[] | undefined>): MentorsListFilters {
  const one = (k: string) => {
    const v = sp[k];
    if (Array.isArray(v)) return String(v[0] ?? "").trim();
    return typeof v === "string" ? v.trim() : "";
  };

  const rawUniversity = one("university");
  const school = pickSchool(one("school")) || pickSchool(rawUniversity);
  const verifiedOnly = one("verified") === "1" || one("verification") === "verified";
  const priceBand = pickPriceBand(one("priceBand"));

  const viewRaw = one("view");
  const view: MentorsListView = viewRaw === "grid" ? "grid" : "list";

  const scopeRaw = one("scope");
  const scope: MentorsListScope =
    scopeRaw === "recent" ? "recent" : scopeRaw === "favorite" ? "favorite" : "all";

  return {
    q: one("q"),
    subject: pickSubject(one("subject")),
    school,
    university: school ? "" : rawUniversity,
    verification: one("verification"),
    verifiedOnly,
    grades: parseListParam(many(sp, "grades"), MENTOR_GRADE_OPTIONS.map((g) => g.id)) as MentorGradeFilter[],
    mentorTypes: parseListParam(many(sp, "mentorTypes"), MENTOR_TYPE_OPTIONS.map((t) => t.id)) as MentorTypeFilter[],
    priceBand,
    sort: pickSort(one("sort")),
    view,
    scope,
    page: Math.max(1, parseIntParam(one("page")) ?? 1),
  };
}

export function mentorsListHref(
  current: Record<string, string | undefined>,
  patch: Record<string, string | undefined | null>
): string {
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) {
    if (v !== undefined && v !== null && v !== "") next[k] = v;
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") {
      delete next[k];
      continue;
    }
    next[k] = v;
  }
  const u = new URLSearchParams(next);
  const s = u.toString();
  return s ? `/mentors?${s}` : "/mentors";
}

export function filtersToHrefRecord(f: MentorsListFilters): Record<string, string | undefined> {
  const o: Record<string, string | undefined> = {};
  if (f.q) o.q = f.q;
  if (f.subject) o.subject = f.subject;
  if (f.school) o.school = f.school;
  else if (f.university) o.university = f.university;
  if (f.verifiedOnly) o.verified = "1";
  if (f.verification && !f.verifiedOnly) o.verification = f.verification;
  if (f.grades.length) o.grades = f.grades.join(",");
  if (f.mentorTypes.length) o.mentorTypes = f.mentorTypes.join(",");
  if (f.priceBand) o.priceBand = f.priceBand;
  if (f.sort && f.sort !== "popular") o.sort = f.sort;
  if (f.view === "grid") o.view = "grid";
  if (f.scope && f.scope !== "all") o.scope = f.scope;
  if (f.page > 1) o.page = String(f.page);
  return o;
}
