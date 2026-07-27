-- 142_p1_8a_pending_refund_lock.sql
-- P1-8A 즉시 연동 — 활성 구독을 질문 자격으로 인정하기 전 pending refund 잠금 검사.
--
-- 계약(결정 C): 활성 구독 기반 자격을 인정하기 전에
--   1) 해당 subscription 행 FOR UPDATE 잠금
--   2) 잠근 구독의 두 canonical 구독 환불 유형(subscription_prorated / subscription_mentor_suspended)
--   3) live pending refund 존재를 별도 statement 로 검사
--   4) pending 이면 새 질문·후속 메시지·첨부(학생 측)를 거부.
-- 클라이언트 사전 검사에 의존하지 않는다. 무료 스레드(활성구독 없음)는 미적용.
-- P1-13 billing-event 정본 확정 시 last_billing_event_id 기준 helper 로 교체 가능한 경계.
--
-- 136/139 를 수정하지 않고 create/append/register RPC 를 본문 포함 재정의(create or replace). 순수 로직 추가.
-- 선행: 131(refunds/subscriptions)·136·139.

begin;
set local lock_timeout='5s';

-- 잠근 구독의 live pending 구독 환불 존재 여부(별도 statement 로 호출).
create or replace function public.qna_subscription_has_live_refund(p_subscription_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.refunds r
    where r.subscription_id = p_subscription_id
      and r.status = 'pending'
      and r.request_type in ('subscription_prorated','subscription_mentor_suspended')
  );
$$;
revoke all on function public.qna_subscription_has_live_refund(uuid) from public, anon;
grant execute on function public.qna_subscription_has_live_refund(uuid) to authenticated, service_role;

