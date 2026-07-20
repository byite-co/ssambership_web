-- 130_p1_8a_question_room_atomic_rpc.sql
-- P1-8A: 구독 질문방(mentor_student_rooms → question_threads → question_messages) 원자 RPC + 웹 전환 기반.
--
-- 목적
--   * 무료 질문권 사용(free_question_usage)과 스레드 생성의 비원자 경쟁 제거.
--     기존: 게이트가 free_question_usage 를 먼저 INSERT → 별도로 thread INSERT → 사후에
--     "사용시각 ↔ thread.created_at 15분 근접" 휴리스틱(freeQuestionUsage.ts:195)으로 짝짓기.
--     문제: (a) thread 생성 실패 시 무료권만 소모, (b) 동일 멘토에 빠른 2회 질문 시 오짝.
--   * free_question_usage.thread_id 수렴 → 정확한 1:1 링크.
--   * 멘토 첫 답변만 answered 전이 + P1-11F canonical event(record_domain_notification)로 exactly-once 알림.
--   * 계정 상태/차단/멘토 승인/무료 자격을 서버(RPC)에서 재검사.
--
-- 안전/전환 정책 (P1-8B 는 별도)
--   * 순수 추가형. 기존 정책·컬럼·함수 변경 없음.
--   * 기존 authenticated direct-write 정책(qt_write_via_room, qm_insert, fqu_insert_own,
--     question_attachments_insert_via_room)은 그대로 유지 — 앱 전환 완료 전 direct 정책 제거/revoke 금지.
--   * 무료사용 FK 에 CASCADE 금지 → thread_id FK 는 ON DELETE SET NULL.
--   * 선행: 044/046/052(free_question_usage), 049/117(question_attachments), 038/117(realtime),
--           record_domain_notification(P1-11F foundation, 실DB 확인).
--
-- 잠금값
--   * 무료권: 총 7회 / 멘토당 3회 / 가입 후 7일(users.created_at) — lib/mentor/freeQuestionPolicy.ts 정본과 일치.
--   * question_threads.status CHECK: pending/answered/confirmed/open/closed/archived.
--   * mastery_status CHECK: unknown/wrong/review/mastered.

begin;

set local lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) free_question_usage.thread_id 수렴 (추가형)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.free_question_usage
  add column if not exists thread_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'free_question_usage_thread_id_fkey'
      and conrelid = 'public.free_question_usage'::regclass
  ) then
    alter table public.free_question_usage
      add constraint free_question_usage_thread_id_fkey
      foreign key (thread_id) references public.question_threads(id) on delete set null;
  end if;
end$$;

