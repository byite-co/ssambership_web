import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMentorIndividualQuestionPriceMap } from "@/lib/individualQuestion/individualQuestionPricing";
import { defaultMentorsListFilters } from "@/lib/mentor/mentorsListSearchParams";
import {
  mentorIsVerified,
  mentorSchoolGradeLine,
  mentorSchoolVerificationBadgeClass,
  mentorSchoolVerificationBadgeLabel,
  mentorSubjectChips,
} from "@/lib/mentor/mentorPublicProfileDisplay";
import { loadPublicMentorsList } from "@/lib/mentor/publicMentorsListQueries";
import { loadSchoolClassificationCatalogs } from "@/lib/mentor/schoolClassificationCatalog";
import { getMajorSubjects, getMinorSubjects } from "@/lib/subjects/subjectCatalog";

/**
 * 학생 개별 질문 탭 "지정 질문 멘토 게시판"용 카드 데이터.
 * 클라이언트 컴포넌트로 그대로 직렬화되므로 표시용 원시값만 담는다(함수·클래스 금지).
 */
export type DirectMentorBoardCard = {
  mentorId: string;
  name: string;
  photoUrl: string | null;
  verified: boolean;
  schoolLine: string;
  badgeLabel: string;
  badgeClass: string;
  chips: string[];
  /** 과목 대분류 칩 필터 매칭용(subjectCatalog 대분류 code) */
  majorCodes: string[];
  /** 검색 입력 매칭용(이름·학교·과목 소문자 블롭) */
  searchBlob: string;
  avgRating: number | null;
  reviewCount: number | null;
  /** 개별 질문 단가(cents). null = 단가 미설정(질문받지 않음) 또는 비로그인이라 조회 불가 */
  iqPriceCents: number | null;
};

export type DirectMentorBoardData = {
  cards: DirectMentorBoardCard[];
  /** true면 단가를 실제 조회한 상태(로그인). false면 비로그인 등으로 단가 미조회. */
  pricesVisible: boolean;
  error: string | null;
};

// 멘토 찾기(publicMentorsListQueries.subjectMatchesPreset)와 동일하게 라벨 부분일치로 보수적 매칭.
function majorCodesForSubjects(subjectsText: string): string[] {
  const blob = subjectsText.toLowerCase();
  if (!blob.trim()) return [];
  const out: string[] = [];
  for (const major of getMajorSubjects()) {
    if (major.code === "etc") continue;
    const labels = [major.label, ...getMinorSubjects(major.code).map((s) => s.label)];
    if (labels.some((label) => blob.includes(label.toLowerCase()))) {
      out.push(major.code);
    }
  }
  return out;
}

/**
 * 지정 질문 멘토 게시판 데이터 로드.
 * 멘토 목록은 멘토 찾기와 동일한 공개 디렉터리 쿼리(승인 + 담당 과목 게이트 포함)를 재사용하고,
 * 개별 질문 단가만 배치로 덧붙인다(표시 전용 — 결제 금액은 서버 액션에서 재조회).
 */
export async function loadDirectMentorBoard(
  supabase: SupabaseClient,
  opts?: { pricesVisible?: boolean; fetchLimit?: number; pageSize?: number }
): Promise<DirectMentorBoardData> {
  const pricesVisible = opts?.pricesVisible ?? false;
  const catalogs = await loadSchoolClassificationCatalogs(supabase);
  const list = await loadPublicMentorsList(supabase, defaultMentorsListFilters({ sort: "popular" }), {
    fetchLimit: opts?.fetchLimit ?? 60,
    pageSize: opts?.pageSize ?? 36,
    schoolTierLabels: catalogs.schoolTierLabels,
    majorCategoryLabels: catalogs.majorCategoryLabels,
  });

  if (list.usersError) {
    return { cards: [], pricesVisible, error: list.usersError };
  }

  const ids = list.cards.map((c) => c.mentorId);
  const priceBatch = pricesVisible
    ? await fetchMentorIndividualQuestionPriceMap(supabase, ids)
    : { byMentor: new Map<string, number>(), error: null as string | null };

  // 단가 조회 실패는 게시판을 숨길 사유가 아님 — 단가 미표시 모드로 강등(치명 오류는 usersError만).
  if (priceBatch.error) {
    console.error("[directMentorBoard] pricing batch failed", { error: priceBatch.error });
  }
  const effectivePricesVisible = pricesVisible && !priceBatch.error;

  const cards: DirectMentorBoardCard[] = list.cards.map((card) => {
    const d = card.display;
    const subjectsText = d.subjects || d.tags || "";
    const searchBlob = [d.displayName, d.university, d.department, d.rawUniversity, d.rawDepartment, subjectsText]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return {
      mentorId: card.mentorId,
      name: d.displayName,
      photoUrl: d.photoUrl?.trim() || null,
      verified: mentorIsVerified(d.verification),
      schoolLine: mentorSchoolGradeLine(d),
      badgeLabel: mentorSchoolVerificationBadgeLabel(d),
      badgeClass: mentorSchoolVerificationBadgeClass(d),
      chips: mentorSubjectChips(subjectsText, 4),
      majorCodes: majorCodesForSubjects(subjectsText),
      searchBlob,
      avgRating: card.avgRating,
      reviewCount: card.reviewCount,
      iqPriceCents: priceBatch.byMentor.get(card.mentorId) ?? null,
    };
  });

  return { cards, pricesVisible: effectivePricesVisible, error: null };
}
