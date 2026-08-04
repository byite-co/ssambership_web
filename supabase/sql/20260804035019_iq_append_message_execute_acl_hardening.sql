-- =============================================================================
-- 20260804035019_iq_append_message_execute_acl_hardening.sql (후속 위생 H1)
-- =============================================================================
-- DB-GRANT-HYGIENE-001. public.iq_append_message(uuid, text) 는 SECURITY DEFINER
-- 이면서 proacl=NULL(기본 PUBLIC EXECUTE) 상태라 anon 까지 EXECUTE 가능했다.
-- 함수 본문의 auth.uid() 게이트로 현재 확인된 익명 우회는 없으나, public 스키마
-- SECURITY DEFINER 함수의 기본 PUBLIC EXECUTE 는 최소권한 계약 위반이다.
--
-- 이 migration 은 '권한만' 조정한다:
--   PUBLIC·anon EXECUTE 회수 → authenticated·service_role 에만 EXECUTE 허용.
--   * 함수 본문·인자·반환형·SECURITY DEFINER·search_path 는 변경하지 않는다
--     (CREATE OR REPLACE 없음 — GRANT/REVOKE 만).
--   * 다른 overload·다른 함수의 권한은 건드리지 않는다(정확 signature 대상).
--
-- 정합 표준: 수렴 M2(20260803162808)가 이미 shortform_view_record_v2 등에 적용한
--   "revoke execute ... from public" 위생 패턴과 동일하다.
-- 앱 계약(authenticated 세션 호출)은 불변 — authenticated EXECUTE 유지.
-- 롤백: supabase/rollback/20260804035019_iq_append_message_execute_acl_hardening_rollback.sql
-- =============================================================================
begin;

-- 사전 게이트: 정확 signature 대상이 존재해야 한다(다른 overload 오조작 방지).
do $$
begin
  if to_regprocedure('public.iq_append_message(uuid,text)') is null then
    raise exception 'target function public.iq_append_message(uuid,text) not found';
  end if;
end
$$;

-- PUBLIC·anon EXECUTE 회수(기본 grant 포함), 인가 역할만 명시 허용.
revoke all privileges on function public.iq_append_message(uuid, text) from public, anon;
grant execute on function public.iq_append_message(uuid, text) to authenticated, service_role;

-- 자가 검증: 최소권한 계약 성립(anon 불가 · authenticated·service_role 가능).
do $$
declare
  v_oid oid := to_regprocedure('public.iq_append_message(uuid,text)')::oid;
begin
  if v_oid is null then
    raise exception 'iq_append_message target function not found';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'anon must not execute iq_append_message';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'authenticated execute missing';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'service_role execute missing';
  end if;
end
$$;

commit;
