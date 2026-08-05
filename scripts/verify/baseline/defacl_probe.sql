-- defacl_probe.sql — public 스키마 '함수 기본 권한(default ACL)' 시점 회귀 검사.
--
-- 왜 필요한가 (preview branch 실측, 2026-08-04):
--   실제 Supabase 프로젝트의 pg_default_acl(schema public, objtype f) 은 신규 함수에
--   anon/authenticated/service_role EXECUTE 를 **역할별로 명시 부여**한다. 원장 M13
--   (20260730095438_comments_author_label_denormalize)은 자기가 만든 트리거 함수 2종에
--   `REVOKE ALL ON FUNCTION ... FROM PUBLIC` 을 실행한 뒤, 그 함수에 anon/authenticated
--   EXECUTE 가 **없어야** 통과하는 자체 검사를 수행한다. 그런데 FROM PUBLIC 회수는
--   역할별 명시 부여를 지우지 못하므로, permissive defacl 상태에서는 구조적으로 실패한다.
--   → 함수 defacl 하드닝은 M13 '이전'에 이미 적용돼 있었어야 한다.
--   이전 로컬 스텁은 함수 defacl 을 비워 둬 이 조건을 시험하지 못했고, 그래서 로컬이
--   통과하고 실플랫폼(branch)이 실패했다. 이 프로브는 그 조건을 로컬에서 상시 재현한다.
--
-- PostgreSQL 실측 의미론 (이 프로브 설계의 근거, PG16 로컬 검증):
--   * pg_default_acl 항목은 내장 기본값(acldefault: 함수 = PUBLIC EXECUTE + 소유자)에
--     **가산**된다. 즉 ALTER DEFAULT PRIVILEGES 로 부여한 역할 항목만 기록되고,
--     내장 PUBLIC EXECUTE 는 default privileges 조작으로 제거되지 않는다.
--   * 그래서 하드닝(역할 부여 회수) 직후 신규 함수의 proacl 은 NULL(=PUBLIC EXECUTE)이며,
--     PUBLIC 제거는 마이그레이션이 객체에 직접 실행하는 `REVOKE ... FROM PUBLIC` 이 한다.
--   * 따라서 올바른 판정 기준은 "생성 직후 ACL" 이 아니라
--     **"REVOKE FROM PUBLIC 이후 역할별 EXECUTE 가 남는가"** 다 — M13 이 하는 그대로.
--
-- 사용: psql -v phase=before  ... (20260729000000 하드닝 적용 직전)
--       psql -v phase=after   ... (하드닝 적용 직후)
-- 프로브 함수는 캡처 즉시 DROP 되므로 최종 인벤토리에 남지 않는다.

\set ON_ERROR_STOP on

-- psql 변수는 dollar-quoted 블록 안에서 치환되지 않으므로 GUC 로 넘긴다.
select set_config('probe.phase', :'phase', false) as phase_set;

-- ① 현재 default ACL 실측 증거 (DEFAULT_ACL_EVIDENCE)
select 'DEFAULT_ACL_EVIDENCE' as tag,
       :'phase' as phase,
       current_user as creator_role,
       pg_get_userbyid(d.defaclrole) as defaclrole,
       n.nspname as schema_name,
       d.defaclobjtype as defaclobjtype,
       coalesce(array_to_string(d.defaclacl, ','), '(none)') as defaclacl,
       coalesce(pg_get_userbyid(a.grantor), '(n/a)') as grantor,
       coalesce(pg_get_userbyid(a.grantee), 'PUBLIC') as grantee,
       coalesce(a.privilege_type, '(none)') as privilege_type
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace
left join aclexplode(d.defaclacl) a on true
where n.nspname = 'public' and d.defaclobjtype = 'f'
order by defaclrole, grantee, privilege_type;