create index if not exists free_question_usage_thread_id_idx
  on public.free_question_usage (thread_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 무료 질문 스레드 원자 생성 RPC (학생 전용)
--    스레드 생성 + (선택)첫 메시지 + 무료권 소비(thread_id 링크)를 한 트랜잭션으로.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.qna_create_free_question_thread(
  p_room_id uuid,
  p_title text,
  p_subject text default null,
  p_topic text default null,
  p_first_message_body text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_student uuid;
  v_mentor uuid;
  v_status text;
  v_suspended_until timestamptz;
  v_created_at timestamptz;
  v_total int;
  v_per int;
  v_subject text;
  v_thread_id uuid;
  v_message_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'TITLE_REQUIRED'; end if;

  select student_id, mentor_id into v_student, v_mentor
  from public.mentor_student_rooms where id = p_room_id;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  -- 당사자·역할 재검사: 스레드 생성은 해당 room 의 학생만.
  if v_uid <> v_student then
    if v_uid = v_mentor then raise exception 'MENTOR_CANNOT_CREATE_THREAD';
    else raise exception 'NOT_ROOM_PARTY'; end if;
  end if;

  -- 학생 단위 직렬화(총/멘토별 한도 경쟁 안전) — 무료권 소비는 학생 행 잠금으로 순서화.
  perform 1 from public.users where id = v_student for update;

  -- 계정 상태 재검사 (lazy: suspended_until 경과 시 active).
  select status, suspended_until, created_at
    into v_status, v_suspended_until, v_created_at
  from public.users where id = v_student;
  if lower(coalesce(v_status,'active')) = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if lower(coalesce(v_status,'active')) = 'suspended'
     and (v_suspended_until is null or v_suspended_until > now()) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  -- 상호 차단 재검사.
  if exists (
    select 1 from public.user_blocks
    where (blocker_id = v_student and blocked_id = v_mentor)
       or (blocker_id = v_mentor and blocked_id = v_student)
  ) then raise exception 'BLOCKED'; end if;

  -- 멘토 승인 재검사(승인 멘토에게만 무료질문).
  if not public.individual_question_user_is_approved_mentor(v_mentor) then
    raise exception 'MENTOR_NOT_APPROVED';
  end if;

  -- 무료 자격 재검사: 만료 / 총 7 / 멘토당 3.
  if v_created_at is not null and now() >= v_created_at + interval '7 days' then
    raise exception 'FREE_QUOTA_EXPIRED';
  end if;
  select count(*) into v_total from public.free_question_usage where student_id = v_student;
  if v_total >= 7 then raise exception 'FREE_QUOTA_TOTAL_EXHAUSTED'; end if;
  select count(*) into v_per from public.free_question_usage
    where student_id = v_student and mentor_id = v_mentor;
  if v_per >= 3 then raise exception 'FREE_QUOTA_MENTOR_EXHAUSTED'; end if;

  -- subject 는 유효 코드일 때만(FK subjects.code) — 무효 코드는 null 로 저장.
  v_subject := nullif(btrim(coalesce(p_subject,'')), '');
  if v_subject is not null and not exists (select 1 from public.subjects where code = v_subject) then
    v_subject := null;
  end if;

  insert into public.question_threads (mentor_student_room_id, title, status, subject, topic)
  values (p_room_id, btrim(p_title), 'pending', v_subject, nullif(btrim(coalesce(p_topic,'')), ''))
  returning id into v_thread_id;

  if p_first_message_body is not null and btrim(p_first_message_body) <> '' then
    insert into public.question_messages (thread_id, author_id, body)
    values (v_thread_id, v_student, btrim(p_first_message_body))
    returning id into v_message_id;
  end if;

  insert into public.free_question_usage (student_id, mentor_id, thread_id)
  values (v_student, v_mentor, v_thread_id);

  return jsonb_build_object(
    'ok', true, 'thread_id', v_thread_id, 'message_id', v_message_id, 'used_free_quota', true
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) 메시지 append RPC — 멘토 첫 답변만 answered 전이 + exactly-once 알림.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.qna_append_message(
  p_thread_id uuid,
  p_body text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_room uuid;
  v_student uuid;
  v_mentor uuid;
  v_status text;
  v_thread_status text;
  v_first_answered timestamptz;
  v_message_id uuid;
  v_is_mentor boolean;
  v_transitioned boolean := false;
  v_mentor_name text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_body is null or btrim(p_body) = '' then raise exception 'BODY_REQUIRED'; end if;

  -- 스레드 잠금 → 멘토 첫 답변 판정 경쟁 안전.
  select t.mentor_student_room_id, t.status, t.first_answered_at
    into v_room, v_thread_status, v_first_answered
  from public.question_threads t
  where t.id = p_thread_id
  for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;

  select student_id, mentor_id into v_student, v_mentor
  from public.mentor_student_rooms where id = v_room;

  if v_uid = v_mentor then v_is_mentor := true;
  elsif v_uid = v_student then v_is_mentor := false;
  else raise exception 'NOT_ROOM_PARTY'; end if;

  -- 계정 상태(작성자) 재검사.
  select status into v_status from public.users where id = v_uid;
  if lower(coalesce(v_status,'active')) = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;

  -- 완료/종료 스레드는 메시지 거부.
  if v_thread_status in ('confirmed','closed','archived') then
    raise exception 'THREAD_LOCKED';
  end if;

  -- 멘토 답변 시 멘토 승인 재검사.
  if v_is_mentor and not public.individual_question_user_is_approved_mentor(v_mentor) then
    raise exception 'MENTOR_NOT_APPROVED';
  end if;

  insert into public.question_messages (thread_id, author_id, body)
  values (p_thread_id, v_uid, btrim(p_body))
  returning id into v_message_id;

  -- 멘토의 첫 콘텐츠에서만 answered 전이(멱등).
  if v_is_mentor and v_first_answered is null then
    update public.question_threads
      set status = 'answered', first_answered_at = now(), updated_at = now()
    where id = p_thread_id and first_answered_at is null;
    v_transitioned := true;

    -- exactly-once 알림(학생에게 1회). event_key/dedup_key = thread 단위.
    select coalesce(nullif(btrim(full_name), ''), nullif(btrim(nickname), ''), '멘토')
      into v_mentor_name from public.users where id = v_mentor;
    perform public.record_domain_notification(
      v_student,
      'question_answered:' || p_thread_id::text,
      'question_answered:' || p_thread_id::text,
      'question_answered',
      '새 답변이 도착했어요',
      coalesce(v_mentor_name, '멘토') || '님이 답변을 남겼습니다.',
      '/question-room/' || v_room::text || '?thread=' || p_thread_id::text,
      jsonb_build_object('room_id', v_room, 'thread_id', p_thread_id),
      jsonb_build_object('room_id', v_room, 'thread_id', p_thread_id)
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'message_id', v_message_id, 'answered_transition', v_transitioned
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) 학생 확인 RPC (confirmed 전이).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.qna_confirm_thread(
  p_thread_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_room uuid;
  v_student uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select t.mentor_student_room_id into v_room
  from public.question_threads t where t.id = p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;

  select student_id into v_student from public.mentor_student_rooms where id = v_room;
  if v_uid <> v_student then raise exception 'STUDENT_ONLY'; end if;

  update public.question_threads
    set status = 'confirmed', confirmed_at = coalesce(confirmed_at, now()), updated_at = now()
  where id = p_thread_id;

  return jsonb_build_object('ok', true, 'thread_id', p_thread_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) 오답 표시 RPC (학생: is_wrong_answer + mastery_status='wrong').
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.qna_flag_wrong_answer(
  p_thread_id uuid,
  p_is_wrong boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_room uuid;
  v_student uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select t.mentor_student_room_id into v_room
  from public.question_threads t where t.id = p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;

  select student_id into v_student from public.mentor_student_rooms where id = v_room;
  if v_uid <> v_student then raise exception 'STUDENT_ONLY'; end if;

  update public.question_threads
    set is_wrong_answer = coalesce(p_is_wrong, true),
        mastery_status = case when coalesce(p_is_wrong, true) then 'wrong' else 'unknown' end,
        updated_at = now()
  where id = p_thread_id;

  return jsonb_build_object('ok', true, 'thread_id', p_thread_id, 'is_wrong_answer', coalesce(p_is_wrong, true));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) 첨부 등록 RPC — Storage 업로드는 웹에서, 메타 등록은 당사자 재검사 후 원자적으로.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.qna_register_attachment(
  p_thread_id uuid,
  p_storage_path text,
  p_file_name text default null,
  p_mime_type text default null,
  p_message_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_room uuid;
  v_student uuid;
  v_mentor uuid;
  v_att_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_storage_path is null or btrim(p_storage_path) = '' then raise exception 'STORAGE_PATH_REQUIRED'; end if;

  select t.mentor_student_room_id into v_room
  from public.question_threads t where t.id = p_thread_id;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;

  select student_id, mentor_id into v_student, v_mentor
  from public.mentor_student_rooms where id = v_room;
  if v_uid <> v_student and v_uid <> v_mentor then raise exception 'NOT_ROOM_PARTY'; end if;

  -- message_id 가 주어지면 동일 thread 소속이어야 함.
  if p_message_id is not null and not exists (
    select 1 from public.question_messages m where m.id = p_message_id and m.thread_id = p_thread_id
  ) then raise exception 'MESSAGE_THREAD_MISMATCH'; end if;

  insert into public.question_attachments (thread_id, message_id, author_id, storage_path, file_name, mime_type)
  values (p_thread_id, p_message_id, v_uid, btrim(p_storage_path), p_file_name, p_mime_type)
  returning id into v_att_id;

  return jsonb_build_object('ok', true, 'attachment_id', v_att_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) 권한: authenticated(웹 세션) + service_role 만. anon/public 제거.
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase 기본 권한(alter default privileges)이 함수 생성 시 anon/authenticated/service_role 에
-- EXECUTE 를 자동 부여하므로, public 뿐 아니라 anon 도 명시적으로 회수한다.
revoke all on function public.qna_create_free_question_thread(uuid,text,text,text,text) from public, anon;
revoke all on function public.qna_append_message(uuid,text) from public, anon;
revoke all on function public.qna_confirm_thread(uuid) from public, anon;
revoke all on function public.qna_flag_wrong_answer(uuid,boolean) from public, anon;
revoke all on function public.qna_register_attachment(uuid,text,text,text,uuid) from public, anon;

grant execute on function public.qna_create_free_question_thread(uuid,text,text,text,text) to authenticated, service_role;
grant execute on function public.qna_append_message(uuid,text) to authenticated, service_role;
grant execute on function public.qna_confirm_thread(uuid) to authenticated, service_role;
grant execute on function public.qna_flag_wrong_answer(uuid,boolean) to authenticated, service_role;
grant execute on function public.qna_register_attachment(uuid,text,text,text,uuid) to authenticated, service_role;

commit;

-- §V 검증 쿼리 (별도 rollback-only fixture 트랜잭션에서 수행):
--  §V-1 컬럼: free_question_usage.thread_id 존재, nullable, FK ON DELETE SET NULL.
--  §V-2 함수 5종 SECURITY DEFINER, execute = {authenticated, service_role} 만.
--  §V-3 무료 스레드 원자 생성: thread + message + usage(thread_id 링크) 동시 존재.
--  §V-4 무료 한도(총 7·멘토 3·만료) 각각 거부.
--  §V-5 멘토 첫 답변만 answered 전이 + notification/outbox 1행(멱등 재호출 시 무증가).
--  §V-6 비당사자/역할 위반 거부.
