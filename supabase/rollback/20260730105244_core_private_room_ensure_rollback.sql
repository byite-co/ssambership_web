-- =============================================================================
-- 20260730105244_core_private_room_ensure_rollback.sql (S2 M5 rollback)
-- =============================================================================
-- forward: supabase/sql/20260730105244_core_private_room_ensure.sql
-- 정본: 계약 §20.2 M5 · §22 #2(역의존 — M6·M9·M17 rollback 이 먼저).
-- 제거 대상은 M5 가 만든 F10 1객체뿐이다. CASCADE 금지 · 데이터 접촉 0.
-- Batch C 역순 정본: M7 → M6 → M5 (이 파일이 마지막).
-- 실행: 장애 시 오너 승인 후 apply_migration 으로 이 파일 1건 명시 선택,
--   ledger name = 20260730105244_core_private_room_ensure_rollback (원장 새 행 append).
-- =============================================================================

begin;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'core_private' AND p.proname = 'ensure_student_mentor_room') THEN
    RAISE EXCEPTION 'S2_M5_ROLLBACK_GATE: F10 not present — nothing to roll back';
  END IF;
  -- 역의존: F10 을 호출하는 api_web_v1 wrapper(F2 — M6)가 남아 있으면 실행 금지
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api_web_v1' AND p.prokind = 'f'
         AND pg_get_functiondef(p.oid) LIKE '%core_private.ensure_student_mentor_room%') > 0 THEN
    RAISE EXCEPTION 'S2_M5_ROLLBACK_GATE: api_web_v1 callers of F10 remain — roll back M6(및 후속) first';
  END IF;
END $$;

DROP FUNCTION core_private.ensure_student_mentor_room(uuid, uuid, uuid, uuid, boolean);

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core_private') <> 0 THEN
    RAISE EXCEPTION 'S2_M5_ROLLBACK_SELFCHECK: core_private not empty after F10 drop';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core_private') THEN
    RAISE EXCEPTION 'S2_M5_ROLLBACK_SELFCHECK: schema must remain (M1 rollback 소유)';
  END IF;
END $$;

commit;
