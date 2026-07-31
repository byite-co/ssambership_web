-- =============================================================================
-- 20260730095438_comments_author_label_denormalize_rollback.sql (S2 M13 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730095438_comments_author_label_denormalize.sql
-- 정본: 계약 §22 #8(정확한 5단계) · §20.2 M13 · 부록 C-2 / 물리 정책 §9.2.
-- 정확한 순서(§22 #8 — 이 범위까지만):
--   ① snapshot UPDATE 보호 트리거 제거
--   ② INSERT 트리거 2종 제거
--   ③ 트리거 함수 2종 제거
--   ④ 신규 comments.author_role 컬럼만 제거
--   ⑤ comments.author_label default 를 '쌤버십 회원' 으로 복원
-- 금지(§22 #8): comments.author_label DROP · community_comments.author_label DROP ·
--   CASCADE · backfill 이전 클라이언트 제공 라벨 복원 · 163/164 브리지 본문 수정 ·
--   행 삭제. 정규화된 라벨 데이터는 rollback 후에도 유지한다 — 계약이 승인한
--   forward-only 보안 정정 예외(데이터 접촉 statement 0건).
-- 역의존: M4 rollback 선행(api_web_v1.community_comments_v1 이 author_role 을
--   참조 — 남아 있으면 ④ 의 RESTRICT DROP 이 실패하는 것이 정본 동작).
-- 실행: 장애 시 오너 승인 후 apply_migration 으로 이 파일 1건을 명시 선택,
--   ledger name = 20260730095438_comments_author_label_denormalize_rollback
--   (원장 새 행 append — forward 행 삭제·수정·reverted 처리 금지).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 — M13 적용 상태·M4 선행 rollback 확인
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
       AND ((tgrelid = 'public.comments'::regclass
             AND tgname IN ('trg_comments_set_author_label_ins', 'trg_comments_set_author_label_upd'))
            OR (tgrelid = 'public.community_comments'::regclass
                AND tgname IN ('trg_community_comments_set_author_label_ins',
                               'trg_community_comments_set_author_label_upd')))) <> 4
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.proname IN ('comments_set_author_label', 'community_comments_set_author_label')) <> 2
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'comments'
                       AND column_name = 'author_role') THEN
    RAISE EXCEPTION 'S2_M13_ROLLBACK_GATE: M13 forward state incomplete — nothing/partial to roll back';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'api_web_v1' AND c.relname = 'community_comments_v1') THEN
    RAISE EXCEPTION 'S2_M13_ROLLBACK_GATE: M4 view community_comments_v1 still exists — roll back M4 first';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- ① snapshot UPDATE 보호 트리거 제거
-- -----------------------------------------------------------------------------
DROP TRIGGER trg_comments_set_author_label_upd ON public.comments;
DROP TRIGGER trg_community_comments_set_author_label_upd ON public.community_comments;

-- -----------------------------------------------------------------------------
-- ② INSERT 트리거 2종 제거
-- -----------------------------------------------------------------------------
DROP TRIGGER trg_comments_set_author_label_ins ON public.comments;
DROP TRIGGER trg_community_comments_set_author_label_ins ON public.community_comments;

-- -----------------------------------------------------------------------------
-- ③ 트리거 함수 2종 제거 (CASCADE 금지 — 의존 트리거는 ①②에서 이미 제거됨)
-- -----------------------------------------------------------------------------
DROP FUNCTION public.comments_set_author_label();
DROP FUNCTION public.community_comments_set_author_label();

-- -----------------------------------------------------------------------------
-- ④ 신규 comments.author_role 컬럼만 제거 (RESTRICT — 의존 잔존 시 실패가 정본)
-- -----------------------------------------------------------------------------
ALTER TABLE public.comments DROP COLUMN author_role;

-- -----------------------------------------------------------------------------
-- ⑤ comments.author_label default 를 baseline '쌤버십 회원' 으로 복원
--    (컬럼·NOT NULL·정규화된 라벨 데이터는 보존 — forward-only 예외)
-- -----------------------------------------------------------------------------
ALTER TABLE public.comments ALTER COLUMN author_label SET DEFAULT '쌤버십 회원';

-- -----------------------------------------------------------------------------
-- B. 사후 자가 검증 — 선재 컬럼 보존 + M13 객체 0 + 163/164 브리지 불변
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- 선재 author_label 컬럼 보존(양 테이블 text NOT NULL) + comments default 복원
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'comments'
                    AND column_name = 'author_label' AND data_type = 'text' AND is_nullable = 'NO'
                    AND column_default = '''쌤버십 회원''::text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'community_comments'
                       AND column_name = 'author_label' AND data_type = 'text' AND is_nullable = 'NO'
                       AND column_default = '''쌤버십 회원''::text') THEN
    RAISE EXCEPTION 'S2_M13_ROLLBACK_SELFCHECK: author_label preservation/default restore failed';
  END IF;
  -- author_role 제거 + M13 트리거·함수 0
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'author_role')
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal
                 AND tgname IN ('trg_comments_set_author_label_ins', 'trg_comments_set_author_label_upd',
                                'trg_community_comments_set_author_label_ins',
                                'trg_community_comments_set_author_label_upd'))
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public'
                   AND p.proname IN ('comments_set_author_label', 'community_comments_set_author_label')) THEN
    RAISE EXCEPTION 'S2_M13_ROLLBACK_SELFCHECK: M13 objects not fully removed';
  END IF;
  -- 163/164 브리지 정본 불변(함수 7종·가드/동기화 트리거 잔존)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('comment_sync_in_progress', 'comments_write_guard', 'cc_write_guard',
                           'cc_sync_board_to_canonical', 'cc_sync_board_delete_to_canonical',
                           'comments_mirror_to_legacy', 'comments_mirror_delete_to_legacy')) <> 7 THEN
    RAISE EXCEPTION 'S2_M13_ROLLBACK_SELFCHECK: 163/164 bridge functions were touched';
  END IF;
  -- 016 updated_at 트리거 정상(ENABLE) 상태 확인
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.community_comments'::regclass
                    AND tgname = 'trg_community_comments_set_updated' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'S2_M13_ROLLBACK_SELFCHECK: trg_community_comments_set_updated not enabled';
  END IF;
END $$;

commit;
