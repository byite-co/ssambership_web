-- db3_batch_pre_fixture.sql — DB-3 로컬 검증용 사전 fixture (오프라인 스크래치 PG 전용 · 운영 적용 금지).
-- 목적: DB-3 적용 **전**(= DB-1·DB-2 적용 후 — 운영 원장 실측 2026-09-03 과 같은 상태) 운영 형태를 재현하고,
--   §6 사전 실측값과 **현재 버그(게시판 댓글 본인 삭제 실패)** 를 찍는다.
--   · 관리자 1 (오너 지정 UUID 9bf48819-… 그대로) · 승인 멘토 M1(숏폼 작성자) · 학생 S1·S2 · 정지(banned) 학생 S3
--   · 게시판 글 P1(S1 · published) · P2(S2 · 관리자 숨김 hidden)
--   · 정본 댓글 C1(S1)·C3(S2)·C4(S3) on P1 → 레거시 미러 L1·L3·L4 · 레거시 댓글 L2(S2) on P1 → 정본 C2
--   · 숏폼 SF1(M1 · published) · SF2(M1 · hidden) · SF3(M1 작성 · creator S2) · SF4(M1 · 하드 DELETE 검증용)
--   · 숏폼 댓글 SC1(S1) · SC2(S2 · 관리자 숨김) · SC3(S2) on SF1
-- 이 파일은 데이터를 COMMIT 한다. 버그 재현 블록은 별도 트랜잭션에서 ROLLBACK 한다.
begin;
set local search_path to public;

create schema if not exists db3_check;
create table if not exists db3_check.snapshot (key text primary key, val text);

-- ── 사용자 (auth.users INSERT → handle_new_auth_user 가 public.users 를 만든다) ──
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, meta::jsonb, now(), now()
from (values
  ('9bf48819-1dd2-40dd-96a3-d64bcca2e60c'::uuid, 'db3-admin@test.local', '{"app_role":"student","full_name":"검증관리자"}'),
  ('00000000-0000-4000-8000-00000000d3a1'::uuid, 'db3-m1@test.local', '{"app_role":"mentor","full_name":"검증멘토일"}'),
  ('00000000-0000-4000-8000-00000000d3b1'::uuid, 'db3-s1@test.local', '{"app_role":"student","full_name":"검증학생일"}'),
  ('00000000-0000-4000-8000-00000000d3b2'::uuid, 'db3-s2@test.local', '{"app_role":"student","full_name":"검증학생이"}'),
  ('00000000-0000-4000-8000-00000000d3b3'::uuid, 'db3-s3@test.local', '{"app_role":"student","full_name":"검증학생삼"}')
) as v(id, email, meta);

update public.users set role = 'admin' where id = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c';
update public.users set status = 'banned' where id = '00000000-0000-4000-8000-00000000d3b3';

insert into public.mentor_profiles (user_id, university_name, department_name, high_school_name)
values ('00000000-0000-4000-8000-00000000d3a1', '서울대학교', '의예과', '검증고')
on conflict (user_id) do nothing;
update public.mentor_profiles set verification_status = 'approved' where user_id = '00000000-0000-4000-8000-00000000d3a1';

-- ── 커뮤니티 콘텐츠 ──
insert into public.community_posts (id, author_id, title, body, category, status, author_role) values
  ('00000000-0000-4000-8000-00000000d3c1', '00000000-0000-4000-8000-00000000d3b1', '검증 글 1', '검증용 게시판 글 본문입니다.', 'study', 'published', 'student'),
  ('00000000-0000-4000-8000-00000000d3c2', '00000000-0000-4000-8000-00000000d3b2', '검증 글 2(숨김)', '관리자가 숨긴 글입니다.', 'study', 'hidden', 'student');

insert into public.shortform_posts (id, author_id, title, body, category, video_url, status, author_role) values
  ('00000000-0000-4000-8000-00000000d3f1', '00000000-0000-4000-8000-00000000d3a1', '검증 숏폼 1', '숏폼 1', 'study', 'https://example.test/v1.mp4', 'published', 'mentor'),
  ('00000000-0000-4000-8000-00000000d3f2', '00000000-0000-4000-8000-00000000d3a1', '검증 숏폼 2(숨김)', '숏폼 2', 'study', 'https://example.test/v2.mp4', 'hidden', 'mentor'),
  ('00000000-0000-4000-8000-00000000d3f3', '00000000-0000-4000-8000-00000000d3a1', '검증 숏폼 3(creator S2)', '숏폼 3', 'study', 'https://example.test/v3.mp4', 'published', 'mentor'),
  ('00000000-0000-4000-8000-00000000d3f4', '00000000-0000-4000-8000-00000000d3a1', '검증 숏폼 4', '숏폼 4', 'study', 'https://example.test/v4.mp4', 'published', 'mentor');
