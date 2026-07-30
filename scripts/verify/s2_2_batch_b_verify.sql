-- =============================================================================
-- scripts/verify/s2_2_batch_b_verify.sql
-- S2-2 Batch B (M1 api_web_v1_schemas · M13 comments_author_label_denormalize ·
--               M4 api_web_v1_read_views) 반복 검증 스크립트
-- =============================================================================
-- 실행 전제:
--   * 격리 로컬 Supabase 스택(PG17)에 baseline 175 + Batch A(M0·M15) 적용 상태.
--   * 운영·staging DB 오실행 방지 — local-only 가드를 통과해야만 fixture DML 시작.
--     러너가 같은 세션에서 먼저 다음을 실행해야 한다:
--       set s2_verify.allow_local = 'on';
--   * phase 스위치(단일 스크립트가 T-M13-01~16 전 구간을 소유):
--       set s2_verify.phase = 'forward'        -- M1→M13→M4 적용 직후 (기본값)
--       set s2_verify.phase = 'post_rollback'  -- M4→M13→M1 rollback 직후
--     - forward phase 는 M1 경계 · T-M13-01~14 · M4 View 5종 검증을 수행한다.
--     - post_rollback phase 는 T-M13-15·16 과 rollback 상태 검증을 수행한다.
--   * forward phase 는 백필 검증(T-M13-12·13)을 위해 러너가 M13 적용 「직전」
--     캡처한 스냅샷을 GUC 로 받아야 한다(부재 시 해당 테스트 FAIL — 무음 약화 금지):
--       set s2_verify.pre_m13_comments_cnt          = '<count>';
--       set s2_verify.pre_m13_cc_cnt                = '<count>';
--       set s2_verify.pre_m13_shortform_md5         = '<md5|EMPTY>';
--       set s2_verify.pre_m13_comments_nontarget_md5 = '<md5|EMPTY>';
--       set s2_verify.pre_m13_cc_board_nontarget_md5 = '<md5|EMPTY>';
--     (md5 표현식 정의는 본문 §2 — 러너와 문자 그대로 동일해야 한다.)
--   * post_rollback phase 에서 러너의 백필 fixture(s2b-bf-*)가 잔존 중이면
--       set s2_verify.bf_fixture = 'on';
--     을 함께 세워 정규화 라벨 유지(T-M13-16)의 데이터 기대치를 활성화한다.
--   * 모든 fixture DML(s2b-vf-*) 은 단일 트랜잭션 안에서 수행하고 마지막에
--     rollback 한다. 실사용 규모(auth.users > 50행) 감지 시 중단한다.
-- 판정:
--   * 각 테스트는 s2_results 임시 테이블에 PASS/FAIL 로 기록되고 말미에 표로 출력.
--   * FAIL 1건 이상이면 S2_BATCH_B_VERIFY_FAILED 예외로 종료(트랜잭션 abort).
-- 근거 계약: api_web_v1_contract_v1_1.md §5·§6 V1~V5·§10.1·§10.2·§10.4·§20.3·
--   §21.7 T-M13-01~16·§22 #8 / 물리 정책 §9.2 / Batch B 지시 §7~§11.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. local-only 가드 + phase 결정
-- -----------------------------------------------------------------------------
do $$
declare
  v_allow text := current_setting('s2_verify.allow_local', true);
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_users bigint;
begin
  if v_allow is distinct from 'on' then
    raise exception 'S2_VERIFY_LOCAL_GUARD: s2_verify.allow_local=on 이 설정되지 않았다. 이 스크립트는 격리 로컬 스택 전용이며 운영·staging 에서 실행을 금지한다.'
      using errcode = '42501';
  end if;
  if v_phase not in ('forward', 'post_rollback') then
    raise exception 'S2_VERIFY_PHASE: s2_verify.phase 는 forward|post_rollback 이어야 한다 (현재 %)', v_phase;
  end if;
  select count(*) into v_users from auth.users;
  if v_users > 50 then
    raise exception 'S2_VERIFY_LOCAL_GUARD: auth.users % 행 — 실사용 규모 데이터가 감지되어 중단한다(로컬 clean-install 이 아님).', v_users
      using errcode = '42501';
  end if;
end $$;

create temporary table s2_results (
  seq     serial primary key,
  grp     text not null,
  test    text not null,
  pass    boolean not null,
  detail  text
);

create temporary table s2_fx (k text primary key, v uuid not null);

-- =============================================================================
-- 1. [forward] M1 — schema/ACL/default privilege 경계
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_cnt int;
  v_acl text;
  v_acl2 text;
begin
  if v_phase <> 'forward' then return; end if;

  -- M1-01: schema 2종 존재
  select count(*) into v_cnt from pg_namespace where nspname in ('api_web_v1', 'core_private');
  insert into s2_results(grp,test,pass,detail) values
    ('M1','01 schemas api_web_v1+core_private exist', v_cnt = 2, 'count='||v_cnt);

  -- M1-02: api_web_v1 — 3 role USAGE + PUBLIC acl 항목 0
  select nspacl::text into v_acl from pg_namespace where nspname = 'api_web_v1';
  insert into s2_results(grp,test,pass,detail) values
    ('M1','02 api_web_v1 USAGE(anon/authenticated/service_role) + no PUBLIC',
     has_schema_privilege('anon','api_web_v1','USAGE')
       and has_schema_privilege('authenticated','api_web_v1','USAGE')
       and has_schema_privilege('service_role','api_web_v1','USAGE')
       and v_acl not like '{=%' and v_acl not like '%,=%',
     coalesce(v_acl,'<null>'));

  -- M1-03: core_private — 외부 USAGE/CREATE 0 + PUBLIC acl 항목 0
  select nspacl::text into v_acl2 from pg_namespace where nspname = 'core_private';
  insert into s2_results(grp,test,pass,detail) values
    ('M1','03 core_private external USAGE/CREATE = 0 + no PUBLIC',
     not has_schema_privilege('anon','core_private','USAGE')
       and not has_schema_privilege('authenticated','core_private','USAGE')
       and not has_schema_privilege('service_role','core_private','USAGE')
       and not has_schema_privilege('anon','core_private','CREATE')
       and not has_schema_privilege('authenticated','core_private','CREATE')
       and not has_schema_privilege('service_role','core_private','CREATE')
       and coalesce(v_acl2,'') not like '{=%' and coalesce(v_acl2,'') not like '%,=%',
     coalesce(v_acl2,'<null>'));

  -- M1-04: default privileges 경계 — 두 schema 의 default ACL 에 PUBLIC 부여 항목 0.
  --   [PG17.6 실측 — M1 forward 섹션 D 기록] per-schema REVOKE 는 선행 per-schema
  --   GRANT 부재 시 pg_default_acl 행을 만들지 않는 저장 no-op(행 0 이 정상)이며,
  --   실효 방어선은 §10.3 함수별 명시 REVOKE 다. 여기서는 PUBLIC 부여 항목 부재
  --   + Batch B 범위의 함수 0(= 노출 표면 0, M1-05)으로 경계를 판정한다.
  select count(*) into v_cnt
    from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname in ('api_web_v1', 'core_private')
     and (d.defaclacl::text like '{=%' or d.defaclacl::text like '%,=%');
  insert into s2_results(grp,test,pass,detail) values
    ('M1','04 default ACL PUBLIC-grant entries = 0', v_cnt = 0, 'public_grant_rows='||v_cnt);

  -- M1-05: 객체 census — api_web_v1 은 view 5 만, core_private 는 0/0, 함수 0
  insert into s2_results(grp,test,pass,detail) values
    ('M1','05 census api_web_v1=5 views/0 fn · core_private=0/0',
     (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='api_web_v1' and c.relkind='v') = 5
     and (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='api_web_v1' and c.relkind<>'v') = 0
     and (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname in ('api_web_v1','core_private')) = 0
     and (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='core_private') = 0,
     null);
