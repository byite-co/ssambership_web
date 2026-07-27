-- 160_p1_11_notification_helper_acl_hardening.sql
-- [적용됨 — ssambership-staging 에 2026-07-20 적용. ACL 확인: 두 헬퍼 postgres/service_role 전용.
--   적용 후 staging fixture 재실행 24/24 PASS(트리거 경유 호출 무영향). 적용 이력: docs/audit/sql_apply_manifest.md]
-- P1-11 후속 수렴 — 157 표시 헬퍼 ACL 최소화.
-- 배경: 157 적용 시 Supabase 기본 권한(ALTER DEFAULT PRIVILEGES)이 신규 함수에
--   anon/authenticated EXECUTE 를 부여한다. 157 파일의 `revoke ... from public` 은 PUBLIC 부여분만
--   제거하므로, SECURITY DEFINER 로 users 를 읽는 표시 헬퍼 2종이 anon/authenticated 에서 직접 호출
--   가능한 상태로 남았다(UUID 를 아는 호출자에게 full_name/nickname 노출 표면 — 138/140 과 동일 계열).
-- 조치: 두 헬퍼에서 anon/authenticated EXECUTE 를 revoke. 트리거 실행은 함수 owner(postgres) 권한으로
--   검사되므로 157~159 트리거 동작에는 영향이 없다(적용 후 fixture 재검증으로 확인).
-- 참고: 트리거 함수(sbe_/sub_/mp_/refund_/mplan_/cra_/com_·155 iq_*)는 trigger 반환형이라 SQL 에서
--   직접 호출이 불가해 노출 표면이 아니며, cash/date 라벨 헬퍼는 테이블을 읽지 않는 순수 포매터다 — 모두 무변경.
-- 선행: 157.

begin;
revoke execute on function public.notification_display_name(uuid) from anon, authenticated;
revoke execute on function public.notification_mentor_label(uuid) from anon, authenticated;
commit;

-- §V: pg_proc ACL 에 anon/authenticated 부재 · service_role/postgres 유지 ·
--   157~159 fixture 재실행 전부 PASS(트리거 경유 호출 무영향).
