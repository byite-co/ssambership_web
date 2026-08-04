-- local_stack_preconditions.sql — 로컬 스택을 "호스팅 프로젝트 초기 상태"로 맞춘다.
--
-- 왜 필요한가
--   pack 안의 여러 자체 검사는 부모 프로젝트/Preview Branch 의 초기 상태를 전제한다.
--   대표 사례가 원장 migration 의 BATCH_F_M11 이다 — public.mentor_profiles 에
--   anon·authenticated 의 7개 테이블 권한이 모두 있어야 통과한다. 그 권한은 명시적 GRANT 가
--   아니라 **테이블 생성 시점의 default privilege** 로 붙는다.
--
--   PHASE A 실측(Preview Branch, PostgreSQL 17.6): branch 생성 직후 public 의 default ACL 이
--   {postgres=X, anon=X, authenticated=X, service_role=X} 로 permissive 였다.
--   반면 `supabase start` 로컬 스택은 그렇지 않을 수 있다(capture_platform_baseline.sh 가
--   probe 로 실측해 기록한다). 그 차이를 여기서 메운다.
--
-- 성격 — 정직하게
--   * 이것은 **모델링**이다. pack 의 일부가 아니고 supabase/migrations 에 들어가지 않는다.
--   * 부모 프로젝트에는 절대 실행하지 않는다. throwaway 로컬 컨테이너 전용이다.
--   * 즉 이 파일이 필요하다는 사실 자체가 "로컬 스택 ≠ 호스팅 프로젝트" 라는 실측 결과다.
--     그 차이는 pg17-evidence/platform_probe.txt 에 남는다.
--
-- 멱등이다. 이미 permissive 면 아무것도 바꾸지 않는다.

do $$
declare
  v_role text;
begin
  -- 플랫폼 role 이 없으면 만든다(로컬 스택에는 보통 이미 있다).
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;

  -- migration 을 실행하는 role(=현재 role)의 default privilege 를 호스팅 실측값으로 맞춘다.
  -- default ACL 은 grantor(객체를 만든 role) 별로 적용되므로 current_user 기준이어야 한다.
  v_role := current_user;
  execute format(
    'alter default privileges for role %I in schema public grant all on tables to postgres, anon, authenticated, service_role',
    v_role);
  execute format(
    'alter default privileges for role %I in schema public grant all on sequences to postgres, anon, authenticated, service_role',
    v_role);
  -- 함수는 built-in default 가 이미 PUBLIC EXECUTE 를 포함한다(제거 불가).
  -- 부모 실측 초기 상태와 맞추기 위해 역할별 EXECUTE 도 명시적으로 둔다.
  -- pack 안의 20260729000000 하드닝이 이후 이 행을 좁힌다.
  execute format(
    'alter default privileges for role %I in schema public grant execute on functions to postgres, anon, authenticated, service_role',
    v_role);

  raise notice 'LOCAL_STACK_PRECONDITIONS: default privileges aligned for role %', v_role;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- 확립 결과를 즉시 검증한다. probe 테이블 하나로 실제 부여 여부를 본다.
create table public._precondition_verify(id int);
do $$
declare
  v_role text; v_priv text; v_missing int := 0;
begin
  for v_role in select unnest(array['anon','authenticated']) loop
    foreach v_priv in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if not has_table_privilege(v_role, 'public._precondition_verify', v_priv) then
        v_missing := v_missing + 1;
        raise warning 'LOCAL_STACK_PRECONDITIONS: % lacks % on new table', v_role, v_priv;
      end if;
    end loop;
  end loop;
  if v_missing > 0 then
    raise exception 'LOCAL_STACK_PRECONDITIONS_FAILED: % missing privileges on a newly created table', v_missing;
  end if;
  raise notice 'LOCAL_STACK_PRECONDITIONS: VERIFIED (anon/authenticated 14/14 on new table)';
end $$;
drop table public._precondition_verify;
