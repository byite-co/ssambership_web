-- =============================================================================
-- full_convergence_m1_verify.sql — 수렴 M1 행위 검증 (로컬 스크래치 전용)
-- 전체를 단일 트랜잭션에서 실행 후 rollback — 데이터 원상 복구.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

-- [M1-1] active student nickname/grade 변경 성공 (앱 RPC)
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ declare v jsonb; begin
  v := api_app_v1.user_profile_update_self('새닉네임', '고3');
  if not (v->>'ok')::boolean or (v->>'nickname') <> '새닉네임' or (v->>'grade_level') <> '고3'
     or (v->>'contract_version')::int <> 1 or (v->>'updated_at') is null then
    raise exception 'FAIL[M1-1] %', v;
  end if;
  raise notice 'PASS M1-1 app RPC nickname+grade update';
end $$;

-- [M1-2] null=유지 · ''=grade 제거
do $$ declare v jsonb; begin
  v := api_app_v1.user_profile_update_self(null, '');
  if (v->>'nickname') <> '새닉네임' or (v->>'grade_level') is not null then
    raise exception 'FAIL[M1-2] %', v;
  end if;
  raise notice 'PASS M1-2 null-keep / empty-clear semantics';
end $$;

-- [M1-3] users 직접 UPDATE 차단 (테이블 권한)
do $$ begin
  begin
    update public.users set nickname = 'hack' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL[M1-3] direct users update allowed';
  exception when insufficient_privilege then
    raise notice 'PASS M1-3 direct users UPDATE denied (42501)';
  end;
end $$;

-- [M1-4] status 자가 변조 차단 (권한 회수로 42501)
do $$ begin
  begin
    update public.users set status = 'active', suspended_until = null
      where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL[M1-4] status self-update allowed';
  exception when insufficient_privilege then
    raise notice 'PASS M1-4 status self-update denied';
  end;
end $$;

-- [M1-5] defense-in-depth: 권한이 있어도 보호 컬럼은 trigger 가 거부
reset role;
grant update on public.users to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  begin
    update public.users set status = 'banned' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL[M1-5a] protected column change allowed';
  exception when insufficient_privilege then
    raise notice 'PASS M1-5a trigger blocks status change (protected)';
  end;
  begin
    update public.users set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL[M1-5b] role change allowed';
  exception when insufficient_privilege then
    raise notice 'PASS M1-5b trigger blocks role change';
  end;
  begin
    update public.users set terms_agreed_at = now() where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL[M1-5c] consent timestamp change allowed';
  exception when insufficient_privilege then
    raise notice 'PASS M1-5c trigger blocks consent timestamp change';
  end;
  -- 비보호 컬럼(nickname)은 trigger 통과 (RLS own-row)
  update public.users set nickname = '트리거통과' where id = '11111111-1111-1111-1111-111111111111';
  raise notice 'PASS M1-5d non-protected column passes trigger';
end $$;
reset role;
revoke update on public.users from authenticated;

-- [M1-6] banned/suspended/삭제 진행 프로필 수정 거부 (전용 코드)
set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
do $$ begin
  begin
    perform api_app_v1.user_profile_update_self('밴닉', null);
    raise exception 'FAIL[M1-6a] banned profile update allowed';
  exception when others then
    if sqlerrm not like '%ACCOUNT_BANNED%' then raise exception 'FAIL[M1-6a] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M1-6a banned -> ACCOUNT_BANNED';
  end;
end $$;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
do $$ begin
  begin
    perform api_app_v1.user_profile_update_self('정지닉', null);
    raise exception 'FAIL[M1-6b] suspended profile update allowed';
  exception when others then
    if sqlerrm not like '%ACCOUNT_SUSPENDED%' then raise exception 'FAIL[M1-6b] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M1-6b valid suspended -> ACCOUNT_SUSPENDED';
  end;
