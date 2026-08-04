-- =============================================================================
-- s3_c_build13_db_contract_convergence_rollback_verify.sql
-- =============================================================================
-- supabase/rollback/20260802024641_build13_db_contract_convergence_rollback.sql
-- 적용 직후, 상태가 forward 적용 **직전(fixture baseline)** 으로 되돌아갔는지 확인한다.
-- 전제: fixture → forward → (forward verify) → rollback 순으로 적용한 세션.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET off

-- 시드는 forward verify 와 동일(각 테스트가 begin/rollback 이므로 잔존 없음)
begin;
delete from public.community_posts;
delete from public.account_deletion_jobs;
delete from public.mentor_profiles;
delete from public.users;
insert into public.users (id, role, status, suspended_until, nickname) values
  ('11111111-1111-1111-1111-111111111111', 'student', 'active', null, '학생A'),
  ('22222222-2222-2222-2222-222222222222', 'mentor',  'active', null, '멘토B'),
  ('55555555-5555-5555-5555-555555555555', 'student', 'active', null, '삭제진행학생');
insert into public.account_deletion_jobs (user_id, state)
values ('55555555-5555-5555-5555-555555555555', 'locked');
insert into public.mentor_profiles (user_id, verification_status)
values ('22222222-2222-2222-2222-222222222222', 'approved');
delete from public.notifications;
delete from public.question_attachments;
delete from public.question_messages;
delete from public.question_threads;
delete from public.user_blocks;
delete from public.mentor_student_rooms;
insert into public.mentor_student_rooms (id, student_id, mentor_id)
values ('dddddddd-0000-0000-0000-00000000000d',
        '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
insert into public.question_threads (id, mentor_student_room_id, title, status)
values ('eeeeeeee-0000-0000-0000-00000000000e', 'dddddddd-0000-0000-0000-00000000000d', '질문', 'open');
commit;

create or replace function pg_temp.expect_true(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_cond is distinct from true then raise exception 'FAIL[%]', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;

-- R-01 카탈로그 복원 — helper 소멸 · 참조 정책 0 · 함수 원형
do $$
BEGIN
  perform pg_temp.expect_true(
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'ugc_write_allowed'),
    'R-01 public.ugc_write_allowed() 제거');
  perform pg_temp.expect_true(
    NOT EXISTS (SELECT 1 FROM pg_policies
                 WHERE coalesce(qual, '') || coalesce(with_check, '') LIKE '%ugc_write_allowed%'),
    'R-02 게이트 참조 정책 0');
  perform pg_temp.expect_true(
    (SELECT p.prosrc NOT LIKE '%ACCOUNT_DELETION_PROBE_FORBIDDEN%'
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'account_deletion_write_blocked'),
    'R-03 account_deletion_write_blocked 원형 복원');
  perform pg_temp.expect_true(
    (SELECT p.prosrc LIKE '%MENTOR_NOT_APPROVED%' AND p.prosrc NOT LIKE '%ROLE_NOT_ALLOWED%'
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'core_private' AND p.proname = 'community_post_create_impl'),
    'R-04 create_impl 승인 멘토 전용 복원');
  perform pg_temp.expect_true(
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND cmd = 'SELECT' AND roles::text = '{public}'
        AND (tablename, policyname) IN
            (('custom_order_deliverables',   '누구나 납품 읽기'),
             ('custom_order_messages',       '누구나 메시지 읽기'),
             ('custom_request_applications', '누구나 지원서 읽기'),
             ('custom_request_posts',        '누구나 의뢰 읽기'))) = 4,
    'R-05 custom_* 공개 SELECT 4종 복원');
  perform pg_temp.expect_true(
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'post_reactions'
        AND cmd IN ('INSERT', 'DELETE')) = 4,
    'R-06 post_reactions 쓰기 정책 4종(한글명 중복 포함) 복원');
  -- community_posts 직접 쓰기 잠금은 rollback 이 건드리지 않는다
  perform pg_temp.expect_true(
    NOT has_table_privilege('authenticated', 'public.community_posts', 'INSERT')
    AND (SELECT count(*) FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'community_posts'
            AND cmd IN ('INSERT', 'UPDATE', 'DELETE')) = 0,
    'R-07 M16 직접 쓰기 잠금 불변(rollback 이 권한을 복구하지 않음)');
END $$;

-- R-08 행위 복원 — 학생 create 는 다시 ROLE_NOT_MENTOR
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  perform pg_temp.expect_true(
    (api_app_v1.community_post_create('x', '본문 충분히 길다 열자 이상', 'free',
     '00000021-0000-0000-0000-000000000021'::uuid) ->> 'code') = 'ROLE_NOT_MENTOR',
    'R-08 학생 create 가 ROLE_NOT_MENTOR 로 회귀(원형)');
