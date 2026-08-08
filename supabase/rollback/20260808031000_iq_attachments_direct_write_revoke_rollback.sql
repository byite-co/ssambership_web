-- =============================================================================
-- 20260808031000_iq_attachments_direct_write_revoke_rollback.sql
-- =============================================================================
-- F4 회수 롤백 — 적용 전 baseline(테이블 권한 7종)으로 복원한다.
-- 주의: baseline 자체가 defense-in-depth 결함이므로 이 롤백은 긴급 복구 전용.
-- =============================================================================

begin;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.individual_question_attachments TO anon, authenticated;

commit;
