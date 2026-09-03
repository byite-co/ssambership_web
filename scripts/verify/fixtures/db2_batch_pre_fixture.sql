-- db2_batch_pre_fixture.sql — DB-2 로컬 검증용 사전 fixture (오프라인 스크래치 PG 전용 · 운영 적용 금지).
-- 목적: DB-2 적용 **전**(= DB-1 적용 후) 운영 형태를 재현하고 §6 사전 실측값을 찍는다.
--   · 관리자 1 (오너 지정 UUID 9bf48819-… 그대로 — 193 A-3 이 이 계정을 요구한다)
--   · 승인 멘토 M1(가천대학교/의예과)·M3(가천대/의예과): approved · 미분류 · 192 B-1 일괄 확정형(reviewed_at 2026-09-03 02:58:53)
--     M2(계명대학교/의예과): approved · 미분류 · 개별 확정형(reviewed_at 2026-08-31 · verified_university_id 있음)
--     M4(충북대/의예과): approved · 미분류 · verified_university_name NULL(대학명을 못 읽은 행 — A-3 제외 대상)
--     M5(서울대학교/의예과): approved · 서연고 · 확정(정정 RPC 대상)
--     M6(원광대학교/의예과): pending · 미분류(자동 판정 잠정 — A-3 제외 대상)
--     M7(고려대학교/통계학과): 행 rejected (NOT_REVIEWABLE 검증용)
--     M9(연세대학교/컴퓨터공학과): approved · 서연고 · 확정 (학적 변경 재판정 검증용)
--   · 대기 멘토 M8(가천대학교/의예과, pending — 승인 시 트리거 폴백 검증용)
--   · 학생 S1·S2 · 게시판 글 P1 + 정본 댓글 C1(→ 레거시 미러 L1) + 레거시 댓글 L2(→ 정본 C2) · 숏폼 SF1·SF2 + 숏폼 댓글 SC1·SC2(SC2 관리자 숨김)
-- 이 파일은 COMMIT 한다(적용 대상 데이터). 검증 assertion 은 post fixture 가 한다.
begin;
set local search_path to public;

create schema if not exists db2_check;
create table if not exists db2_check.snapshot (key text primary key, val text);

-- ── 사용자 (auth.users INSERT → handle_new_auth_user 가 public.users 를 만든다) ──
insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, meta::jsonb, now(), now()
from (values
  ('9bf48819-1dd2-40dd-96a3-d64bcca2e60c'::uuid, 'db2-admin@test.local', '{"app_role":"student","full_name":"검증관리자"}'),
  ('00000000-0000-4000-8000-00000000d2a1'::uuid, 'db2-m1@test.local', '{"app_role":"mentor","full_name":"검증멘토일"}'),
  ('00000000-0000-4000-8000-00000000d2a2'::uuid, 'db2-m2@test.local', '{"app_role":"mentor","full_name":"검증멘토이"}'),
  ('00000000-0000-4000-8000-00000000d2a3'::uuid, 'db2-m3@test.local', '{"app_role":"mentor","full_name":"검증멘토삼"}'),
  ('00000000-0000-4000-8000-00000000d2a4'::uuid, 'db2-m4@test.local', '{"app_role":"mentor","full_name":"검증멘토사"}'),
  ('00000000-0000-4000-8000-00000000d2a5'::uuid, 'db2-m5@test.local', '{"app_role":"mentor","full_name":"검증멘토오"}'),
  ('00000000-0000-4000-8000-00000000d2a6'::uuid, 'db2-m6@test.local', '{"app_role":"mentor","full_name":"검증멘토육"}'),
  ('00000000-0000-4000-8000-00000000d2a7'::uuid, 'db2-m7@test.local', '{"app_role":"mentor","full_name":"검증멘토칠"}'),
  ('00000000-0000-4000-8000-00000000d2a8'::uuid, 'db2-m8@test.local', '{"app_role":"mentor","full_name":"검증멘토팔"}'),
  ('00000000-0000-4000-8000-00000000d2a9'::uuid, 'db2-m9@test.local', '{"app_role":"mentor","full_name":"검증멘토구"}'),
  ('00000000-0000-4000-8000-00000000d2b1'::uuid, 'db2-s1@test.local', '{"app_role":"student","full_name":"검증학생일"}'),
  ('00000000-0000-4000-8000-00000000d2b2'::uuid, 'db2-s2@test.local', '{"app_role":"student","full_name":"검증학생이"}')
) as v(id, email, meta);

update public.users set role = 'admin' where id = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c';

