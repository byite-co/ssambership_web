-- =============================================================================
-- 20260729211929_mentor_profile_privileged_column_guard_rollback.sql (S2 M0 rollback)
-- =============================================================================
-- forward: supabase/sql/20260729211929_mentor_profile_privileged_column_guard.sql
-- 정본: 물리 정책 §6·§7 / 계약 §20.2 M0("트리거·함수 DROP") · §22.
-- 제거 대상은 M0 가 만든 3객체뿐이다:
--   1) UPDATE 트리거 trg_mentor_profile_privileged_guard_upd
--   2) INSERT 트리거 trg_mentor_profile_privileged_guard_ins
--   3) 트리거 함수  public.enforce_mentor_profile_privileged_guard()
-- 손대지 않는 것: mentor_profiles 테이블·컬럼·default·ACL·업무 데이터,
--   기존 트리거(trg_mentor_profiles_set_updated · trg_mp_notify_activity ·
--   trg_mp_seed_default_plans). 포괄 삭제 동적 SQL 금지 — 명시 DROP 만 사용.
-- 실행: 장애 시 오너 승인 후 apply_migration 으로 이 파일 1건을 명시 선택,
--   ledger name = 20260729211929_mentor_profile_privileged_column_guard_rollback
--   (원장 새 행 append — forward 행 삭제·수정·reverted 처리 금지).
-- =============================================================================

begin;

drop trigger if exists trg_mentor_profile_privileged_guard_upd on public.mentor_profiles;
drop trigger if exists trg_mentor_profile_privileged_guard_ins on public.mentor_profiles;
drop function if exists public.enforce_mentor_profile_privileged_guard();

commit;
