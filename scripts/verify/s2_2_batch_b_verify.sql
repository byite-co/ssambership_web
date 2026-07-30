-- =============================================================================
-- scripts/verify/s2_2_batch_b_verify.sql
-- S2-2 Batch B (M1 api_web_v1_schemas · M13 comments_author_label_denormalize ·
--               M4 api_web_v1_read_views) 반복 검증 스크립트
-- =============================================================================
-- 실행 전제:
--   * 격리 로컬 Supabase 스택(PG17)에 baseline 177(후보 C 175 + Batch A M0·M15)이
--     적용된 상태. 운영·staging DB 오실행 방지 — local-only 가드를 통과해야 실행된다.
--     러너가 같은 세션에서 먼저 다음을 실행해야 한다:
--       set s2_verify.allow_local = 'on';
--       set s2_verify.phase = 'baseline' | 'forward' | 'rollback';
--   * phase 별 검사 범위(계약 §20.3·§21.7 — 왕복 러너가 각 시점에 1회씩 실행):
--       baseline : Batch B 적용 전 — T-M13-01(선재 구조) + M1/M4 대상 부재.
--       forward  : M1→M13→M4 적용 후 — M1 경계 / M13 카탈로그·T-M13-02~14 /
--                  M4 V1~V5 필드·타입·옵션·필터·GRANT / V3 의도적 예외 /
--                  PII 비노출 / View DML 0 / core_private 봉인 / fixture 잔여 0.
--       rollback : M4→M13→M1 rollback 후 — T-M13-15·16 + 스키마·객체 부재 +
--                  163/164 브리지 보존 + default 복원.
--   * T-M13-12·13(백필 행 수·비대상 컬럼·shortform 바이트 불변)의 전후 비교는
--     러너가 백필 전 캡처와 대조한다. 본 스크립트의 forward phase 는 정규화 규칙
--     전행 일치(백필 완료 상태)의 상시 assertion 을 수행한다.
--   * 모든 fixture DML 은 단일 트랜잭션 안에서 수행하고 마지막에 rollback 한다.
--     실사용 데이터 규모(auth.users > 50행)가 감지되면 허용 변수가 있어도 중단한다.
-- 판정:
--   * 각 테스트는 s2_results 임시 테이블에 PASS/FAIL 로 기록되고 말미에 표로 출력된다.
--   * FAIL 이 1건이라도 있으면 S2_BATCH_B_VERIFY_FAILED 예외로 종료(트랜잭션 abort —
--     fixture 는 어느 경로로든 남지 않는다).
-- 근거 계약: api_web_v1_contract_v1_1.md §5·§6 V1~V5·§10.1·§10.2·§10.4·§20.2 M1/M13/M4·
--   §20.3·§21.7 T-M13-01~16·§22 #8.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. local-only 가드 + phase 검증
-- -----------------------------------------------------------------------------
do $$
declare
  v_allow text := current_setting('s2_verify.allow_local', true);
  v_phase text := current_setting('s2_verify.phase', true);
  v_users bigint;
begin
  if v_allow is distinct from 'on' then
    raise exception 'S2_VERIFY_LOCAL_GUARD: s2_verify.allow_local=on 이 설정되지 않았다. 이 스크립트는 격리 로컬 스택 전용이며 운영·staging 에서 실행을 금지한다.'
      using errcode = '42501';
  end if;
  if v_phase not in ('baseline', 'forward', 'rollback') then
    raise exception 'S2_VERIFY_PHASE_INVALID: s2_verify.phase 는 baseline|forward|rollback 중 하나여야 한다(현재: %)', coalesce(v_phase, '<null>')
      using errcode = '42501';
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
-- PHASE: baseline — T-M13-01 + Batch B 대상 부재 (계약 §20.3 「M13 이전」)
-- =============================================================================
do $$
declare
  v_cnt int;
  v_def text;
begin
  if current_setting('s2_verify.phase') <> 'baseline' then return; end if;

  -- T-M13-01a: comments.author_label — text NOT NULL DEFAULT '쌤버십 회원'
  select count(*) into v_cnt from information_schema.columns
   where table_schema = 'public' and table_name = 'comments' and column_name = 'author_label'
     and data_type = 'text' and is_nullable = 'NO' and column_default = '''쌤버십 회원''::text';
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-01','a comments.author_label 선재 구조(text NOT NULL default 쌤버십 회원)', v_cnt = 1, 'matched='||v_cnt);

  -- T-M13-01b: comments.author_role 부재
  select count(*) into v_cnt from information_schema.columns
   where table_schema = 'public' and table_name = 'comments' and column_name = 'author_role';
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-01','b comments.author_role 부재', v_cnt = 0, 'found='||v_cnt);

  -- T-M13-01c: community_comments.author_label — text NOT NULL DEFAULT '쌤버십 회원'
  select count(*) into v_cnt from information_schema.columns
   where table_schema = 'public' and table_name = 'community_comments' and column_name = 'author_label'
     and data_type = 'text' and is_nullable = 'NO' and column_default = '''쌤버십 회원''::text';
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-01','c community_comments.author_label 선재 구조', v_cnt = 1, 'matched='||v_cnt);

  -- T-M13-01d: 163/164 브리지 정본(함수 4·트리거 4·매핑 컬럼 2)
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in
     ('cc_sync_board_to_canonical','comments_mirror_to_legacy','comments_write_guard','cc_write_guard');
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-01','d 163/164 브리지 함수 4종', v_cnt = 4, 'count='||v_cnt);
  select count(*) into v_cnt from pg_trigger where not tgisinternal and tgname in
    ('trg_comments_write_guard','trg_comments_mirror_to_legacy','trg_cc_write_guard','trg_cc_sync_board_to_canonical');
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-01','e 163/164 브리지 트리거 4종', v_cnt = 4, 'count='||v_cnt);
  select count(*) into v_cnt from information_schema.columns
   where (table_schema,table_name,column_name) in
     (('public','comments','legacy_comment_id'),('public','community_comments','canonical_comment_id'));
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-01','f 163/164 매핑 컬럼 2종', v_cnt = 2, 'count='||v_cnt);

  -- Batch B 대상 부재: schema 2·M13 함수 2·M4 view 5
  select count(*) into v_cnt from pg_namespace where nspname in ('api_web_v1','core_private');
  insert into s2_results(grp,test,pass,detail) values
    ('BASE','M1 schema 부재', v_cnt = 0, 'found='||v_cnt);
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('comments_set_author_label','community_comments_set_author_label');
  insert into s2_results(grp,test,pass,detail) values
    ('BASE','M13 트리거 함수 부재', v_cnt = 0, 'found='||v_cnt);