update public.shortform_posts set creator_id = '00000000-0000-4000-8000-00000000d3b2' where id = '00000000-0000-4000-8000-00000000d3f3';

-- 정본 댓글 C1(S1) · C3(S2) · C4(S3 · banned) → 미러(163·164)가 레거시 행을 만든다
insert into public.comments (id, post_id, author_id, content) values
  ('00000000-0000-4000-8000-00000000d3e1', '00000000-0000-4000-8000-00000000d3c1', '00000000-0000-4000-8000-00000000d3b1', '정본 댓글 1'),
  ('00000000-0000-4000-8000-00000000d3e3', '00000000-0000-4000-8000-00000000d3c1', '00000000-0000-4000-8000-00000000d3b2', '정본 댓글 3'),
  ('00000000-0000-4000-8000-00000000d3e7', '00000000-0000-4000-8000-00000000d3c1', '00000000-0000-4000-8000-00000000d3b3', '정본 댓글 4(정지 계정)');
-- 레거시 댓글 L2(S2) → 브리지가 정본 C2 를 만든다
insert into public.community_comments (id, post_type, post_id, author_id, body)
values ('00000000-0000-4000-8000-00000000d3e2', 'board', '00000000-0000-4000-8000-00000000d3c1', '00000000-0000-4000-8000-00000000d3b2', '레거시 댓글 2');
-- 숏폼 댓글 SC1(S1) · SC2(S2 · 관리자 숨김) · SC3(S2)
insert into public.community_comments (id, post_type, post_id, author_id, body) values
  ('00000000-0000-4000-8000-00000000d3e4', 'shortform', '00000000-0000-4000-8000-00000000d3f1', '00000000-0000-4000-8000-00000000d3b1', '숏폼 댓글 1'),
  ('00000000-0000-4000-8000-00000000d3e5', 'shortform', '00000000-0000-4000-8000-00000000d3f1', '00000000-0000-4000-8000-00000000d3b2', '숏폼 댓글 2'),
  ('00000000-0000-4000-8000-00000000d3e6', 'shortform', '00000000-0000-4000-8000-00000000d3f1', '00000000-0000-4000-8000-00000000d3b2', '숏폼 댓글 3');
update public.community_comments set status = 'hidden' where id = '00000000-0000-4000-8000-00000000d3e5';