end $$;

-- =============================================================================
-- 2. [forward] T-M13-12·13 — 백필 정확성 (fixture 생성 「이전」에 비교해야 한다)
--    스냅샷 md5 표현식은 러너 캡처식과 문자 그대로 동일하다.
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_pre_ccnt  text := current_setting('s2_verify.pre_m13_comments_cnt', true);
  v_pre_cccnt text := current_setting('s2_verify.pre_m13_cc_cnt', true);
  v_pre_sf    text := current_setting('s2_verify.pre_m13_shortform_md5', true);
  v_pre_cn    text := current_setting('s2_verify.pre_m13_comments_nontarget_md5', true);
  v_pre_bn    text := current_setting('s2_verify.pre_m13_cc_board_nontarget_md5', true);
  v_now bigint;
  v_md5 text;
  v_viol int;
begin
  if v_phase <> 'forward' then return; end if;

  if coalesce(v_pre_ccnt,'') = '' or coalesce(v_pre_cccnt,'') = '' or coalesce(v_pre_sf,'') = ''
     or coalesce(v_pre_cn,'') = '' or coalesce(v_pre_bn,'') = '' then
    insert into s2_results(grp,test,pass,detail) values
      ('T-M13','12 comments backfill (행 수·비대상 컬럼 불변)', false, '사전 스냅샷 GUC 미제공 — 러너가 M13 직전 캡처값을 세워야 한다'),
      ('T-M13','13 legacy board backfill + shortform 불변', false, '사전 스냅샷 GUC 미제공');
    return;
  end if;

  -- T-M13-12: comments — 행 수 불변 + 비대상 컬럼 md5 불변 + 라벨·역할 규칙 위반 0
  select count(*) into v_now from public.comments;
  select coalesce(md5(string_agg(
           concat_ws('|', id, post_id, author_id, parent_id, content, like_count, is_deleted,
                     created_at, updated_at, legacy_comment_id), '~' order by id)), 'EMPTY')
    into v_md5 from public.comments;
  select count(*) into v_viol
    from public.comments c
   where c.author_label is distinct from coalesce(
           (select nullif(btrim(u.nickname), '') from public.users u where u.id = c.author_id),
           '쌤버십 사용자')
      or c.author_role is distinct from (select case when u.role in ('student','mentor') then u.role end
                                           from public.users u where u.id = c.author_id);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','12 comments backfill (행 수·비대상 컬럼 불변 + 규칙 위반 0)',
     v_now = v_pre_ccnt::bigint and v_md5 = v_pre_cn and v_viol = 0,
     'rows '||v_pre_ccnt||'→'||v_now||' · nontarget '||case when v_md5=v_pre_cn then 'same' else 'DIFF' end||' · viol='||v_viol);

  -- T-M13-13: community_comments — 행 수 불변 + board 비대상 md5 불변 +
  --           board 규칙 위반 0 + shortform 바이트 단위 불변
  select count(*) into v_now from public.community_comments;
  select coalesce(md5(string_agg(
           concat_ws('|', id, post_type, post_id, author_id, body, status,
                     created_at, updated_at, canonical_comment_id), '~' order by id)), 'EMPTY')
    into v_md5 from public.community_comments where post_type = 'board';
  select count(*) into v_viol
    from public.community_comments cc
   where cc.post_type = 'board'
     and cc.author_label is distinct from coalesce(
           (select nullif(btrim(u.nickname), '') from public.users u where u.id = cc.author_id),
           '쌤버십 사용자');
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','13 legacy board backfill + shortform 바이트 불변',
     v_now = v_pre_cccnt::bigint and v_md5 = v_pre_bn and v_viol = 0
       and (select coalesce(md5(string_agg(
              concat_ws('|', id, post_type, post_id, author_id, author_label, body, status,
                        created_at, updated_at, canonical_comment_id), '~' order by id)), 'EMPTY')
              from public.community_comments where post_type = 'shortform') = v_pre_sf,
     'rows '||v_pre_cccnt||'→'||v_now||' · board-nontarget '||case when v_md5=v_pre_bn then 'same' else 'DIFF' end||' · viol='||v_viol);
end $$;

-- =============================================================================
-- 3. [forward] T-M13-01·14 — 구조·함수 하드닝 카탈로그 검증
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_cnt int;
  v_def text;
  v_def2 text;
