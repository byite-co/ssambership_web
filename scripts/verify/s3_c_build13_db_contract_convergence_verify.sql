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
delete from public.notifications;
delete from public.question_attachments;
delete from public.question_messages;
delete from public.question_threads;
delete from public.mentor_student_rooms;
delete from public.refunds;
delete from public.subscriptions;
delete from storage.objects;
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
  ('77777777-7777-7777-7777-777777777777', 'student', 'suspended', now() - interval '1 day', '정지만료학생'),
  -- 보정 §1 fail-closed 표적: deleted · unknown status · status NULL 대용
  ('88888888-8888-8888-8888-888888888888', 'student', 'deleted',   null, '삭제상태학생'),
  ('99999999-9999-9999-9999-999999999999', 'student', 'dormant',   null, '미지상태학생'),
  ('aaaaaaaa-1111-1111-1111-111111111111', 'student', '',          null, '빈상태학생'),
  -- 질문방 상대 멘토(승인) — mentor approval 게이트 통과용
  ('bbbbbbbb-2222-2222-2222-222222222222', 'mentor',  'active',    null, '승인멘토');
insert into public.mentor_profiles (user_id, verification_status)
values ('bbbbbbbb-2222-2222-2222-222222222222', 'approved');

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

-- 질문방 시드 — 학생A ↔ 승인멘토 방 1개 · open 스레드 1개 · 첨부 storage 객체 2개
insert into public.mentor_student_rooms (id, student_id, mentor_id)
values ('dddddddd-0000-0000-0000-00000000000d',
        '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-2222-2222-2222-222222222222');
insert into public.question_threads (id, mentor_student_room_id, title, status)
values ('eeeeeeee-0000-0000-0000-00000000000e', 'dddddddd-0000-0000-0000-00000000000d', '질문', 'open');
insert into storage.objects (bucket_id, name, owner_id) values
  ('question-room-attachments',
   'dddddddd-0000-0000-0000-00000000000d/eeeeeeee-0000-0000-0000-00000000000e/s.png',
   '11111111-1111-1111-1111-111111111111'),
  ('question-room-attachments',
   'dddddddd-0000-0000-0000-00000000000d/eeeeeeee-0000-0000-0000-00000000000e/m.png',
   'bbbbbbbb-2222-2222-2222-222222222222');
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

-- 질문방 게이트 단언기 — append/attachment 가 기대 코드로 거부되고
-- **message 0 · attachment 0 · answered 전이 0 · 알림 0** 임을 함께 증명한다.
-- p_uid 가 NULL 이면 방의 학생·멘토 **양방향**을 모두 검사한다(상호 차단용).
create or replace function pg_temp.assert_qna_blocked(
  p_expected text, p_label text, p_uid uuid default null
) returns void language plpgsql as $$
declare
  v_thread uuid := 'eeeeeeee-0000-0000-0000-00000000000e';
  v_room   uuid := 'dddddddd-0000-0000-0000-00000000000d';
  v_student uuid; v_mentor uuid;
  v_uids uuid[]; v_u uuid; v_path text;
  v_m0 int; v_a0 int; v_n0 int; v_st0 text; v_fa0 timestamptz;
  v_m1 int; v_a1 int; v_n1 int; v_st1 text; v_fa1 timestamptz;
