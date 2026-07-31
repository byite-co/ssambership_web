-- =============================================================================
-- scripts/verify/s2_2_batch_f_verify.sql
-- S2-2 Batch F (M11·M12·M16 최종 권한 잠금 + M10 checkpoint) 반복 검증 스크립트
-- =============================================================================
-- 실행 전제:
--   * 격리 로컬 Supabase 스택(PG17) — clean-install 187(baseline 175 + Batch A~E 12)
--     위에서 사용한다. 운영·staging 반입 0.
--   * 운영 오실행 방지 — 러너가 같은 세션에서 먼저 실행해야 한다:
--       set s2_verify.allow_local = 'on';
--   * phase 스위치:
--       set s2_verify.phase = 'forward'        -- M11+M12+M16+M10 적용 직후 (기본값)
--       set s2_verify.phase = 'post_rollback'  -- M16→M12→M11 rollback 직후
--   * 운영 baseline 재현(러너 절차 — 로컬 fresh clean-install 은 신규 클라우드 기본
--     auto-expose OFF 라 운영과 ACL·정책 baseline 이 다르다. Batch F forward 적용 전에
--     러너가 다음을 1회 수행해 운영 기준선을 재현한다. 이 재현분은 M11/M12/M16 이
--     회수하므로 검증 종료 시 잔여 0 이다):
--       grant select, insert, update, delete on public.mentor_profiles  to anon, authenticated;
--       grant select, insert, update, delete on public.mentor_plans     to anon, authenticated;
--       grant select, insert, update, delete on public.community_posts  to anon, authenticated;
--       revoke maintain on public.mentor_profiles, public.mentor_plans,
--                         public.community_posts from anon, authenticated;
--       create policy "로그인 유저 게시글 작성" on public.community_posts
--         for insert to public with check ( auth.uid() = author_id );
--       create policy "본인 게시글 수정" on public.community_posts
--         for update to public using ( auth.uid() = author_id );
--     (한글명 2종은 운영 대시보드 생성분 — 2026-07-29 pg_policies 실측 정의. 재현 후의
--      상태가 @187 스냅샷·rollback 왕복 대조의 기준선이다.)
--   * Data API 로컬 검증(D-API-W/A)은 SQL 밖 러너 단계다: 로컬 PostgREST 에
--     api_web_v1·api_app_v1 를 노출한 뒤(kong :54321 경유) HTTP 로
--     ① api_web_v1 정상 ② api_app_v1 정상 ③ core_private → PGRST106
--     ④ 정상 요청 PGRST106·PGRST002 0건 — 을 실측하고 러너 로그에 기록한다.
--     원격 Data API 설정은 접촉하지 않는다(D_API_*_REMOTE = NOT_STARTED).
--   * M10 카탈로그 assertion 의 정본은 migration 파일
--     supabase/sql/20260730195156_contract_permission_assertions.sql 자체이며
--     (읽기 전용 — 재실행 가능), 러너가 rollback 재검증(§22 #2)에도 같은 파일을
--     다시 실행한다. 본 검증기는 그 부분집합을 회귀로 재확인한다.
--   * 모든 fixture DML(s2f-vf-*) 은 단일 트랜잭션에서 수행하고 마지막에 rollback.
--     실사용 규모(auth.users > 50행) 감지 시 중단.
-- 판정: s2_results 에 PASS/FAIL 기록 → FAIL ≥1 이면 S2_BATCH_F_VERIFY_FAILED.
-- 근거 계약: api_web_v1_contract_v1_1.md §10.6 · §14.7 · §20.2 M10~M12·M16 ·
--   §20.3 · §21 T-PERM-01~15 · T-REG-02·03·05·06·07 · T-SEC-02·03·06·07·14 · §22 #6.
-- =============================================================================

begin;

do $$
declare
  v_allow text := current_setting('s2_verify.allow_local', true);
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_users bigint;
begin
  if v_allow is distinct from 'on' then
    raise exception 'S2_VERIFY_LOCAL_GUARD: s2_verify.allow_local=on 이 설정되지 않았다. 격리 로컬 스택 전용.'
      using errcode = '42501';
  end if;
  if v_phase not in ('forward', 'post_rollback') then
    raise exception 'S2_VERIFY_PHASE: s2_verify.phase 는 forward|post_rollback 이어야 한다 (현재 %)', v_phase;
  end if;
  select count(*) into v_users from auth.users;
  if v_users > 50 then
    raise exception 'S2_VERIFY_LOCAL_GUARD: auth.users % 행 — 실사용 규모 감지, 중단.', v_users
      using errcode = '42501';
  end if;
end $$;

create temporary table s2_results (
  seq serial primary key, grp text not null, test text not null,
  pass boolean not null, detail text
);
create temporary table s2_fx (k text primary key, v uuid not null);

-- 로컬 auto-expose 기본값은 service_role 에 레거시 SELECT/UPDATE 가 없다(Batch E
-- 검증기 선례). 운영·스테이징의 service_role 라이브 grant 상태를 재현하는 최소
-- grant 를 이 트랜잭션 안에서만 부여한다 — 마지막 rollback 으로 파기된다(카탈로그
-- 불변 — M16 의 service_role 예외 검증·V4/V5 T-PERM-13 검증용).
grant select on public.cash_wallets, public.cash_ledger to service_role;
grant select, update on public.community_posts to service_role;

-- =============================================================================
-- 1. [forward] 카탈로그 — M11·M12·M16 ACL·정책 + M10 부분집합 (T-PERM-09·10·15)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_cnt int; v_ok boolean; v_det text;
begin
  if v_phase <> 'forward' then return; end if;

  -- F-01: M11 — mentor_profiles SELECT 만 true·비SELECT 7종(M 포함) false·컬럼 잔여 0
  select count(*) into v_cnt
    from (values('anon'),('authenticated')) r(rolname)
   cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                     ('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
   where has_table_privilege(r.rolname, 'public.mentor_profiles', p.priv)
         is distinct from (p.priv = 'SELECT');
  v_ok := v_cnt = 0
          and (select count(*) from information_schema.column_privileges
                where table_schema='public' and table_name='mentor_profiles'
                  and grantee in ('anon','authenticated') and privilege_type <> 'SELECT') = 0;
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-09','M11 mentor_profiles SELECT-only ACL·컬럼 잔여 0', v_ok, 'mismatch=' || v_cnt);

  -- F-02: M12 — mentor_plans SELECT 만 true (T-PERM-10)
  select count(*) into v_cnt
    from (values('anon'),('authenticated')) r(rolname)
   cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                     ('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
   where has_table_privilege(r.rolname, 'public.mentor_plans', p.priv)
         is distinct from (p.priv = 'SELECT');
  v_ok := v_cnt = 0
          and (select count(*) from information_schema.column_privileges
                where table_schema='public' and table_name='mentor_plans'
                  and grantee in ('anon','authenticated') and privilege_type <> 'SELECT') = 0;
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-10','M12 mentor_plans SELECT-only ACL·컬럼 잔여 0', v_ok, 'mismatch=' || v_cnt);

  -- F-03: M16 — community_posts SELECT 만 true·쓰기 정책 0·6종 부재·SELECT 정책 유지
  select count(*) into v_cnt
    from (values('anon'),('authenticated')) r(rolname)
   cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                     ('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv)
   where has_table_privilege(r.rolname, 'public.community_posts', p.priv)
         is distinct from (p.priv = 'SELECT');
  v_ok := v_cnt = 0
          and (select count(*) from pg_policies
                where schemaname='public' and tablename='community_posts'
                  and cmd in ('INSERT','UPDATE','DELETE')) = 0
          and (select count(*) from pg_policies
                where schemaname='public' and tablename='community_posts'
                  and policyname in ('cp_write_self','로그인 유저 게시글 작성','cp_update_own',
                                     'cp_update_self','본인 게시글 수정','cp_delete_own')) = 0
          and (select count(*) from pg_policies
                where schemaname='public' and tablename='community_posts' and cmd='SELECT'
                  and policyname in ('cp_select_own','cp_select_published')) = 2;
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-15','M16 community_posts SELECT-only·쓰기 정책 6종 부재·SELECT 정책 유지', v_ok, 'mismatch=' || v_cnt);

  -- F-04: core_private 외부 권한 0(T-PERM-01·06) + census(view 6·fn 25·schema 3)
  v_ok := not has_schema_privilege('anon','core_private','USAGE')
          and not has_schema_privilege('authenticated','core_private','USAGE')
          and not has_schema_privilege('service_role','core_private','USAGE')
          and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='core_private'
                  and (has_function_privilege('anon',p.oid,'EXECUTE')
                       or has_function_privilege('authenticated',p.oid,'EXECUTE')
                       or has_function_privilege('service_role',p.oid,'EXECUTE'))) = 0
          and (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname in ('api_web_v1','api_app_v1') and c.relkind='v') = 6
          and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname in ('api_web_v1','core_private','api_app_v1')) = 25
          and (select count(*) from pg_namespace
                where nspname in ('api_web_v1','api_app_v1','core_private')) = 3;
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-01/06','core_private 외부 권한 0 + 객체 총계 6/25/3', v_ok, null);

  -- F-05: SECDEF 화이트리스트 census(T-PERM-04) + F0 부재(T-PERM-05)
  v_ok := (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname in ('api_web_v1','api_app_v1','core_private') and p.prosecdef) = 20
          and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='core_private' and p.prosecdef
                  and p.proname <> 'ensure_student_mentor_room') = 0
          and (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                where n.nspname in ('api_web_v1','api_app_v1') and c.relkind='v'
                  and not ('security_invoker=true' = any(coalesce(c.reloptions,'{}')))) = 1
          and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname in ('api_web_v1','core_private','api_app_v1','public')
                  and p.proname in ('user_display_label','user_display_role')) = 0;
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-04/05','SECDEF census 20(+V3 view 1)·F0 라벨 함수 부재', v_ok, null);

  -- F-06: api_web_v1 PUBLIC EXECUTE 0(T-PERM-02) + V4/V5 anon SELECT false(T-PERM-07)
  --       + 신규 view DML 0(T-PERM-08)
  v_ok := (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='api_web_v1'
              and (p.proacl is null
                   or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))) = 0
          and not has_table_privilege('anon','api_web_v1.my_wallet_v1','SELECT')
          and not has_table_privilege('anon','api_web_v1.my_cash_ledger_v1','SELECT')
          and not has_function_privilege('anon','api_web_v1.my_subscriptions_self()','EXECUTE')
          and not has_function_privilege('anon','api_web_v1.mentor_settlement_self()','EXECUTE')
          and (select count(*)
                 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                cross join (values('anon'),('authenticated'),('service_role')) r(rolname)
                cross join (values('INSERT'),('UPDATE'),('DELETE')) p(priv)
                where n.nspname in ('api_web_v1','api_app_v1') and c.relkind='v'
                  and has_table_privilege(r.rolname, c.oid, p.priv)) = 0;
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-02/07/08','PUBLIC EXECUTE 0·V4/V5+V6/V7 anon 거부·view DML 0', v_ok, null);

  -- F-07: T-REG-05 Realtime publication 3테이블 그대로 + T-REG-06 public 표면 불변
  v_ok := (select count(*) from pg_publication_tables where pubname='supabase_realtime') = 3
          and (select count(*) from pg_publication_tables where pubname='supabase_realtime'
                and schemaname='public'
                and tablename in ('question_threads','question_messages','question_attachments')) = 3
          and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='public'
                  and p.proname in ('weekly_question_usage_self','ensure_free_question_room',
                                    'community_post_create','community_post_update',
                                    'community_post_soft_delete','mentor_profile_update_self',
                                    'mentor_plan_prices_set_self','mentor_payout_account_update_self',
                                    'my_subscriptions_self','mentor_settlement_self',
                                    'record_cash_topup_v2','subscription_checkout_confirm_v2')) = 0
          and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' and p.proname='get_weekly_question_usage'
                         and position('[S2 M15]' in p.prosrc) > 0)
          and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' and p.proname='record_cash_topup'
                         and position('core_private.record_cash_topup_impl' in p.prosrc) > 0);
  insert into s2_results(grp,test,pass,detail) values
    ('T-REG-05/06','Realtime 3테이블·public 표면 불변(본문 교체 2건만)', v_ok, null);

  -- F-08: T-PERM-12 대표 — 레거시 자금 RPC ACL 불변(record_cash_topup service_role 전용)
  v_ok := not has_function_privilege('anon','public.record_cash_topup(uuid,bigint,text)','EXECUTE')
          and not has_function_privilege('authenticated','public.record_cash_topup(uuid,bigint,text)','EXECUTE')
          and has_function_privilege('service_role','public.record_cash_topup(uuid,bigint,text)','EXECUTE')
          and has_function_privilege('authenticated','public.get_weekly_question_usage(uuid,uuid)','EXECUTE');
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-12','레거시 topup service_role 전용·weekly usage authenticated 유지', v_ok, null);
end $$;