-- ── 사전 스냅샷 (rollback 복원 대조용 · DB-3 가 건드리지 않는 194 객체) ──
insert into db3_check.snapshot (key, val) values
  ('fn_cwg',         (select md5(pg_get_functiondef('public.comments_write_guard()'::regprocedure)))),
  ('fn_spg',         (select md5(pg_get_functiondef('public.shortform_posts_protected_guard()'::regprocedure)))),
  ('fn_self_del',    (select md5(pg_get_functiondef('public.community_comment_soft_delete_self(uuid)'::regprocedure)))),
  ('fn_sync_flag',   (select md5(pg_get_functiondef('public.comments_sync_deleted_flag()'::regprocedure)))),
  ('pol_c',          (select roles::text || '|' || qual from pg_policies where tablename = 'comments' and policyname = 'comments_select_visible')),
  ('rt_policies',    (select count(*)::text from pg_policies where schemaname = 'realtime' and tablename = 'messages')),
  ('trg_comments',   (select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.comments'::regclass and not tgisinternal)),
  ('trg_sf',         (select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.shortform_posts'::regclass and not tgisinternal)),
  ('trg_cc',         (select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.community_comments'::regclass and not tgisinternal)),
  ('log_count',      (select count(*)::text from public.admin_action_logs)),
  ('fn_count',       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'));

-- 전제 확인: DB-1·DB-2 적용 후 · DB-3 이전 상태여야 한다(운영 실측 2026-09-03 과 동일)
do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public'
       and ((table_name in ('shortform_posts', 'comments', 'community_comments') and column_name in ('deleted_at', 'deleted_by'))
         or (table_name = 'community_posts' and column_name in ('deleted_at', 'deleted_by')))) <> 8 then
    raise exception 'PRE: 194 deleted_at/deleted_by 8컬럼이 아니다';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_comments_sync_deleted_flag') then
    raise exception 'PRE: 194 동기화 트리거 부재';
  end if;
  if exists (select 1 from pg_proc where proname in ('soft_delete_own_content', 'ugc_block_hard_delete')) then
    raise exception 'PRE: DB-3 객체가 이미 있다';
  end if;
  if (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages') <> 0 then
    raise exception 'PRE: realtime.messages 정책이 0 이 아니다';
  end if;
  if (select comment_count from public.community_posts where id = '00000000-0000-4000-8000-00000000d3c1') <> 4 then
    raise exception 'PRE: P1 댓글 수 4 가 아니다(브리지 미동작)';
  end if;
  if (select count(*) from public.community_comments where post_type = 'board' and canonical_comment_id = '00000000-0000-4000-8000-00000000d3e1') <> 1
     or (select count(*) from public.comments where legacy_comment_id = '00000000-0000-4000-8000-00000000d3e2') <> 1 then
    raise exception 'PRE: 브리지 미러(L1·C2)가 없다';
  end if;
  if (select status from public.users where id = '00000000-0000-4000-8000-00000000d3b3') <> 'banned' then
    raise exception 'PRE: S3 banned 아님';
  end if;
end $$;

commit;

-- ── 현재 버그 재현 — 게시판 댓글 본인 삭제(웹 D-CM-6 경로: UPDATE is_deleted=true … RETURNING id) 는 RLS 가 거부한다 ──
-- 별도 트랜잭션 · ROLLBACK. 결과 문자열을 db3_check.snapshot 에 남긴다(post fixture 가 "해소" 를 대조).
begin;
set local search_path to public;
create or replace function pg_temp.as_user(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
end $$;
create or replace function pg_temp.try_rows(p_sql text) returns text language plpgsql as $$
declare n int;
begin
  execute p_sql; get diagnostics n = row_count; return 'ROWS=' || n;
exception when others then return left(sqlerrm, 80);
end $$;
create temp table pre_bug (key text, val text) on commit drop;
grant select, insert on pre_bug to authenticated;   -- 역할 전환 뒤에도 기록할 수 있게
set local role authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000d3b1'::uuid, 'authenticated');
insert into pre_bug select 'pre_bug_update_returning', pg_temp.try_rows($q$ update public.comments set is_deleted = true, content = '삭제된 댓글입니다.'
  where id = '00000000-0000-4000-8000-00000000d3e1' and author_id = '00000000-0000-4000-8000-00000000d3b1' returning id $q$);
insert into pre_bug select 'pre_bug_update_plain', pg_temp.try_rows($q$ update public.comments set is_deleted = true, content = '삭제된 댓글입니다.'
  where id = '00000000-0000-4000-8000-00000000d3e1' and author_id = '00000000-0000-4000-8000-00000000d3b1' $q$);
insert into pre_bug select 'pre_bug_update_deleted_at', pg_temp.try_rows($q$ update public.comments set deleted_at = now(), deleted_by = '00000000-0000-4000-8000-00000000d3b1'
  where id = '00000000-0000-4000-8000-00000000d3e1' and author_id = '00000000-0000-4000-8000-00000000d3b1' $q$);
reset role;
select pg_temp.as_user(null, null);
-- 어느 시도도 흔적을 남기지 않았어야 한다(try_rows 는 서브트랜잭션 — 실패 시 되돌린다)
do $$
begin
  if (select is_deleted or deleted_at is not null from public.comments where id = '00000000-0000-4000-8000-00000000d3e1') then
    raise exception 'PRE: 버그 재현 중 댓글이 바뀌었다';
  end if;
  if not exists (select 1 from pre_bug where key = 'pre_bug_update_returning' and val like 'new row violates row-level security policy%') then
    raise exception 'PRE: 웹 경로(UPDATE … RETURNING) 가 RLS 로 실패해야 한다: %', (select val from pre_bug where key = 'pre_bug_update_returning');
  end if;
end $$;
-- 스냅샷은 ROLLBACK 되지 않도록 dblink 없이 — 값을 NOTICE 로 찍고, post fixture 는 같은 문장을 다시 실행해 "해소" 를 확인한다
\pset tuples_only on
\pset format unaligned
select 'PRE bug ' || key || ' = ' || val from pre_bug order by key;
rollback;

-- ── §6 사전 실측 (tuples only) ──
select 'PRE snapshot ' || key || '=' || val from db3_check.snapshot order by key;
select 'PRE A fn soft_delete_own_content=' || exists (select 1 from pg_proc where proname = 'soft_delete_own_content')::text;
select 'PRE A comments_select_visible=' || qual from pg_policies where tablename = 'comments' and policyname = 'comments_select_visible';
select 'PRE B realtime.messages=' || coalesce(to_regclass('realtime.messages')::text, 'null') || ' policies=' || (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages');
select 'PRE C no_delete triggers(세 표)=' || count(*) || ' · 다른 표의 *_no_delete=' || (select string_agg(tgrelid::regclass::text || '.' || tgname, ',') from pg_trigger where tgname like 'trg_%_no_delete' and tgrelid not in ('public.shortform_posts'::regclass, 'public.comments'::regclass, 'public.community_comments'::regclass))
  from pg_trigger where tgname in ('trg_shortform_posts_no_delete', 'trg_comments_no_delete', 'trg_community_comments_no_delete');
select 'PRE rows shortform_posts=' || (select count(*) from public.shortform_posts) || ' comments=' || (select count(*) from public.comments) || ' community_comments=' || (select count(*) from public.community_comments) || ' community_posts=' || (select count(*) from public.community_posts);