begin
  select r.student_id, r.mentor_id into v_student, v_mentor
    from public.mentor_student_rooms r where r.id = v_room;
  v_uids := case when p_uid is null then array[v_student, v_mentor] else array[p_uid] end;

  select count(*) into v_m0 from public.question_messages where thread_id = v_thread;
  select count(*) into v_a0 from public.question_attachments where thread_id = v_thread;
  select count(*) into v_n0 from public.notifications;
  select t.status, t.first_answered_at into v_st0, v_fa0
    from public.question_threads t where t.id = v_thread;

  foreach v_u in array v_uids loop
    perform set_config('request.jwt.claim.sub', v_u::text, true);
    v_path := v_room::text || '/' || v_thread::text ||
              case when v_u = v_mentor then '/m.png' else '/s.png' end;

    begin
      perform public.qna_append_message(v_thread, '차단 검증 본문');
      raise exception 'FAIL[%]: append 가 허용됐다(uid=%)', p_label, v_u;
    exception when raise_exception then
      if SQLERRM <> p_expected then
        raise exception 'FAIL[%]: append 코드 % (기대 %) uid=%', p_label, SQLERRM, p_expected, v_u;
      end if;
    end;

    begin
      perform public.qna_register_attachment(v_thread, v_path);
      raise exception 'FAIL[%]: attachment 가 허용됐다(uid=%)', p_label, v_u;
    exception when raise_exception then
      if SQLERRM <> p_expected then
        raise exception 'FAIL[%]: attachment 코드 % (기대 %) uid=%', p_label, SQLERRM, p_expected, v_u;
      end if;
    end;
  end loop;

  select count(*) into v_m1 from public.question_messages where thread_id = v_thread;
  select count(*) into v_a1 from public.question_attachments where thread_id = v_thread;
  select count(*) into v_n1 from public.notifications;
  select t.status, t.first_answered_at into v_st1, v_fa1
    from public.question_threads t where t.id = v_thread;

  if v_m1 <> v_m0 or v_a1 <> v_a0 or v_n1 <> v_n0
     or v_st1 is distinct from v_st0 or v_fa1 is distinct from v_fa0 then
    raise exception 'FAIL[%]: 차단인데 부수효과 발생(msg %→% · att %→% · noti %→% · status %→%)',
      p_label, v_m0, v_m1, v_a0, v_a1, v_n0, v_n1, v_st0, v_st1;
  end if;
  raise notice 'PASS % — append·attachment 거부(%) · row/state/notification 변화 0', p_label, p_expected;
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


-- =============================================================================
-- 보정 §1 (범위 F) — ugc_write_allowed() fail-closed
-- =============================================================================

-- F-01 허용: active student / active mentor / 정지 만료
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$ BEGIN perform pg_temp.expect_true(public.ugc_write_allowed(), 'F-01 active student 허용'); END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$ BEGIN perform pg_temp.expect_true(public.ugc_write_allowed(), 'F-02 active mentor 허용'); END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);
do $$ BEGIN perform pg_temp.expect_true(public.ugc_write_allowed(), 'F-03 정지 만료 허용'); END $$;
rollback;

-- F-04 users 행이 없는 authenticated JWT 는 차단(fail-closed 핵심)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ffffffff-ffff-ffff-ffff-ffffffffffff', true);
do $$
BEGIN
  perform pg_temp.expect_true(public.ugc_write_allowed() = false, 'F-04 users 행 부재 JWT 차단');
  -- comments 는 users FK 가 없으므로 실제 INSERT 도 막혀야 한다
  BEGIN
    insert into public.comments (author_id, body) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'x');
    raise exception 'FAIL[F-04b]: users 행 없는 JWT 의 comments INSERT 가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS F-04b users 행 부재 comments INSERT 차단';
  END;
  BEGIN
    insert into public.post_reactions (user_id, type) values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'like');
    raise exception 'FAIL[F-04c]: users 행 없는 JWT 의 post_reactions INSERT 가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS F-04c users 행 부재 post_reactions INSERT 차단';
  END;
END $$;
rollback;

-- F-05 admin 차단
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
do $$
BEGIN
  perform pg_temp.expect_true(public.ugc_write_allowed() = false, 'F-05 admin 차단');
  BEGIN
    insert into public.comments (author_id, body) values ('66666666-6666-6666-6666-666666666666', 'x');
    raise exception 'FAIL[F-05b]: admin comments INSERT 가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS F-05b admin comments INSERT 차단';
  END;
END $$;
rollback;

-- F-06 deleted / F-07 unknown status / F-08 빈 status 차단
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
do $$ BEGIN
  perform pg_temp.expect_true(public.ugc_write_allowed() = false, 'F-06 status=deleted 차단');
  perform pg_temp.assert_ugc_blocked('88888888-8888-8888-8888-888888888888', 'F-06b deleted');