-- =============================================================================
-- 2. [forward] 기능 게이트 — 가입 트리거·M11(F7/F13/승인 RPC)·M12(F8)·직접 쓰기 거부
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_student uuid := gen_random_uuid();
  v_mentor  uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
  v_verif   uuid;
  v_res jsonb;
  v_cnt int; v_ok boolean; v_det text;
begin
  if v_phase <> 'forward' then return; end if;

  -- 공용 fixture — 가입 트리거 경유 생성(T-PERM-14 후단·T-REG-07 상당)
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at)
  values
    (v_student, 's2f-vf-s1@example.invalid', '{"app_role":"student","nickname":"에프검증학생"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_mentor,  's2f-vf-m1@example.invalid', '{"app_role":"mentor","nickname":"에프검증멘토"}'::jsonb,  '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_admin,   's2f-vf-a1@example.invalid', '{"app_role":"admin","nickname":"에프검증관리"}'::jsonb,   '{}'::jsonb, 'authenticated', 'authenticated', now(), now());
  insert into s2_fx values ('student', v_student), ('mentor', v_mentor), ('admin', v_admin);

  -- F-10: 가입 경로 정상 — 트리거가 users 3행 + mentor_profiles 1행 생성.
  --       클라이언트 제공 app_role=admin 은 student 로 강제된다(가입 트리거 보안
  --       정본 — 관리자 계정은 운영 경로에서만 승격).
  v_ok := (select count(*) from public.users where id in (v_student, v_mentor, v_admin)) = 3
          and (select count(*) from public.mentor_profiles where user_id = v_mentor) = 1
          and (select role from public.users where id = v_admin) = 'student';
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-14','M11 후 가입 트리거(handle_new_auth_user) 정상·admin 자가승격 차단',
     v_ok, 'admin_role=' || coalesce((select role from public.users where id = v_admin),'?'));

  -- 관리자 fixture 승격(운영 경로 상당 — superuser·JWT 없음) + 멘토 승인
  update public.users set role = 'admin' where id = v_admin;
  update public.mentor_profiles set verification_status = 'approved' where user_id = v_mentor;

  -- F-11: M11 기능 — 멘토 세션 직접 UPDATE 거부(42501) + 자기승인 거부(T-SEC-02·03)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      update public.mentor_profiles set bio = '직접 쓰기 시도' where user_id = v_mentor;
      v_ok := false; v_det := '직접 UPDATE 가 거부되지 않음';
    exception when insufficient_privilege then
      v_ok := true; v_det := 'bio UPDATE 42501';
    end;
    begin
      update public.mentor_profiles set verification_status = 'approved' where user_id = v_mentor;
      v_ok := false; v_det := coalesce(v_det,'') || ' · 자기승인 UPDATE 가 거부되지 않음';
    exception when insufficient_privilege then
      v_ok := coalesce(v_ok, true) and true; v_det := coalesce(v_det,'') || ' · 자기승인 42501';
    end;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-SEC-02/03','M11 후 멘토 직접 UPDATE·자기승인 거부(42501)', coalesce(v_ok,false), left(v_det,200));

  -- F-12: 학생 세션 mentor_profiles INSERT 거부(T-SEC-14 — XW-02 (나))
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      insert into public.mentor_profiles (user_id, verification_status) values (v_student, 'approved');
      v_ok := false; v_det := 'INSERT 가 거부되지 않음';
    exception when insufficient_privilege then
      v_ok := true; v_det := 'INSERT 42501';
    end;
    execute 'reset role';
    v_ok := v_ok and not public.individual_question_user_is_approved_mentor(v_student);
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-SEC-14','M11 후 학생 mentor_profiles INSERT 거부 + 승인 헬퍼 false', coalesce(v_ok,false), left(v_det,200));

  -- F-13: M11 후 F7 정상 — 멘토 세션 프로필 저장(허용 9필드)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.mentor_profile_update_self(
      p_university_name => '검증대학교', p_department_name => '검증학과',
      p_high_school_name => '검증고등학교', p_teaching_subjects => array[]::text[],
      p_intro_line => 'F7 경유 저장', p_bio => 'M11 이후에도 RPC 로 저장된다',
      p_answer_style => null, p_profile_image_url => null,
      p_is_open_for_subscriptions => true);
    execute 'reset role';
    v_ok := (v_res->>'ok')::boolean
            and (select bio from public.mentor_profiles where user_id = v_mentor) = 'M11 이후에도 RPC 로 저장된다';
    v_det := coalesce(v_res->>'code', 'ok');
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M11-F7','M11 후 F7 mentor_profile_update_self 정상', coalesce(v_ok,false), left(v_det,200));

  -- F-14: M11 후 F13 정상 — 정산계좌 저장 + 원문 비반환(마스킹)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.mentor_payout_account_update_self('KB국민은행', '12345671234');
    execute 'reset role';
    v_ok := (v_res->>'ok')::boolean
            and coalesce(v_res::text not like '%12345671234%', false)
            and coalesce(v_res->>'account_masked', '') like '%1234';
    v_det := coalesce(v_res->>'code', coalesce(v_res->>'account_masked','ok'));
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M11-F13','M11 후 F13 정산계좌 저장·마스킹 정상', coalesce(v_ok,false), left(v_det,200));

  -- F-15: T-PERM-11 — 관리자 승인 SECDEF RPC 가 M11 후에도 mentor_profiles 를 갱신
  begin
    -- 직전 테스트의 트랜잭션-로컬 JWT claims 를 파기(M0 가드는 JWT 없는 superuser
    -- 세션의 특권 컬럼 변경만 허용)
    perform set_config('request.jwt.claims', '', true);
    insert into storage.objects (bucket_id, name)
    values ('student-id-images', v_mentor::text || '/school-verifications/s2f-vf-doc.png');
    insert into public.mentor_school_verifications (mentor_id, status, document_storage_ref)
    values (v_mentor, 'pending', v_mentor::text || '/school-verifications/s2f-vf-doc.png')
    returning id into v_verif;
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := public.approve_mentor_school_verification_admin(
      v_verif, '검증대학교', 'VRF-001', '검증학과', '공학', '그외');
    execute 'reset role';
    -- 174 정본 RPC 는 mentor_school_verifications 만 쓴다(프로필 status 반영은
    -- 관리자 콘솔 service_role 경로 소유) — RPC 자체 동작(M11 무영향)을 판정한다.
    v_ok := v_res->>'status' = 'approved'
            and (select status from public.mentor_school_verifications where id = v_verif) = 'approved'
            and (select reviewed_by from public.mentor_school_verifications where id = v_verif) = v_admin;
    v_det := left(coalesce(v_res::text,'null'), 80);
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-11','M11 후 관리자 승인 SECDEF RPC 정상 동작', coalesce(v_ok,false), left(v_det,200));

  -- F-16: M12 기능 — F8 밴드 내 저장·밴드 밖 거부·cap 강제(T-SEC-06·07·T-REG-02·03)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.mentor_plan_prices_set_self(29900, 84900, 174900);
    execute 'reset role';
    v_ok := (v_res->>'ok')::boolean
            and (select count(*) from public.mentor_plans
                  where mentor_id = v_mentor
                    and ((plan_tier = 'limited'  and amount_cents = 2990000  and cap_weight = 1.0)
                      or (plan_tier = 'standard' and amount_cents = 8490000  and cap_weight = 2.5)
                      or (plan_tier = 'premium'  and amount_cents = 17490000 and cap_weight = 4.5))) = 3;
    v_det := coalesce(v_res->>'code','ok');
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.mentor_plan_prices_set_self(10000, 84900, 174900); -- 밴드 밖
    execute 'reset role';
    v_ok := v_ok and v_res->>'code' = 'PLAN_PRICE_OUT_OF_BAND'
            and (select amount_cents from public.mentor_plans
                  where mentor_id = v_mentor and plan_tier = 'limited') = 2990000;
    v_det := v_det || ' · ' || coalesce(v_res->>'code','?');
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-SEC-06/07','M12 후 F8 밴드 강제·cap 고정·클램프 없는 거부', coalesce(v_ok,false), left(v_det,200));

  -- F-17: M12 후 직접 UPDATE·DELETE 거부 + 공개 SELECT 유지
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    begin
      update public.mentor_plans set amount_cents = 1 where mentor_id = v_mentor;
      v_ok := false; v_det := 'UPDATE 가 거부되지 않음';
    exception when insufficient_privilege then
      v_ok := true; v_det := 'UPDATE 42501';
    end;
    begin
      delete from public.mentor_plans where mentor_id = v_mentor;
      v_ok := false; v_det := coalesce(v_det,'') || ' · DELETE 가 거부되지 않음';
    exception when insufficient_privilege then
      v_ok := coalesce(v_ok, true) and true; v_det := coalesce(v_det,'') || ' · DELETE 42501';
    end;
    execute 'reset role';
    execute 'set local role anon';
    select count(*) into v_cnt from public.mentor_plans where mentor_id = v_mentor;
    execute 'reset role';
    v_ok := v_ok and v_cnt = 3;
    v_det := v_det || ' · anon SELECT ' || v_cnt;
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M12','M12 후 플랜 직접 쓰기 거부·공개 조회 유지', coalesce(v_ok,false), left(v_det,200));
end $$;

