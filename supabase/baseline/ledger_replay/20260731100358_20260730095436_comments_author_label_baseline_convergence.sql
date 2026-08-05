-- =============================================================================
-- 20260730095436_comments_author_label_baseline_convergence.sql (S2 MC)
-- =============================================================================
-- P0 D-1 해소 — comments.author_label baseline convergence (M13 직전 조건부 수렴).
-- 정본 계약: docs/audit/s2_3_p0_d1_comments_author_label_remote_drift_contract_20260731.md
--            §10 채택 계약 · §11 Forward Contract(S1~S5) · §13 멱등성 · §14 잠금.
--   - 원격 public.comments 에 037 정본 컬럼 author_label 이 부재(드리프트 실측
--     S2-3 §3.1)하여 M13 게이트 ①이 중단된다. 본 migration 은 M13 「직전」에
--     실행되어 컬럼을 037 정본 형상(text NOT NULL DEFAULT '쌤버십 회원')으로
--     조건부 수렴한다. M13·M4·기존 SQL 은 바이트 무수정 유지.
--   - timestamp 20260730095436 은 S2-3 계약 §10 이 지정한 과거 삽입 슬롯의
--     일회성 고정값이다(M1 20260730095435 < MC < M13 20260730095438 사전순
--     불변식). 기존 timestamp 정책(§5 채번 절차)의 일반 변경이 아니라
--     S2-3 P0 D-1 해소 계약에 따른 MC 단일 삽입 예외다.
--   - 대상은 public.comments.author_label 단독. DML 0 · 다른 컬럼 변경 0 ·
--     함수·트리거·정책·인덱스·GRANT 변경 0 · community_comments 무접촉 ·
--     column comment 추가 0 · NOTIFY 없음(schema cache reload 는 운영 절차
--     — S2-3 §15, 적용 러너 소관).
--   - 상태 분기(S2-3 §11 — 재량 0 이식):
--       S1 컬럼 부재(+author_role 부재)  → ADD COLUMN 정확히 1문장
--       S2 037 정본 형상                 → NOTICE no-op (clean-install 경로)
--       S3 M13 적용 후 형상              → NOTICE no-op (default 되돌림 절대 금지)
--       S4 타입 ≠ text                   → 수정 0건 중단 (강제 변환 금지)
--       S5 그 외 형상(nullable·예상 밖 default·부분 M13·generated/identity 등)
--                                        → 수정 0건 중단 (자동 보정 금지 — 오너 회부)
--   - 오류 식별자: BATCH_B_BASELINE_OBJECT_MISMATCH 재사용(신규 채번 금지 —
--     Batch B 관행). 예외 시 단일 트랜잭션 전체 rollback — 부분 적용 상태 없음.
--   - 멱등성(§13): 성공 후 상태는 항상 S2 또는 S3 로 판정되어 no-op. 몇 번을
--     어떤 순서로 실행해도 S1 에서 정확히 1회만 효과.
--   - 잠금(§14): ADD COLUMN constant default 는 PG11+ fast-path(table rewrite 0).
--     ACCESS EXCLUSIVE 순간 보유 — lock_timeout 5s, 초과 실패 시 재실행 안전.
-- 선행조건: 없음(MC 자체 선행 간선 없음 — 유일 필수 제약은 「M13 이전」 실행.
--   위상 그래프 M13 : MC 신설, S2-3 §10).
-- rollback 정본: supabase/rollback/20260730095436_comments_author_label_baseline_convergence_rollback.sql
--   (CONDITIONAL — pre-state 컬럼 부재가 증명된 DB 한정·M13 이력 시 forward-fix only)
-- =============================================================================

begin;

set local lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- A. 테이블 게이트 + 상태 분기 S1~S5 (S2-3 §11 — 불일치 시 수정 0건 중단)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_type      text;
  v_null      text;
  v_def       text;
  v_gen       text;
  v_ident     text;
  v_role_ex   boolean;
