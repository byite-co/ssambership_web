-- =============================================================================
-- s3_c_build13_db_contract_convergence_verify.sql
-- =============================================================================
-- 20260802024641_build13_db_contract_convergence.sql 의 행위 계약 반복 검증기.
-- 실행 전제(오프라인 스크래치 Postgres — 운영·staging 반입 0):
--   1) psql -v ON_ERROR_STOP=1 -f scripts/verify/fixtures/s3_c_build13_contract_baseline_fixture.sql
--   2) psql -v ON_ERROR_STOP=1 -f supabase/sql/20260802024641_build13_db_contract_convergence.sql
--   3) psql -v ON_ERROR_STOP=1 -f scripts/verify/s3_c_build13_db_contract_convergence_verify.sql
-- rollback 검증은 (2) 대신 rollback 파일을 적용한 뒤 이 파일의 ROLLBACK 절
--   (마지막 섹션 R)만 별도로 돌린다 — 러너 스크립트가 -v mode=forward|rollback 로 분기한다.
-- 각 단언은 실패 시 RAISE EXCEPTION 으로 즉시 중단하고, 통과 시 NOTICE 를 남긴다.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET off

-- -----------------------------------------------------------------------------
-- 시드 (테스트 주체 6종)
-- -----------------------------------------------------------------------------
begin;
delete from public.content_reports;
delete from public.user_blocks;
delete from public.post_reactions;
delete from public.shortform_reactions;
delete from public.comments;
delete from public.community_comments;
delete from public.community_posts;
delete from public.account_deletion_jobs;
delete from public.custom_order_deliverables;
delete from public.custom_order_messages;
delete from public.custom_request_applications;
delete from public.custom_request_posts;
delete from public.custom_request_orders;
delete from public.mentor_profiles;
delete from public.users;

insert into public.users (id, role, status, suspended_until, nickname) values
  ('11111111-1111-1111-1111-111111111111', 'student', 'active',    null, '학생A'),
  ('22222222-2222-2222-2222-222222222222', 'mentor',  'active',    null, '멘토B'),
  ('33333333-3333-3333-3333-333333333333', 'student', 'banned',    null, '정지학생'),
  ('44444444-4444-4444-4444-444444444444', 'student', 'suspended', now() + interval '7 days', '일시정지학생'),
  ('55555555-5555-5555-5555-555555555555', 'student', 'active',    null, '삭제진행학생'),
  ('66666666-6666-6666-6666-666666666666', 'admin',   'active',    null, '관리자'),
  ('77777777-7777-7777-7777-777777777777', 'student', 'suspended', now() - interval '1 day', '정지만료학생');

-- 멘토B 는 **미승인** — 승인 멘토 전용 제한이 제거됐음을 증명하기 위해 프로필을 두지 않는다.
insert into public.account_deletion_jobs (user_id, state) values
  ('55555555-5555-5555-5555-555555555555', 'locked');

insert into public.custom_request_orders (id, student_id, mentor_id)
values ('aaaaaaaa-0000-0000-0000-00000000000a',
        '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
insert into public.custom_order_deliverables (custom_request_order_id, mentor_id, note)
values ('aaaaaaaa-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', '납품물');
insert into public.custom_order_messages (custom_request_order_id, author_id, body)
values ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '메시지');
insert into public.custom_request_posts (id, author_id, title)
values ('bbbbbbbb-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', '의뢰');
insert into public.custom_request_applications (post_id, mentor_id, message)
values ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', '지원');
commit;