-- create: 구독 경로에서 subscription FOR UPDATE + pending-refund 게이트.
create or replace function public.qna_create_question_thread(
  p_room_id uuid, p_title text, p_subject text default null, p_topic text default null, p_first_message_body text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_student uuid; v_mentor uuid; v_status text; v_suspended_until timestamptz;
  v_created_at timestamptz; v_total int; v_per int; v_subject text; v_thread_id uuid; v_message_id uuid;
  v_has_active_sub boolean; v_usage json; v_path text; v_sub_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_title is null or btrim(p_title)='' then raise exception 'TITLE_REQUIRED'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=p_room_id;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_uid <> v_student then
    if v_uid = v_mentor then raise exception 'MENTOR_CANNOT_CREATE_THREAD'; else raise exception 'NOT_ROOM_PARTY'; end if;
  end if;
  perform 1 from public.users where id=v_student for update;
  select status, suspended_until, created_at into v_status, v_suspended_until, v_created_at from public.users where id=v_student;
  if lower(coalesce(v_status,'active'))='banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if lower(coalesce(v_status,'active'))='suspended' and (v_suspended_until is null or v_suspended_until > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if exists (select 1 from public.user_blocks where (blocker_id=v_student and blocked_id=v_mentor) or (blocker_id=v_mentor and blocked_id=v_student)) then raise exception 'BLOCKED'; end if;
  if not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;

  v_has_active_sub := exists (select 1 from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active');
  if v_has_active_sub then
    -- 결정 C: 활성 구독 FOR UPDATE 잠금 후 별도 statement 로 live pending refund 검사.
    select id into v_sub_id from public.subscriptions
      where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then
      raise exception 'SUBSCRIPTION_REFUND_PENDING';
    end if;
    v_usage := public.get_weekly_question_usage(v_student, v_mentor);
    if not coalesce((v_usage->>'can_ask')::boolean, false) then raise exception 'WEEKLY_LIMIT_EXHAUSTED'; end if;
    v_path := 'subscription';
  else
    if v_created_at is not null and now() >= v_created_at + interval '7 days' then raise exception 'FREE_QUOTA_EXPIRED'; end if;
    select count(*) into v_total from public.free_question_usage where student_id=v_student;
    if v_total >= 7 then raise exception 'FREE_QUOTA_TOTAL_EXHAUSTED'; end if;
    select count(*) into v_per from public.free_question_usage where student_id=v_student and mentor_id=v_mentor;
    if v_per >= 3 then raise exception 'FREE_QUOTA_MENTOR_EXHAUSTED'; end if;
    v_path := 'free';
  end if;

  v_subject := nullif(btrim(coalesce(p_subject,'')),'');
  if v_subject is not null and not exists (select 1 from public.subjects where code=v_subject) then v_subject := null; end if;
  insert into public.question_threads (mentor_student_room_id, title, status, subject, topic)
  values (p_room_id, btrim(p_title), 'pending', v_subject, nullif(btrim(coalesce(p_topic,'')),'')) returning id into v_thread_id;
  if p_first_message_body is not null and btrim(p_first_message_body) <> '' then
    insert into public.question_messages (thread_id, author_id, body) values (v_thread_id, v_student, btrim(p_first_message_body)) returning id into v_message_id;
  end if;
  if v_path='free' then
    insert into public.free_question_usage (student_id, mentor_id, thread_id) values (v_student, v_mentor, v_thread_id);
  end if;
  return jsonb_build_object('ok',true,'thread_id',v_thread_id,'message_id',v_message_id,'path',v_path,'used_free_quota',(v_path='free'));
end; $$;

-- append: 학생 후속 메시지도 활성 구독 pending-refund 게이트.
create or replace function public.qna_append_message(p_thread_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_status text; v_thread_status text;
  v_first_answered timestamptz; v_message_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_mentor_name text; v_sub_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_body is null or btrim(p_body)='' then raise exception 'BODY_REQUIRED'; end if;
  select t.mentor_student_room_id, t.status, t.first_answered_at into v_room, v_thread_status, v_first_answered
    from public.question_threads t where t.id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if v_uid=v_mentor then v_is_mentor:=true; elsif v_uid=v_student then v_is_mentor:=false; else raise exception 'NOT_ROOM_PARTY'; end if;
  select status into v_status from public.users where id=v_uid;
  if lower(coalesce(v_status,'active'))='banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;
  if v_is_mentor and not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;
  -- 학생 후속 메시지: 활성 구독 FOR UPDATE + live pending refund 게이트.
  if not v_is_mentor then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
  end if;

  insert into public.question_messages (thread_id, author_id, body) values (p_thread_id, v_uid, btrim(p_body)) returning id into v_message_id;
  if v_is_mentor and v_first_answered is null then
    update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
    v_transitioned := true;
    select coalesce(nullif(btrim(full_name),''), nullif(btrim(nickname),''), '멘토') into v_mentor_name from public.users where id=v_mentor;
    perform public.record_domain_notification(v_student, 'question_answered:'||p_thread_id::text, 'question_answered:'||p_thread_id::text,
      'question_answered','새 답변이 도착했어요', coalesce(v_mentor_name,'멘토')||'님이 답변을 남겼습니다.',
      '/question-room/'||v_room::text||'?thread='||p_thread_id::text,
      jsonb_build_object('room_id',v_room,'thread_id',p_thread_id), jsonb_build_object('room_id',v_room,'thread_id',p_thread_id));
  end if;
  return jsonb_build_object('ok',true,'message_id',v_message_id,'answered_transition',v_transitioned);
end; $$;

-- register: 학생 첨부도 활성 구독 pending-refund 게이트(139 계약 + refund).
create or replace function public.qna_register_attachment(
  p_thread_id uuid, p_storage_path text, p_file_name text default null, p_mime_type text default null, p_message_id uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_thread_status text;
  v_first_answered timestamptz; v_att_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_mentor_name text; v_sub_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_storage_path is null or btrim(p_storage_path)='' then raise exception 'STORAGE_PATH_REQUIRED'; end if;
  select t.mentor_student_room_id, t.status, t.first_answered_at into v_room, v_thread_status, v_first_answered
    from public.question_threads t where t.id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if v_uid=v_mentor then v_is_mentor:=true; elsif v_uid=v_student then v_is_mentor:=false; else raise exception 'NOT_ROOM_PARTY'; end if;
  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;
  if p_storage_path not like (v_room::text || '/' || p_thread_id::text || '/%') then raise exception 'STORAGE_PATH_MISMATCH'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='question-room-attachments' and o.name = btrim(p_storage_path) and o.owner_id = v_uid::text) then raise exception 'STORAGE_OBJECT_NOT_OWNED'; end if;
  if p_message_id is not null and not exists (select 1 from public.question_messages m where m.id=p_message_id and m.thread_id=p_thread_id) then raise exception 'MESSAGE_THREAD_MISMATCH'; end if;
  if not v_is_mentor then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
  end if;

  insert into public.question_attachments (thread_id, message_id, author_id, storage_path, file_name, mime_type)
  values (p_thread_id, p_message_id, v_uid, btrim(p_storage_path), p_file_name, p_mime_type) returning id into v_att_id;
  if v_is_mentor and v_first_answered is null then
    update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
    v_transitioned := true;
    select coalesce(nullif(btrim(full_name),''), nullif(btrim(nickname),''), '멘토') into v_mentor_name from public.users where id=v_mentor;
    perform public.record_domain_notification(v_student, 'question_answered:'||p_thread_id::text, 'question_answered:'||p_thread_id::text,
      'question_answered','새 답변이 도착했어요', coalesce(v_mentor_name,'멘토')||'님이 파일을 보냈습니다.',
      '/question-room/'||v_room::text||'?thread='||p_thread_id::text,
      jsonb_build_object('room_id',v_room,'thread_id',p_thread_id), jsonb_build_object('room_id',v_room,'thread_id',p_thread_id));
  end if;
  return jsonb_build_object('ok',true,'attachment_id',v_att_id,'answered_transition',v_transitioned);
end; $$;

revoke all on function public.qna_create_question_thread(uuid,text,text,text,text) from public, anon;
revoke all on function public.qna_append_message(uuid,text) from public, anon;
revoke all on function public.qna_register_attachment(uuid,text,text,text,uuid) from public, anon;
grant execute on function public.qna_create_question_thread(uuid,text,text,text,text) to authenticated, service_role;
grant execute on function public.qna_append_message(uuid,text) to authenticated, service_role;
grant execute on function public.qna_register_attachment(uuid,text,text,text,uuid) to authenticated, service_role;

commit;

-- §V(rollback-only): 활성구독+pending 환불(subscription_prorated/mentor_suspended) → 생성·학생append·
--   학생첨부 SUBSCRIPTION_REFUND_PENDING 거부 · 환불 없으면 정상 · 무료 스레드 미적용 · 멘토 답변 무영향.
