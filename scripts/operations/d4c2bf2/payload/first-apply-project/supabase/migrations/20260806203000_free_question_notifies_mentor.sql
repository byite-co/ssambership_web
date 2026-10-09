-- [S1-7 2026-08-06] QA-C13 — 무료질문은 멘토에게 알림이 가지 않는다.
--
-- 현상: qna_create_question_thread 가 새 질문 알림(question_received)을
--       `if v_path = 'subscription'` 일 때만 기록한다. 무료질문 경로(v_path='free')
--       는 제외돼 있어, 멘토가 목록을 직접 열어보지 않으면 무료질문이 방치된다.
--       (qna_create_free_question_thread 는 이 함수에 위임만 한다)
--
-- 결정(오너 판단 2026-08-06): **무료질문도 멘토에게 알린다.**
--   구독 알림 확장(C17 멘토용 구독 알림 · C18 구독 시작 알림)은 이번 배치에
--   넣지 않고 다음 라운드로 미룬다.
--
-- 수정: 알림 기록을 감싸던 경로 조건(if v_path='subscription' … end if)만 제거한다.
--       그 외 본문은 정본(20260805162500 as-applied)과 한 글자도 다르지 않다.
--       문구('새 질문이 도착했어요' / '학생이 새 질문을 등록했어요.')는 두 경로
--       모두에 정확하므로 그대로 쓴다. event_key 는 종전대로
--       question_received:<thread_id> — 스레드당 1회 멱등이고 타입도 기존
--       question_received 라 앱 수정이 필요 없다.
CREATE OR REPLACE FUNCTION public.qna_create_question_thread(p_room_id uuid, p_title text, p_subject text DEFAULT NULL::text, p_topic text DEFAULT NULL::text, p_first_message_body text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- ── 새 질문 → 방 멘토 인앱 알림(question_received) ──
  -- 20260805 도입(구독 한정) → S1-7/QA-C13 에서 무료 경로까지 확장.
  -- 같은 트랜잭션 안 — 위 생성이 롤백되면 알림도 롤백(원자), record_domain_notification
  -- 이 (recipient,event_key) 멱등 + outbox 게이트를 기존 계약대로 처리한다.
  -- S1-7/QA-C13: 무료·구독 경로 모두 알린다(종전에는 subscription 한정 조건이 있었다).
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

  return jsonb_build_object('ok',true,'thread_id',v_thread_id,'message_id',v_message_id,'path',v_path,'used_free_quota',(v_path='free'));
end;
$function$;