END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
do $$ BEGIN
  perform pg_temp.expect_true(public.ugc_write_allowed() = false, 'F-07 unknown status 차단');
  perform pg_temp.assert_ugc_blocked('99999999-9999-9999-9999-999999999999', 'F-07b unknown status');
END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-1111-1111-1111-111111111111', true);
do $$ BEGIN
  perform pg_temp.expect_true(public.ugc_write_allowed() = false, 'F-08 빈 status 차단');
END $$;
rollback;

-- F-09 status NULL 차단 (운영 users.status 는 NOT NULL 이라 제약을 일시 해제해 재현 — rollback)
begin;
alter table public.users alter column status drop not null;
update public.users set status = null where id = '99999999-9999-9999-9999-999999999999';
set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', true);
do $$ BEGIN
  perform pg_temp.expect_true(public.ugc_write_allowed() = false, 'F-09 status NULL 차단');
  perform pg_temp.assert_ugc_blocked('99999999-9999-9999-9999-999999999999', 'F-09b status NULL');
END $$;
rollback;

-- F-10 banned/suspended/deletion 은 여전히 차단(회귀) · 신고·차단은 계속 허용
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
do $$ BEGIN perform pg_temp.expect_true(public.ugc_write_allowed() = false, 'F-10 banned 차단'); END $$;
rollback;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
do $$ BEGIN perform pg_temp.expect_true(public.ugc_write_allowed() = false, 'F-11 유효 suspended 차단'); END $$;
rollback;
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
do $$ BEGIN perform pg_temp.expect_true(public.ugc_write_allowed() = false, 'F-12 deletion write-blocked 차단'); END $$;
rollback;

-- F-13 과잉 차단 금지 재확인 — deleted 계정도 신고·차단·차단해제는 가능
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
do $$
BEGIN
  insert into public.content_reports (reporter_id, target_type, target_id, reason)
  values ('88888888-8888-8888-8888-888888888888', 'community_post',
          '00000012-0000-0000-0000-000000000012', '기타');
  insert into public.user_blocks (blocker_id, blocked_id)
  values ('88888888-8888-8888-8888-888888888888', '22222222-2222-2222-2222-222222222222');
  delete from public.user_blocks
   where blocker_id = '88888888-8888-8888-8888-888888888888'
     and blocked_id = '22222222-2222-2222-2222-222222222222';
  raise notice 'PASS F-13 deleted 계정 신고·차단·차단해제 유지(과잉 차단 없음)';
END $$;
rollback;

-- =============================================================================
-- 보정 §2 (범위 G) — community_post_update 역할 계약
-- =============================================================================

-- G-01 학생이 자기 글 수정 성공
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
DECLARE r jsonb; v_up timestamptz; v_pid uuid;
BEGIN
  r := api_app_v1.community_post_create('학생 글', '학생이 쓴 본문입니다 충분히 길다', 'study',
                                        '00000031-0000-0000-0000-000000000031'::uuid);
  v_pid := (r->>'post_id')::uuid;
  select updated_at into v_up from public.community_posts where id = v_pid;
  r := api_app_v1.community_post_update(v_pid, '수정 제목', '수정된 본문입니다 충분히 길다', 'free', v_up);
  perform pg_temp.expect_true(coalesce((r->>'ok')::boolean, false), 'G-01 student own update 성공');
  perform pg_temp.expect_true(
    (select title = '수정 제목' and category = 'free' from public.community_posts where id = v_pid),
    'G-01b 수정 반영');
  perform pg_temp.expect_true((r->>'contract_version') = '1', 'G-01c contract_version 불변');
END $$;
rollback;

-- G-02 미승인 멘토가 자기 글 수정 성공(승인 요구 제거 증명)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$
DECLARE r jsonb; v_up timestamptz; v_pid uuid;
BEGIN
  r := api_web_v1.community_post_create('멘토 글', '멘토가 쓴 본문입니다 충분히 길다', 'free',
                                        '00000032-0000-0000-0000-000000000032'::uuid);
  v_pid := (r->>'post_id')::uuid;
  select updated_at into v_up from public.community_posts where id = v_pid;
  r := api_web_v1.community_post_update(v_pid, '멘토 수정', '멘토가 고친 본문 충분히 길다', 'study', v_up);
  perform pg_temp.expect_true(coalesce((r->>'ok')::boolean, false), 'G-02 unapproved mentor own update 성공');
