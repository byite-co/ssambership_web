-- =============================================================================
-- 20260730195150_revoke_mentor_plans_write_rollback.sql (S2 M12 rollback)
-- =============================================================================
-- M12(mentor_plans 테이블 단위 회수)의 대칭 복원 — 계약 §22 #6 문자 그대로.
--   - 회수했던 비SELECT 6종(INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)을
--     역할 2종(anon, authenticated)에 되돌린다.
--   - SELECT 는 forward 이후에도 계속 존재하므로 중복 복원 대상으로 계산하지 않는다.
-- 실행 전제(§22 #2): M16 rollback 이후(역순 2순위). 오너 승인 후 apply_migration 으로
--   원장 새 행 append(ledger name = 20260730195150_revoke_mentor_plans_write_rollback).
-- 복원 후 기대: anon·authenticated 의 mentor_plans 테이블 권한 7종 전부 true.
-- =============================================================================

begin;

DO $$
BEGIN
  IF to_regclass('public.mentor_plans') IS NULL THEN
    RAISE EXCEPTION 'M12_ROLLBACK_BASELINE_MISMATCH: public.mentor_plans not found';
  END IF;
END $$;

-- §22 #6 정본 — 회수한 권한 목록(비SELECT 6종·역할 2종)을 문자 그대로 복원
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.mentor_plans
TO anon, authenticated;

-- 복원 직후 게이트 — 7종 전부 true (M12 적용 전 baseline 복원 확인)
DO $$
DECLARE
  v_role text;
  v_priv text;
BEGIN
  FOR v_role, v_priv IN
    SELECT r.rolname, p.priv
      FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
  LOOP
    IF NOT has_table_privilege(v_role, 'public.mentor_plans', v_priv) THEN
      RAISE EXCEPTION 'M12_ROLLBACK_ACL_MISMATCH: % % expected true, measured false', v_role, v_priv;
    END IF;
  END LOOP;
END $$;

commit;
