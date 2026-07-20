-- 136_p1_8a_question_room_atomic_rpc.sql
-- P1-8A: 구독 질문방 원자 RPC + free_question_usage.thread_id 수렴 (정본 수렴 파일)
--
-- 계보 메모
--   * 설계 정본: docs/audit/p1-8a_question_room_rpc_plan.md (원래 127_question_thread_rpcs.sql 로 예약).
--   * 본 정의는 PR #43(브랜치 claude/v16-web-db-autonomous-*)에서 staging 에 선적용됐다.
--     PR #43 의 파일 번호 130 은 이 브랜치의 130_shortform_scrap_reaction 과 충돌하므로,
--     정본 브랜치(PR #42)에서 다음 빈 고유 번호 136 으로 수렴한다. (131=P1-13 예약, 127=설계 예약 gap.)
--   * 선행 의존: 132_notification_outbox_foundation.sql (P1-11F: notification_outbox + record_domain_notification).
--     clean-install 시 132 가 반드시 136 보다 먼저 적용돼야 한다.
--   * 멱등(create or replace / add ... if not exists). staging 에 이미 적용된 부분은 no-op,
--     UNIQUE(thread_id)/UNIQUE(storage_path)/일반 create RPC/enhanced register 는 델타로 수렴.
--
-- 목적
--   * 무료 질문권 소비(free_question_usage)와 스레드 생성의 비원자·오짝 제거.
--   * free_question_usage.thread_id 수렴(FK ON DELETE SET NULL + UNIQUE) → 정확 1:1 링크.
--   * 생성 RPC가 무료/활성구독 자격을 서버에서 분기.
--   * 멘토 첫 메시지/첨부만 answered 전이 + record_domain_notification exactly-once.
--   * 계정상태·차단·멘토승인·자격 서버 재검사.
--
-- 전환 정책 (P1-8B 는 별도 · WAITING_EXTERNAL_APP)
--   * 순수 추가형. 기존 direct-write 정책·GRANT(qt_write_via_room/qm_insert/fqu_insert_own/
--     question_attachments_insert_via_room/049 storage) 유지. 앱 신버전 전 제거·revoke·open→pending 이관 금지.
--   * 무료사용 FK CASCADE 금지 → thread_id FK ON DELETE SET NULL.
--
-- 잠금값: 무료 총 7 / 멘토당 3 / 가입 후 7일. 주간(구독): limited4/standard9/premium999(get_weekly_question_usage).
--         status CHECK pending/answered/confirmed/open/closed/archived. mastery unknown/wrong/review/mastered.

begin;
set local lock_timeout = '5s';

-- ── 1) free_question_usage.thread_id 수렴 (추가형 + UNIQUE) ──
alter table public.free_question_usage add column if not exists thread_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint
    where conname='free_question_usage_thread_id_fkey' and conrelid='public.free_question_usage'::regclass) then
    alter table public.free_question_usage
      add constraint free_question_usage_thread_id_fkey
      foreign key (thread_id) references public.question_threads(id) on delete set null;
  end if;
  -- UNIQUE(thread_id): NULL 다중 허용(레거시), 신규 링크는 스레드당 1건.
  if not exists (select 1 from pg_constraint
    where conname='free_question_usage_thread_id_key' and conrelid='public.free_question_usage'::regclass) then
    alter table public.free_question_usage
      add constraint free_question_usage_thread_id_key unique (thread_id);
  end if;
end$$;

create index if not exists free_question_usage_thread_id_idx
  on public.free_question_usage (thread_id);

-- ── 1b) question_attachments.storage_path UNIQUE (0행 → 중복 대사 불필요) ──
do $$
begin
  if not exists (select 1 from pg_constraint
    where conname='question_attachments_storage_path_key' and conrelid='public.question_attachments'::regclass) then
    alter table public.question_attachments
      add constraint question_attachments_storage_path_key unique (storage_path);
  end if;
end$$;

