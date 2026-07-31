-- =============================================================================
-- 20260730095436_comments_author_label_baseline_convergence_rollback.sql (S2 MC rollback)
-- =============================================================================
-- forward: supabase/sql/20260730095436_comments_author_label_baseline_convergence.sql
-- 정본: S2-3 계약 §12 Rollback Contract — 등급 **CONDITIONAL**.
--   이 rollback 은 「MC 적용 전 comments.author_label 이 부재했던 DB」(S2-3 §3.1
--   원격 실측 pre-state)에 대해서만 원상복구를 보장한다. clean-install 처럼 MC
--   적용 전부터 컬럼이 선재하던 DB 에서는 이 파일을 실행하지 않는다 — 런타임
--   추론만으로 「MC 가 추가했는지」 판별할 수 없으므로, 운영 실행 시 R0 ③ 스키마
--   스냅샷으로 pre-state 부재가 증명되지 않으면 실행 금지다(절차 규칙 — §12).
-- M13 이력 방어(§12·지시 §9.3): M13(20260730095438)이 한 번이라도 원장에 적용된
--   DB 는 M13 rollback 선행 여부와 무관하게 MC rollback 을 거부한다 —
--   M13 이후 author_label 은 서버 정규화 라벨(forward-only 보안 정정, 계약 §22 #8)
--   을 보유하므로 DROP 은 정보 손실이다. M13 이후는 FORWARD_FIX_ONLY 로 고정.
-- 구조 하드게이트(전건 충족 시에만 DROP — 하나라도 미충족이면 수정 0건 중단):
--   ① comments.author_role 부재
--   ② M13 함수 2종 부재(comments_set_author_label·community_comments_set_author_label)
--      + M13 트리거 4종 부재(trg_comments_set_author_label_ins/upd·
--        trg_community_comments_set_author_label_ins/upd)
--   ③ M4 View api_web_v1.community_comments_v1 부재
--   ④ comments.author_label = text · NOT NULL · DEFAULT '쌤버십 회원'::text
--   ⑤ 전 행 author_label = '쌤버십 회원' (비default 라벨·NULL·빈 문자열이 1행이라도
--      있으면 정보 손실 가능성 — DROP 거부)
-- 오류 식별자: BATCH_B_BASELINE_OBJECT_MISMATCH 재사용(신규 채번 금지).
-- 이미 컬럼 부재(rollback 완료 상태) 재실행은 NOTICE 후 no-op.
-- 실행: 오너 승인 후 apply_migration 으로 이 파일 1건 명시 선택,
--   ledger name = 20260730095436_comments_author_label_baseline_convergence_rollback
--   (원장 새 행 append — forward 행 삭제·수정·reverted 처리 금지).
-- =============================================================================

begin;

set local lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- A. M13 원장 이력 방어 (가능한 환경에서 우선 평가 — forward-fix only 강제)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt bigint;
BEGIN
  IF to_regclass('public.comments') IS NULL THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: public.comments table missing — MC rollback target absent';
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*) FROM supabase_migrations.schema_migrations
       WHERE version = '20260730095438'
          OR name IN ('comments_author_label_denormalize',
                      '20260730095438_comments_author_label_denormalize')
    $q$ INTO v_cnt;
    IF v_cnt > 0 THEN
      RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: M13_APPLIED_FORWARD_FIX_ONLY — M13(20260730095438) ledger history exists (rows=%). MC rollback is refused regardless of M13 rollback state.', v_cnt;
    END IF;
  END IF;
  -- 원장 조회가 불가능한 환경(스키마 부재)은 여기서 통과하지만, 아래 구조
  -- 하드게이트 ①~③ 이 M13 잔재를 독립적으로 차단한다. 원장 없는 환경에서
  -- M13 적용 이력 유무를 추정으로 PASS 처리하지 않는다 — 운영 실행은 R0 ③
  -- 스냅샷·원장 실측이 선행된 경우에만 허용된다(헤더 절차 규칙).
END $$;

-- -----------------------------------------------------------------------------
-- B. no-op 게이트 + 구조 하드게이트 ①~⑤ + DROP (전건 충족 시에만)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt  bigint;
  v_type text;
  v_null text;
  v_def  text;
BEGIN
  -- 이미 컬럼 부재 — rollback 완료 상태 재실행 no-op
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'comments'
                    AND column_name = 'author_label') THEN
    RAISE NOTICE 'S2_MC_ROLLBACK: comments.author_label already absent — no-op';
    RETURN;
  END IF;

  -- ① author_role 부재
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'comments'
                AND column_name = 'author_role') THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_role exists — M13 residue, MC rollback refused (forward-fix only)';
  END IF;

  -- ② M13 함수 2종·트리거 4종 부재
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('comments_set_author_label',
                                  'community_comments_set_author_label')) THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: M13 trigger function exists — MC rollback refused (forward-fix only)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE NOT tgisinternal
                AND tgname IN ('trg_comments_set_author_label_ins',
                               'trg_comments_set_author_label_upd',
                               'trg_community_comments_set_author_label_ins',
                               'trg_community_comments_set_author_label_upd')) THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: M13 trigger exists — MC rollback refused (forward-fix only)';
  END IF;

  -- ③ M4 View 부재
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'api_web_v1' AND c.relname = 'community_comments_v1') THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: api_web_v1.community_comments_v1 exists — roll back M4 first, MC rollback refused';
  END IF;

  -- ④ author_label 형상 — text NOT NULL DEFAULT '쌤버십 회원'::text 정확 일치
  SELECT data_type, is_nullable, column_default INTO v_type, v_null, v_def
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'comments'
     AND column_name = 'author_label';
  IF v_type <> 'text' OR v_null <> 'NO'
     OR v_def IS DISTINCT FROM '''쌤버십 회원''::text' THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_label shape type=% null=% default=% — not the MC baseline shape, rollback refused',
      v_type, v_null, coalesce(v_def, '<none>');
  END IF;

  -- ⑤ 전 행 author_label = '쌤버십 회원' (정보 손실 방지)
  SELECT count(*) INTO v_cnt
    FROM public.comments
   WHERE author_label IS DISTINCT FROM '쌤버십 회원';
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: % comments row(s) carry non-default author_label — information loss risk, MC rollback refused', v_cnt;
  END IF;

  -- 전건 충족 — 정확히 1문장 (RESTRICT — CASCADE 금지)
  ALTER TABLE public.comments DROP COLUMN author_label;
  RAISE NOTICE 'S2_MC_ROLLBACK: comments.author_label dropped — pre-MC state restored';
END $$;

-- -----------------------------------------------------------------------------
-- C. 사후 자가 검증 — 컬럼 부재 확인 (no-op 경로 포함 동일 종착 상태)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'comments'
                AND column_name = 'author_label') THEN
    RAISE EXCEPTION 'S2_MC_ROLLBACK_SELFCHECK: comments.author_label still present after rollback';
  END IF;
END $$;

commit;