end $$;
-- 삭제 write-block 은 pending(취소 가능 창)이 아니라 locked 이후부터다(정본 계약).
reset role;
update public.account_deletion_jobs set state = 'locked'
 where user_id = '88888888-8888-8888-8888-888888888888';
set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
do $$ begin
  begin
    perform api_app_v1.user_profile_update_self('삭제닉', null);
    raise exception 'FAIL[M1-6c] deletion-in-progress update allowed';
  exception when others then
    if sqlerrm not like '%ACCOUNT_DELETION_IN_PROGRESS%' then raise exception 'FAIL[M1-6c] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M1-6c deletion write-block(locked) -> ACCOUNT_DELETION_IN_PROGRESS';
  end;
end $$;
reset role;
update public.account_deletion_jobs set state = 'pending'
 where user_id = '88888888-8888-8888-8888-888888888888';
set local role authenticated;

-- [M1-7] 검증 오류 코드: 닉네임 공백·grade 멘토 거부 · 웹 RPC 동일 동작
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ begin
  begin
    perform api_app_v1.user_profile_update_self('   ', null);
    raise exception 'FAIL[M1-7a] empty nickname accepted';
  exception when others then
    if sqlerrm not like '%NICKNAME_REQUIRED%' then raise exception 'FAIL[M1-7a] wrong code: %', sqlerrm; end if;
    raise notice 'PASS M1-7a empty nickname -> NICKNAME_REQUIRED';
  end;
end $$;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
do $$ declare v jsonb; begin
  begin
    perform api_web_v1.user_profile_update_self(null, '고1');
    raise exception 'FAIL[M1-7b] mentor grade accepted';
  exception when others then
    if sqlerrm not like '%GRADE_LEVEL_NOT_ALLOWED%' then raise exception 'FAIL[M1-7b] wrong code: %', sqlerrm; end if;
  end;
  v := api_web_v1.user_profile_update_self('멘토닉', null);
  if not (v->>'ok')::boolean then raise exception 'FAIL[M1-7c] %', v; end if;
  raise notice 'PASS M1-7 web RPC mentor nickname ok / grade rejected';
end $$;

-- [M1-8] 관리자/service 경로 상태 변경은 정상 (superuser = 정본 서버 경로 시뮬레이션)
reset role;
do $$ begin
  update public.users set status = 'suspended', suspended_until = now() + interval '1 day',
         status_reason = 'verify', status_changed_at = now()
   where id = '22222222-2222-2222-2222-222222222222';
  if not exists (select 1 from public.users where id='22222222-2222-2222-2222-222222222222' and status='suspended') then
    raise exception 'FAIL[M1-8] admin path status change failed';
  end if;
  raise notice 'PASS M1-8 service/admin status change path intact';
end $$;

-- [M1-9] status CHECK — 허용 외 값 거부
do $$ begin
  begin
    update public.users set status = 'weird' where id = '22222222-2222-2222-2222-222222222222';
    raise exception 'FAIL[M1-9] unknown status accepted';
  exception when check_violation then
    raise notice 'PASS M1-9 users_status_allowed CHECK enforced';
  end;
end $$;

-- [M1-10] 마케팅 동의 RPC — 원장 append + users 반영
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ declare v jsonb; v_cnt int; begin
  v := api_web_v1.user_marketing_consent_set_self(true);
  if not (v->>'ok')::boolean then raise exception 'FAIL[M1-10] %', v; end if;
  select count(*) into v_cnt from public.user_consent_records
   where user_id = '11111111-1111-1111-1111-111111111111' and consent_type = 'marketing';
  if v_cnt <> 1 then raise exception 'FAIL[M1-10] ledger rows %', v_cnt; end if;
  if not exists (select 1 from public.users where id='11111111-1111-1111-1111-111111111111' and marketing_agreed) then
    raise exception 'FAIL[M1-10] users.marketing_agreed not set';
  end if;
  raise notice 'PASS M1-10 marketing consent ledger append + flag';
end $$;

rollback;
select '=== full_convergence_m1_verify: ALL PASS' as result;