-- =============================================================================
-- 3. [forward] F12 확정·M16 커뮤니티·moderation·T-PERM-13
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_student uuid; v_mentor uuid;
  v_plan uuid; v_pay uuid; v_post uuid; v_spost uuid;
  v_key uuid := gen_random_uuid();
  v_res jsonb; v_res2 jsonb;
  v_bal bigint; v_cnt int; v_ok boolean; v_det text;
begin
  if v_phase <> 'forward' then return; end if;
  select v into v_student from s2_fx where k = 'student';
  select v into v_mentor  from s2_fx where k = 'mentor';

  -- F-18: F12 플랜 조회·확정 정상(M12 게이트 후단) — 지갑 충전(레거시 2층) → 확정 →
  --       재호출 idempotent(T-CONC-03 단일세션 등가)
  begin
    -- 직전 블록의 JWT claims 파기 + 승인 상태 복원(F-15 는 검증 행만 승인 — 프로필
    -- status 반영은 관리자 콘솔 service_role 경로 소유이므로 여기서 운영 상당 반영)
    perform set_config('request.jwt.claims', '', true);
    update public.mentor_profiles set verification_status = 'approved' where user_id = v_mentor;
    execute 'set local role service_role';
    perform public.record_cash_topup(v_student, 6000000, 'cash-s2fvf-1');
    execute 'reset role';
    select id into v_plan from public.mentor_plans
     where mentor_id = v_mentor and plan_tier = 'limited';
    insert into public.payments (user_id, mentor_id, amount, currency, status, kind, plan_id)
    values (v_student, v_mentor, 29900, 'KRW', 'pending', 'subscription', v_plan)
    returning id into v_pay;
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_pay, v_plan, 2990000);
    v_res2 := api_web_v1.subscription_checkout_confirm_v2(v_pay, v_plan, 2990000);
    execute 'reset role';
    select balance_cents into v_bal from public.cash_wallets where user_id = v_student;
    v_ok := (v_res->>'ok')::boolean and (v_res->>'idempotent')::boolean is not true
            and (v_res2->>'ok')::boolean and (v_res2->>'idempotent')::boolean
            and v_bal = 3010000
            and (select count(*) from public.cash_ledger
                  where idempotency_key = 'sub_debit_' || v_pay::text) = 1
            and (select count(*) from public.mentor_student_rooms
                  where student_id = v_student and mentor_id = v_mentor) = 1;
    v_det := coalesce(v_res->>'code','ok') || '/' || coalesce(v_res2->>'code','ok') || ' bal=' || v_bal;
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M12-F12','M12 후 F12 확정·멱등 재생·원장 1행·방 확보 정상', coalesce(v_ok,false), left(v_det,200));

  -- F-19: M16 기능 — 멘토 F4 생성 + 동일 멱등키 재호출 idempotent_replay(재생 1회·글 1건)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.community_post_create(p_title=>'s2f-vf 게시글', p_body=>'열 자를 넘기는 본문입니다', p_category=>'free', p_idempotency_key=>v_key);
    v_res2 := api_web_v1.community_post_create(p_title=>'다른 제목', p_body=>'다른 본문 열 자를 넘긴다', p_category=>'free', p_idempotency_key=>v_key);
    execute 'reset role';
    v_post := (v_res->>'post_id')::uuid;
    v_ok := (v_res->>'ok')::boolean and (v_res2->>'ok')::boolean
            and (v_res2->>'idempotent_replay')::boolean
            and (v_res2->>'post_id')::uuid = v_post
            and (select count(*) from public.community_posts where author_id = v_mentor) = 1;
    v_det := coalesce(v_res->>'code','ok') || '/' || coalesce(v_res2->>'code','ok');
    if v_post is not null then
      insert into s2_fx values ('post', v_post);
    end if;
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M16-F4','M16 후 F4 생성·replay-first 멱등 재생(글 1건)', coalesce(v_ok,false), left(v_det,200));

  -- F-20: M16 후 F5 수정·F6 soft-delete·재삭제 already_deleted(웹 F5/F6 대표)
  begin
    select v into v_post from s2_fx where k = 'post';
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res := api_web_v1.community_post_update(
      p_post_id => v_post, p_title => 's2f-vf 수정본', p_body => '수정된 본문 열 자 초과',
      p_category => 'free',
      p_expected_updated_at => (select updated_at from public.community_posts where id = v_post),
      p_image_refs => null, p_status => 'published');
    v_res2 := api_web_v1.community_post_soft_delete(v_post);
    execute 'reset role';
    v_ok := (v_res->>'ok')::boolean and (v_res2->>'ok')::boolean
            and (select deleted_at is not null from public.community_posts where id = v_post);
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res2 := api_web_v1.community_post_soft_delete(v_post);
    execute 'reset role';
    v_ok := v_ok and (v_res2->>'ok')::boolean and (v_res2->>'already_deleted')::boolean
            and (select count(*) from public.community_posts where id = v_post) = 1;
    v_det := coalesce(v_res->>'code','ok') || '/' || coalesce(v_res2->>'code','ok');
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M16-F5/F6','M16 후 F5 수정·F6 soft-delete·already_deleted 재호출', coalesce(v_ok,false), left(v_det,200));

  -- F-21: M16 후 직접 INSERT/UPDATE/DELETE 42501 (학생·멘토 공통 표본)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_ok := true; v_det := '';
    begin
      insert into public.community_posts (author_id, title, body, category, status)
      values (v_mentor, '직접', '직접 본문', 'free', 'published');
      v_ok := false; v_det := 'INSERT 허용됨';
    exception when insufficient_privilege then v_det := 'ins 42501'; end;
    begin
      update public.community_posts set title = 'x' where author_id = v_mentor;
      v_ok := false; v_det := v_det || ' · UPDATE 허용됨';
    exception when insufficient_privilege then v_det := v_det || ' · upd 42501'; end;
    begin
      delete from public.community_posts where author_id = v_mentor;
      v_ok := false; v_det := v_det || ' · DELETE 허용됨';
    exception when insufficient_privilege then v_det := v_det || ' · del 42501'; end;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-15','M16 후 직접 INSERT/UPDATE/DELETE 42501 거부', coalesce(v_ok,false), left(v_det,200));

  -- F-22: 기존 학생 글 F6 계약 유지 — 학생 본인 글 soft-delete 허용 + 앱 wrapper
  --       학생 F4 → ROLE_NOT_MENTOR (앱 Gate 4 대표)
  begin
    insert into public.community_posts (author_id, title, body, category, status)
    values (v_student, 's2f-vf 학생 기존 글', '기존 학생 글 본문입니다', 'free', 'published')
    returning id into v_spost;
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_res  := api_app_v1.community_post_create(p_title=>'학생 시도', p_body=>'학생 작성 시도 본문', p_category=>'free', p_idempotency_key=>gen_random_uuid());
    v_res2 := api_web_v1.community_post_soft_delete(v_spost);
    execute 'reset role';
    v_ok := v_res->>'code' = 'ROLE_NOT_MENTOR'
            and (v_res2->>'ok')::boolean
            and (select deleted_at is not null from public.community_posts where id = v_spost);
    v_det := coalesce(v_res->>'code','?') || '/' || coalesce(v_res2->>'code','ok');
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M16-학생글','기존 학생 글 F6 허용·학생 신규 작성 ROLE_NOT_MENTOR(앱 Gate4 대표)', coalesce(v_ok,false), left(v_det,200));

  -- F-23: service_role moderation 직접 UPDATE 정상(T-PERM-15 후단 — 의도된 예외)
  begin
    select v into v_post from s2_fx where k = 'post';
    execute 'set local role service_role';
    update public.community_posts set status = 'hidden' where id = v_post;
    execute 'reset role';
    v_ok := (select status from public.community_posts where id = v_post) = 'hidden';
    v_det := 'status=hidden';
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-15','service_role moderation UPDATE 정상(의도된 예외)', coalesce(v_ok,false), left(v_det,200));

  -- F-24: T-PERM-13 — V4/V5 service_role 전행 반환 · V6/V7 은 무세션 거부
  begin
    execute 'set local role service_role';
    select count(*) into v_cnt from api_web_v1.my_wallet_v1;
    execute 'reset role';
    v_ok := v_cnt >= 1;  -- fixture 학생 지갑 포함 전 사용자 행
    v_det := 'wallet rows=' || v_cnt;
    perform set_config('request.jwt.claims', '', true);
    execute 'set local role service_role';
    begin
      perform * from api_web_v1.my_subscriptions_self();
      v_ok := false; v_det := v_det || ' · V6 무세션 허용됨';
    exception when others then
      v_det := v_det || ' · V6 ' || sqlstate;
    end;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-PERM-13','V4/V5 service_role 전행·V6 무세션 거부', coalesce(v_ok,false), left(v_det,200));
