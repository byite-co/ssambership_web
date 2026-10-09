-- DB-GRANT-HYGIENE-001: iq_append_message(uuid,text) execute-ACL hardening.
--权限만 조정 (revoke PUBLIC/anon, grant authenticated/service_role). 본문·시그니처·
-- SECURITY DEFINER·search_path 불변. 정합 표준 = M2 shortform_view_record_v2 위생.
begin;

do $$
begin
  if to_regprocedure('public.iq_append_message(uuid,text)') is null then
    raise exception 'target function public.iq_append_message(uuid,text) not found';
  end if;
end
$$;

revoke all privileges on function public.iq_append_message(uuid, text) from public, anon;
grant execute on function public.iq_append_message(uuid, text) to authenticated, service_role;

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