-- ② 프로브 함수 생성 → 생성 직후 proacl, 그리고 M13 과 동일한
--    `REVOKE ALL ... FROM PUBLIC` 이후 proacl 을 함께 실측 (PROBE_FUNCTION_EVIDENCE)
create or replace function public.zzz_defacl_probe() returns integer
language sql immutable as $probe$ select 1 $probe$;

select 'PROBE_FUNCTION_EVIDENCE' as tag,
       :'phase' as created_at_stage,
       'public.zzz_defacl_probe()' as probe_function_name,
       pg_get_userbyid(p.proowner) as creator_role,
       coalesce(array_to_string(p.proacl, ','), '(null=implicit PUBLIC)') as proacl_immediately_after_create,
       has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
       has_function_privilege('postgres', p.oid, 'EXECUTE') as postgres_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'zzz_defacl_probe';

-- M13 이 실제로 실행하는 것과 동일한 회수
revoke all on function public.zzz_defacl_probe() from public;

select 'PROBE_AFTER_REVOKE_PUBLIC' as tag,
       :'phase' as created_at_stage,
       coalesce(array_to_string(p.proacl, ','), '(null=implicit PUBLIC)') as proacl_after_revoke_from_public,
       has_function_privilege('public', p.oid, 'EXECUTE') as public_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
       -- M13 자체 검사 ③ 의 proacl 조건과 동일한 식
       (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%')) as m13_proacl_condition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'zzz_defacl_probe';

-- ③ 단계별 기대값 단언 — 판정 기준은 M13 과 동일하게
--    "REVOKE FROM PUBLIC 이후 역할별 EXECUTE 가 남는가" 다.
do $$
declare
  v_oid oid;
  v_anon boolean; v_auth boolean; v_svc boolean; v_m13 boolean;
  v_phase text := current_setting('probe.phase');
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'zzz_defacl_probe';
  v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
  v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  v_svc  := has_function_privilege('service_role', v_oid, 'EXECUTE');
  select (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%'))
    into v_m13 from pg_proc p where p.oid = v_oid;

  if v_phase = 'before' then
    -- 하드닝 이전 = permissive defacl: FROM PUBLIC 회수로도 역할 부여가 남아야 한다.
    -- (이것이 branch 에서 M13 이 실패한 조건 — 로컬이 이 조건을 실제로 재현하는지 검증)
    if not (v_anon and v_auth and v_svc) then
      raise exception 'DEFACL_PROBE_BEFORE_FAIL: permissive function defacl 미재현 — REVOKE FROM PUBLIC 후 anon=% auth=% svc=% (셋 다 true 여야 실플랫폼 조건과 동일)',
        v_anon, v_auth, v_svc;
    end if;
    raise notice 'DEFACL_PROBE_BEFORE: PASS (permissive defacl 재현 — FROM PUBLIC 회수 후에도 역할 EXECUTE 잔존, M13 게이트 실패 조건 성립)';
  elsif v_phase = 'after' then
    -- 하드닝 이후 = 역할 부여 없음: FROM PUBLIC 회수만으로 역할 EXECUTE 가 사라져야 한다.
    if v_anon or v_auth or v_svc then
      raise exception 'DEFACL_PROBE_AFTER_FAIL: 하드닝 후에도 역할 EXECUTE 잔존 (anon=% auth=% svc=%) — M13 게이트가 통과할 수 없다',
        v_anon, v_auth, v_svc;
    end if;
    if not v_m13 then
      raise exception 'DEFACL_PROBE_AFTER_FAIL: proacl 에 PUBLIC 항목 잔존 — M13 자체 검사 ③ 조건 불충족';
    end if;
    raise notice 'DEFACL_PROBE_AFTER: PASS (하드닝 확인 — FROM PUBLIC 회수로 역할 EXECUTE 소멸, M13 proacl 조건 충족)';
  else
    raise exception 'DEFACL_PROBE_USAGE: phase must be before|after (got %)', v_phase;
  end if;
end $$;

-- ④ 프로브 정리 (인벤토리 오염 0)
drop function public.zzz_defacl_probe();