END $$;
rollback;

-- G-03 타인 글 수정 실패 / G-04 삭제된 글 수정 실패
begin;
insert into public.community_posts (id, author_id, title, body, content, category, status, updated_at)
values ('00000033-0000-0000-0000-000000000033', '22222222-2222-2222-2222-222222222222',
        '남의 글', '본문 충분히 길다 열자', '본문 충분히 길다 열자', 'free', 'published', now()),
       ('00000034-0000-0000-0000-000000000034', '11111111-1111-1111-1111-111111111111',
        '삭제된 글', '본문 충분히 길다 열자', '본문 충분히 길다 열자', 'free', 'published', now());
update public.community_posts set deleted_at = now() where id = '00000034-0000-0000-0000-000000000034';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  perform pg_temp.expect_code(
    api_app_v1.community_post_update('00000033-0000-0000-0000-000000000033', 't',
      '본문 충분히 길다 열자', 'free', now()) ->> 'code',
    'POST_NOT_FOUND_OR_NOT_OWNED', 'G-03 타인 글 수정 거부');
  perform pg_temp.expect_code(
    api_app_v1.community_post_update('00000034-0000-0000-0000-000000000034', 't',
      '본문 충분히 길다 열자', 'free', now()) ->> 'code',
    'POST_NOT_FOUND_OR_NOT_OWNED', 'G-04 삭제된 글 수정 거부');
END $$;
rollback;

-- G-05 admin → ROLE_NOT_ALLOWED (admin 소유 글을 만들어 소유 게이트를 통과시킨 뒤 역할 게이트 도달)
begin;
insert into public.community_posts (id, author_id, title, body, content, category, status, updated_at)
values ('00000035-0000-0000-0000-000000000035', '66666666-6666-6666-6666-666666666666',
        '관리자 글', '본문 충분히 길다 열자', '본문 충분히 길다 열자', 'free', 'published', now());
set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
do $$
DECLARE v_up timestamptz;
BEGIN
  select updated_at into v_up from public.community_posts where id = '00000035-0000-0000-0000-000000000035';
  perform pg_temp.expect_code(
    api_app_v1.community_post_update('00000035-0000-0000-0000-000000000035', 't',
      '본문 충분히 길다 열자', 'free', v_up) ->> 'code',
    'ROLE_NOT_ALLOWED', 'G-05 admin update ROLE_NOT_ALLOWED');
END $$;
rollback;

-- G-06 banned / G-07 suspended / G-08 deletion-blocked update 실패
begin;
insert into public.community_posts (id, author_id, title, body, content, category, status, updated_at) values
  ('00000036-0000-0000-0000-000000000036', '33333333-3333-3333-3333-333333333333', 'b', '본문 충분히 길다 열자', '본문 충분히 길다 열자', 'free', 'published', now()),
  ('00000037-0000-0000-0000-000000000037', '44444444-4444-4444-4444-444444444444', 's', '본문 충분히 길다 열자', '본문 충분히 길다 열자', 'free', 'published', now()),
  ('00000038-0000-0000-0000-000000000038', '55555555-5555-5555-5555-555555555555', 'd', '본문 충분히 길다 열자', '본문 충분히 길다 열자', 'free', 'published', now());
