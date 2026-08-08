-- =============================================================================
-- 20260808031000_iq_attachments_direct_write_revoke.sql (F4 hardening)
-- =============================================================================
-- individual_question_attachments 테이블의 anon/authenticated 직접 write 권한 회수.
--
-- 실측 baseline(staging 2026-08-08):
--   - RLS ON, 정책은 SELECT(iqa_select_party) 하나뿐 — write 정책 없음.
--   - 그런데 anon/authenticated 에 테이블 권한 7종(INSERT/UPDATE/DELETE/TRUNCATE/
--     REFERENCES/TRIGGER/SELECT)이 전부 남아 있었다. direct REST write 는 RLS 가
--     막고 있으나 불필요한 grant 가 유지되는 defense-in-depth 결함(F4).
-- 정상 경로 실측(회수 안전 근거):
--   - 앱: 테이블 접근은 SELECT 뿐(listAttachments / _findRegistered / realtime 구독).
--     행 등록은 SECURITY DEFINER RPC add_individual_question_attachment 만 사용
--     (definer 실행이라 테이블 grant 와 무관 — 회수 영향 없음).
--   - 웹: 테이블 write 는 service-role 클라이언트만 사용
--     (individualQuestionAttachmentStorage / transferIndividualQuestionsToRoom /
--      accountDeletionAdapters) — service_role 권한은 건드리지 않는다.
-- 회수 후 유지: anon/authenticated SELECT(당사자 RLS 가 행 범위를 제한),
--               service_role·postgres 권한 전부.
-- 패턴 정본: 20260730195150_revoke_mentor_plans_write.sql (REVOKE ALL + SELECT 복원).
-- rollback 정본: supabase/rollback/20260808031000_iq_attachments_direct_write_revoke_rollback.sql
-- =============================================================================

begin;

DO $$
BEGIN
  IF to_regclass('public.individual_question_attachments') IS NULL THEN
    RAISE EXCEPTION 'IQA_REVOKE_ABORT: public.individual_question_attachments not found';
  END IF;
END $$;

REVOKE ALL ON public.individual_question_attachments FROM anon, authenticated;
GRANT SELECT ON public.individual_question_attachments TO anon, authenticated;

-- 사후 검증: anon/authenticated 에 SELECT 외 권한이 남아 있으면 실패시킨다.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(grantee || ':' || privilege_type, ', ')
    INTO v_bad
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'individual_question_attachments'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type <> 'SELECT';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'IQA_REVOKE_INCOMPLETE: %', v_bad;
  END IF;
  IF (SELECT count(*)
        FROM information_schema.role_table_grants
       WHERE table_schema = 'public'
         AND table_name = 'individual_question_attachments'
         AND grantee IN ('anon', 'authenticated')
         AND privilege_type = 'SELECT') <> 2 THEN
    RAISE EXCEPTION 'IQA_REVOKE_SELECT_LOST: anon/authenticated SELECT must remain';
  END IF;
END $$;

commit;
