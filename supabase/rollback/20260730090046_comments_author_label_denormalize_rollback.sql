-- =============================================================================
-- 20260730090046_comments_author_label_denormalize_rollback.sql (S2 M13 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730090046_comments_author_label_denormalize.sql
-- 정본: 물리 정책 §6·§7·§9.2 / 계약 §20.2 M13 · §22 #8 (5단계 — 여기까지만).
--   ① snapshot UPDATE 보호 트리거 제거
--   ② INSERT 트리거 2종 제거
--   ③ 트리거 함수 2종 제거
--   ④ 신규 comments.author_role 컬럼만 제거
--   ⑤ comments.author_label default 를 baseline '쌤버십 회원' 으로 복원
-- 금지(계약 §22 #8): comments.author_label·community_comments.author_label DROP,
--   163/164 브리지 함수·트리거 DROP·본문 수정, CASCADE, 행 삭제,
--   backfill 이전 클라이언트 제공 라벨 복원.
-- 정규화된 라벨 데이터는 rollback 후에도 유지한다 — 계약이 승인한
--   forward-only 보안 정정 예외(§22 #8, 오너 확정 2026-07-30).
-- 실행: 장애 시 오너 승인 후 apply_migration 으로 이 파일 1건을 명시 선택,
--   ledger name = 20260730090046_comments_author_label_denormalize_rollback
--   (원장 새 행 append — forward 행 삭제·수정·reverted 처리 금지).
-- =============================================================================

begin;

-- ① snapshot UPDATE 보호 트리거 제거
DROP TRIGGER trg_comments_set_author_label_upd ON public.comments;
DROP TRIGGER trg_community_comments_set_author_label_upd ON public.community_comments;

-- ② INSERT 트리거 2종 제거
DROP TRIGGER trg_comments_set_author_label_ins ON public.comments;
DROP TRIGGER trg_community_comments_set_author_label_ins ON public.community_comments;

-- ③ 트리거 함수 2종 제거
DROP FUNCTION public.comments_set_author_label();
DROP FUNCTION public.community_comments_set_author_label();

-- ④ 신규 comments.author_role 컬럼만 제거 (선재 author_label 은 보존)
ALTER TABLE public.comments DROP COLUMN author_role;

-- ⑤ comments.author_label default 복원 (037 baseline)
ALTER TABLE public.comments
  ALTER COLUMN author_label SET DEFAULT '쌤버십 회원';

commit;