-- ── 멘토 프로필 학적 ──
insert into public.mentor_profiles (user_id, university_name, department_name, high_school_name) values
  ('00000000-0000-4000-8000-00000000d2a1', '가천대학교', '의예과',       '검증고'),
  ('00000000-0000-4000-8000-00000000d2a2', '계명대학교', '의예과',       '검증고'),
  ('00000000-0000-4000-8000-00000000d2a3', '가천대',     '의예과',       '검증고'),
  ('00000000-0000-4000-8000-00000000d2a4', '충북대',     '의예과',       '검증고'),
  ('00000000-0000-4000-8000-00000000d2a5', '서울대학교', '의예과',       '검증고'),
  ('00000000-0000-4000-8000-00000000d2a6', '원광대학교', '의예과',       '검증고'),
  ('00000000-0000-4000-8000-00000000d2a7', '고려대학교', '통계학과',     '검증고'),
  ('00000000-0000-4000-8000-00000000d2a8', '가천대학교', '의예과',       '검증고'),
  ('00000000-0000-4000-8000-00000000d2a9', '연세대학교', '컴퓨터공학과', '검증고')
on conflict (user_id) do update set
  university_name = excluded.university_name,
  department_name = excluded.department_name,
  high_school_name = excluded.high_school_name;

-- 승인 전이 → 192 트리거가 pending·reviewed NULL 행(제안값)을 만든다. M8 은 대기(pending) 그대로.
update public.mentor_profiles set verification_status = 'approved'
 where user_id in ('00000000-0000-4000-8000-00000000d2a1', '00000000-0000-4000-8000-00000000d2a2',
                   '00000000-0000-4000-8000-00000000d2a3', '00000000-0000-4000-8000-00000000d2a4',
                   '00000000-0000-4000-8000-00000000d2a5', '00000000-0000-4000-8000-00000000d2a6',
                   '00000000-0000-4000-8000-00000000d2a7', '00000000-0000-4000-8000-00000000d2a9');

-- 운영 형태 재현(서비스 경로 = postgres · guard_self_review 는 auth.uid() 가 NULL 이라 개입하지 않는다)
update public.mentor_school_verifications
   set status = 'approved', school_tier = '미분류',
       reviewed_by = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c', reviewed_at = '2026-09-03 02:58:53.752476+00'
 where mentor_id in ('00000000-0000-4000-8000-00000000d2a1', '00000000-0000-4000-8000-00000000d2a3');
update public.mentor_school_verifications
   set status = 'approved', school_tier = '미분류', verified_university_id = '계명대학교',
       reviewed_by = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c', reviewed_at = '2026-08-31 09:50:37.788749+00'
 where mentor_id = '00000000-0000-4000-8000-00000000d2a2';
update public.mentor_school_verifications
   set status = 'approved', school_tier = '미분류', verified_university_name = null,
       reviewed_by = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c', reviewed_at = '2026-09-03 02:58:53.752476+00'
 where mentor_id = '00000000-0000-4000-8000-00000000d2a4';
update public.mentor_school_verifications
   set status = 'approved', school_tier = '서연고', verified_university_id = '서울대학교',
       reviewed_by = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c', reviewed_at = '2026-08-20 00:00:00+00'
 where mentor_id = '00000000-0000-4000-8000-00000000d2a5';
-- M6: pending · 미분류(자동 판정) 그대로
update public.mentor_school_verifications set status = 'rejected'
 where mentor_id = '00000000-0000-4000-8000-00000000d2a7';
update public.mentor_school_verifications
   set status = 'approved', verified_university_id = '연세대학교',
       reviewed_by = '9bf48819-1dd2-40dd-96a3-d64bcca2e60c', reviewed_at = '2026-08-21 00:00:00+00'
 where mentor_id = '00000000-0000-4000-8000-00000000d2a9';

-- ── 커뮤니티 콘텐츠 ──
insert into public.community_posts (id, author_id, title, body, category, status, author_role)
values ('00000000-0000-4000-8000-00000000d2c1', '00000000-0000-4000-8000-00000000d2b1', '검증 글', '검증용 게시판 글 본문입니다.', 'study', 'published', 'student');

insert into public.shortform_posts (id, author_id, title, body, category, video_url, status, author_role) values
  ('00000000-0000-4000-8000-00000000d2f1', '00000000-0000-4000-8000-00000000d2a1', '검증 숏폼 1', '숏폼 1', 'study', 'https://example.test/v1.mp4', 'published', 'mentor'),
  ('00000000-0000-4000-8000-00000000d2f2', '00000000-0000-4000-8000-00000000d2a1', '검증 숏폼 2', '숏폼 2', 'study', 'https://example.test/v2.mp4', 'published', 'mentor');