-- ── 2) 질문 스레드 원자 생성 RPC (일반: 무료/활성구독 서버 분기, 학생 전용) ──
create or replace function public.qna_create_question_thread(
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
  v_has_active_sub boolean;
  v_usage json;
  v_path text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'TITLE_REQUIRED'; end if;

  select student_id, mentor_id into v_student, v_mentor
  from public.mentor_student_rooms where id = p_room_id;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;

  if v_uid <> v_student then
    if v_uid = v_mentor then raise exception 'MENTOR_CANNOT_CREATE_THREAD';
    else raise exception 'NOT_ROOM_PARTY'; end if;
  end if;

  -- 학생 단위 직렬화(무료 총/멘토별 한도 + 주간 한도 경쟁 안전).
  perform 1 from public.users where id = v_student for update;

  select status, suspended_until, created_at
    into v_status, v_suspended_until, v_created_at
  from public.users where id = v_student;
  if lower(coalesce(v_status,'active')) = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if lower(coalesce(v_status,'active')) = 'suspended'
     and (v_suspended_until is null or v_suspended_until > now()) then
    raise exception 'ACCOUNT_SUSPENDED';
  end if;

  if exists (select 1 from public.user_blocks
    where (blocker_id=v_student and blocked_id=v_mentor) or (blocker_id=v_mentor and blocked_id=v_student)) then
    raise exception 'BLOCKED';
  end if;

  if not public.individual_question_user_is_approved_mentor(v_mentor) then
    raise exception 'MENTOR_NOT_APPROVED';
  end if;

  -- 자격 분기: 활성 구독 vs 무료.
  v_has_active_sub := exists (
    select 1 from public.subscriptions
    where student_id = v_student and mentor_id = v_mentor and lower(coalesce(status,'')) = 'active'
  );

  if v_has_active_sub then
    v_usage := public.get_weekly_question_usage(v_student, v_mentor);
    if not coalesce((v_usage->>'can_ask')::boolean, false) then
      raise exception 'WEEKLY_LIMIT_EXHAUSTED';
    end if;
    v_path := 'subscription';
  else
    if v_created_at is not null and now() >= v_created_at + interval '7 days' then
      raise exception 'FREE_QUOTA_EXPIRED';
    end if;
    select count(*) into v_total from public.free_question_usage where student_id = v_student;
    if v_total >= 7 then raise exception 'FREE_QUOTA_TOTAL_EXHAUSTED'; end if;
    select count(*) into v_per from public.free_question_usage
      where student_id = v_student and mentor_id = v_mentor;
    if v_per >= 3 then raise exception 'FREE_QUOTA_MENTOR_EXHAUSTED'; end if;
    v_path := 'free';
  end if;

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

  if v_path = 'free' then
    insert into public.free_question_usage (student_id, mentor_id, thread_id)
    values (v_student, v_mentor, v_thread_id);
  end if;

  return jsonb_build_object(
    'ok', true, 'thread_id', v_thread_id, 'message_id', v_message_id,
    'path', v_path, 'used_free_quota', (v_path = 'free')
  );
end;
$$;

-- ── 2b) 무료 전용 진입점(레거시 호환): 일반 RPC 로 위임(추가형 — drop 금지). ──
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
begin
  return public.qna_create_question_thread(p_room_id, p_title, p_subject, p_topic, p_first_message_body);
end;
$$;

-- ── 3) 메시지 append RPC — 멘토 첫 답변만 answered 전이 + exactly-once 알림 ──
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

  select t.mentor_student_room_id, t.status, t.first_answered_at
    into v_room, v_thread_status, v_first_answered
  from public.question_threads t where t.id = p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;

  select student_id, mentor_id into v_student, v_mentor
  from public.mentor_student_rooms where id = v_room;

  if v_uid = v_mentor then v_is_mentor := true;
  elsif v_uid = v_student then v_is_mentor := false;
  else raise exception 'NOT_ROOM_PARTY'; end if;

  select status into v_status from public.users where id = v_uid;
  if lower(coalesce(v_status,'active')) = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;

  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;

  if v_is_mentor and not public.individual_question_user_is_approved_mentor(v_mentor) then
    raise exception 'MENTOR_NOT_APPROVED';
  end if;

  insert into public.question_messages (thread_id, author_id, body)
  values (p_thread_id, v_uid, btrim(p_body)) returning id into v_message_id;

  if v_is_mentor and v_first_answered is null then
    update public.question_threads
      set status='answered', first_answered_at=now(), updated_at=now()
    where id = p_thread_id and first_answered_at is null;
    v_transitioned := true;
    select coalesce(nullif(btrim(full_name),''), nullif(btrim(nickname),''), '멘토')
      into v_mentor_name from public.users where id = v_mentor;
    perform public.record_domain_notification(
      v_student,
      'question_answered:' || p_thread_id::text,
      'question_answered:' || p_thread_id::text,
      'question_answered', '새 답변이 도착했어요',
      coalesce(v_mentor_name,'멘토') || '님이 답변을 남겼습니다.',
      '/question-room/' || v_room::text || '?thread=' || p_thread_id::text,
      jsonb_build_object('room_id', v_room, 'thread_id', p_thread_id),
      jsonb_build_object('room_id', v_room, 'thread_id', p_thread_id)
    );
  end if;

  return jsonb_build_object('ok', true, 'message_id', v_message_id, 'answered_transition', v_transitioned);
end;
$$;