END $$;
rollback;

-- R-09 UGC 게이트 해제 — 삭제 진행 계정도 댓글 작성 가능(원형)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
do $$
BEGIN
  insert into public.comments (author_id, body) values ('55555555-5555-5555-5555-555555555555', 'x');
  raise notice 'PASS R-09 UGC 상태 게이트 해제(원형 복원)';
END $$;
rollback;

-- R-10 타인 deletion probe 재허용(원형)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  perform pg_temp.expect_true(
    public.account_deletion_write_blocked('55555555-5555-5555-5555-555555555555') = true,
    'R-10 타인 probe 재허용(원형 복원 — 회귀 확인용)');
END $$;
rollback;

-- R-11 content_reports 원형 — status 위조가 다시 통과(원형)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  insert into public.content_reports (reporter_id, target_type, target_id, status)
  values ('11111111-1111-1111-1111-111111111111', 'community_post',
          '00000012-0000-0000-0000-000000000012', 'resolved');
  raise notice 'PASS R-11 content_reports 필드 강제 해제(원형 복원)';
END $$;
rollback;

-- R-12 custom_* 공개 SELECT 재노출(원형)
begin;
insert into public.custom_request_posts (id, author_id, title)
values ('bbbbbbbb-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', '의뢰')
on conflict (id) do nothing;
set local role anon;
do $$
DECLARE v_n int;
BEGIN
  select count(*) into v_n from public.custom_request_posts;
  perform pg_temp.expect_true(v_n >= 1, 'R-12 anon custom_request_posts 재노출(원형 복원)');
END $$;
rollback;


-- R-13 보정 §2 복원 — 학생 자기 글 수정이 다시 ROLE_NOT_MENTOR (원형)
begin;
insert into public.community_posts (id, author_id, title, body, content, category, status, updated_at)
values ('00000051-0000-0000-0000-000000000051', '11111111-1111-1111-1111-111111111111',
        't', '본문 충분히 길다 열자', '본문 충분히 길다 열자', 'free', 'published', now());
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
DECLARE v_up timestamptz;
BEGIN
  select updated_at into v_up from public.community_posts where id = '00000051-0000-0000-0000-000000000051';
  perform pg_temp.expect_true(
    (api_app_v1.community_post_update('00000051-0000-0000-0000-000000000051', 't2',
      '본문 충분히 길다 열자', 'free', v_up) ->> 'code') = 'ROLE_NOT_MENTOR',
    'R-13 학생 update 가 ROLE_NOT_MENTOR 로 회귀(원형)');
END $$;
rollback;

-- R-14 보정 §3 복원 — 상호 차단이 있어도 append 가 통과(게이트 제거 = 회귀 확인)
begin;
insert into public.user_blocks (blocker_id, blocked_id)
values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
do $$
BEGIN
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform pg_temp.expect_true(
    coalesce((public.qna_append_message('eeeeeeee-0000-0000-0000-00000000000e', '차단 무시 본문') ->> 'ok')::boolean, false),
    'R-14 차단 상태에서도 append 통과(원형 복원 — 회귀 확인용)');
END $$;
rollback;

-- R-15 보정 §3 복원 — 삭제 진행 계정도 attachment 등록 계정 게이트가 없다(원형)
begin;
update public.mentor_student_rooms set student_id = '55555555-5555-5555-5555-555555555555'
 where id = 'dddddddd-0000-0000-0000-00000000000d';
do $$
BEGIN
  perform set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
  perform pg_temp.expect_true(
    coalesce((public.qna_append_message('eeeeeeee-0000-0000-0000-00000000000e', '삭제 진행 본문') ->> 'ok')::boolean, false),
    'R-15 삭제 진행 계정 append 통과(원형 복원 — 회귀 확인용)');
END $$;
rollback;

-- R-16 보정 §1 복원 — users 행 없는 JWT 의 comments INSERT 가 다시 통과(원형)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', true);
do $$
BEGIN
  insert into public.comments (author_id, body) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'x');
  raise notice 'PASS R-16 users 행 부재 JWT comments INSERT 통과(원형 복원 — 회귀 확인용)';
END $$;
rollback;

-- R-17 보정 §4 복원 — 자기 신고가 다시 통과(원형)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  insert into public.content_reports (reporter_id, target_type, target_id)
  values ('11111111-1111-1111-1111-111111111111', 'user', '11111111-1111-1111-1111-111111111111');
  raise notice 'PASS R-17 자기 신고 통과(원형 복원 — 회귀 확인용)';
END $$;
rollback;

\echo '=== S3-C ROLLBACK VERIFY: ALL PASS ==='