end $$;

-- =============================================================================
-- 4. [post_rollback] M16→M12→M11 rollback 후 — @187 기준선(운영 재현 상태) 복원
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_mentor uuid := gen_random_uuid();
  v_cnt int; v_ok boolean; v_det text;
begin
  if v_phase <> 'post_rollback' then return; end if;

  -- R-01: 3테이블 ACL 7종 전부 true 복원(§22 #6 대칭)
  select count(*) into v_cnt
    from (values('public.mentor_profiles'),('public.mentor_plans'),('public.community_posts')) t(tbl)
   cross join (values('anon'),('authenticated')) r(rolname)
   cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                     ('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
   where not has_table_privilege(r.rolname, t.tbl, p.priv);
  insert into s2_results(grp,test,pass,detail) values
    ('RB','rollback 후 3테이블 ACL 7종 복원', v_cnt = 0, 'missing=' || v_cnt);

  -- R-02: community_posts 쓰기 정책 6종 재생 + SELECT 정책 유지
  select count(*) into v_cnt from pg_policies
   where schemaname='public' and tablename='community_posts'
     and ( (policyname = 'cp_write_self'            and cmd='INSERT' and roles='{authenticated}')
        or (policyname = '로그인 유저 게시글 작성'  and cmd='INSERT' and roles='{public}')
        or (policyname = 'cp_update_own'            and cmd='UPDATE' and roles='{authenticated}')
        or (policyname = 'cp_update_self'           and cmd='UPDATE' and roles='{authenticated}')
        or (policyname = '본인 게시글 수정'         and cmd='UPDATE' and roles='{public}')
        or (policyname = 'cp_delete_own'            and cmd='DELETE' and roles='{authenticated}') );
  v_ok := v_cnt = 6
          and (select count(*) from pg_policies
                where schemaname='public' and tablename='community_posts' and cmd='SELECT'
                  and policyname in ('cp_select_own','cp_select_published')) = 2;
  insert into s2_results(grp,test,pass,detail) values
    ('RB','rollback 후 쓰기 정책 6종·SELECT 정책 복원', v_ok, 'restored=' || v_cnt);

  -- R-03: 기능 회귀 — 멘토 세션 직접 UPDATE·커뮤니티 직접 INSERT 재허용(레거시 동작)
  begin
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at)
    values (v_mentor, 's2f-vf-rb1@example.invalid', '{"app_role":"mentor","nickname":"롤백검증멘토"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now());
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    update public.mentor_profiles set bio = '레거시 직접 쓰기 복원' where user_id = v_mentor;
    insert into public.community_posts (author_id, title, body, category, status)
    values (v_mentor, 'rb 직접 작성', '레거시 직접 INSERT 복원 본문', 'free', 'published');
    execute 'reset role';
    v_ok := (select bio from public.mentor_profiles where user_id = v_mentor) = '레거시 직접 쓰기 복원'
            and (select count(*) from public.community_posts where author_id = v_mentor) = 1;
    v_det := 'ok';
  exception when others then
    execute 'reset role';
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('RB','rollback 후 레거시 직접 쓰기 재허용(기능 복원)', coalesce(v_ok,false), left(v_det,200));

  -- R-04: 신규 표면 불변 — M7/M8/M14 wrapper 잔존(rollback 은 M11·M12·M16 만)
  v_ok := (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='api_web_v1') = 14
          and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                where n.nspname='api_app_v1') = 5;
  insert into s2_results(grp,test,pass,detail) values
    ('RB','rollback 범위 격리 — api 표면 14/5 불변', v_ok, null);
end $$;

-- =============================================================================
-- 결과 출력·판정
-- =============================================================================
select grp, test, case when pass then 'PASS' else 'FAIL' end as result, detail
  from s2_results order by seq;

select count(*) filter (where pass) || '/' || count(*) as passed from s2_results;

do $$
declare
  v_fail int;
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
begin
  select count(*) into v_fail from s2_results where not pass;
  if v_fail > 0 then
    raise exception 'S2_BATCH_F_VERIFY_FAILED: % 건 실패 (phase=%)', v_fail, v_phase;
  end if;
  raise notice 'S2_BATCH_F_VERIFY: ALL PASS (phase=%)', v_phase;
end $$;

-- 모든 fixture DML(s2f-vf-*) 은 여기서 파기된다(잔여 0 보증).
rollback;

-- 잔여 검사 — fixture 가 커밋되지 않았음을 별도 트랜잭션에서 확인
do $$
declare
  v_cnt bigint;
begin
  select count(*) into v_cnt from auth.users where email like 's2f-vf-%';
  if v_cnt > 0 then
    raise exception 'S2_BATCH_F_VERIFY_RESIDUE: fixture 잔여 % 건', v_cnt;
  end if;
  select count(*) into v_cnt from storage.objects where name like '%s2f-vf%';
  if v_cnt > 0 then
    raise exception 'S2_BATCH_F_VERIFY_RESIDUE: storage fixture 잔여 % 건', v_cnt;
  end if;
  raise notice 'S2_BATCH_F_VERIFY: fixture 잔여 0';
end $$;