end $$;

-- =============================================================================
-- PHASE: forward — M1 경계 assertion (계약 §5.3·§10.1)
-- =============================================================================
do $$
declare
  v_cnt int;
  v_pub int;
begin
  if current_setting('s2_verify.phase') <> 'forward' then return; end if;

  -- M1-1: schema 2종 존재
  select count(*) into v_cnt from pg_namespace where nspname in ('api_web_v1','core_private');
  insert into s2_results(grp,test,pass,detail) values
    ('M1','schema api_web_v1·core_private 존재', v_cnt = 2, 'count='||v_cnt);

  -- M1-2: 두 schema 에 PUBLIC(grantee=0) 권한 0건
  select count(*) into v_pub
    from pg_namespace n, aclexplode(n.nspacl) a
   where n.nspname in ('api_web_v1','core_private') and a.grantee = 0;
  insert into s2_results(grp,test,pass,detail) values
    ('M1','PUBLIC schema 권한 0건', v_pub = 0, 'public_grants='||v_pub);

  -- M1-3: api_web_v1 — anon/authenticated/service_role USAGE ✓, CREATE ✗
  insert into s2_results(grp,test,pass,detail) values
    ('M1','api_web_v1 USAGE(anon·authenticated·service_role)',
     has_schema_privilege('anon','api_web_v1','USAGE')
     and has_schema_privilege('authenticated','api_web_v1','USAGE')
     and has_schema_privilege('service_role','api_web_v1','USAGE'), null);
  insert into s2_results(grp,test,pass,detail) values
    ('M1','api_web_v1 CREATE 부여 0',
     not has_schema_privilege('anon','api_web_v1','CREATE')
     and not has_schema_privilege('authenticated','api_web_v1','CREATE')
     and not has_schema_privilege('service_role','api_web_v1','CREATE'), null);

  -- M1-4: core_private — 외부 역할 USAGE·CREATE 전부 0 (rev 8 A-2)
  insert into s2_results(grp,test,pass,detail) values
    ('M1','core_private 외부 USAGE 0(service_role 포함)',
     not has_schema_privilege('anon','core_private','USAGE')
     and not has_schema_privilege('authenticated','core_private','USAGE')
     and not has_schema_privilege('service_role','core_private','USAGE')
     and not has_schema_privilege('anon','core_private','CREATE')
     and not has_schema_privilege('authenticated','core_private','CREATE')
     and not has_schema_privilege('service_role','core_private','CREATE'), null);

  -- M1-5: default privilege — 두 schema 의 per-schema 기본 ACL 이 PUBLIC 에 아무 권한도
  --   추가 부여하지 않는다. (PG 실측·문서: per-schema ALTER DEFAULT PRIVILEGES 는
  --   전역 기본에 additive 만 가능해 REVOKE 는 카탈로그 행을 남기지 않는다 —
  --   그래서 계약 §5.3 주의 1이 각 함수의 명시적 REVOKE 를 이중 방어로 강제한다.
  --   함수별 실효 회수는 T-M13-14b 및 후속 batch 함수 검증이 담당.)
  select count(*) into v_cnt
    from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname in ('api_web_v1','core_private')
     and exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0);
  insert into s2_results(grp,test,pass,detail) values
    ('M1','default privileges: PUBLIC 추가 부여 항목 0', v_cnt = 0, 'public_entries='||v_cnt);

  -- M1-6: core_private 내부 객체 0 (Batch B 단계 — M5 이전)
  select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'core_private')
       + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private')
    into v_cnt;
  insert into s2_results(grp,test,pass,detail) values
    ('M1','core_private 객체 0(외부 wrapper·View 생성 0)', v_cnt = 0, 'objects='||v_cnt);
end $$;

-- =============================================================================
-- PHASE: forward — M13 카탈로그 assertion (§20.3 「M13 적용 직후」 + T-M13-14)
-- =============================================================================
do $$
declare
  v_cnt int;
  v_acl aclitem[];
  v_bad int;
