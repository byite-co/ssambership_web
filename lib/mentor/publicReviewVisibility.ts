// W4(C10): probePublicReviewVisibilityColumns(is_hidden/hidden · is_blinded/is_blind 컬럼 프로빙,
// 탐지 실패 시 필터 생략 fail-open — XW-23) 삭제 — 호출부 전무(사문 export).
// 정본 경로: public.reviews.is_hidden / is_blinded 고정 컬럼 직접 참조(187 baseline 실측)
// — lib/mentor/publicMentorsListQueries.ts batchReviewStats · lib/mentor/publicMentorBundle.ts
// fetchReviewsSummary(get_mentor_review_stats RPC) 참고.
export {};