begin
  if v_phase <> 'forward' then return; end if;

  -- T-M13-01: 선재 author_label 구조(보존) + M13 적용 직후 상태
  --   comments.author_label text NOT NULL default '쌤버십 사용자'(M13 정정) ·
  --   community_comments.author_label text NOT NULL default '쌤버십 회원'(불변) ·
  --   comments.author_role text NULL 무 default (M13 신규 컬럼은 정확히 1개)
  select column_default into v_def from information_schema.columns
   where table_schema='public' and table_name='comments' and column_name='author_label'
     and data_type='text' and is_nullable='NO';
  select column_default into v_def2 from information_schema.columns
   where table_schema='public' and table_name='community_comments' and column_name='author_label'
     and data_type='text' and is_nullable='NO';
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','01 선재 label 컬럼 구조 + author_role(신규 1개) 형태',
     v_def = '''쌤버십 사용자''::text' and v_def2 = '''쌤버십 회원''::text'
       and exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='comments' and column_name='author_role'
                      and data_type='text' and is_nullable='YES' and column_default is null),
     'comments.default='||coalesce(v_def,'<null>')||' cc.default='||coalesce(v_def2,'<null>'));

  -- T-M13-14: 트리거 함수 2종 — SECDEF · 고정 search_path='' · PUBLIC/외부 EXECUTE 0
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public'
     and p.proname in ('comments_set_author_label','community_comments_set_author_label')
     and p.prosecdef
     and p.proconfig::text like '%search_path=%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%'));
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','14 fn 2종 SECDEF+search_path pinned+PUBLIC EXECUTE 0', v_cnt = 2, 'matched='||v_cnt);

  -- 트리거 4종 존재(§20.3 적용 직후 게이트 상당 — 역할별 정의 확인)
  select count(*) into v_cnt from pg_trigger where not tgisinternal
    and ((tgrelid='public.comments'::regclass
          and tgname in ('trg_comments_set_author_label_ins','trg_comments_set_author_label_upd'))
         or (tgrelid='public.community_comments'::regclass
             and tgname in ('trg_community_comments_set_author_label_ins',
                            'trg_community_comments_set_author_label_upd')));
  select pg_get_triggerdef(oid) into v_def from pg_trigger
   where tgrelid='public.comments'::regclass and tgname='trg_comments_set_author_label_upd';
  select pg_get_triggerdef(oid) into v_def2 from pg_trigger
   where tgrelid='public.community_comments'::regclass and tgname='trg_community_comments_set_author_label_upd';
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','01b 트리거 4종 존재 + UPDATE OF 컬럼·board WHEN 한정',
     v_cnt = 4
       and v_def like '%BEFORE UPDATE OF author_label, author_role%'
       and v_def2 like '%BEFORE UPDATE OF author_label%' and v_def2 like '%board%',
     'count='||v_cnt);
end $$;

-- =============================================================================
-- 4. [forward] T-M13-02~11 — 기능 검증 (fixture: s2b-vf-*)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_student uuid := gen_random_uuid();
  v_mentor  uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
  v_blank   uuid := gen_random_uuid();
  v_nonick  uuid := gen_random_uuid();
  v_orphan  uuid := gen_random_uuid();
  v_post    uuid := gen_random_uuid();
  v_id      uuid;
  v_id2     uuid;
  v_txt     text;
  v_txt2    text;
  v_ok      boolean;
  v_det     text;
  v_cnt     int;