-- 정본 댓글 C1 → 미러(163·164)가 레거시 L1(canonical_comment_id = C1)을 만든다
insert into public.comments (id, post_id, author_id, content)
values ('00000000-0000-4000-8000-00000000d2e1', '00000000-0000-4000-8000-00000000d2c1', '00000000-0000-4000-8000-00000000d2b1', '정본 댓글 1');
-- 레거시 댓글 L2 → 브리지가 정본 C2(legacy_comment_id = L2)를 만든다
insert into public.community_comments (id, post_type, post_id, author_id, body)
values ('00000000-0000-4000-8000-00000000d2e2', 'board', '00000000-0000-4000-8000-00000000d2c1', '00000000-0000-4000-8000-00000000d2b2', '레거시 댓글 2');
-- 숏폼 댓글 SC1(S1) · SC2(S2 · 관리자 숨김)
insert into public.community_comments (id, post_type, post_id, author_id, body) values
  ('00000000-0000-4000-8000-00000000d2e3', 'shortform', '00000000-0000-4000-8000-00000000d2f1', '00000000-0000-4000-8000-00000000d2b1', '숏폼 댓글 1'),
  ('00000000-0000-4000-8000-00000000d2e4', 'shortform', '00000000-0000-4000-8000-00000000d2f1', '00000000-0000-4000-8000-00000000d2b2', '숏폼 댓글 2');
update public.community_comments set status = 'hidden' where id = '00000000-0000-4000-8000-00000000d2e4';

-- ── 사전 스냅샷 (rollback 복원 대조용) ──
insert into db2_check.snapshot (key, val) values
  ('fn_suggest',       (select md5(pg_get_functiondef('public.school_tier_suggest(text)'::regprocedure)))),
  ('fn_rpc',           (select md5(pg_get_functiondef('public.approve_mentor_school_verification_admin(uuid,text,text,text,text,text)'::regprocedure)))),
  ('fn_cc_sync',       (select md5(pg_get_functiondef('public.cc_sync_board_to_canonical()'::regprocedure)))),
  ('fn_cc_sync_del',   (select md5(pg_get_functiondef('public.cc_sync_board_delete_to_canonical()'::regprocedure)))),
  ('fn_mirror',        (select md5(pg_get_functiondef('public.comments_mirror_to_legacy()'::regprocedure)))),
  ('fn_mirror_del',    (select md5(pg_get_functiondef('public.comments_mirror_delete_to_legacy()'::regprocedure)))),
  ('fn_cwg',           (select md5(pg_get_functiondef('public.comments_write_guard()'::regprocedure)))),
  ('fn_spg',           (select md5(pg_get_functiondef('public.shortform_posts_protected_guard()'::regprocedure)))),
  ('fn_count',         (select md5(pg_get_functiondef('public.community_refresh_post_comment_count()'::regprocedure)))),
  ('fn_view_v2',       (select md5(pg_get_functiondef('public.shortform_view_record_v2(uuid,uuid)'::regprocedure)))),
  ('fn_inc',           (select md5(pg_get_functiondef('public.increment_shortform_post_view(uuid)'::regprocedure)))),
  ('fn_self_del',      (select md5(pg_get_functiondef('public.community_comment_soft_delete_self(uuid)'::regprocedure)))),
  ('fn_report_valid',  (select md5(pg_get_functiondef('rls_private.report_target_content_valid(text,uuid)'::regprocedure)))),
  ('view_cc_v1',       (select pg_get_viewdef('api_web_v1.community_comments_v1'::regclass))),
  ('view_cc_v1_opts',  (select coalesce(reloptions::text, '') from pg_class where oid = 'api_web_v1.community_comments_v1'::regclass)),
  ('view_cc_v1_acl',   (select coalesce(relacl::text, '') from pg_class where oid = 'api_web_v1.community_comments_v1'::regclass)),
  ('pol_sf',           (select roles::text || '|' || qual from pg_policies where tablename = 'shortform_posts' and policyname = 'sf_select_published')),
  ('pol_c',            (select roles::text || '|' || qual from pg_policies where tablename = 'comments' and policyname = 'comments_select_visible')),
  ('pol_cc',           (select roles::text || '|' || qual from pg_policies where tablename = 'community_comments' and policyname = 'community_comments_select_visible')),
  ('trg_count',        (select pg_get_triggerdef(oid) from pg_trigger where tgname = 'trg_comments_refresh_count' and tgrelid = 'public.comments'::regclass)),
  ('stm_columns',      (select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'school_tier_mappings')),
  ('stm_constraints',  (select string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname) from pg_constraint where conrelid = 'public.school_tier_mappings'::regclass)),
  ('stm_indexes',      (select string_agg(indexdef, ',' order by indexname) from pg_indexes where schemaname = 'public' and tablename = 'school_tier_mappings')),
  ('stm_policy',       (select roles::text || '|' || cmd || '|' || qual || '|' || with_check from pg_policies where tablename = 'school_tier_mappings')),
  ('stm_grants',       (select string_agg(grantee || ':' || privilege_type, ',' order by grantee, privilege_type) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'school_tier_mappings' and grantee in ('anon', 'authenticated', 'service_role'))),
  ('msv_m2_reviewed_at', (select reviewed_at::text from public.mentor_school_verifications where mentor_id = '00000000-0000-4000-8000-00000000d2a2')),
  ('msv_m5_reviewed_at', (select reviewed_at::text from public.mentor_school_verifications where mentor_id = '00000000-0000-4000-8000-00000000d2a5'));