-- ── 4) 학생 확인 RPC (answered→confirmed) ──
create or replace function public.qna_confirm_thread(p_thread_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_status text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select t.mentor_student_room_id, t.status into v_room, v_status
  from public.question_threads t where t.id = p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id into v_student from public.mentor_student_rooms where id = v_room;
  if v_uid <> v_student then raise exception 'STUDENT_ONLY'; end if;
  if v_status = 'confirmed' then return jsonb_build_object('ok', true, 'thread_id', p_thread_id); end if;
  if v_status <> 'answered' then raise exception 'NOT_ANSWERED'; end if;
  update public.question_threads
    set status='confirmed', confirmed_at=coalesce(confirmed_at, now()), updated_at=now()
  where id = p_thread_id;
  return jsonb_build_object('ok', true, 'thread_id', p_thread_id);
end;
$$;

-- ── 5) 오답 표시 RPC (학생) ──
create or replace function public.qna_flag_wrong_answer(p_thread_id uuid, p_is_wrong boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_room uuid; v_student uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select t.mentor_student_room_id into v_room
  from public.question_threads t where t.id = p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id into v_student from public.mentor_student_rooms where id = v_room;
  if v_uid <> v_student then raise exception 'STUDENT_ONLY'; end if;
  update public.question_threads
    set is_wrong_answer=coalesce(p_is_wrong,true),
        mastery_status=case when coalesce(p_is_wrong,true) then 'wrong' else 'unknown' end,
        updated_at=now()
  where id = p_thread_id;
  return jsonb_build_object('ok', true, 'thread_id', p_thread_id, 'is_wrong_answer', coalesce(p_is_wrong,true));
end;
$$;

-- ── 6) 첨부 등록 RPC — 경로 thread-id 검증 + 멘토 첫 첨부 answered 전이 + exactly-once 알림 ──
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
  v_thread_status text;
  v_first_answered timestamptz;
  v_att_id uuid;
  v_is_mentor boolean;
  v_transitioned boolean := false;
  v_mentor_name text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_storage_path is null or btrim(p_storage_path) = '' then raise exception 'STORAGE_PATH_REQUIRED'; end if;

  select t.mentor_student_room_id, t.status, t.first_answered_at
    into v_room, v_thread_status, v_first_answered
  from public.question_threads t where t.id = p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;

  select student_id, mentor_id into v_student, v_mentor
  from public.mentor_student_rooms where id = v_room;
  if v_uid = v_mentor then v_is_mentor := true;
  elsif v_uid = v_student then v_is_mentor := false;
  else raise exception 'NOT_ROOM_PARTY'; end if;

  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;

  -- 경로 thread-id 검증: {room}/{thread}/... 프리픽스 (buildObjectPath 계약).
  if p_storage_path not like (v_room::text || '/' || p_thread_id::text || '/%') then
    raise exception 'STORAGE_PATH_MISMATCH';
  end if;

  if p_message_id is not null and not exists (
    select 1 from public.question_messages m where m.id = p_message_id and m.thread_id = p_thread_id
  ) then raise exception 'MESSAGE_THREAD_MISMATCH'; end if;

  insert into public.question_attachments (thread_id, message_id, author_id, storage_path, file_name, mime_type)
  values (p_thread_id, p_message_id, v_uid, btrim(p_storage_path), p_file_name, p_mime_type)
  returning id into v_att_id;

  if v_is_mentor and v_first_answered is null then
    update public.question_threads
      set status='answered', first_answered_at=now(), updated_at=now()
    where id = p_thread_id and first_answered_at is null;
    v_transitioned := true;
    select coalesce(nullif(btrim(full_name),''), nullif(btrim(nickname),''), '멘토')
      into v_mentor_name from public.users where id = v_mentor;
    perform public.record_domain_notification(
      v_student,
      'question_answered:' || p_thread_id::text,
      'question_answered:' || p_thread_id::text,
      'question_answered', '새 답변이 도착했어요',
      coalesce(v_mentor_name,'멘토') || '님이 파일을 보냈습니다.',
      '/question-room/' || v_room::text || '?thread=' || p_thread_id::text,
      jsonb_build_object('room_id', v_room, 'thread_id', p_thread_id),
      jsonb_build_object('room_id', v_room, 'thread_id', p_thread_id)
    );
  end if;

  return jsonb_build_object('ok', true, 'attachment_id', v_att_id, 'answered_transition', v_transitioned);
end;
$$;

-- ── 7) 권한: authenticated + service_role. public·anon revoke. ──
revoke all on function public.qna_create_question_thread(uuid,text,text,text,text) from public, anon;
revoke all on function public.qna_create_free_question_thread(uuid,text,text,text,text) from public, anon;
revoke all on function public.qna_append_message(uuid,text) from public, anon;
revoke all on function public.qna_confirm_thread(uuid) from public, anon;
revoke all on function public.qna_flag_wrong_answer(uuid,boolean) from public, anon;
revoke all on function public.qna_register_attachment(uuid,text,text,text,uuid) from public, anon;

grant execute on function public.qna_create_question_thread(uuid,text,text,text,text) to authenticated, service_role;
grant execute on function public.qna_create_free_question_thread(uuid,text,text,text,text) to authenticated, service_role;
grant execute on function public.qna_append_message(uuid,text) to authenticated, service_role;
grant execute on function public.qna_confirm_thread(uuid) to authenticated, service_role;
grant execute on function public.qna_flag_wrong_answer(uuid,boolean) to authenticated, service_role;
grant execute on function public.qna_register_attachment(uuid,text,text,text,uuid) to authenticated, service_role;

commit;

-- §V (rollback-only fixture): 무료/구독 경로 생성, thread_id UNIQUE, storage_path UNIQUE,
--   append/register 멘토 첫답 answered+exactly-once, confirm(answered 선행), wrong, 비당사자·한도 거부.
-- pending-refund lock 경계(결정 C)는 P1-13 billing-event 정본 확정 시 helper 로 교체 = WAITING_P1_13.