begin
  if v_phase <> 'forward' then return; end if;

  -- 라이브(staging·production)는 legacy default privilege 로 client role DML grant 가
  -- 실재하지만, 로컬 clean-install(CLI 2.110.0)은 신규 auto-expose 기본값으로 해당
  -- grant 가 없어 라이브와 다르다. Batch A 검증기(154행 주석)와 동일한 관행으로,
  -- 트리거·RLS·invoker view 행위 검증에 필요한 최소 grant 를 이 트랜잭션 안에서만
  -- 재현한다(말미 rollback 으로 전부 소멸 — 영구 GRANT 변경 0).
  grant select, insert, update on public.comments to authenticated;
  grant select on public.comments to anon;
  grant select, insert, update on public.community_comments to authenticated;
  grant select on public.community_posts to anon, authenticated;
  grant select on public.cash_wallets to authenticated;
  grant select on public.cash_ledger to authenticated;

  -- fixture: 사용자 6 + 게시글 1 (가입 트리거가 public.users 를 생성)
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at)
  values
    (v_student, 's2b-vf-student@example.invalid', '{"app_role":"student","nickname":"검증학생닉"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_mentor,  's2b-vf-mentor@example.invalid',  '{"app_role":"mentor","nickname":"검증멘토닉"}'::jsonb,  '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_admin,   's2b-vf-admin@example.invalid',   '{"app_role":"student","nickname":"검증관리자닉"}'::jsonb,'{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_blank,   's2b-vf-blank@example.invalid',   '{"app_role":"student","nickname":"   "}'::jsonb,         '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_nonick,  's2b-vf-nonick@example.invalid',  '{"app_role":"student"}'::jsonb,                           '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_orphan,  's2b-vf-orphan@example.invalid',  '{"app_role":"student","nickname":"고아닉"}'::jsonb,       '{}'::jsonb, 'authenticated', 'authenticated', now(), now());
  update public.users set role = 'admin' where id = v_admin;      -- JWT 없는 세션 — role guard 허용 경로
  update public.users set nickname = null where id = v_nonick;
  delete from public.users where id = v_orphan;                    -- 사용자 행 부재 케이스(legacy FK 는 auth.users)
  insert into public.community_posts (id, author_id, title, body, content, category, status)
  values (v_post, v_student, 's2b-vf-post', 'vf body', 'vf content', 'free', 'published');
  insert into s2_fx values ('student', v_student), ('mentor', v_mentor), ('admin', v_admin),
                            ('blank', v_blank), ('post', v_post);

  -- T-M13-02: canonical INSERT spoof 라벨·역할 — 서버 덮어쓰기 (authenticated 학생)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.comments (post_id, author_id, content, author_label, author_role)
    values (v_post, v_student, 's2b-vf t02', 's2b-vf-spoof', 'admin') returning id into v_id;
    execute 'reset role';
    select author_label || '/' || coalesce(author_role, '<null>') into v_txt from public.comments where id = v_id;
    v_ok := (v_txt = '검증학생닉/student'); v_det := v_txt;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','02 canonical spoof INSERT 서버 덮어쓰기', coalesce(v_ok, false), left(v_det, 160));

  -- T-M13-03: student·mentor 역할 snapshot
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.comments (post_id, author_id, content)
    values (v_post, v_mentor, 's2b-vf t03') returning id into v_id2;
    execute 'reset role';
    select author_label || '/' || coalesce(author_role, '<null>') into v_txt from public.comments where id = v_id2;
    v_ok := (v_txt = '검증멘토닉/mentor')
            and exists (select 1 from public.comments where id = v_id and author_role = 'student');
    v_det := v_txt;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','03 student/mentor 역할 snapshot', coalesce(v_ok, false), left(v_det, 160));

  -- T-M13-04: admin → author_role NULL (라벨은 nickname 유지 — 역할만 비노출).
  --   '기타 role' 은 users_role_check(student/mentor/admin)로 라이브 fixture 불가 —
  --   함수 정의의 IN ('student','mentor') 한정 분기로 확인(카탈로그 검증).
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.comments (post_id, author_id, content, author_role)
    values (v_post, v_admin, 's2b-vf t04', 'mentor') returning id into v_id;
    execute 'reset role';
    select author_label || '/' || coalesce(author_role, '<null>') into v_txt from public.comments where id = v_id;
    v_ok := (v_txt = '검증관리자닉/<null>')
            and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'comments_set_author_label'
                           and p.prosrc like '%IN (''student'', ''mentor'')%');
    v_det := v_txt;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','04 admin/기타 역할 → author_role NULL', coalesce(v_ok, false), left(v_det, 160));

  -- T-M13-05: nickname 공백·NULL → '쌤버십 사용자' + 사용자 행 부재 fallback.
  --   canonical 은 comments.author_id FK(public.users)로 부재 fixture 불가 —
  --   legacy(auth.users FK) orphan 으로 라이브 확인 + canonical 은 함수 fallback 분기 확인.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_blank, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.comments (post_id, author_id, content) values (v_post, v_blank, 's2b-vf t05a') returning id into v_id;
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('sub', v_nonick, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.comments (post_id, author_id, content) values (v_post, v_nonick, 's2b-vf t05b') returning id into v_id2;
    execute 'reset role';
    -- orphan(공개 users 부재): postgres 로 legacy board INSERT — BEFORE 트리거 fallback.
    -- 163 브리지 AFTER 동기화는 canonical comments 의 public.users FK 로 orphan 을
    -- 수용할 수 없으므로(실측 23503) 브리지 자체 스위치로 억제한다 — 라벨 트리거
    -- (BEFORE)는 그대로 발화하며, 역사적 legacy-origin 고아 행 상황의 재현이다.
    perform set_config('app.comment_sync', '1', true);
    insert into public.community_comments (post_type, post_id, author_id, body, author_label)
    values ('board', v_post, v_orphan, 's2b-vf t05c', 's2b-vf-spoof') returning id into v_id;
    perform set_config('app.comment_sync', '0', true);
    select author_label into v_txt from public.community_comments where id = v_id;
    v_ok := (select count(*) from public.comments where id in (v_id2) and author_label = '쌤버십 사용자') = 1
            and (select count(*) from public.comments where content = 's2b-vf t05a' and author_label = '쌤버십 사용자') = 1
            and v_txt = '쌤버십 사용자'
            and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         where n.nspname = 'public' and p.proname = 'comments_set_author_label'
                           and p.prosrc like '%IF FOUND THEN%' and p.prosrc like '%쌤버십 사용자%');
    v_det := 'orphan_label=' || v_txt;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','05 blank/NULL nickname·사용자 부재 → 쌤버십 사용자', coalesce(v_ok, false), left(v_det, 160));

  -- T-M13-06: legacy board spoof 덮어쓰기 + shortform 트리거 미발화(스푸핑 유지)
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.community_comments (post_type, post_id, author_id, body, author_label)
    values ('board', v_post, v_student, 's2b-vf t06a', 's2b-vf-spoof') returning id into v_id;
    insert into public.community_comments (post_type, post_id, author_id, body, author_label)
    values ('shortform', v_post, v_student, 's2b-vf t06b', 's2b-vf-sf-spoof') returning id into v_id2;
    execute 'reset role';
    select author_label into v_txt  from public.community_comments where id = v_id;
    select author_label into v_txt2 from public.community_comments where id = v_id2;
    v_ok := (v_txt = '검증학생닉' and v_txt2 = 's2b-vf-sf-spoof');
    v_det := 'board=' || v_txt || ' shortform=' || v_txt2;
    insert into s2_fx values ('t06_board', v_id), ('t06_sf', v_id2);
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','06 legacy board spoof 덮어쓰기 + shortform 미발화', coalesce(v_ok, false), left(v_det, 160));

  -- T-M13-07: legacy → canonical 브리지 경유 — 양쪽 라벨 동일(서버 규칙값)
  begin
    select v into v_id from s2_fx where k = 't06_board';
    select c.author_label into v_txt from public.comments c
     where c.legacy_comment_id = v_id;
    select cc.author_label into v_txt2 from public.community_comments cc where cc.id = v_id;
    v_ok := (v_txt = '검증학생닉' and v_txt = v_txt2);
    v_det := 'canonical=' || coalesce(v_txt, '<none>') || ' legacy=' || coalesce(v_txt2, '<none>');
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','07 legacy→canonical 라벨 동일', coalesce(v_ok, false), left(v_det, 160));

  -- T-M13-08: canonical → legacy 브리지 경유 — 양쪽 라벨 동일
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    insert into public.comments (post_id, author_id, content, author_label)
    values (v_post, v_mentor, 's2b-vf t08', 's2b-vf-spoof') returning id into v_id;
    execute 'reset role';
    select author_label into v_txt from public.comments where id = v_id;
    select author_label into v_txt2 from public.community_comments where canonical_comment_id = v_id;
    v_ok := (v_txt = '검증멘토닉' and v_txt2 = '검증멘토닉');
    v_det := 'canonical=' || v_txt || ' legacy=' || coalesce(v_txt2, '<none>');
    insert into s2_fx values ('t08_canonical', v_id);
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','08 canonical→legacy 라벨 동일', coalesce(v_ok, false), left(v_det, 160));

  -- T-M13-09: canonical label/role UPDATE 변조 — 명시적 거부(성공 no-op 위장 금지)
  begin
    select v into v_id from s2_fx where k = 't08_canonical';
    v_ok := false; v_det := 'no error raised';
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      update public.comments set author_label = 'HACKED' where id = v_id;
      execute 'reset role';
    exception when others then
      v_ok := (sqlerrm like '%COMMENT_PROTECTED_FIELDS_IMMUTABLE%'); v_det := sqlerrm;
    end;
    if v_ok then
      v_ok := false; v_det := v_det || ' | role-update: no error';
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        update public.comments set author_role = 'admin' where id = v_id;
        execute 'reset role';
      exception when others then
        v_ok := (sqlerrm like '%COMMENT_PROTECTED_FIELDS_IMMUTABLE%');
        v_det := 'label+role 모두 거부: ' || sqlerrm;
      end;
    end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','09 canonical label/role UPDATE 명시 거부', coalesce(v_ok, false), left(v_det, 160));

  -- T-M13-10: legacy board label UPDATE 명시 거부(admin 경로) + shortform 은 허용
  begin
    select v into v_id from s2_fx where k = 't06_board';
    select v into v_id2 from s2_fx where k = 't06_sf';
    v_ok := false; v_det := 'no error raised';
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      update public.community_comments set author_label = 'HACKED' where id = v_id;
      execute 'reset role';
    exception when others then
      v_ok := (sqlerrm like '%CC_PROTECTED_FIELDS_IMMUTABLE%'); v_det := sqlerrm;
    end;
    if v_ok then
      -- shortform 라벨 UPDATE 는 M13 무영향(기존 동작 유지) — postgres 경로로 확인 후 원복
      update public.community_comments set author_label = 's2b-vf-sf-spoof2' where id = v_id2;
      update public.community_comments set author_label = 's2b-vf-sf-spoof'  where id = v_id2;
      v_det := 'board 거부 + shortform 허용: ' || v_det;
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','10 legacy board label UPDATE 명시 거부(+shortform 무영향)', coalesce(v_ok, false), left(v_det, 160));

  -- T-M13-11: body/content/status/is_deleted·매핑 포인터의 163/164 동기화 회귀 없음
  begin
    select v into v_id from s2_fx where k = 't06_board';       -- legacy-origin (매핑 존재)
    select v into v_id2 from s2_fx where k = 't08_canonical';  -- canonical-origin
    -- legacy body/status 수정 → canonical content/is_deleted 동기화 (라벨 가드 비발화)
    update public.community_comments set body = 's2b-vf t11 edited', status = 'hidden' where id = v_id;
    -- canonical content 수정 → legacy body 동기화
    update public.comments set content = 's2b-vf t11 mirror' where id = v_id2;
    v_ok := exists (select 1 from public.comments
                     where legacy_comment_id = v_id and content = 's2b-vf t11 edited' and is_deleted = true)
        and exists (select 1 from public.community_comments
                     where canonical_comment_id = v_id2 and body = 's2b-vf t11 mirror')
        and exists (select 1 from public.community_comments
                     where id = v_id and canonical_comment_id is not null);
    v_det := null;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','11 bridge body/status/포인터 동기화 회귀 없음', coalesce(v_ok, false), left(v_det, 160));
