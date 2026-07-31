-- =============================================================================
-- 20260730195147_revoke_mentor_profiles_write_rollback.sql (S2 M11 rollback)
-- =============================================================================
-- M11(mentor_profiles 테이블 단위 회수)의 대칭 복원 — 계약 §22 #6 문자 그대로.
--   - 회수했던 비SELECT 6종(INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)을
--     역할 2종(anon, authenticated)에 되돌린다.
--   - SELECT 는 forward 이후에도 계속 존재하므로 중복 복원 대상으로 계산하지 않는다.
--   - RLS 정책·service_role·postgres 권한·데이터는 forward 가 건드리지 않았으므로
--     복원 대상이 아니다.
-- 실행 전제(§22 #2·#4): M16 rollback → M12 rollback 이후(역순 3순위). 웹 코드
--   호출부는 레거시로 선복원돼 있어야 한다. 오너 승인 후 apply_migration 으로
--   원장 새 행 append(ledger name = 20260730195147_revoke_mentor_profiles_write_rollback).
-- 복원 후 기대: anon·authenticated 의 mentor_profiles 테이블 권한 7종
--   (SELECT + 위 6종) 전부 true — M11 적용 전 §10.6 실측 baseline 과 동일.
-- =============================================================================

begin;

DO $$
BEGIN
  IF to_regclass('public.mentor_profiles') IS NULL THEN
    RAISE EXCEPTION 'M11_ROLLBACK_BASELINE_MISMATCH: public.mentor_profiles not found';
  END IF;
END $$;

-- §22 #6 정본 — 회수한 권한 목록(비SELECT 6종·역할 2종)을 문자 그대로 복원
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.mentor_profiles
TO anon, authenticated;

-- 복원 직후 게이트 — 7종 전부 true (M11 적용 전 baseline 복원 확인)
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
    IF NOT has_table_privilege(v_role, 'public.mentor_profiles', v_priv) THEN
      RAISE EXCEPTION 'M11_ROLLBACK_ACL_MISMATCH: % % expected true, measured false', v_role, v_priv;
    END IF;
  END LOOP;
END $$;

commit;
