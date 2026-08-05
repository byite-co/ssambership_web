-- 20260805170000_qna_question_received_notification.sql
--
-- 목적
--   * 구독형 새 질문(qna_create_question_thread, path='subscription') 생성 시
--     해당 방 멘토에게 인앱 알림(question_received)을 기록한다.
--   * 지금까지 구독형 QnA 알림은 question_answered(→ 학생) 1종뿐 —
--     멘토는 새 질문을 알림으로 받지 못했다(앱/웹 공통 서버 공백).
--
-- 계약
--   * type: question_received / recipient: mentor_student_rooms.mentor_id
--   * title: 새 질문이 도착했어요 / body: 학생이 새 질문을 등록했어요.
--   * metadata: room_id, thread_id, student_id
--   * event_key = dedup_key = 'question_received:{thread_id}' —
--     같은 스레드 재처리 시 (recipient,event_key) UNIQUE(132) 로 중복 0.
--   * record_domain_notification 재사용 → notification_outbox 적재(푸시 게이트
--     §14.6 push_transport_enabled)도 기존 경로 그대로.
--   * 생성 RPC 트랜잭션 '안'에서 호출 — 질문 생성 실패 시 알림 0건(원자).
--   * 무료 질문 경로(path='free')에서는 생성하지 않는다.
--   * 학생 본인 수신 알림은 만들지 않는다(수신자는 멘토 고정).
--
-- 선행: 132_notification_outbox_foundation.sql (record_domain_notification),
--       136_p1_8a_question_room_atomic_rpc.sql (qna_create_question_thread).
-- 멱등: create or replace — 재적용 안전. 과거 migration 은 수정하지 않는다.

begin;
set local lock_timeout = '5s';

create or replace function public.qna_create_question_thread(
  p_room_id uuid,
  p_title text,
  p_subject text default null,
  p_topic text default null,
  p_first_message_body text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
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
  if v_path='free' then insert into public.free_question_usage (student_id, mentor_id, thread_id) values (v_student, v_mentor, v_thread_id); end if;

  -- ── 신규(20260805): 구독 경로 새 질문 → 방 멘토 인앱 알림(question_received) ──
  -- 같은 트랜잭션 안 — 위 생성이 롤백되면 알림도 롤백(원자), record_domain_notification
  -- 이 (recipient,event_key) 멱등 + outbox 게이트를 기존 계약대로 처리한다.
  if v_path = 'subscription' then
    perform public.record_domain_notification(
      v_mentor,
      'question_received:' || v_thread_id::text,
      'question_received:' || v_thread_id::text,
      'question_received',
      '새 질문이 도착했어요',
      '학생이 새 질문을 등록했어요.',
      '/mentor/question-room/' || p_room_id::text || '?thread=' || v_thread_id::text,
      jsonb_build_object('room_id', p_room_id, 'thread_id', v_thread_id, 'student_id', v_student),
      jsonb_build_object('room_id', p_room_id, 'thread_id', v_thread_id, 'student_id', v_student)
    );
  end if;

  return jsonb_build_object('ok',true,'thread_id',v_thread_id,'message_id',v_message_id,'path',v_path,'used_free_quota',(v_path='free'));
end;
$$;

commit;