end $$;

-- =============================================================================
-- 5. [forward] M4 — View 5종 필드·타입·옵션·GRANT·PII (카탈로그)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_sig text;
  v_bad text;
  v_cnt int;
begin
  if v_phase <> 'forward' then return; end if;

  -- M4-01~05: 각 view 의 필드 시그니처(이름:타입, 정의 순서) — 계약 §6 원문과 1:1
  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_sig from pg_attribute a
   where a.attrelid = 'api_web_v1.community_posts_v1'::regclass and a.attnum > 0 and not a.attisdropped;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','01 V1 community_posts_v1 field signature',
     v_sig = 'id:uuid, author_id:uuid, title:text, body:text, category:text, image_refs:text[], author_label:text, author_role:text, like_count:integer, comment_count:integer, view_count:integer, status:text, created_at:timestamp with time zone, updated_at:timestamp with time zone',
     left(v_sig, 200));

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_sig from pg_attribute a
   where a.attrelid = 'api_web_v1.community_comments_v1'::regclass and a.attnum > 0 and not a.attisdropped;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','02 V2 community_comments_v1 field signature',
     v_sig = 'id:uuid, post_id:uuid, author_id:uuid, parent_id:uuid, body:text, like_count:integer, author_label:text, author_role:text, created_at:timestamp with time zone',
     left(v_sig, 200));

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_sig from pg_attribute a
   where a.attrelid = 'api_web_v1.mentor_directory_v1'::regclass and a.attnum > 0 and not a.attisdropped;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','03 V3 mentor_directory_v1 field signature',
     v_sig = 'mentor_id:uuid, nickname:text, university_name:text, department_name:text, teaching_subjects:text[], intro_line:text, profile_image_url:text, high_school_name:text, school_verified:boolean, school_tier:text, verified_major_category:text, verified_university_name:text, verified_department_name:text, is_open_for_subscriptions:boolean, avg_rating:numeric, review_count:integer, created_at:timestamp with time zone',
     left(v_sig, 260));

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_sig from pg_attribute a
   where a.attrelid = 'api_web_v1.my_wallet_v1'::regclass and a.attnum > 0 and not a.attisdropped;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','04 V4 my_wallet_v1 field signature',
     v_sig = 'user_id:uuid, balance_cents:bigint, balance_krw:bigint', v_sig);

  select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
    into v_sig from pg_attribute a
   where a.attrelid = 'api_web_v1.my_cash_ledger_v1'::regclass and a.attnum > 0 and not a.attisdropped;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','05 V5 my_cash_ledger_v1 field signature',
     v_sig = 'id:uuid, delta_cents:bigint, delta_krw:bigint, reason:text, ref_type:text, ref_id:uuid, order_ref:text, created_at:timestamp with time zone',
     left(v_sig, 200));

  -- M4-06: security_invoker — V1·V2·V4·V5 true / V3 는 계약된 의도적 예외(false)
  select count(*) into v_cnt from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'api_web_v1'
     and c.relname in ('community_posts_v1','community_comments_v1','my_wallet_v1','my_cash_ledger_v1')
     and c.reloptions::text like '%security_invoker=true%';
  insert into s2_results(grp,test,pass,detail) values
    ('M4','06 invoker 4종 true + V3 SECDEF 의도적 예외',
     v_cnt = 4 and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                where n.nspname='api_web_v1' and c.relname='mentor_directory_v1'
                                  and c.reloptions::text like '%security_invoker=true%'),
     'invoker=true count='||v_cnt);

  -- M4-07: GRANT — V1~V3 SELECT(anon·authenticated·service_role) / V4·V5 anon 0
  insert into s2_results(grp,test,pass,detail) values
    ('M4','07 SELECT grant 매트릭스(§10.2)',
     has_table_privilege('anon','api_web_v1.community_posts_v1','SELECT')
       and has_table_privilege('anon','api_web_v1.community_comments_v1','SELECT')
       and has_table_privilege('anon','api_web_v1.mentor_directory_v1','SELECT')
       and not has_table_privilege('anon','api_web_v1.my_wallet_v1','SELECT')
       and not has_table_privilege('anon','api_web_v1.my_cash_ledger_v1','SELECT')
       and (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
             where n.nspname='api_web_v1'
               and has_table_privilege('authenticated', c.oid, 'SELECT')
               and has_table_privilege('service_role', c.oid, 'SELECT')) = 5,
     null);

  -- M4-08: DML 0 (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER × 3 role) + PUBLIC 0
  select string_agg(distinct v.relname, ', ') into v_bad
    from pg_class v join pg_namespace n on n.oid = v.relnamespace,
         unnest(array['anon','authenticated','service_role']) as r(role),
         unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
   where n.nspname = 'api_web_v1' and has_table_privilege(r.role, v.oid, p.priv);
  insert into s2_results(grp,test,pass,detail) values
    ('M4','08 view DML 권한 0 + PUBLIC acl 0',
     v_bad is null
       and not exists (select 1 from pg_class v join pg_namespace n on n.oid = v.relnamespace
                        where n.nspname='api_web_v1'
                          and (v.relacl::text like '{=%' or v.relacl::text like '%,=%')),
     coalesce('leak: '||v_bad, 'clean'));

  -- M4-09: PII 비노출 — V3 정의·컬럼에 full_name/email/birth_date/grade_level 0 +
  --         V5 에 idempotency_key 컬럼명 비노출(order_ref CASE 한정)
  insert into s2_results(grp,test,pass,detail) values
    ('M4','09 PII 0 (V3) + idempotency_key 비노출(V5)',
     pg_get_viewdef('api_web_v1.mentor_directory_v1'::regclass) !~* '(full_name|email|birth_date|grade_level)'
       and not exists (select 1 from information_schema.columns
                        where table_schema='api_web_v1' and column_name in ('full_name','email','birth_date','grade_level','idempotency_key'))
       and pg_get_viewdef('api_web_v1.my_cash_ledger_v1'::regclass) ~* 'WHEN.*ref_type.*topup.*THEN.*idempotency_key',
     null);
