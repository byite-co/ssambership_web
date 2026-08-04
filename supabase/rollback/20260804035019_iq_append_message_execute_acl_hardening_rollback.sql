-- =============================================================================
-- 20260804035019_iq_append_message_execute_acl_hardening_rollback.sql
-- =============================================================================
-- forward(20260804035019_iq_append_message_execute_acl_hardening)의 권한 의미를
-- 사전 상태(effective PUBLIC EXECUTE)로 복원한다.
--
-- 주의: 사전 상태는 proacl=NULL(기본 PUBLIC EXECUTE)이었다. 카탈로그의 NULL 표현
--   자체를 시스템 카탈로그 직접 UPDATE 로 되돌리지 않는다 — 복원 목표는 'effective
--   privilege(모든 로그인 역할이 EXECUTE 가능)'의 의미 복원이다. GRANT ... TO PUBLIC
--   은 acl 을 materialize 하지만 유효 권한은 사전과 동일하다.
--   함수 본문·인자·반환형·SECURITY DEFINER·search_path 는 변경하지 않는다.
-- =============================================================================
begin;

do $$
begin
  if to_regprocedure('public.iq_append_message(uuid,text)') is null then
    raise exception 'target function public.iq_append_message(uuid,text) not found';
  end if;
end
$$;

-- 인가 역할 명시 grant 회수 후 PUBLIC EXECUTE 재부여(유효 권한 = 사전 상태).
revoke all privileges on function public.iq_append_message(uuid, text) from authenticated, service_role;
grant execute on function public.iq_append_message(uuid, text) to public;

-- 자가 검증: PUBLIC(anon 포함) EXECUTE 가 복원됐는지 확인.
do $$
declare
  v_oid oid := to_regprocedure('public.iq_append_message(uuid,text)')::oid;
begin
  if v_oid is null then
    raise exception 'iq_append_message target function not found';
  end if;
  if not has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'rollback did not restore public execute';
  end if;
end
$$;

commit;
