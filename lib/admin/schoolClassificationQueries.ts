import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadUserNamesByIds } from "@/lib/admin/accountDetailQueries";
import { mentorProfilesAdminReadClient } from "@/lib/admin/mentorProfilesAdminRead";
import {
  SCHOOL_TIER_UNCLASSIFIED,
  SCHOOL_VERIFICATION_TABLE,
  buildSchoolTierDistribution,
  isBranchCampusSuspect,
  sortUnclassifiedMentors,
  type SchoolTierDistributionRow,
  type UnclassifiedMentorItem,
} from "@/lib/admin/schoolClassificationConsole";

/**
 * 등급 분류(PR-11 §3) 서버 조회 — 확정 승인 행(approved · 멘토당 1행)의 등급별 분포 · 미분류 멘토 목록 · 캠퍼스 표기 멘토. 전부 읽기.
 *
 * `mentor_school_verifications` 는 관리자 세션으로도 읽히지만(is_admin SELECT) 멘토 입력값(`mentor_profiles.university_name`)은 본인 행 RLS 라
 * 관리자 읽기 클라이언트(service_role 우선 · 세션 폴백)로 함께 읽는다. 행 상한 2000(멘토 74명).
 */

const VERIFICATION_COLUMNS = "id, mentor_id, status, school_tier, verified_university_name, verified_department_name, verified_major_category, reviewed_by, reviewed_at";
const PROFILE_COLUMNS = "user_id, university_name, department_name, verification_status";
const ROW_LIMIT = 2000;

type Row = Record<string, unknown>;

export type BranchCampusMentorItem = { mentorId: string; name: string; universityName: string; tier: string };

export type SchoolClassificationOverview = {
  distribution: SchoolTierDistributionRow[];
  approvedCount: number;
  unclassified: UnclassifiedMentorItem[];
  branchCampus: BranchCampusMentorItem[];
  error: string | null;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strOrNull(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

export async function loadSchoolClassificationOverview(supabase: SupabaseClient): Promise<SchoolClassificationOverview> {
  const readDb = mentorProfilesAdminReadClient(supabase);
  const { data, error } = await readDb.from(SCHOOL_VERIFICATION_TABLE).select(VERIFICATION_COLUMNS).eq("status", "approved").limit(ROW_LIMIT);
  if (error) {
    console.error("[loadSchoolClassificationOverview] mentor_school_verifications:", error.message);
    return { distribution: buildSchoolTierDistribution([]), approvedCount: 0, unclassified: [], branchCampus: [], error: error.message };
  }
  const rows = (data as Row[] | null) ?? [];

  // 멘토 id 목록을 쿼리스트링에 싣지 않는다(URL 상한) — 승인 멘토 프로필·users(role=mentor)를 상한 안에서 읽어 메모리 매핑. 확정자 이름은 소수라 id 조회.
  const [profiles, mentorUsers, reviewerNames] = await Promise.all([
    readDb.from("mentor_profiles").select(PROFILE_COLUMNS).eq("verification_status", "approved").limit(ROW_LIMIT),
    readDb.from("users").select("id, full_name, nickname, email").eq("role", "mentor").limit(ROW_LIMIT),
    loadUserNamesByIds(readDb, [...new Set(rows.map((r) => strOrNull(r.reviewed_by)))]),
  ]);
  if (profiles.error) console.error("[loadSchoolClassificationOverview] mentor_profiles:", profiles.error.message);
  if (mentorUsers.error) console.error("[loadSchoolClassificationOverview] users:", mentorUsers.error.message);
  const profileById = new Map<string, Row>();
  for (const p of (profiles.data as Row[] | null) ?? []) profileById.set(str(p.user_id), p);
  const names = new Map<string, string>();
  for (const u of (mentorUsers.data as Row[] | null) ?? []) {
    const id = str(u.id);
    if (id) names.set(id, str(u.full_name) || str(u.nickname) || str(u.email) || id.slice(0, 8));
  }

  const unclassified: UnclassifiedMentorItem[] = [];
  const branchCampus: BranchCampusMentorItem[] = [];
  for (const r of rows) {
    const mentorId = str(r.mentor_id);
    const profile = profileById.get(mentorId);
    const universityName = str(profile?.university_name) || str(r.verified_university_name);
    const tier = str(r.school_tier) || SCHOOL_TIER_UNCLASSIFIED;
    const name = names.get(mentorId) ?? mentorId.slice(0, 8);
    if (tier === SCHOOL_TIER_UNCLASSIFIED) {
      const reviewedBy = strOrNull(r.reviewed_by);
      unclassified.push({
        verificationId: str(r.id),
        mentorId,
        name,
        universityName: universityName || "—",
        departmentName: str(profile?.department_name) || str(r.verified_department_name) || "—",
        reviewerName: reviewedBy ? (reviewerNames.get(reviewedBy) ?? reviewedBy.slice(0, 8)) : null,
        reviewedAt: strOrNull(r.reviewed_at),
        confirmed: Boolean(reviewedBy),
      });
    }
    if (isBranchCampusSuspect(universityName, tier)) branchCampus.push({ mentorId, name, universityName, tier });
  }

  return {
    distribution: buildSchoolTierDistribution(rows.map((r) => ({ school_tier: strOrNull(r.school_tier) }))),
    approvedCount: rows.length,
    unclassified: sortUnclassifiedMentors(unclassified),
    branchCampus: branchCampus.sort((a, b) => a.universityName.localeCompare(b.universityName, "ko") || a.name.localeCompare(b.name, "ko")),
    error: null,
  };
}