begin
  if current_setting('s2_verify.phase') <> 'forward' then return; end if;

  -- M13-1: comments.author_label — default '쌤버십 사용자'·NOT NULL 유지
  select count(*) into v_cnt from information_schema.columns
   where table_schema = 'public' and table_name = 'comments' and column_name = 'author_label'
     and data_type = 'text' and is_nullable = 'NO' and column_default = '''쌤버십 사용자''::text';
  insert into s2_results(grp,test,pass,detail) values
    ('M13','author_label default 쌤버십 사용자·NOT NULL', v_cnt = 1, 'matched='||v_cnt);

  -- M13-2: comments.author_role — text NULL (신규 정확히 1개)
  select count(*) into v_cnt from information_schema.columns
   where table_schema = 'public' and table_name = 'comments' and column_name = 'author_role'
     and data_type = 'text' and is_nullable = 'YES';
  insert into s2_results(grp,test,pass,detail) values
    ('M13','author_role text NULL 존재', v_cnt = 1, 'matched='||v_cnt);

  -- M13-3: community_comments.author_label — baseline default 불변(016 — M13 은 정정하지 않음)
  select count(*) into v_cnt from information_schema.columns
   where table_schema = 'public' and table_name = 'community_comments' and column_name = 'author_label'
     and data_type = 'text' and is_nullable = 'NO' and column_default = '''쌤버십 회원''::text';
  insert into s2_results(grp,test,pass,detail) values
    ('M13','community_comments.author_label 불변(선재 default 유지)', v_cnt = 1, 'matched='||v_cnt);

  -- T-M13-14a: 함수 2종 — SECDEF + 고정 search_path=''
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('comments_set_author_label','community_comments_set_author_label')
     and p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""';
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-14','a 함수 2종 SECDEF + search_path=''''', v_cnt = 2, 'matched='||v_cnt);

  -- T-M13-14b: 함수 2종 — PUBLIC·anon·authenticated·service_role EXECUTE 0
  select count(*) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname = 'public'
     and p.proname in ('comments_set_author_label','community_comments_set_author_label')
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0
          or a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated','service_role')));
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-14','b 함수 2종 PUBLIC/외부 role EXECUTE 0', v_bad = 0, 'bad_grants='||v_bad);

  -- M13-4: 트리거 역할 4종 — 정확한 이벤트·컬럼·WHEN
  select count(*) into v_cnt from pg_trigger t
   where t.tgrelid = 'public.comments'::regclass and t.tgname = 'trg_comments_set_author_label_ins'
     and pg_get_triggerdef(t.oid) like '%BEFORE INSERT ON public.comments%';
  insert into s2_results(grp,test,pass,detail) values
    ('M13','트리거① canonical BEFORE INSERT', v_cnt = 1, 'matched='||v_cnt);

  select count(*) into v_cnt from pg_trigger t
   where t.tgrelid = 'public.comments'::regclass and t.tgname = 'trg_comments_set_author_label_upd'
     and pg_get_triggerdef(t.oid) like '%BEFORE UPDATE OF author_label, author_role ON public.comments%';
  insert into s2_results(grp,test,pass,detail) values
    ('M13','트리거② canonical UPDATE OF author_label,author_role', v_cnt = 1, 'matched='||v_cnt);

  select count(*) into v_cnt from pg_trigger t
   where t.tgrelid = 'public.community_comments'::regclass and t.tgname = 'trg_community_comments_set_author_label_ins'
     and pg_get_triggerdef(t.oid) like '%BEFORE INSERT ON public.community_comments%'
     and pg_get_triggerdef(t.oid) like '%post_type%board%';
  insert into s2_results(grp,test,pass,detail) values
    ('M13','트리거③ legacy board BEFORE INSERT(WHEN board)', v_cnt = 1, 'matched='||v_cnt);

  select count(*) into v_cnt from pg_trigger t
   where t.tgrelid = 'public.community_comments'::regclass and t.tgname = 'trg_community_comments_set_author_label_upd'
     and pg_get_triggerdef(t.oid) like '%BEFORE UPDATE OF author_label ON public.community_comments%'
     and pg_get_triggerdef(t.oid) like '%post_type%board%';
  insert into s2_results(grp,test,pass,detail) values
    ('M13','트리거④ legacy board UPDATE OF author_label(WHEN board)', v_cnt = 1, 'matched='||v_cnt);

  -- M13-5: 163/164 브리지 본문 불변의 구조 증거 — 함수·트리거 존속
  select count(*) into v_cnt from pg_trigger where not tgisinternal and tgname in
    ('trg_comments_write_guard','trg_comments_mirror_to_legacy','trg_comments_mirror_delete',
     'trg_cc_write_guard','trg_cc_sync_board_to_canonical','trg_cc_sync_board_delete');
  insert into s2_results(grp,test,pass,detail) values
    ('M13','163/164 브리지 트리거 6종 존속', v_cnt = 6, 'count='||v_cnt);
end $$;

-- =============================================================================
-- PHASE: forward — T-M13-02~13 행동 검증 (fixture — 본 트랜잭션에서 rollback)
-- =============================================================================
do $$
declare
  v_phase text := current_setting('s2_verify.phase');
  u_student uuid := gen_random_uuid();
  u_mentor  uuid := gen_random_uuid();
  u_admin   uuid := gen_random_uuid();
  u_blank   uuid := gen_random_uuid();
  u_nulln   uuid := gen_random_uuid();
  u_ghost   uuid := gen_random_uuid();  -- auth.users 만 존재(public.users 부재)
  p_post    uuid;
  v_id      uuid;
  v_id2     uuid;
  v_label   text;
  v_role    text;
  v_cnt     int;
  v_err     text;
begin
  if v_phase <> 'forward' then return; end if;

  -- fixture 사용자 (마커: s2b-…@example.invalid)
  -- auth.users INSERT 는 on_auth_user_created 가 public.users 행을 자동 생성한다(001 실측)
  -- → public.users 는 UPDATE 로 fixture 속성을 부여한다.
  insert into auth.users (id, email) values
    (u_student, 's2b-student@example.invalid'),
    (u_mentor , 's2b-mentor@example.invalid'),
    (u_admin  , 's2b-admin@example.invalid'),
    (u_blank  , 's2b-blank@example.invalid'),
    (u_nulln  , 's2b-nulln@example.invalid'),
    (u_ghost  , 's2b-ghost@example.invalid');
  update public.users set role='student', full_name='s2b PII 학생', nickname='검증학생닉', email='s2b-student@example.invalid' where id = u_student;
  update public.users set role='mentor' , full_name='s2b PII 멘토', nickname='검증멘토닉', email='s2b-mentor@example.invalid' where id = u_mentor;
  update public.users set role='admin'  , full_name='s2b PII 관리자', nickname='검증관리자닉', email='s2b-admin@example.invalid' where id = u_admin;
  update public.users set role='student', full_name='s2b PII 공백', nickname='   ', email='s2b-blank@example.invalid' where id = u_blank;
  update public.users set role='student', full_name='s2b PII 널', nickname=null, email='s2b-nulln@example.invalid' where id = u_nulln;
  -- 사용자 행 부재 케이스: 자동 생성된 public.users 행 제거(auth.users 만 존재)
  delete from public.users where id = u_ghost;
  insert into s2_fx values ('u_student', u_student), ('u_mentor', u_mentor), ('u_admin', u_admin);

  insert into public.community_posts (author_id, title, content, category, status)
  values (u_student, 's2b fixture post', 's2b fixture body content', 'free', 'published')
  returning id into p_post;
  insert into s2_fx values ('p_post', p_post);

  -- T-M13-02: spoof 라벨·역할 INSERT(authenticated 클라이언트 경로) → 서버 덮어쓰기
  perform set_config('request.jwt.claims', json_build_object('sub', u_student, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.comments (post_id, author_id, content, author_label, author_role)
  values (p_post, u_student, 's2b spoof insert', '해킹라벨', 'admin')
  returning id, author_label, author_role into v_id, v_label, v_role;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-02','comments spoof INSERT 서버 덮어쓰기', v_label = '검증학생닉' and v_role = 'student',
     'label='||v_label||' role='||coalesce(v_role,'<null>'));
  insert into s2_fx values ('c_student', v_id);

  -- T-M13-03: student/mentor 역할 snapshot
  insert into public.comments (post_id, author_id, content)
  values (p_post, u_mentor, 's2b mentor comment')
  returning id, author_label, author_role into v_id, v_label, v_role;
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-03','student·mentor 역할 snapshot', v_role = 'mentor' and v_label = '검증멘토닉',
     'label='||v_label||' role='||coalesce(v_role,'<null>'));

  -- T-M13-04: admin → author_role NULL(라벨은 nickname 사용)
  insert into public.comments (post_id, author_id, content, author_role)
  values (p_post, u_admin, 's2b admin comment', 'admin')
  returning author_label, author_role into v_label, v_role;
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-04','admin 역할 NULL(신원 비노출)', v_role is null and v_label = '검증관리자닉',
     'label='||v_label||' role='||coalesce(v_role,'<null>'));

  -- T-M13-05: blank·NULL nickname → 정확히 '쌤버십 사용자' / 사용자 부재(legacy 경로)
  insert into public.comments (post_id, author_id, content) values (p_post, u_blank, 's2b blank nick')
  returning author_label into v_label;
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-05','a blank nickname fallback', v_label = '쌤버십 사용자', 'label='||v_label);
  insert into public.comments (post_id, author_id, content) values (p_post, u_nulln, 's2b null nick')
  returning author_label into v_label;
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-05','b NULL nickname fallback', v_label = '쌤버십 사용자', 'label='||v_label);
  -- public.users 부재(comments 는 FK 로 불가 — 계약 §21.7 허용 방식: legacy 안전 fixture 로 확인).
  -- 브리지는 comments FK(public.users) 때문에 ghost 행을 canonical 로 승격할 수 없으므로
  -- 163/164 자체의 재귀 방지 GUC 로 브리지만 억제한다 — M13 라벨 트리거는 GUC 와 무관하게 발화.
  perform set_config('app.comment_sync', '1', true);
  insert into public.community_comments (post_type, post_id, author_id, body, author_label)
  values ('board', p_post, u_ghost, 's2b ghost user comment', '고스트해킹라벨')
  returning author_label into v_label;
  perform set_config('app.comment_sync', '0', true);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-05','c 사용자 행 부재 fallback(legacy board)', v_label = '쌤버십 사용자', 'label='||v_label);

  -- T-M13-06: legacy board spoof INSERT 덮어쓰기 + shortform 트리거 미발화
  perform set_config('request.jwt.claims', json_build_object('sub', u_student, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.community_comments (post_type, post_id, author_id, body, author_label)
  values ('board', p_post, u_student, 's2b legacy spoof', '레거시해킹라벨')
  returning id, author_label into v_id, v_label;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-06','a legacy board spoof INSERT 덮어쓰기', v_label = '검증학생닉', 'label='||v_label);
  insert into s2_fx values ('cc_board', v_id);

  insert into public.community_comments (post_type, post_id, author_id, body, author_label)
  values ('shortform', p_post, u_student, 's2b shortform comment', '숏폼클라이언트라벨')
  returning id, author_label into v_id2, v_label;
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-06','b shortform 트리거 미발화(클라이언트 라벨 유지)', v_label = '숏폼클라이언트라벨', 'label='||v_label);
  insert into s2_fx values ('cc_short', v_id2);

  -- T-M13-07: legacy → canonical 브리지 라벨 동일
  select c.author_label into v_label
    from public.community_comments cc join public.comments c on c.id = cc.canonical_comment_id
   where cc.id = (select v from s2_fx where k = 'cc_board');
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-07','legacy→canonical 라벨 동일(서버 규칙값)', v_label = '검증학생닉', 'canonical label='||coalesce(v_label,'<missing>'));

  -- T-M13-08: canonical → legacy 브리지 라벨 동일
  select cc.author_label into v_label
    from public.comments c join public.community_comments cc on cc.canonical_comment_id = c.id
   where c.id = (select v from s2_fx where k = 'c_student');
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-08','canonical→legacy 라벨 동일(서버 규칙값)', v_label = '검증학생닉', 'legacy label='||coalesce(v_label,'<missing>'));

  -- T-M13-09: canonical label/role UPDATE 변조 → 명시적 거부(성공 no-op 위장 금지)
  begin
    update public.comments set author_label = '변조라벨' where id = (select v from s2_fx where k = 'c_student');
    insert into s2_results(grp,test,pass,detail) values
      ('T-M13-09','a author_label UPDATE 명시 거부', false, '오류 없이 성공(위반)');
  exception when others then
    v_err := sqlerrm;
    insert into s2_results(grp,test,pass,detail) values
      ('T-M13-09','a author_label UPDATE 명시 거부', v_err like '%COMMENT_PROTECTED_FIELDS_IMMUTABLE%', 'err='||v_err);
  end;
  begin
    update public.comments set author_role = 'mentor' where id = (select v from s2_fx where k = 'c_student');
    insert into s2_results(grp,test,pass,detail) values
      ('T-M13-09','b author_role UPDATE 명시 거부', false, '오류 없이 성공(위반)');
  exception when others then
    v_err := sqlerrm;
    insert into s2_results(grp,test,pass,detail) values
      ('T-M13-09','b author_role UPDATE 명시 거부', v_err like '%COMMENT_PROTECTED_FIELDS_IMMUTABLE%', 'err='||v_err);
  end;

  -- T-M13-10: legacy board label UPDATE 거부 + shortform label UPDATE 는 미발화(허용)
  begin
    update public.community_comments set author_label = '변조라벨'
     where id = (select v from s2_fx where k = 'cc_board');
    insert into s2_results(grp,test,pass,detail) values
      ('T-M13-10','a legacy board label UPDATE 명시 거부', false, '오류 없이 성공(위반)');
  exception when others then
    v_err := sqlerrm;
    insert into s2_results(grp,test,pass,detail) values
      ('T-M13-10','a legacy board label UPDATE 명시 거부', v_err like '%CC_PROTECTED_FIELDS_IMMUTABLE%', 'err='||v_err);
  end;
  update public.community_comments set author_label = '숏폼라벨수정'
   where id = (select v from s2_fx where k = 'cc_short');
  select author_label into v_label from public.community_comments where id = (select v from s2_fx where k = 'cc_short');
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-10','b shortform label UPDATE 미발화(board 한정 증명)', v_label = '숏폼라벨수정', 'label='||v_label);

  -- T-M13-11: body/content/status/is_deleted 브리지 동기화 회귀 없음
  update public.comments set content = 's2b content edited'
   where id = (select v from s2_fx where k = 'c_student');
  select cc.body into v_label from public.community_comments cc
   where cc.canonical_comment_id = (select v from s2_fx where k = 'c_student');
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-11','a canonical content → legacy body 동기화', v_label = 's2b content edited', 'body='||coalesce(v_label,'<missing>'));

  update public.community_comments set body = 's2b body edited', status = 'hidden'
   where id = (select v from s2_fx where k = 'cc_board');
  select c.content, c.is_deleted::text into v_label, v_err from public.comments c
   where c.id = (select cc.canonical_comment_id from public.community_comments cc
                  where cc.id = (select v from s2_fx where k = 'cc_board'));
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-11','b legacy body/status → canonical content/is_deleted 동기화',
     v_label = 's2b body edited' and v_err = 'true', 'content='||coalesce(v_label,'<missing>')||' is_deleted='||coalesce(v_err,'<missing>'));

  -- T-M13-12/13 상시 assertion: 전행 정규화 규칙 일치(백필 완료 상태) + shortform 규칙 비적용
  select count(*) into v_cnt
    from public.comments c
    left join public.users u on u.id = c.author_id
   where c.author_label is distinct from
         (case when u.nickname is null or btrim(u.nickname) = '' then '쌤버십 사용자' else u.nickname end)
      or c.author_role is distinct from
         (case when u.role in ('student','mentor') then u.role else null end);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-12','comments 전행 라벨·역할 정규화 일치(fixture 포함)', v_cnt = 0, 'deviating='||v_cnt);

  select count(*) into v_cnt
    from public.community_comments cc
    left join public.users u on u.id = cc.author_id
   where cc.post_type = 'board'
     and cc.author_label is distinct from
         (case when u.nickname is null or btrim(u.nickname) = '' then '쌤버십 사용자' else u.nickname end);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-13','community_comments board 전행 라벨 정규화 일치', v_cnt = 0, 'deviating='||v_cnt);
end $$;

-- =============================================================================
-- PHASE: forward — M4 V1~V5 필드·타입·옵션·필터·GRANT + PII + DML 0 (§6·§10.2)
-- =============================================================================
do $$
declare
  v_cnt int;
  v_def text;
  v_opts text;
  r record;
  v_expected text;
begin
  if current_setting('s2_verify.phase') <> 'forward' then return; end if;

  -- M4-0: api_web_v1 객체는 정확히 view 5종(V6·V7·함수·테이블 0)
  select count(*) into v_cnt from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'api_web_v1';
  insert into s2_results(grp,test,pass,detail) values
    ('M4','api_web_v1 relation 정확히 5(view 만)', v_cnt = 5, 'relations='||v_cnt);
  select count(*) into v_cnt from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'api_web_v1' and c.relkind <> 'v';
  insert into s2_results(grp,test,pass,detail) values
    ('M4','api_web_v1 비-view relation 0', v_cnt = 0, 'nonview='||v_cnt);
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_web_v1';
  insert into s2_results(grp,test,pass,detail) values
    ('M4','api_web_v1 함수 0(V6·V7 생성 금지)', v_cnt = 0, 'procs='||v_cnt);

  -- M4-1: V1~V5 필드명·타입·순서 (계약 §6 원문)
  for r in
    select * from (values
      ('community_posts_v1',
       'id:uuid,author_id:uuid,title:text,body:text,category:text,image_refs:text[],author_label:text,author_role:text,like_count:integer,comment_count:integer,view_count:integer,status:text,created_at:timestamp with time zone,updated_at:timestamp with time zone'),
      ('community_comments_v1',
       'id:uuid,post_id:uuid,author_id:uuid,parent_id:uuid,body:text,like_count:integer,author_label:text,author_role:text,created_at:timestamp with time zone'),
      ('mentor_directory_v1',
       'mentor_id:uuid,nickname:text,university_name:text,department_name:text,teaching_subjects:text[],intro_line:text,profile_image_url:text,high_school_name:text,school_verified:boolean,school_tier:text,verified_major_category:text,verified_university_name:text,verified_department_name:text,is_open_for_subscriptions:boolean,avg_rating:numeric,review_count:integer,created_at:timestamp with time zone'),
      ('my_wallet_v1', 'user_id:uuid,balance_cents:bigint,balance_krw:bigint'),
      ('my_cash_ledger_v1',
       'id:uuid,delta_cents:bigint,delta_krw:bigint,reason:text,ref_type:text,ref_id:uuid,order_ref:text,created_at:timestamp with time zone')
    ) as t(vname, expected)
  loop
    select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' order by a.attnum)
      into v_def
      from pg_attribute a
     where a.attrelid = ('api_web_v1.' || r.vname)::regclass and a.attnum > 0 and not a.attisdropped;
    insert into s2_results(grp,test,pass,detail) values
      ('M4', r.vname || ' 필드·타입·순서', v_def = r.expected,
       case when v_def = r.expected then null else 'actual=' || v_def end);
  end loop;

  -- M4-2: security_invoker 옵션 — V1·V2·V4·V5 true / V3 false(의도적 예외)
  for r in
    select c.relname, coalesce(array_to_string(c.reloptions, ','), '') as opts
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'api_web_v1'
  loop
    v_expected := case when r.relname = 'mentor_directory_v1'
                       then 'security_invoker=false' else 'security_invoker=true' end;
    insert into s2_results(grp,test,pass,detail) values
      ('M4', r.relname || ' ' || v_expected, r.opts = v_expected, 'opts='||r.opts);
  end loop;

  -- M4-3: 필터·규칙 (뷰 정의 텍스트)
  select pg_get_viewdef('api_web_v1.community_posts_v1'::regclass) into v_def;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V1 규칙: coalesce(content,body)+coalesce(image_urls)+deleted_at+published/본인',
     v_def like '%COALESCE(content, body)%' and v_def like '%COALESCE(image_urls%'
     and v_def like '%deleted_at IS NULL%' and v_def like '%''published''%' and v_def like '%auth.uid()%', null);

  select pg_get_viewdef('api_web_v1.community_comments_v1'::regclass) into v_def;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V2 규칙: 원천 comments 만 + body=content + is_deleted=false + M13 정본 컬럼',
     v_def like '%FROM comments c%' and v_def not like '%community_comments%'
     and v_def like '%content AS body%' and v_def like '%is_deleted = false%'
     and v_def like '%author_label%' and v_def like '%author_role%', null);

  select pg_get_viewdef('api_web_v1.mentor_directory_v1'::regclass) into v_def;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V3 규칙: mentor+active+승인판정식+최신 승인 검증 정렬+hidden/blinded 제외',
     v_def like '%''mentor''%' and v_def like '%''active''%'
     and v_def like '%''approved''%' and v_def like '%''verified''%'
     and v_def like '%COALESCE(msv.reviewed_at, msv.updated_at, msv.created_at) DESC%'
     and v_def like '%is_hidden%' and v_def like '%is_blinded%', null);
  -- V3 PII 0: full_name·email·birth_date·grade_level 참조 없음
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V3 PII 비노출(full_name·email·birth_date·grade_level 참조 0)',
     v_def not like '%full_name%' and v_def not like '%email%'
     and v_def not like '%birth_date%' and v_def not like '%grade_level%', null);

  select pg_get_viewdef('api_web_v1.my_wallet_v1'::regclass) into v_def;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V4 규칙: balance_krw = balance_cents/100',
     v_def like '%balance_cents / 100%', null);

  select pg_get_viewdef('api_web_v1.my_cash_ledger_v1'::regclass) into v_def;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V5 규칙: order_ref = topup 한정 idempotency_key(전면 노출 컬럼 없음)',
     v_def like '%''topup''%' and v_def like '%idempotency_key%'
     and v_def like '%delta_cents / 100%', null);

  -- M4-4: GRANT — V1·V2·V3 SELECT(anon·authenticated·service_role) / V4·V5 anon 0
  for r in
    select * from (values
      ('community_posts_v1',    true ), ('community_comments_v1', true ),
      ('mentor_directory_v1',   true ), ('my_wallet_v1',          false),
      ('my_cash_ledger_v1',     false)
    ) as t(vname, anon_ok)
  loop
    insert into s2_results(grp,test,pass,detail) values
      ('M4', r.vname || ' SELECT GRANT(anon=' || r.anon_ok || ')',
       has_table_privilege('anon', 'api_web_v1.' || r.vname, 'SELECT') = r.anon_ok
       and has_table_privilege('authenticated', 'api_web_v1.' || r.vname, 'SELECT')
       and has_table_privilege('service_role', 'api_web_v1.' || r.vname, 'SELECT'), null);
    -- DML·부속 권한 0 (모든 외부 role + PUBLIC)
    insert into s2_results(grp,test,pass,detail) values
      ('M4', r.vname || ' DML/TRUNCATE/REFERENCES/TRIGGER 0',
       not has_table_privilege('anon', 'api_web_v1.' || r.vname, 'INSERT')
       and not has_table_privilege('anon', 'api_web_v1.' || r.vname, 'UPDATE')
       and not has_table_privilege('anon', 'api_web_v1.' || r.vname, 'DELETE')
       and not has_table_privilege('anon', 'api_web_v1.' || r.vname, 'TRUNCATE')
       and not has_table_privilege('anon', 'api_web_v1.' || r.vname, 'REFERENCES')
       and not has_table_privilege('anon', 'api_web_v1.' || r.vname, 'TRIGGER')
       and not has_table_privilege('authenticated', 'api_web_v1.' || r.vname, 'INSERT')
       and not has_table_privilege('authenticated', 'api_web_v1.' || r.vname, 'UPDATE')
       and not has_table_privilege('authenticated', 'api_web_v1.' || r.vname, 'DELETE')
       and not has_table_privilege('authenticated', 'api_web_v1.' || r.vname, 'TRUNCATE')
       and not has_table_privilege('authenticated', 'api_web_v1.' || r.vname, 'REFERENCES')
       and not has_table_privilege('authenticated', 'api_web_v1.' || r.vname, 'TRIGGER')
       and not has_table_privilege('service_role', 'api_web_v1.' || r.vname, 'INSERT')
       and not has_table_privilege('service_role', 'api_web_v1.' || r.vname, 'UPDATE')
       and not has_table_privilege('service_role', 'api_web_v1.' || r.vname, 'DELETE')
       and not has_table_privilege('service_role', 'api_web_v1.' || r.vname, 'TRUNCATE')
       and not has_table_privilege('service_role', 'api_web_v1.' || r.vname, 'REFERENCES')
       and not has_table_privilege('service_role', 'api_web_v1.' || r.vname, 'TRIGGER'), null);
    -- PUBLIC(grantee=0) 권한 0
    select count(*) into v_cnt
      from pg_class c join pg_namespace n on n.oid = c.relnamespace,
           aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
     where n.nspname = 'api_web_v1' and c.relname = r.vname and a.grantee = 0;
    insert into s2_results(grp,test,pass,detail) values
      ('M4', r.vname || ' PUBLIC 권한 0', v_cnt = 0, 'public_grants='||v_cnt);
  end loop;
end $$;

-- =============================================================================
-- PHASE: forward — M4 행동 검증 (invoker RLS·SECDEF 예외·잔액 환산 — fixture rollback)
-- =============================================================================
do $$
declare
  v_phase text := current_setting('s2_verify.phase');
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  u_c uuid := gen_random_uuid();
  u_m1 uuid := gen_random_uuid();   -- 승인·활성 멘토
  u_m2 uuid := gen_random_uuid();   -- pending 멘토(비노출)
  u_m3 uuid := gen_random_uuid();   -- 승인·banned 멘토(비노출)
  p_pub uuid; p_draft uuid; p_del uuid;
  v_cnt int; v_cnt2 int;
  v_krw bigint; v_ref text;
  v_num numeric;
begin
  if v_phase <> 'forward' then return; end if;

  -- 직전 블록의 트랜잭션 로컬 JWT claims 잔여 제거(119 role guard 의 JWT-null 분기 사용)
  perform set_config('request.jwt.claims', '', true);

  -- auth.users INSERT 가 public.users 를 자동 생성 → UPDATE 로 속성 부여(001 실측)
  insert into auth.users (id, email) values
    (u_a, 's2b-va@example.invalid'), (u_b, 's2b-vb@example.invalid'),
    (u_c, 's2b-vc@example.invalid'),
    (u_m1, 's2b-vm1@example.invalid'), (u_m2, 's2b-vm2@example.invalid'),
    (u_m3, 's2b-vm3@example.invalid');
  update public.users set role='student', full_name='s2b PII A', nickname='뷰학생A', email='s2b-va@example.invalid', status='active' where id = u_a;
  update public.users set role='student', full_name='s2b PII B', nickname='뷰학생B', email='s2b-vb@example.invalid', status='active' where id = u_b;
  update public.users set role='mentor', full_name='s2b PII M1', nickname='뷰멘토1', email='s2b-vm1@example.invalid', status='active' where id = u_m1;
  update public.users set role='mentor', full_name='s2b PII M2', nickname='뷰멘토2', email='s2b-vm2@example.invalid', status='active' where id = u_m2;
  update public.users set role='mentor', full_name='s2b PII M3', nickname='뷰멘토3', email='s2b-vm3@example.invalid', status='banned' where id = u_m3;

  -- V1 fixture: published / draft(본인) / soft-deleted
  insert into public.community_posts (author_id, title, content, category, status)
  values (u_a, 's2b v1 published', 's2b published body', 'free', 'published') returning id into p_pub;
  insert into public.community_posts (author_id, title, content, category, status)
  values (u_a, 's2b v1 draft', 's2b draft body', 'free', 'draft') returning id into p_draft;
  insert into public.community_posts (author_id, title, content, category, status, deleted_at)
  values (u_a, 's2b v1 deleted', 's2b deleted body', 'free', 'published', now()) returning id into p_del;

  -- V2 fixture: 정상 + soft-deleted 댓글
  insert into public.comments (post_id, author_id, content) values (p_pub, u_a, 's2b v2 visible comment');
  insert into public.comments (post_id, author_id, content, is_deleted) values (p_pub, u_a, 's2b v2 deleted comment', true);

  -- V3 fixture: 멘토 3종 + 학교 검증 2건(구승인·신승인) + 리뷰(정상 5·hidden 1·blinded 1)
  insert into public.mentor_profiles (user_id, university_name, department_name, high_school_name, verification_status, is_open_for_subscriptions)
  values (u_m1, 's2b대', 's2b과', 's2b고', 'approved', true),
         (u_m2, 's2b대', 's2b과', 's2b고', 'pending', true),
         (u_m3, 's2b대', 's2b과', 's2b고', 'approved', true);
  insert into public.mentor_school_verifications (mentor_id, status, verified_university_name, verified_department_name, verified_major_category, school_tier, reviewed_at)
  -- uq_msv_one_approved_per_mentor(실측): approved 는 멘토당 1건 — 구승인은 superseded 로 두고
  -- approved 1건 + 비승인 2건 사이에서 approved 만 선택되는지 검증한다.
  values (u_m1, 'superseded', '구승인대', '구승인과', '인문', '그외', now() - interval '10 days'),
         (u_m1, 'approved', '신승인대', '신승인과', '자연', '서연고', now() - interval '1 day'),
         (u_m1, 'pending' , '미승인대', '미승인과', '공학', '미분류', now());
  insert into public.reviews (mentor_id, author_id, rating, body) values (u_m1, u_a, 5, 's2b review ok');
  insert into public.reviews (mentor_id, author_id, rating, body, is_hidden) values (u_m1, u_b, 1, 's2b review hidden', true);
  insert into public.reviews (mentor_id, author_id, rating, body, is_blinded) values (u_m1, u_c, 1, 's2b review blinded', true);

  -- V4/V5 fixture
  insert into public.cash_wallets (user_id, balance_cents) values (u_a, 1234500), (u_b, 500);
  insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, idempotency_key)
  values (u_a, 1234500, 's2b topup', 'topup', 's2b_order_20260730_0001');
  insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, idempotency_key)
  values (u_a, -84900, 's2b debit', 'subscription', 's2b_sub_debit_0001');

  -- V1 행동: anon 은 published 만, 본인(authenticated)은 draft 포함, deleted 0
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into v_cnt from api_web_v1.community_posts_v1 where title like 's2b v1%';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt2 from api_web_v1.community_posts_v1 where title like 's2b v1%';
  reset role;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V1 행동: anon=published 1·author=+draft 2·deleted 0', v_cnt = 1 and v_cnt2 = 2,
     'anon='||v_cnt||' author='||v_cnt2);

  -- V2 행동: is_deleted 숨김 (anon)
  set local role anon;
  select count(*) into v_cnt from api_web_v1.community_comments_v1 where body like 's2b v2%comment';
  reset role;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V2 행동: is_deleted=false 만 노출', v_cnt = 1, 'visible='||v_cnt);

  -- V3 행동(SECDEF 예외): anon 이 승인·활성 멘토만 조회, 최신 승인 검증·hidden/blinded 제외
  set local role anon;
  select count(*) into v_cnt from api_web_v1.mentor_directory_v1 where mentor_id in (u_m1, u_m2, u_m3);
  select verified_university_name into v_ref from api_web_v1.mentor_directory_v1 where mentor_id = u_m1;
  select avg_rating, review_count into v_num, v_cnt2 from api_web_v1.mentor_directory_v1 where mentor_id = u_m1;
  reset role;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V3 행동: 승인·활성만(u_m1) — pending·banned 제외', v_cnt = 1, 'visible='||v_cnt);
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V3 행동: 최신 승인 학교 검증 선택', v_ref = '신승인대', 'verified_university='||coalesce(v_ref,'<null>'));
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V3 행동: hidden/blinded 리뷰 제외(avg=5·count=1)', v_num = 5 and v_cnt2 = 1,
     'avg='||coalesce(v_num::text,'<null>')||' count='||coalesce(v_cnt2::text,'<null>'));

  -- V4 행동: invoker — 본인 행만 + balance_krw 환산
  perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*), max(balance_krw) into v_cnt, v_krw from api_web_v1.my_wallet_v1;
  reset role;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V4 행동: 본인 지갑만 + balance_krw=balance_cents/100', v_cnt = 1 and v_krw = 12345,
     'rows='||v_cnt||' krw='||coalesce(v_krw::text,'<null>'));

  -- V5 행동: 본인 원장만 + order_ref 는 topup 행만
  perform set_config('request.jwt.claims', json_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_cnt from api_web_v1.my_cash_ledger_v1 where reason like 's2b%';
  select count(*) into v_cnt2 from api_web_v1.my_cash_ledger_v1 where reason like 's2b%' and order_ref is not null;
  select order_ref into v_ref from api_web_v1.my_cash_ledger_v1 where reason = 's2b topup';
  reset role;
  insert into s2_results(grp,test,pass,detail) values
    ('M4','V5 행동: 본인 원장 2행 + order_ref=topup 행만', v_cnt = 2 and v_cnt2 = 1 and v_ref = 's2b_order_20260730_0001',
     'rows='||v_cnt||' with_ref='||v_cnt2||' ref='||coalesce(v_ref,'<null>'));

  -- V4/V5 권한 행동: anon SELECT 거부(permission denied)
  begin
    set local role anon;
    perform count(*) from api_web_v1.my_wallet_v1;
    reset role;
    insert into s2_results(grp,test,pass,detail) values
      ('M4','V4 anon SELECT 거부', false, '오류 없이 성공(위반)');
  exception when insufficient_privilege then
    reset role;
    insert into s2_results(grp,test,pass,detail) values
      ('M4','V4 anon SELECT 거부', true, 'permission denied');
  end;
  begin
    set local role anon;
    perform count(*) from api_web_v1.my_cash_ledger_v1;
    reset role;
    insert into s2_results(grp,test,pass,detail) values
      ('M4','V5 anon SELECT 거부', false, '오류 없이 성공(위반)');
  exception when insufficient_privilege then
    reset role;
    insert into s2_results(grp,test,pass,detail) values
      ('M4','V5 anon SELECT 거부', true, 'permission denied');
  end;
end $$;

-- =============================================================================
-- PHASE: rollback — T-M13-15·16 + 스키마·객체 부재 + 브리지 보존 (§22 #8)
-- =============================================================================
do $$
declare
  v_cnt int;
begin
  if current_setting('s2_verify.phase') <> 'rollback' then return; end if;

  -- T-M13-15a: 선재 author_label 컬럼 보존 + default '쌤버십 회원' 복원
  select count(*) into v_cnt from information_schema.columns
   where table_schema = 'public' and table_name = 'comments' and column_name = 'author_label'
     and data_type = 'text' and is_nullable = 'NO' and column_default = '''쌤버십 회원''::text';
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-15','a author_label 보존 + default 복원', v_cnt = 1, 'matched='||v_cnt);

  -- T-M13-15b: author_role 제거
  select count(*) into v_cnt from information_schema.columns
   where table_schema = 'public' and table_name = 'comments' and column_name = 'author_role';
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-15','b author_role 제거', v_cnt = 0, 'found='||v_cnt);

  -- T-M13-15c: M13 트리거·함수 부재
  select count(*) into v_cnt from pg_trigger where not tgisinternal and tgname in
    ('trg_comments_set_author_label_ins','trg_comments_set_author_label_upd',
     'trg_community_comments_set_author_label_ins','trg_community_comments_set_author_label_upd');
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-15','c M13 트리거 4종 부재', v_cnt = 0, 'found='||v_cnt);
  select count(*) into v_cnt from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('comments_set_author_label','community_comments_set_author_label');
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-15','d M13 함수 2종 부재', v_cnt = 0, 'found='||v_cnt);

  -- T-M13-15e: community_comments.author_label 컬럼 보존(DROP 금지 확인)
  select count(*) into v_cnt from information_schema.columns
   where table_schema = 'public' and table_name = 'community_comments' and column_name = 'author_label'
     and data_type = 'text' and is_nullable = 'NO' and column_default = '''쌤버십 회원''::text';
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-15','e community_comments.author_label 보존', v_cnt = 1, 'matched='||v_cnt);

  -- T-M13-16: 정규화 라벨 유지(과거 클라이언트 라벨 미복원 — forward-only)
  select count(*) into v_cnt
    from public.comments c
    left join public.users u on u.id = c.author_id
   where c.author_label is distinct from
         (case when u.nickname is null or btrim(u.nickname) = '' then '쌤버십 사용자' else u.nickname end);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-16','a comments 정규화 라벨 유지', v_cnt = 0, 'deviating='||v_cnt);
  select count(*) into v_cnt
    from public.community_comments cc
    left join public.users u on u.id = cc.author_id
   where cc.post_type = 'board'
     and cc.author_label is distinct from
         (case when u.nickname is null or btrim(u.nickname) = '' then '쌤버십 사용자' else u.nickname end);
  insert into s2_results(grp,test,pass,detail) values
    ('T-M13-16','b legacy board 정규화 라벨 유지', v_cnt = 0, 'deviating='||v_cnt);

  -- RB-1: M1·M4 산출물 부재 + default acl 항목 부재
  select count(*) into v_cnt from pg_namespace where nspname in ('api_web_v1','core_private');
  insert into s2_results(grp,test,pass,detail) values
    ('RB','schema 2종 부재(M1 rollback)', v_cnt = 0, 'found='||v_cnt);
  select count(*) into v_cnt from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
   where n.nspname in ('api_web_v1','core_private');
  insert into s2_results(grp,test,pass,detail) values
    ('RB','default privilege 항목 부재', v_cnt = 0, 'found='||v_cnt);

  -- RB-2: 163/164 브리지 보존
  select count(*) into v_cnt from pg_trigger where not tgisinternal and tgname in
    ('trg_comments_write_guard','trg_comments_mirror_to_legacy','trg_comments_mirror_delete',
     'trg_cc_write_guard','trg_cc_sync_board_to_canonical','trg_cc_sync_board_delete');
  insert into s2_results(grp,test,pass,detail) values
    ('RB','163/164 브리지 트리거 6종 보존', v_cnt = 6, 'count='||v_cnt);
end $$;

-- -----------------------------------------------------------------------------
-- 결과 출력·판정
-- -----------------------------------------------------------------------------
select grp, test, case when pass then 'PASS' else 'FAIL' end as result, detail
  from s2_results order by seq;

select current_setting('s2_verify.phase') || ' phase: '
       || count(*) filter (where pass) || '/' || count(*) as passed
  from s2_results;

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
  raise notice 'S2_BATCH_B_VERIFY(%): ALL PASS', current_setting('s2_verify.phase');
end $$;

-- 모든 fixture DML 은 여기서 파기된다(잔여 0 보증).
rollback;

-- -----------------------------------------------------------------------------
-- fixture 잔여 0 확인 (트랜잭션 밖 일반 조회 — 모든 phase 공통)
-- -----------------------------------------------------------------------------
do $$
declare
  v_cnt bigint;
begin
  select count(*) into v_cnt from auth.users where email like 's2b-%@example.invalid';
  if v_cnt > 0 then
    raise exception 'S2_FIXTURE_RESIDUE: auth.users % rows remain', v_cnt;
  end if;
  select count(*) into v_cnt from public.users u where u.email like 's2b-%@example.invalid';
  if v_cnt > 0 then
    raise exception 'S2_FIXTURE_RESIDUE: public.users % rows remain', v_cnt;
  end if;
  select count(*) into v_cnt from public.community_posts where title like 's2b %';
  if v_cnt > 0 then
    raise exception 'S2_FIXTURE_RESIDUE: community_posts % rows remain', v_cnt;
  end if;
  raise notice 'S2_BATCH_B_VERIFY: fixture residue 0';
end $$;