do $$
DECLARE v_up timestamptz;
BEGIN
  select updated_at into v_up from public.community_posts where id = '00000036-0000-0000-0000-000000000036';
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  perform pg_temp.expect_code(
    core_private.community_post_update_impl('33333333-3333-3333-3333-333333333333',
      '00000036-0000-0000-0000-000000000036', 't', '본문 충분히 길다 열자', 'free', '{}', 'published', v_up) ->> 'code',
    'ACCOUNT_BANNED', 'G-06 banned update 실패');
  select updated_at into v_up from public.community_posts where id = '00000037-0000-0000-0000-000000000037';
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  perform pg_temp.expect_code(
    core_private.community_post_update_impl('44444444-4444-4444-4444-444444444444',
      '00000037-0000-0000-0000-000000000037', 't', '본문 충분히 길다 열자', 'free', '{}', 'published', v_up) ->> 'code',
    'ACCOUNT_SUSPENDED', 'G-07 유효 suspended update 실패');
  select updated_at into v_up from public.community_posts where id = '00000038-0000-0000-0000-000000000038';
  perform set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
  perform pg_temp.expect_code(
    core_private.community_post_update_impl('55555555-5555-5555-5555-555555555555',
      '00000038-0000-0000-0000-000000000038', 't', '본문 충분히 길다 열자', 'free', '{}', 'published', v_up) ->> 'code',
    'ACCOUNT_DELETION_IN_PROGRESS', 'G-08 deletion-blocked update 실패');
END $$;
rollback;

-- G-09 낙관적 충돌 / G-10 마스킹·이미지·removed_image_refs 회귀
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
DECLARE r jsonb; v_up timestamptz; v_pid uuid;
BEGIN
  r := api_app_v1.community_post_create('원본', '원본 본문입니다 충분히 길다', 'study',
                                        '00000039-0000-0000-0000-000000000039'::uuid);
  v_pid := (r->>'post_id')::uuid;
  select updated_at into v_up from public.community_posts where id = v_pid;

  perform pg_temp.expect_code(
    api_app_v1.community_post_update(v_pid, 't', '본문 충분히 길다 열자', 'free',
                                     v_up - interval '1 second') ->> 'code',
    'UPDATE_CONFLICT', 'G-09 expected_updated_at 불일치 → UPDATE_CONFLICT');

  r := api_app_v1.community_post_update(v_pid, '연락처 010-1234-5678', '메일 abc@example.com 본문 충분히 길다',
                                        'free', v_up);
  perform pg_temp.expect_true(coalesce((r->>'ok')::boolean, false), 'G-10 update 성공');
  perform pg_temp.expect_true(
    (select title like '%[연락처 비공개]%' and body like '%[연락처 비공개]%'
       from public.community_posts where id = v_pid),
    'G-10b update 연락처 마스킹 보존');
  perform pg_temp.expect_true(r ? 'removed_image_refs', 'G-10c removed_image_refs 반환 보존');

  select updated_at into v_up from public.community_posts where id = v_pid;
  perform pg_temp.expect_code(
    api_app_v1.community_post_update(v_pid, 't', '본문 충분히 길다 열자', 'free', v_up,
                                     '{a,b,c,d,e,f}') ->> 'code',
    'IMAGE_COUNT_EXCEEDED', 'G-10d update 이미지 검증 보존');
  perform pg_temp.expect_code(
    api_app_v1.community_post_update(v_pid, '  ', '본문 충분히 길다 열자', 'free', v_up) ->> 'code',
    'TITLE_REQUIRED', 'G-10e update TITLE_REQUIRED 보존');
  perform pg_temp.expect_code(
    api_app_v1.community_post_update(v_pid, 't', '본문 충분히 길다 열자', 'nope', v_up) ->> 'code',
    'CATEGORY_INVALID', 'G-10f update CATEGORY_INVALID 보존');
  perform pg_temp.expect_code(
    api_app_v1.community_post_update(v_pid, 't', '짧다', 'free', v_up) ->> 'code',
    'BODY_TOO_SHORT', 'G-10g update BODY_TOO_SHORT 보존');
END $$;
rollback;

-- G-11 direct community_posts UPDATE 계속 42501
begin;
insert into public.community_posts (id, author_id, title, body, content, category, status)
values ('00000040-0000-0000-0000-000000000040', '11111111-1111-1111-1111-111111111111',
        't', '본문 충분히 길다 열자', '본문 충분히 길다 열자', 'free', 'published');
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  BEGIN
    update public.community_posts set title = '직접수정' where id = '00000040-0000-0000-0000-000000000040';
    raise exception 'FAIL[G-11]: community_posts 직접 UPDATE 가 성공했다';
  EXCEPTION WHEN insufficient_privilege THEN
    raise notice 'PASS G-11 direct community_posts UPDATE 거부 유지';
  END;