end $$;

-- =============================================================================
-- 6. [forward] M4 — 기능 검증 (RLS 경유 필터·본인 한정·거부 경로)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_student uuid;
  v_mentor uuid;
  v_admin uuid;
  v_blank uuid;
  v_post uuid;
  v_m_pending uuid := gen_random_uuid();
  v_m_banned  uuid := gen_random_uuid();
  v_post2 uuid := gen_random_uuid();
  v_post3 uuid := gen_random_uuid();
  v_cnt int;
  v_cnt2 int;
  v_ok boolean;
  v_det text;
  v_num numeric;
  v_txt text;
begin
  if v_phase <> 'forward' then return; end if;
  select v into v_student from s2_fx where k = 'student';
  select v into v_mentor  from s2_fx where k = 'mentor';
  select v into v_admin   from s2_fx where k = 'admin';
  select v into v_blank   from s2_fx where k = 'blank';
  select v into v_post    from s2_fx where k = 'post';

  -- fixture 확장: 미승인·정지 멘토 / 게시글 상태 3종 / 학교인증 2건 / 리뷰 3건 / 지갑·원장
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at)
  values
    (v_m_pending, 's2b-vf-mpend@example.invalid', '{"app_role":"mentor","nickname":"미승인멘토"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_m_banned,  's2b-vf-mban@example.invalid',  '{"app_role":"mentor","nickname":"정지멘토"}'::jsonb,  '{}'::jsonb, 'authenticated', 'authenticated', now(), now());
  update public.mentor_profiles set verification_status = 'approved', is_open_for_subscriptions = true
   where user_id in (v_mentor, v_m_banned);
  update public.users set status = 'banned' where id = v_m_banned;
  update public.mentor_profiles
     set university_name = '검증대', department_name = '검증학과', high_school_name = '검증고',
         intro_line = 's2b-vf intro', teaching_subjects = array['수학','물리']
   where user_id = v_mentor;
  -- uq_msv_one_approved_per_mentor(부분 UNIQUE)로 approved 는 멘토당 1건만 가능 —
  -- 운영 패턴대로 구 승인건은 superseded 로 두고 최신 approved 1건이 선택됨을 검증.
  insert into public.mentor_school_verifications
    (mentor_id, status, verified_university_name, verified_department_name, verified_major_category, school_tier, reviewed_at, created_at, updated_at)
  values
    (v_mentor, 'superseded', '옛대학교', '옛학과', '자연', '그외',  now() - interval '10 days', now() - interval '20 days', now() - interval '10 days'),
    (v_mentor, 'approved',   '새대학교', '새학과', '공학', '서연고', now() - interval '1 day',  now() - interval '5 days',  now() - interval '1 day'),
    (v_mentor, 'pending',    '펜딩대학교', null, null, null, null, now(), now());
  -- uq_reviews_mentor_author(작성자당 1건) — 리뷰 3건은 서로 다른 작성자로 구성.
  insert into public.reviews (mentor_id, author_id, rating, body, is_hidden, is_blinded) values
    (v_mentor, v_student, 5, 's2b-vf visible', false, false),
    (v_mentor, v_admin,   1, 's2b-vf hidden',  true,  false),
    (v_mentor, v_blank,   1, 's2b-vf blinded', false, true);
  insert into public.community_posts (id, author_id, title, body, content, category, status)
  values (v_post2, v_student, 's2b-vf-draft', null, 'draft content', 'free', 'draft');
  insert into public.community_posts (id, author_id, title, body, content, category, status, deleted_at)
  values (v_post3, v_student, 's2b-vf-deleted', 'x', 'x', 'free', 'published', now());
  insert into public.cash_wallets (user_id, balance_cents)
  values (v_student, 1234500), (v_mentor, 990000)
  on conflict (user_id) do update set balance_cents = excluded.balance_cents;
  insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key) values
    (v_student, 1234500, 's2b-vf topup', 'topup', null, 's2b_vf_order_1'),
    (v_student, -50000, 's2b-vf debit', 'subscription_debit', gen_random_uuid(), 's2b_vf_subdebit_1'),
    (v_mentor, 990000, 's2b-vf topup2', 'topup', null, 's2b_vf_order_2');

  -- M4-10: V1 — published 전체 + draft 는 작성자에게만 + deleted_at 숨김 + coalesce 규약
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_cnt from api_web_v1.community_posts_v1
     where title in ('s2b-vf-post', 's2b-vf-draft', 's2b-vf-deleted');
    select count(*) into v_cnt2 from api_web_v1.community_posts_v1
     where title = 's2b-vf-draft' and body = 'draft content' and image_refs = '{}'::text[];
    execute 'reset role';
    v_ok := (v_cnt = 2 and v_cnt2 = 1);  -- post+draft(본인) 노출 · deleted 숨김 · body=coalesce(content,body)
    v_det := 'visible='||v_cnt||' draft_coalesce='||v_cnt2;
    if v_ok then
      perform set_config('request.jwt.claims', json_build_object('sub', v_mentor, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      select count(*) into v_cnt from api_web_v1.community_posts_v1 where title = 's2b-vf-draft';
      execute 'reset role';
      v_ok := (v_cnt = 0);  -- 타인 draft 비노출
      v_det := v_det || ' other_draft='||v_cnt;
    end if;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('M4','10 V1 노출 규칙(published/본인 draft/deleted 숨김/coalesce)', coalesce(v_ok, false), left(v_det, 160));

  -- M4-11: V2 — 정본 comments 원천 · is_deleted 필터 · M13 라벨 노출
  begin
    update public.comments set is_deleted = true where content = 's2b-vf t05a';
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_cnt from api_web_v1.community_comments_v1 where body = 's2b-vf t05a';
    select count(*) into v_cnt2 from api_web_v1.community_comments_v1
     where body = 's2b-vf t02' and author_label = '검증학생닉' and author_role = 'student';
    execute 'reset role';
    v_ok := (v_cnt = 0 and v_cnt2 = 1);
    v_det := 'deleted_visible='||v_cnt||' labeled='||v_cnt2;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('M4','11 V2 정본 원천·is_deleted 필터·비정규화 라벨', coalesce(v_ok, false), left(v_det, 160));

  -- M4-12: V3 — 승인+활성 멘토만 (pending·banned 제외) · anon 에서도 동일
  begin
    execute 'set local role anon';
    select count(*) into v_cnt from api_web_v1.mentor_directory_v1 where nickname = '검증멘토닉';
    select count(*) into v_cnt2 from api_web_v1.mentor_directory_v1 where nickname in ('미승인멘토', '정지멘토');
    execute 'reset role';
    v_ok := (v_cnt = 1 and v_cnt2 = 0);
    v_det := 'approved_active='||v_cnt||' excluded='||v_cnt2;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','12 V3 승인+활성 멘토만(anon 열람)', coalesce(v_ok, false), left(v_det, 160));

  -- M4-13: V3 — 최신 승인 학교인증 1건 선택(reviewed_at DESC) + school_verified
  begin
    execute 'set local role anon';
    select count(*) into v_cnt from api_web_v1.mentor_directory_v1
     where nickname = '검증멘토닉' and school_verified = true
       and verified_university_name = '새대학교' and verified_department_name = '새학과'
       and verified_major_category = '공학' and school_tier = '서연고';
    execute 'reset role';
    v_ok := (v_cnt = 1); v_det := 'latest_approved='||v_cnt;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','13 V3 최신 승인 학교인증 선택(정렬식)', coalesce(v_ok, false), left(v_det, 160));

  -- M4-14: V3 — hidden/blinded 리뷰 제외 평점·개수 (5점 1건만 집계)
  begin
    execute 'set local role anon';
    select avg_rating, review_count into v_num, v_cnt from api_web_v1.mentor_directory_v1
     where nickname = '검증멘토닉';
    execute 'reset role';
    v_ok := (v_num = 5 and v_cnt = 1);
    v_det := 'avg='||coalesce(v_num::text,'<null>')||' cnt='||v_cnt;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','14 V3 hidden/blinded 리뷰 제외 집계', coalesce(v_ok, false), left(v_det, 160));

  -- M4-15: V4 — invoker RLS 로 본인 행만 + balance_krw 산식
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_cnt from api_web_v1.my_wallet_v1;
    select count(*) into v_cnt2 from api_web_v1.my_wallet_v1
     where user_id = v_student and balance_cents = 1234500 and balance_krw = 12345;
    execute 'reset role';
    v_ok := (v_cnt = 1 and v_cnt2 = 1);
    v_det := 'rows='||v_cnt||' own_krw='||v_cnt2;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('M4','15 V4 본인 행만 + balance_krw=cents/100', coalesce(v_ok, false), left(v_det, 160));

  -- M4-16: V5 — 본인 행만 + order_ref 는 topup 행의 idempotency_key 만
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select count(*) into v_cnt from api_web_v1.my_cash_ledger_v1;
    select order_ref into v_txt from api_web_v1.my_cash_ledger_v1 where ref_type = 'topup' and delta_cents = 1234500;
    select count(*) into v_cnt2 from api_web_v1.my_cash_ledger_v1
     where ref_type <> 'topup' and order_ref is not null;
    execute 'reset role';
    v_ok := (v_cnt = 2 and v_txt = 's2b_vf_order_1' and v_cnt2 = 0);
    v_det := 'rows='||v_cnt||' order_ref='||coalesce(v_txt,'<null>')||' nontopup_ref='||v_cnt2;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('M4','16 V5 본인 행만 + order_ref=topup idempotency_key 한정', coalesce(v_ok, false), left(v_det, 160));

  -- M4-17: anon 의 V4·V5 접근 — permission denied (42501)
  begin
    v_ok := false; v_det := 'no error raised';
    begin
      execute 'set local role anon';
      execute 'select count(*) from api_web_v1.my_wallet_v1';
      execute 'reset role';
    exception when insufficient_privilege then
      v_ok := true; v_det := 'wallet 42501';
    end;
    if v_ok then
      v_ok := false;
      begin
        execute 'set local role anon';
        execute 'select count(*) from api_web_v1.my_cash_ledger_v1';
        execute 'reset role';
      exception when insufficient_privilege then
        v_ok := true; v_det := v_det || ' + ledger 42501';
      end;
    end if;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','17 anon V4/V5 접근 거부(42501)', coalesce(v_ok, false), left(v_det, 160));

  -- M4-18: view DML 거부 — INSERT(V1)·UPDATE(V4) 모두 실패.
  --   V1 은 표현식 컬럼으로 비자동갱신 뷰라 rewrite 단계 55000 이 권한 검사보다
  --   먼저 난다 — 42501(권한 0)·55000/0A000(갱신 불가) 모두 "DML 불가" 판정.
  begin
    v_ok := false; v_det := 'no error raised';
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      insert into api_web_v1.community_posts_v1 (id, author_id, title) values (gen_random_uuid(), v_student, 'x');
      execute 'reset role';
    exception when others then
      v_ok := (sqlstate in ('42501', '55000', '0A000'));
      v_det := 'insert ' || sqlstate;
    end;
    if v_ok then
      v_ok := false;
      begin
        perform set_config('request.jwt.claims', json_build_object('sub', v_student, 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        update api_web_v1.my_wallet_v1 set balance_cents = 0;
        execute 'reset role';
      exception when others then
        v_ok := (sqlstate in ('42501', '55000', '0A000'));
        v_det := v_det || ' + update ' || sqlstate;
      end;
    end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('M4','18 view DML 거부(INSERT/UPDATE 42501)', coalesce(v_ok, false), left(v_det, 160));

  -- M4-19: anon 공개 표면 — V1 published 만·V2 열람 가능(라벨 포함)
  begin
    execute 'set local role anon';
    select count(*) into v_cnt from api_web_v1.community_posts_v1 where title like 's2b-vf-%';
    select count(*) into v_cnt2 from api_web_v1.community_comments_v1 where author_label = '검증멘토닉';
    execute 'reset role';
    v_ok := (v_cnt = 1 and v_cnt2 >= 1);  -- published 1건만 · 댓글 라벨 열람
    v_det := 'posts='||v_cnt||' labeled_comments='||v_cnt2;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','19 anon 공개 표면(V1 published 만·V2 라벨)', coalesce(v_ok, false), left(v_det, 160));
end $$;

-- =============================================================================
-- 7. [post_rollback] T-M13-15·16 + M4/M1 rollback 상태
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_bf text := current_setting('s2_verify.bf_fixture', true);
  v_def text;
  v_def2 text;
  v_cnt int;
  v_viol int;
begin
  if v_phase <> 'post_rollback' then return; end if;

  -- T-M13-15: 선재 label 컬럼 보존 · author_role 제거 · default 복원 · 트리거/함수 부재
  select column_default into v_def from information_schema.columns
   where table_schema='public' and table_name='comments' and column_name='author_label'
     and data_type='text' and is_nullable='NO';
  select column_default into v_def2 from information_schema.columns
   where table_schema='public' and table_name='community_comments' and column_name='author_label'
     and data_type='text' and is_nullable='NO';
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13','15 rollback 후 label 보존·role 제거·default 복원·객체 부재',
     v_def = '''쌤버십 회원''::text' and v_def2 = '''쌤버십 회원''::text'
       and not exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='comments' and column_name='author_role')
       and not exists (select 1 from pg_trigger where not tgisinternal
                        and tgname in ('trg_comments_set_author_label_ins','trg_comments_set_author_label_upd',
                                       'trg_community_comments_set_author_label_ins','trg_community_comments_set_author_label_upd'))
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                        where n.nspname='public'
                          and p.proname in ('comments_set_author_label','community_comments_set_author_label')),
     'comments.default='||coalesce(v_def,'<null>')||' cc.default='||coalesce(v_def2,'<null>'));

  -- T-M13-16: 정규화 라벨 유지(forward-only) — 과거 클라이언트 라벨 미복원.
  --   러너 백필 fixture(s2b-bf-*) 존재 시: canonical·board 에 spoof 라벨 0 +
  --   규칙 일치 유지 + shortform 은 스푸핑 라벨 그대로(무영향) 확인.
  if v_bf = 'on' then
    select count(*) into v_cnt from public.comments where author_label like 's2b-spoof-%';
    select count(*) into v_viol from public.community_comments
     where post_type = 'board' and author_label like 's2b-spoof-%';
    insert into s2_results(grp,test,pass,detail) values
      ('T-M13','16 정규화 라벨 유지(spoof 미복원·shortform 무영향)',
       v_cnt = 0 and v_viol = 0
         and (select count(*) from public.comments where author_label in ('백필학생닉','백필멘토닉','백필관리자닉')) >= 3
         and (select count(*) from public.community_comments
               where post_type = 'shortform' and author_label like 's2b-spoof-%') = 2,
       'canonical_spoof='||v_cnt||' board_spoof='||v_viol);
  else
    -- fixture 부재 실행 — 데이터 기대치 없이 spoof 부재만 확인(약화 사유를 명시)
    select count(*) into v_cnt from public.comments where author_label like 's2b-spoof-%';
    insert into s2_results(grp,test,pass,detail) values
      ('T-M13','16 정규화 라벨 유지(spoof 미복원)', v_cnt = 0,
       'bf_fixture GUC off — spoof 부재만 확인(러너 fixture 없이 실행됨), spoof='||v_cnt);
  end if;

  -- R-01: M4 rollback — api_web_v1 view 부재
  insert into s2_results(grp,test,pass,detail) values
    ('ROLLBACK','01 api_web_v1 view 0',
     not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='api_web_v1'), null);

  -- R-02: M1 rollback — schema 2종 부재 + default acl 항목 0
  insert into s2_results(grp,test,pass,detail) values
    ('ROLLBACK','02 schemas 부재 + default acl 0',
     not exists (select 1 from pg_namespace where nspname in ('api_web_v1','core_private'))
       and not exists (select 1 from pg_default_acl d join pg_namespace n on n.oid=d.defaclnamespace
                        where n.nspname in ('api_web_v1','core_private')), null);

  -- R-03: 163/164 브리지 불변 + Batch A(M0·M15) 객체 잔존
  insert into s2_results(grp,test,pass,detail) values
    ('ROLLBACK','03 bridge 7fn 불변 + Batch A 객체 잔존',
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public'
         and p.proname in ('comment_sync_in_progress','comments_write_guard','cc_write_guard',
                           'cc_sync_board_to_canonical','cc_sync_board_delete_to_canonical',
                           'comments_mirror_to_legacy','comments_mirror_delete_to_legacy')) = 7
     and exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='enforce_mentor_profile_privileged_guard')
     and (select count(*) from pg_trigger where tgrelid='public.mentor_profiles'::regclass
           and tgname in ('trg_mentor_profile_privileged_guard_upd','trg_mentor_profile_privileged_guard_ins')) = 2,
     null);

  -- R-04: 016 updated_at 트리거 정상(ENABLE) — 백필 구간 DISABLE 의 잔존 없음
  insert into s2_results(grp,test,pass,detail) values
    ('ROLLBACK','04 trg_community_comments_set_updated enabled',
     exists (select 1 from pg_trigger
              where tgrelid='public.community_comments'::regclass
                and tgname='trg_community_comments_set_updated' and tgenabled='O'), null);