-- 전제 확인: DB-1 적용 후 · DB-2 이전 상태여야 한다
do $$
begin
  if public.school_tier_suggest('가천대학교') <> '미분류' or public.school_tier_suggest(null) <> '미분류' then
    raise exception 'PRE: 192 폴백(미분류)이 아니다';
  end if;
  if (select count(*) from public.mentor_school_verifications where status = 'approved' and school_tier = '미분류') <> 4 then
    raise exception 'PRE: 미분류 approved 4건이 아니다';
  end if;
  if (select count(*) from public.mentor_school_verifications where status = 'approved' and school_tier = '미분류'
       and verified_university_name is not null and btrim(verified_university_name) <> '') <> 3 then
    raise exception 'PRE: A-3 대상(M1·M2·M3) 3건이 아니다';
  end if;
  if (select count(*) from public.mentor_school_verifications where status = 'pending' and school_tier = '미분류') <> 1 then
    raise exception 'PRE: pending 미분류(M6) 1건이 아니다';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name in ('shortform_posts', 'comments', 'community_comments') and column_name in ('deleted_at', 'deleted_by')) then
    raise exception 'PRE: deleted_at/deleted_by 컬럼이 이미 있다';
  end if;
  if to_regclass('public.school_tier_mappings') is null then
    raise exception 'PRE: school_tier_mappings 부재';
  end if;
  if (select comment_count from public.community_posts where id = '00000000-0000-4000-8000-00000000d2c1') <> 2 then
    raise exception 'PRE: P1 댓글 수 2 가 아니다(브리지 미동작)';
  end if;
  if (select count(*) from public.community_comments where post_type = 'board' and canonical_comment_id = '00000000-0000-4000-8000-00000000d2e1') <> 1
     or (select count(*) from public.comments where legacy_comment_id = '00000000-0000-4000-8000-00000000d2e2') <> 1 then
    raise exception 'PRE: 브리지 미러(L1·C2)가 없다';
  end if;
end $$;

commit;

-- ── §6 사전 실측 (tuples only) ──
\pset tuples_only on
\pset format unaligned
select 'PRE snapshot ' || key || '=' || val from db2_check.snapshot where key like 'fn_%' order by key;
select 'PRE A tier ' || status || '/' || coalesce(school_tier, 'null') || ' n=' || count(*) from public.mentor_school_verifications group by status, school_tier order by 1;
select 'PRE A suggest 가천대학교=' || public.school_tier_suggest('가천대학교') || ' 빈문자=' || public.school_tier_suggest('') || ' null=' || coalesce(public.school_tier_suggest(null), 'null');
select 'PRE B columns deleted_*=' || count(*) from information_schema.columns where table_schema = 'public'
  and ((table_name in ('shortform_posts', 'comments', 'community_comments') and column_name in ('deleted_at', 'deleted_by')) or (table_name = 'community_posts' and column_name in ('deleted_at', 'deleted_by')));
select 'PRE B policy ' || tablename || '.' || policyname || ' = ' || qual from pg_policies where schemaname = 'public' and cmd = 'SELECT'
  and tablename in ('shortform_posts', 'comments', 'community_comments') order by 1;
select 'PRE C school_tier_mappings=' || coalesce(to_regclass('public.school_tier_mappings')::text, 'null');