-- -----------------------------------------------------------------------------
-- 공용 단언 helper (검증 세션 전용 — 이 파일 끝에서 DROP)
-- -----------------------------------------------------------------------------
create or replace function pg_temp.expect_code(p_actual text, p_expected text, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL[%]: expected code %, measured %', p_label, coalesce(p_expected, '<null>'), coalesce(p_actual, '<null>');
  end if;
  raise notice 'PASS %', p_label;
end $$;

create or replace function pg_temp.expect_true(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAIL[%]', p_label;
  end if;
  raise notice 'PASS %', p_label;
end $$;

-- 계정 상태 게이트 대상 4경로(comments · community_comments · post_reactions ·
-- shortform_reactions INSERT)가 전부 42501 로 막히는지 확인한다.
create or replace function pg_temp.assert_ugc_blocked(p_uid uuid, p_label text)
returns void language plpgsql as $$
begin
  begin
    insert into public.comments (author_id, body) values (p_uid, 'x');
    raise exception 'FAIL[%]: comments INSERT 가 허용됐다', p_label;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.community_comments (author_id, body) values (p_uid, 'x');
    raise exception 'FAIL[%]: community_comments INSERT 가 허용됐다', p_label;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.post_reactions (user_id, type) values (p_uid, 'like');
    raise exception 'FAIL[%]: post_reactions INSERT 가 허용됐다', p_label;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.shortform_reactions (user_id, type) values (p_uid, 'like');
    raise exception 'FAIL[%]: shortform_reactions INSERT 가 허용됐다', p_label;
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS % — UGC 4경로 전건 차단', p_label;
end $$;

-- =============================================================================
-- 범위 A — community_post_create 역할 계약
-- =============================================================================

-- A-01 active student create 성공 (앱 표면 api_app_v1)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
DECLARE r jsonb;
BEGIN
  r := api_app_v1.community_post_create('학생 글', '학생이 쓴 본문입니다 충분히 길다', 'study',
                                        '0000000a-0000-0000-0000-00000000000a'::uuid, '{}', 'published');
  perform pg_temp.expect_true(coalesce((r->>'ok')::boolean, false), 'A-01 active student create 성공');
  perform pg_temp.expect_true((r->>'post_id') is not null, 'A-01b post_id 반환');
  perform pg_temp.expect_true((r->>'idempotent_replay')::boolean = false, 'A-01c 최초 생성은 replay=false');
  perform pg_temp.expect_true(
    (select author_role = 'student' and author_label = '학생A'
       from public.community_posts where id = (r->>'post_id')::uuid),
    'A-01d author_role·author_label 서버 도출');
END $$;
rollback;

-- A-02 active mentor create 성공 (미승인 멘토 — MENTOR_NOT_APPROVED 제거 증명)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$
DECLARE r jsonb;
BEGIN
  r := api_web_v1.community_post_create('멘토 글', '멘토가 쓴 본문입니다 충분히 길다', 'free',
                                        '0000000b-0000-0000-0000-00000000000b'::uuid, '{}', 'published');
  perform pg_temp.expect_true(coalesce((r->>'ok')::boolean, false), 'A-02 active mentor create 성공(미승인 포함)');
  perform pg_temp.expect_true(
    (select author_role = 'mentor' from public.community_posts where id = (r->>'post_id')::uuid),
    'A-02b author_role=mentor');
END $$;
rollback;

-- A-03 banned / A-04 suspended / A-05 deletion-blocked / A-06 admin
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
do $$
BEGIN
  perform pg_temp.expect_code(
    api_app_v1.community_post_create('x', '본문 열자 이상으로 충분', 'free',
                                     '0000000c-0000-0000-0000-00000000000c'::uuid) ->> 'code',
    'ACCOUNT_BANNED', 'A-03 banned create 실패');
END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
do $$
BEGIN
  perform pg_temp.expect_code(
    api_app_v1.community_post_create('x', '본문 열자 이상으로 충분', 'free',
                                     '0000000d-0000-0000-0000-00000000000d'::uuid) ->> 'code',
    'ACCOUNT_SUSPENDED', 'A-04 유효 suspended create 실패');
END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
do $$
BEGIN
  perform pg_temp.expect_code(
    api_app_v1.community_post_create('x', '본문 열자 이상으로 충분', 'free',
                                     '0000000e-0000-0000-0000-00000000000e'::uuid) ->> 'code',
    'ACCOUNT_DELETION_IN_PROGRESS', 'A-05 deletion-blocked create 실패');
END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
do $$
BEGIN
  perform pg_temp.expect_code(
    api_app_v1.community_post_create('x', '본문 열자 이상으로 충분', 'free',
                                     '0000000f-0000-0000-0000-00000000000f'::uuid) ->> 'code',
    'ROLE_NOT_ALLOWED', 'A-06 admin create 거부');
END $$;
rollback;

-- A-07 정지 만료(suspended_until 과거) 학생은 작성 가능 — 과잉 차단 금지
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);
do $$
BEGIN
  perform pg_temp.expect_true(
    coalesce((api_app_v1.community_post_create('만료', '정지 만료 학생 본문 충분히 길다', 'free',
              '00000010-0000-0000-0000-000000000010'::uuid) ->> 'ok')::boolean, false),
    'A-07 정지 만료 학생 create 성공(과잉 차단 없음)');
END $$;
rollback;

-- A-08 guest/anon 거부
begin;
set local role anon;
do $$
BEGIN
  BEGIN
    perform api_app_v1.community_post_create('x', 'y', 'free', '00000011-0000-0000-0000-000000000011'::uuid);
    raise exception 'FAIL[A-08]: anon 이 RPC 를 실행했다';
  EXCEPTION WHEN insufficient_privilege THEN
    raise notice 'PASS A-08 anon EXECUTE 거부';
  END;
END $$;
rollback;

-- A-09 동일 idempotency key replay 수렴
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
DECLARE r1 jsonb; r2 jsonb;
BEGIN
  r1 := api_app_v1.community_post_create('replay', '멱등 검증 본문 충분히 길다', 'study',
                                         '00000012-0000-0000-0000-000000000012'::uuid);
  r2 := api_app_v1.community_post_create('다른 제목', '다른 본문 충분히 길다', 'free',
                                         '00000012-0000-0000-0000-000000000012'::uuid);
  perform pg_temp.expect_true((r1->>'post_id') = (r2->>'post_id'), 'A-09 replay 동일 post_id');
  perform pg_temp.expect_true((r2->>'idempotent_replay')::boolean, 'A-09b replay 플래그 true');
  perform pg_temp.expect_true(
    (select title = 'replay' from public.community_posts where id = (r1->>'post_id')::uuid),
    'A-09c replay 는 원본을 덮어쓰지 않는다');
END $$;
rollback;

-- A-10 보존 불변 — 연락처 마스킹 · title/category/body 검증
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
DECLARE r jsonb;
BEGIN
  r := api_app_v1.community_post_create('연락처 010-1234-5678 삽입', '메일 abc@example.com 포함 본문 충분히 길다',
                                        'study', '00000013-0000-0000-0000-000000000013'::uuid);
  perform pg_temp.expect_true(
    (select title like '%[연락처 비공개]%' and body like '%[연락처 비공개]%'
       from public.community_posts where id = (r->>'post_id')::uuid),
    'A-10 연락처 마스킹 보존');
  perform pg_temp.expect_code(
    api_app_v1.community_post_create('  ', '본문 충분히 길다', 'free',
                                     '00000014-0000-0000-0000-000000000014'::uuid) ->> 'code',
    'TITLE_REQUIRED', 'A-10b TITLE_REQUIRED 보존');
  perform pg_temp.expect_code(
    api_app_v1.community_post_create('t', '본문 충분히 길다', 'nope',
                                     '00000015-0000-0000-0000-000000000015'::uuid) ->> 'code',
    'CATEGORY_INVALID', 'A-10c CATEGORY_INVALID 보존');
  perform pg_temp.expect_code(
    api_app_v1.community_post_create('t', '짧다', 'free',
                                     '00000016-0000-0000-0000-000000000016'::uuid) ->> 'code',
    'BODY_TOO_SHORT', 'A-10d BODY_TOO_SHORT 보존');
  perform pg_temp.expect_code(
    api_app_v1.community_post_create('t', '본문은 열 글자를 넘도록 충분히 길게 쓴다', 'free',
                                     '00000017-0000-0000-0000-000000000017'::uuid, '{a,b,c,d,e,f}') ->> 'code',
    'IMAGE_COUNT_EXCEEDED', 'A-10e image_refs 검증 보존');
END $$;
rollback;

-- A-11 direct community_posts INSERT 계속 실패
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  BEGIN
    insert into public.community_posts (author_id, title, body, category, status)
    values ('11111111-1111-1111-1111-111111111111', '직접', '직접 삽입 시도', 'free', 'published');
    raise exception 'FAIL[A-11]: community_posts 직접 INSERT 가 성공했다';
  EXCEPTION WHEN insufficient_privilege THEN
    raise notice 'PASS A-11 direct community_posts INSERT 거부 유지';
  END;
END $$;
rollback;

-- =============================================================================
-- 범위 B — 직접 UGC write 계정 상태 게이트
-- =============================================================================

-- B-01 정상 사용자: comments / community_comments / reactions 전부 성공
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  insert into public.comments (author_id, body) values ('11111111-1111-1111-1111-111111111111', '댓글');
  update public.comments set body = '수정 댓글' where author_id = '11111111-1111-1111-1111-111111111111';
  insert into public.community_comments (author_id, body) values ('11111111-1111-1111-1111-111111111111', '커뮤 댓글');
  insert into public.post_reactions (user_id, type) values ('11111111-1111-1111-1111-111111111111', 'like');
  delete from public.post_reactions where user_id = '11111111-1111-1111-1111-111111111111';
  insert into public.shortform_reactions (user_id, type) values ('11111111-1111-1111-1111-111111111111', 'like');
  delete from public.shortform_reactions where user_id = '11111111-1111-1111-1111-111111111111';
  raise notice 'PASS B-01 active 사용자 UGC write 전건 성공';
END $$;
rollback;

-- B-02 banned — 4경로 전건 차단
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
do $$ BEGIN perform pg_temp.assert_ugc_blocked('33333333-3333-3333-3333-333333333333', 'B-02 banned'); END $$;
rollback;

-- B-03 유효 suspended — 4경로 전건 차단
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
do $$ BEGIN perform pg_temp.assert_ugc_blocked('44444444-4444-4444-4444-444444444444', 'B-03 suspended'); END $$;
rollback;

-- B-04 deletion write-blocked — 4경로 전건 차단
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
do $$ BEGIN perform pg_temp.assert_ugc_blocked('55555555-5555-5555-5555-555555555555', 'B-04 deletion-blocked'); END $$;
rollback;

-- B-05 차단 계정의 기존 반응 DELETE 도 막힌다(USING 게이트) — 행이 있어도 0건 삭제
begin;
insert into public.post_reactions (user_id, type) values ('33333333-3333-3333-3333-333333333333', 'like');
insert into public.shortform_reactions (user_id, type) values ('33333333-3333-3333-3333-333333333333', 'like');
insert into public.comments (author_id, body) values ('33333333-3333-3333-3333-333333333333', '기존 댓글');
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
do $$
DECLARE v_n int;
BEGIN
  delete from public.post_reactions where user_id = '33333333-3333-3333-3333-333333333333';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  perform pg_temp.expect_true(v_n = 0, 'B-05 banned post_reactions DELETE 차단');
  delete from public.shortform_reactions where user_id = '33333333-3333-3333-3333-333333333333';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  perform pg_temp.expect_true(v_n = 0, 'B-05b banned shortform_reactions DELETE 차단');
  update public.comments set body = 'z' where author_id = '33333333-3333-3333-3333-333333333333';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  perform pg_temp.expect_true(v_n = 0, 'B-05c banned comments UPDATE 차단');
END $$;
rollback;

-- B-06 과잉 차단 금지 — banned 사용자도 신고·차단·차단해제는 가능
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
do $$
BEGIN
  insert into public.content_reports (reporter_id, target_type, target_id, reason)
  values ('33333333-3333-3333-3333-333333333333', 'community_post',
          '00000012-0000-0000-0000-000000000012', '기타');
  insert into public.user_blocks (blocker_id, blocked_id)
  values ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222');
  delete from public.user_blocks
   where blocker_id = '33333333-3333-3333-3333-333333333333'
     and blocked_id = '22222222-2222-2222-2222-222222222222';
  raise notice 'PASS B-06 banned 사용자 신고·차단·차단해제 유지(과잉 차단 없음)';
END $$;
rollback;

-- =============================================================================
-- 범위 C — content_reports 필드 무결성
-- =============================================================================
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  -- 정상 신고
  insert into public.content_reports (reporter_id, target_type, target_id, reason)
  values ('11111111-1111-1111-1111-111111111111', 'community_post',
          '00000012-0000-0000-0000-000000000012', '기타');
  raise notice 'PASS C-01 정상 신고 INSERT';

  -- 질문방 신고 계약 — target_type='user'
  insert into public.content_reports (reporter_id, target_type, target_id, reason)
  values ('11111111-1111-1111-1111-111111111111', 'user',
          '22222222-2222-2222-2222-222222222222', '기타');
  raise notice 'PASS C-02 target_type=user 허용(S3-E 계약)';

  -- reporter_id 위조
  BEGIN
    insert into public.content_reports (reporter_id, target_type, target_id)
    values ('22222222-2222-2222-2222-222222222222', 'community_post', '00000012-0000-0000-0000-000000000012');
    raise exception 'FAIL[C-03]: reporter_id 위조가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS C-03 forged reporter_id 거부';
  END;

  -- status 위조
  BEGIN
    insert into public.content_reports (reporter_id, target_type, target_id, status)
    values ('11111111-1111-1111-1111-111111111111', 'community_post', '00000012-0000-0000-0000-000000000012', 'resolved');
    raise exception 'FAIL[C-04]: status 위조가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS C-04 forged report status 거부';
  END;

  -- admin_note 위조
  BEGIN
    insert into public.content_reports (reporter_id, target_type, target_id, admin_note)
    values ('11111111-1111-1111-1111-111111111111', 'community_post', '00000012-0000-0000-0000-000000000012', '관리자 메모');
    raise exception 'FAIL[C-05]: admin_note 위조가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS C-05 forged admin_note 거부';
  END;

  -- resolved_by / resolved_at 위조
  BEGIN
    insert into public.content_reports (reporter_id, target_type, target_id, resolved_by)
    values ('11111111-1111-1111-1111-111111111111', 'community_post', '00000012-0000-0000-0000-000000000012',
            '66666666-6666-6666-6666-666666666666');
    raise exception 'FAIL[C-06]: resolved_by 위조가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS C-06 forged resolved_by 거부';
  END;
  BEGIN
    insert into public.content_reports (reporter_id, target_type, target_id, resolved_at)
    values ('11111111-1111-1111-1111-111111111111', 'community_post', '00000012-0000-0000-0000-000000000012', now());
    raise exception 'FAIL[C-07]: resolved_at 위조가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS C-07 forged resolved_at 거부';
  END;

  -- 자유 텍스트 target_type 확장 거부
  BEGIN
    insert into public.content_reports (reporter_id, target_type, target_id)
    values ('11111111-1111-1111-1111-111111111111', '임의값', '00000012-0000-0000-0000-000000000012');
    raise exception 'FAIL[C-08]: 임의 target_type 이 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS C-08 자유 텍스트 target_type 거부';
  END;
END $$;
rollback;

-- C-09 관리자 UPDATE 경로 유지
begin;
insert into public.content_reports (id, reporter_id, target_type, target_id, reason)
values ('cccccccc-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
        'community_post', '00000012-0000-0000-0000-000000000012', '기타');
set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
do $$
DECLARE v_n int;
BEGIN
  update public.content_reports
     set status = 'resolved', admin_note = '처리 완료',
         resolved_by = '66666666-6666-6666-6666-666666666666', resolved_at = now()
   where id = 'cccccccc-0000-0000-0000-00000000000c';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  perform pg_temp.expect_true(v_n = 1, 'C-09 관리자 UPDATE 경로 유지');
END $$;
rollback;

-- =============================================================================
-- 범위 D — account_deletion_write_blocked self 제한
-- =============================================================================
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  perform pg_temp.expect_true(
    public.account_deletion_write_blocked('11111111-1111-1111-1111-111111111111') = false,
    'D-01 자기 deletion probe 정상(미차단)');
  BEGIN
    perform public.account_deletion_write_blocked('55555555-5555-5555-5555-555555555555');
    raise exception 'FAIL[D-02]: 타인 deletion probe 가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS D-02 타인 deletion probe 거부';
  END;
  BEGIN
    perform public.account_deletion_write_blocked(null);
    raise exception 'FAIL[D-03]: NULL probe 가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS D-03 NULL probe 거부';
  END;
END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
do $$
BEGIN
  perform pg_temp.expect_true(
    public.account_deletion_write_blocked('55555555-5555-5555-5555-555555555555') = true,
    'D-04 삭제 진행 계정의 자기 probe = true');
END $$;
rollback;

-- D-05 내부/service 문맥(auth.uid() IS NULL)은 임의 UUID 조회 유지
do $$
BEGIN
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_true(
    public.account_deletion_write_blocked('55555555-5555-5555-5555-555555555555') = true,
    'D-05 내부 문맥 임의 UUID 조회 유지(worker 계약 보존)');
END $$;

-- =============================================================================
-- 범위 E — custom_* 공개 SELECT 제거
-- =============================================================================
begin;
set local role anon;
do $$
DECLARE v_n int;
BEGIN
  select count(*) into v_n from public.custom_order_deliverables;
  perform pg_temp.expect_true(v_n = 0, 'E-01 anon custom_order_deliverables SELECT 0건');
  select count(*) into v_n from public.custom_order_messages;
  perform pg_temp.expect_true(v_n = 0, 'E-02 anon custom_order_messages SELECT 0건');
  select count(*) into v_n from public.custom_request_posts;
  perform pg_temp.expect_true(v_n = 0, 'E-03 anon custom_request_posts SELECT 0건');
  select count(*) into v_n from public.custom_request_applications;
  perform pg_temp.expect_true(v_n = 0, 'E-04 anon custom_request_applications SELECT 0건');
END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
DECLARE v_n int;
BEGIN
  select count(*) into v_n from public.custom_order_deliverables;
  perform pg_temp.expect_true(v_n = 1, 'E-05 당사자(학생) 납품 SELECT 유지');
  select count(*) into v_n from public.custom_order_messages;
  perform pg_temp.expect_true(v_n = 1, 'E-06 당사자(학생) 메시지 SELECT 유지');
  select count(*) into v_n from public.custom_request_posts;
  perform pg_temp.expect_true(v_n = 1, 'E-07 작성자 의뢰 SELECT 유지');
END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$
DECLARE v_n int;
BEGIN
  select count(*) into v_n from public.custom_request_applications;
  perform pg_temp.expect_true(v_n = 1, 'E-08 지원 멘토 지원서 SELECT 유지');
END $$;
rollback;

-- 무관한 제3자는 읽을 수 없다(공개 정책 제거 실증)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);
do $$
DECLARE v_n int;
BEGIN
  select count(*) into v_n from public.custom_order_deliverables;
  perform pg_temp.expect_true(v_n = 0, 'E-09 제3자 납품 SELECT 0건');
  select count(*) into v_n from public.custom_request_posts;
  perform pg_temp.expect_true(v_n = 0, 'E-10 제3자 의뢰 SELECT 0건');
END $$;
rollback;

\echo '=== S3-C FORWARD VERIFY: ALL PASS ==='