END $$;
rollback;

-- =============================================================================
-- 보정 §3 (범위 H) — 질문방 차단·계정 상태 게이트
-- =============================================================================

-- H-01 정상 당사자는 append/attachment 모두 성공(회귀 없음)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
DECLARE r jsonb;
BEGIN
  r := public.qna_append_message('eeeeeeee-0000-0000-0000-00000000000e', '학생 질문 본문');
  perform pg_temp.expect_true(coalesce((r->>'ok')::boolean, false), 'H-01 학생 append 성공');
  r := public.qna_register_attachment('eeeeeeee-0000-0000-0000-00000000000e',
        'dddddddd-0000-0000-0000-00000000000d/eeeeeeee-0000-0000-0000-00000000000e/s.png');
  perform pg_temp.expect_true(coalesce((r->>'ok')::boolean, false), 'H-01b 학생 attachment 성공');
END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-2222-2222-2222-222222222222', true);
do $$
DECLARE r jsonb;
BEGIN
  r := public.qna_append_message('eeeeeeee-0000-0000-0000-00000000000e', '멘토 답변 본문');
  perform pg_temp.expect_true(coalesce((r->>'ok')::boolean, false), 'H-02 멘토 append 성공');
  perform pg_temp.expect_true((r->>'answered_transition')::boolean, 'H-02b answered 전이 보존');
  perform pg_temp.expect_true((select count(*) from public.notifications) = 1, 'H-02c 멘토 답변 알림 1건 보존');
END $$;
rollback;

-- H-03 학생이 멘토를 차단 → 양방향 append/attachment 거부 + 부수효과 0
begin;
insert into public.user_blocks (blocker_id, blocked_id)
values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-2222-2222-2222-222222222222');
do $$ BEGIN perform pg_temp.assert_qna_blocked('BLOCKED', 'H-03 학생→멘토 차단'); END $$;
rollback;