BEGIN
  -- 테이블 게이트: public.comments 부재 시 수정 없이 중단
  IF to_regclass('public.comments') IS NULL THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: public.comments table missing';
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'comments'
                    AND column_name = 'author_role')
    INTO v_role_ex;

  SELECT data_type, is_nullable, column_default, is_generated, is_identity
    INTO v_type, v_null, v_def, v_gen, v_ident
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'comments'
     AND column_name = 'author_label';

  IF NOT FOUND THEN
    IF v_role_ex THEN
      -- 부분 M13 상태(author_label 부재 + author_role 존재) — 자동 수정 금지 (S5)
      RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_label absent but comments.author_role present (partial M13 state — manual review required)';
    END IF;
    -- S1: 원격 드리프트 실측 상태 — 037 정본 형상으로 수렴 (정확히 1문장)
    ALTER TABLE public.comments
      ADD COLUMN author_label text NOT NULL DEFAULT '쌤버십 회원';
    RAISE NOTICE 'S2_MC S1: comments.author_label added (text NOT NULL DEFAULT ''쌤버십 회원'') — baseline converged';
  ELSIF v_type <> 'text' THEN
    -- S4: 타입 불일치 — 강제 변환 금지, 수정 0건 중단
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_label type=% null=% default=% (expected text — no coercion)',
      v_type, v_null, coalesce(v_def, '<none>');
  ELSIF v_null = 'NO' AND v_def IS NOT DISTINCT FROM '''쌤버십 회원''::text'
        AND NOT v_role_ex AND v_gen = 'NEVER' AND v_ident = 'NO' THEN
    -- S2: 037 정본 baseline 형상 — no-op (clean-install·수렴 성공 후 재실행 경로)
    RAISE NOTICE 'S2_MC S2: comments.author_label already at baseline shape — no-op';
  ELSIF v_null = 'NO' AND v_def IS NOT DISTINCT FROM '''쌤버십 사용자''::text'
        AND v_role_ex AND v_gen = 'NEVER' AND v_ident = 'NO' THEN
    -- S3: M13 적용 후 형상 — no-op. default 를 '쌤버십 회원' 으로 되돌리거나
    --     author_role·M13 객체를 접촉하는 것을 절대 금지한다(M13 되돌림 방지).
    RAISE NOTICE 'S2_MC S3: comments.author_label at post-M13 shape — no-op (default preserved)';
  ELSE
    -- S5: 그 외 모든 형상(nullable·default 부재/예상 밖·S3 부분 충족·generated/identity)
    --     — 자동 보정 금지, 수정 0건 중단 (오너 회부)
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_label unexpected shape type=% null=% default=% generated=% identity=% author_role_present=%',
      v_type, v_null, coalesce(v_def, '<none>'), v_gen, v_ident, v_role_ex;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. 적용 직후 자가 검증 (S2-3 §11 post-check — commit 직전 A/B 두 형상만 허용)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_label_ok_a boolean;
  v_label_ok_b boolean;
  v_role_ex    boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'comments'
                    AND column_name = 'author_role')
    INTO v_role_ex;
  -- A: baseline 정본 — text NOT NULL default '쌤버십 회원' ∧ author_role 부재
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'comments'
                    AND column_name = 'author_label'
                    AND data_type = 'text' AND is_nullable = 'NO'
                    AND column_default = '''쌤버십 회원''::text')
    INTO v_label_ok_a;
  -- B: M13 이후 — text NOT NULL default '쌤버십 사용자' ∧ author_role 존재
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'comments'
                    AND column_name = 'author_label'
                    AND data_type = 'text' AND is_nullable = 'NO'
                    AND column_default = '''쌤버십 사용자''::text')
    INTO v_label_ok_b;
  IF NOT ((v_label_ok_a AND NOT v_role_ex) OR (v_label_ok_b AND v_role_ex)) THEN
    RAISE EXCEPTION 'S2_MC_SELFCHECK: comments.author_label post-state is neither baseline(A) nor post-M13(B) shape (label_a=% label_b=% author_role=%)',
      v_label_ok_a, v_label_ok_b, v_role_ex;
  END IF;
END $$;

commit;