end $$;

-- -----------------------------------------------------------------------------
-- 8. 결과 보고 + 게이트 (FAIL ≥1 → 예외로 전체 rollback)
-- -----------------------------------------------------------------------------
select grp, test, case when pass then 'PASS' else 'FAIL' end as result, detail
  from s2_results order by seq;

select count(*) filter (where pass) || '/' || count(*) as passed from s2_results;

do $$
declare
  v_fail int;
  v_list text;
begin
  select count(*), string_agg(grp || ':' || test, ' | ') filter (where not pass)
    into v_fail, v_list
    from s2_results where not pass;
  if v_fail > 0 then
    raise exception 'S2_BATCH_B_VERIFY_FAILED: % failing test(s) — %', v_fail, v_list;
  end if;
  raise notice 'S2_BATCH_B_VERIFY: ALL PASS (phase=%)',
    coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
end $$;

-- 모든 fixture DML(s2b-vf-*) 은 여기서 파기된다(잔여 0 보증).
rollback;

-- -----------------------------------------------------------------------------
-- 9. rollback 후 fixture 잔여 0 확인 (새 트랜잭션 밖 일반 조회)
-- -----------------------------------------------------------------------------
do $$
declare
  v_cnt bigint;
begin
  select count(*) into v_cnt from auth.users where email like 's2b-vf-%@example.invalid';
  if v_cnt > 0 then
    raise exception 'S2_FIXTURE_RESIDUE: auth.users % rows remain', v_cnt;
  end if;
  select count(*) into v_cnt from public.users u where u.email like 's2b-vf-%@example.invalid';
  if v_cnt > 0 then
    raise exception 'S2_FIXTURE_RESIDUE: public.users % rows remain', v_cnt;
  end if;
  select count(*) into v_cnt from public.community_posts where title like 's2b-vf-%';
  if v_cnt > 0 then
    raise exception 'S2_FIXTURE_RESIDUE: community_posts % rows remain', v_cnt;
  end if;
  select count(*) into v_cnt from public.comments where content like 's2b-vf %';
  if v_cnt > 0 then
    raise exception 'S2_FIXTURE_RESIDUE: comments % rows remain', v_cnt;
  end if;
  raise notice 'S2_BATCH_B_VERIFY: fixture residue 0';
end $$;