-- H-04 멘토가 학생을 차단 → 양방향 거부(반대 방향 차단도 동일)
begin;
insert into public.user_blocks (blocker_id, blocked_id)
values ('bbbbbbbb-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
do $$ BEGIN perform pg_temp.assert_qna_blocked('BLOCKED', 'H-04 멘토→학생 차단'); END $$;
rollback;

-- H-05 차단 해제 후 정상 복귀
begin;
insert into public.user_blocks (blocker_id, blocked_id)
values ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-2222-2222-2222-222222222222');
delete from public.user_blocks
 where blocker_id = '11111111-1111-1111-1111-111111111111'
   and blocked_id = 'bbbbbbbb-2222-2222-2222-222222222222';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  perform pg_temp.expect_true(
    coalesce((public.qna_append_message('eeeeeeee-0000-0000-0000-00000000000e', '해제 후 질문') ->> 'ok')::boolean, false),
    'H-05 차단 해제 후 append 정상');
END $$;
rollback;

-- H-06 banned / H-07 suspended / H-08 deletion / H-09 users 행 부재 계정 거부
--   (학생 자리를 각 상태 계정으로 바꾼 방을 쓴다)
begin;
update public.mentor_student_rooms set student_id = '33333333-3333-3333-3333-333333333333'
 where id = 'dddddddd-0000-0000-0000-00000000000d';
do $$ BEGIN perform pg_temp.assert_qna_blocked('ACCOUNT_BANNED', 'H-06 banned',
  '33333333-3333-3333-3333-333333333333'); END $$;
rollback;

begin;
update public.mentor_student_rooms set student_id = '44444444-4444-4444-4444-444444444444'
 where id = 'dddddddd-0000-0000-0000-00000000000d';
do $$ BEGIN perform pg_temp.assert_qna_blocked('ACCOUNT_SUSPENDED', 'H-07 유효 suspended',
  '44444444-4444-4444-4444-444444444444'); END $$;
rollback;

begin;
update public.mentor_student_rooms set student_id = '55555555-5555-5555-5555-555555555555'
 where id = 'dddddddd-0000-0000-0000-00000000000d';
do $$ BEGIN perform pg_temp.assert_qna_blocked('ACCOUNT_DELETION_IN_PROGRESS', 'H-08 deletion write-blocked',
  '55555555-5555-5555-5555-555555555555'); END $$;
rollback;

begin;
update public.mentor_student_rooms set student_id = '88888888-8888-8888-8888-888888888888'
 where id = 'dddddddd-0000-0000-0000-00000000000d';
do $$ BEGIN perform pg_temp.assert_qna_blocked('ACCOUNT_NOT_ACTIVE', 'H-09 deleted status',
  '88888888-8888-8888-8888-888888888888'); END $$;
rollback;

-- H-10 보존 회귀 — THREAD_LOCKED · NOT_ROOM_PARTY · MENTOR_NOT_APPROVED ·
--      SUBSCRIPTION_REFUND_PENDING · storage 검증
begin;
update public.question_threads set status = 'closed' where id = 'eeeeeeee-0000-0000-0000-00000000000e';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  BEGIN
    perform public.qna_append_message('eeeeeeee-0000-0000-0000-00000000000e', 'x');
    raise exception 'FAIL[H-10]: THREAD_LOCKED 가 발생하지 않았다';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'THREAD_LOCKED' THEN raise exception 'FAIL[H-10]: % (THREAD_LOCKED 기대)', SQLERRM; END IF;
    raise notice 'PASS H-10 THREAD_LOCKED 보존';
  END;
END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
do $$
BEGIN
  BEGIN
    perform public.qna_append_message('eeeeeeee-0000-0000-0000-00000000000e', 'x');
    raise exception 'FAIL[H-11]: NOT_ROOM_PARTY 가 발생하지 않았다';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NOT_ROOM_PARTY' THEN raise exception 'FAIL[H-11]: % (NOT_ROOM_PARTY 기대)', SQLERRM; END IF;
    raise notice 'PASS H-11 NOT_ROOM_PARTY 보존';
  END;
END $$;
rollback;

begin;
delete from public.mentor_profiles where user_id = 'bbbbbbbb-2222-2222-2222-222222222222';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-2222-2222-2222-222222222222', true);
do $$
BEGIN
  BEGIN
    perform public.qna_append_message('eeeeeeee-0000-0000-0000-00000000000e', 'x');
    raise exception 'FAIL[H-12]: MENTOR_NOT_APPROVED 가 발생하지 않았다';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'MENTOR_NOT_APPROVED' THEN raise exception 'FAIL[H-12]: % (MENTOR_NOT_APPROVED 기대)', SQLERRM; END IF;
    raise notice 'PASS H-12 MENTOR_NOT_APPROVED 보존';
  END;
END $$;
rollback;

begin;
insert into public.subscriptions (id, student_id, mentor_id, status)
values ('00000041-0000-0000-0000-000000000041', '11111111-1111-1111-1111-111111111111',
        'bbbbbbbb-2222-2222-2222-222222222222', 'active');
insert into public.refunds (subscription_id, status, request_type)
values ('00000041-0000-0000-0000-000000000041', 'pending', 'subscription_prorated');
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  BEGIN
    perform public.qna_append_message('eeeeeeee-0000-0000-0000-00000000000e', 'x');
    raise exception 'FAIL[H-13]: SUBSCRIPTION_REFUND_PENDING 가 발생하지 않았다';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SUBSCRIPTION_REFUND_PENDING' THEN raise exception 'FAIL[H-13]: % (기대 SUBSCRIPTION_REFUND_PENDING)', SQLERRM; END IF;
    raise notice 'PASS H-13 SUBSCRIPTION_REFUND_PENDING 보존';
  END;
END $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  BEGIN
    perform public.qna_register_attachment('eeeeeeee-0000-0000-0000-00000000000e', 'wrong/path/x.png');
    raise exception 'FAIL[H-14]: STORAGE_PATH_MISMATCH 가 발생하지 않았다';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'STORAGE_PATH_MISMATCH' THEN raise exception 'FAIL[H-14]: % (기대 STORAGE_PATH_MISMATCH)', SQLERRM; END IF;
    raise notice 'PASS H-14 STORAGE_PATH_MISMATCH 보존';
  END;
  BEGIN
    perform public.qna_register_attachment('eeeeeeee-0000-0000-0000-00000000000e',
      'dddddddd-0000-0000-0000-00000000000d/eeeeeeee-0000-0000-0000-00000000000e/m.png');
    raise exception 'FAIL[H-15]: STORAGE_OBJECT_NOT_OWNED 가 발생하지 않았다';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'STORAGE_OBJECT_NOT_OWNED' THEN raise exception 'FAIL[H-15]: % (기대 STORAGE_OBJECT_NOT_OWNED)', SQLERRM; END IF;
    raise notice 'PASS H-15 STORAGE_OBJECT_NOT_OWNED 보존';
  END;
END $$;
rollback;

-- =============================================================================
-- 보정 §4 (범위 I) — target_type='user' 신고 대상 무결성
-- =============================================================================
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
do $$
BEGIN
  insert into public.content_reports (reporter_id, target_type, target_id, reason)
  values ('11111111-1111-1111-1111-111111111111', 'user',
          '22222222-2222-2222-2222-222222222222', '기타');
  raise notice 'PASS I-01 상대 사용자 신고 성공';

  BEGIN
    insert into public.content_reports (reporter_id, target_type, target_id)
    values ('11111111-1111-1111-1111-111111111111', 'user', '11111111-1111-1111-1111-111111111111');
    raise exception 'FAIL[I-02]: 자기 신고가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS I-02 자기 신고 거부';
  END;

  BEGIN
    insert into public.content_reports (reporter_id, target_type, target_id)
    values ('11111111-1111-1111-1111-111111111111', 'user', 'ffffffff-0000-0000-0000-00000000000f');
    raise exception 'FAIL[I-03]: 존재하지 않는 대상 UUID 신고가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS I-03 미존재 대상 UUID 거부';
  END;

  BEGIN
    insert into public.content_reports (reporter_id, target_type, target_id)
    values ('11111111-1111-1111-1111-111111111111', 'user', null);
    raise exception 'FAIL[I-04]: target_id NULL 인 user 신고가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS I-04 target_id NULL 거부';
  END;

  -- 다른 target_type 계약은 불변 — 대상 실재 검사 없음
  insert into public.content_reports (reporter_id, target_type, target_id, reason)
  values ('11111111-1111-1111-1111-111111111111', 'community_post',
          'ffffffff-0000-0000-0000-00000000000f', '기타');
  raise notice 'PASS I-05 비-user target_type 계약 불변(대상 실재 검사 없음)';
END $$;
rollback;

-- I-06 banned reporter 가 정상 상대를 user 신고하는 것은 성공(과잉 차단 금지)
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
do $$
BEGIN
  insert into public.content_reports (reporter_id, target_type, target_id, reason)
  values ('33333333-3333-3333-3333-333333333333', 'user',
          '22222222-2222-2222-2222-222222222222', '기타');
  raise notice 'PASS I-06 banned reporter 의 user 신고 허용';
  -- 관리 필드 위조는 여전히 거부(회귀)
  BEGIN
    insert into public.content_reports (reporter_id, target_type, target_id, status)
    values ('33333333-3333-3333-3333-333333333333', 'user',
            '22222222-2222-2222-2222-222222222222', 'resolved');
    raise exception 'FAIL[I-07]: status 위조가 허용됐다';
  EXCEPTION WHEN insufficient_privilege THEN raise notice 'PASS I-07 user 신고에서도 관리 필드 위조 거부';
  END;
END $$;
rollback;

\echo '=== S3-C FORWARD VERIFY: ALL PASS ==='
