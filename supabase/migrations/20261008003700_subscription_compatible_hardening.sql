-- Compatible hardening: no app signature, navigation, or payment entry-point changes.
begin;
set local lock_timeout='5s';
do $gate$ begin if md5(replace(pg_get_functiondef('public.qna_create_question_thread(uuid,text,text,text,text)'::regprocedure),chr(13),'')) <> '18ec99f1b887daf3bfc6193cb0697d47' then raise exception 'HARDENING_SOURCE_DRIFT: public.qna_create_question_thread'; end if; end $gate$;
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
  if char_length(p_title)>120 then raise exception 'TITLE_TOO_LONG'; end if;
  if char_length(p_topic)>80 then raise exception 'TOPIC_TOO_LONG'; end if;
  if char_length(p_first_message_body)>10000 then raise exception 'MESSAGE_TOO_LONG'; end if;
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
  if v_subject is not null and not exists (select 1 from public.subjects where code=v_subject) then raise exception 'SUBJECT_INVALID'; end if;
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
$function$
;
do $gate$ begin if md5(replace(pg_get_functiondef('public.qna_append_message(uuid,text)'::regprocedure),chr(13),'')) <> 'd3b9fafabe67cd8656cf3aa897bc7447' then raise exception 'HARDENING_SOURCE_DRIFT: public.qna_append_message'; end if; end $gate$;
CREATE OR REPLACE FUNCTION public.qna_append_message(p_thread_id uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_status text; v_thread_status text;
  v_first_answered timestamptz; v_message_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_sub_id uuid;
  v_susp timestamptz; v_norm text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_body is null or btrim(p_body)='' then raise exception 'BODY_REQUIRED'; end if;
  if char_length(p_body)>10000 then raise exception 'MESSAGE_TOO_LONG'; end if;
  select t.mentor_student_room_id, t.status, t.first_answered_at into v_room, v_thread_status, v_first_answered
    from public.question_threads t where t.id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if v_uid=v_mentor then v_is_mentor:=true; elsif v_uid=v_student then v_is_mentor:=false; else raise exception 'NOT_ROOM_PARTY'; end if;

  -- [S3-C 보정 §3] 당사자 확정 직후 — 계정 상태 4종 + 상호 차단. 이 아래로는
  -- 어떤 INSERT·상태 전이도 없으므로 차단 시 부수효과 0 이다.
  select u.status, u.suspended_until into v_status, v_susp from public.users u where u.id=v_uid;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  v_norm := lower(btrim(coalesce(v_status,'')));
  if v_norm='banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_norm='suspended' and (v_susp is null or v_susp > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if v_norm not in ('active','suspended') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if public.account_deletion_write_blocked(v_uid) then raise exception 'ACCOUNT_DELETION_IN_PROGRESS'; end if;
  if public.qna_users_blocked(v_student, v_mentor) then raise exception 'BLOCKED'; end if;

  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;
  if v_is_mentor and not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;
  -- 학생 후속 메시지: 활성 구독 FOR UPDATE + live pending refund 게이트(142 유지).
  if not v_is_mentor then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
  end if;

  -- F2(D-12)+R1: 아래 INSERT 가 AFTER INSERT 알림 트리거를 발화 — 멘토 메시지 행 1건 = 알림 정확히 1건.
  insert into public.question_messages (thread_id, author_id, body) values (p_thread_id, v_uid, btrim(p_body)) returning id into v_message_id;
  if v_is_mentor and v_first_answered is null then
    update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
    v_transitioned := true;
  end if;
  return jsonb_build_object('ok',true,'message_id',v_message_id,'answered_transition',v_transitioned);
end; $function$
;
do $gate$ begin if md5(replace(pg_get_functiondef('api_web_v1.qna_create_question_thread(uuid,text,text,text,text)'::regprocedure),chr(13),'')) <> 'd30630a9bdfd2b6dd5039884a97b0f21' then raise exception 'HARDENING_SOURCE_DRIFT: api_web_v1.qna_create_question_thread'; end if; end $gate$;
CREATE OR REPLACE FUNCTION api_web_v1.qna_create_question_thread(p_room_id uuid, p_title text, p_subject text DEFAULT NULL::text, p_topic text DEFAULT NULL::text, p_first_message_body text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_res  jsonb;
  v_code text;
BEGIN
  -- 판정 로직을 복제하지 않는다 — 정본 호출 + 예외의 안정 코드 변환만(§13.2)
  v_res := public.qna_create_question_thread(p_room_id, p_title, p_subject, p_topic, p_first_message_body);
  RETURN v_res || jsonb_build_object('contract_version', 1);
EXCEPTION WHEN OTHERS THEN
  v_code := CASE SQLERRM
    -- 트리거 코드 수렴(XW-08 — §9.8 매핑표)
    WHEN 'FREE_QUESTION_EXPIRED'           THEN 'FREE_QUOTA_EXPIRED'
    WHEN 'FREE_QUESTION_TOTAL_LIMIT'       THEN 'FREE_QUOTA_TOTAL_EXHAUSTED'
    WHEN 'FREE_QUESTION_PER_MENTOR_LIMIT'  THEN 'FREE_QUOTA_MENTOR_EXHAUSTED'
    WHEN 'FREE_QUESTION_STUDENT_NOT_FOUND' THEN 'FREE_QUOTA_STUDENT_NOT_FOUND'
    -- 정본 raise 14종(실측 전수 — §9.8 "qna_* raise 14종 동명 유지")
    WHEN 'AUTH_REQUIRED'                 THEN 'AUTH_REQUIRED'
    WHEN 'TITLE_REQUIRED'                THEN 'TITLE_REQUIRED'
    WHEN 'ROOM_NOT_FOUND'                THEN 'ROOM_NOT_FOUND'
    WHEN 'NOT_ROOM_PARTY'                THEN 'NOT_ROOM_PARTY'
    WHEN 'MENTOR_CANNOT_CREATE_THREAD'   THEN 'MENTOR_CANNOT_CREATE_THREAD'
    WHEN 'ACCOUNT_BANNED'                THEN 'ACCOUNT_BANNED'
    WHEN 'ACCOUNT_SUSPENDED'             THEN 'ACCOUNT_SUSPENDED'
    WHEN 'ACCOUNT_DELETION_IN_PROGRESS'  THEN 'ACCOUNT_DELETION_IN_PROGRESS'
    WHEN 'BLOCKED'                       THEN 'BLOCKED'
    WHEN 'MENTOR_NOT_APPROVED'           THEN 'MENTOR_NOT_APPROVED'
    WHEN 'SUBSCRIPTION_REFUND_PENDING'   THEN 'SUBSCRIPTION_REFUND_PENDING'
    WHEN 'WEEKLY_LIMIT_EXHAUSTED'        THEN 'WEEKLY_LIMIT_EXHAUSTED'
    WHEN 'FREE_QUOTA_EXPIRED'            THEN 'FREE_QUOTA_EXPIRED'
    WHEN 'FREE_QUOTA_TOTAL_EXHAUSTED'    THEN 'FREE_QUOTA_TOTAL_EXHAUSTED'
    WHEN 'FREE_QUOTA_MENTOR_EXHAUSTED'   THEN 'FREE_QUOTA_MENTOR_EXHAUSTED'
    WHEN 'TITLE_TOO_LONG' THEN 'TITLE_TOO_LONG'
    WHEN 'TOPIC_TOO_LONG' THEN 'TOPIC_TOO_LONG'
    WHEN 'MESSAGE_TOO_LONG' THEN 'MESSAGE_TOO_LONG'
    WHEN 'SUBJECT_INVALID' THEN 'SUBJECT_INVALID'
    ELSE NULL
  END;
  IF v_code IS NULL THEN
    -- 사전에 없는 예외는 삼키지 않고 그대로 전파(§8.2 — T-CON-06)
    RAISE;
  END IF;
  RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', v_code);
END $function$
;
do $gate$ begin if md5(replace(pg_get_functiondef('api_app_v1.qna_create_question_thread(uuid,text,text,text,text)'::regprocedure),chr(13),'')) <> '3266b156de0c77aa0fd75c1c94fea8fb' then raise exception 'HARDENING_SOURCE_DRIFT: api_app_v1.qna_create_question_thread'; end if; end $gate$;
CREATE OR REPLACE FUNCTION api_app_v1.qna_create_question_thread(p_room_id uuid, p_title text, p_subject text DEFAULT NULL::text, p_topic text DEFAULT NULL::text, p_first_message_body text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_res  jsonb;
  v_code text;
BEGIN
  v_res := public.qna_create_question_thread(p_room_id, p_title, p_subject, p_topic, p_first_message_body);
  RETURN v_res || jsonb_build_object('contract_version', 1);
EXCEPTION WHEN OTHERS THEN
  v_code := CASE SQLERRM
    WHEN 'FREE_QUESTION_EXPIRED'           THEN 'FREE_QUOTA_EXPIRED'
    WHEN 'FREE_QUESTION_TOTAL_LIMIT'       THEN 'FREE_QUOTA_TOTAL_EXHAUSTED'
    WHEN 'FREE_QUESTION_PER_MENTOR_LIMIT'  THEN 'FREE_QUOTA_MENTOR_EXHAUSTED'
    WHEN 'FREE_QUESTION_STUDENT_NOT_FOUND' THEN 'FREE_QUOTA_STUDENT_NOT_FOUND'
    WHEN 'AUTH_REQUIRED'                 THEN 'AUTH_REQUIRED'
    WHEN 'TITLE_REQUIRED'                THEN 'TITLE_REQUIRED'
    WHEN 'ROOM_NOT_FOUND'                THEN 'ROOM_NOT_FOUND'
    WHEN 'NOT_ROOM_PARTY'                THEN 'NOT_ROOM_PARTY'
    WHEN 'MENTOR_CANNOT_CREATE_THREAD'   THEN 'MENTOR_CANNOT_CREATE_THREAD'
    WHEN 'ACCOUNT_BANNED'                THEN 'ACCOUNT_BANNED'
    WHEN 'ACCOUNT_SUSPENDED'             THEN 'ACCOUNT_SUSPENDED'
    WHEN 'ACCOUNT_DELETION_IN_PROGRESS'  THEN 'ACCOUNT_DELETION_IN_PROGRESS'
    WHEN 'BLOCKED'                       THEN 'BLOCKED'
    WHEN 'MENTOR_NOT_APPROVED'           THEN 'MENTOR_NOT_APPROVED'
    WHEN 'SUBSCRIPTION_REFUND_PENDING'   THEN 'SUBSCRIPTION_REFUND_PENDING'
    WHEN 'WEEKLY_LIMIT_EXHAUSTED'        THEN 'WEEKLY_LIMIT_EXHAUSTED'
    WHEN 'FREE_QUOTA_EXPIRED'            THEN 'FREE_QUOTA_EXPIRED'
    WHEN 'FREE_QUOTA_TOTAL_EXHAUSTED'    THEN 'FREE_QUOTA_TOTAL_EXHAUSTED'
    WHEN 'FREE_QUOTA_MENTOR_EXHAUSTED'   THEN 'FREE_QUOTA_MENTOR_EXHAUSTED'
    WHEN 'TITLE_TOO_LONG' THEN 'TITLE_TOO_LONG'
    WHEN 'TOPIC_TOO_LONG' THEN 'TOPIC_TOO_LONG'
    WHEN 'MESSAGE_TOO_LONG' THEN 'MESSAGE_TOO_LONG'
    WHEN 'SUBJECT_INVALID' THEN 'SUBJECT_INVALID'
    ELSE NULL
  END;
  IF v_code IS NULL THEN
    -- 사전에 없는 예외는 삼키지 않고 그대로 전파(앱 계약 §3.3 envelope 규약)
    RAISE;
  END IF;
  RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', v_code);
END $function$
;

-- Existing data was checked before rollout. NOT VALID avoids an initial write lock scan;
-- VALIDATE below proves historical rows satisfy the same bounds without rewriting content.
alter table public.question_threads add constraint question_threads_title_size check(char_length(title)<=120) not valid;
alter table public.question_threads add constraint question_threads_topic_size check(char_length(topic)<=80) not valid;
alter table public.question_messages add constraint question_messages_body_size check(char_length(body)<=10000) not valid;
alter table public.question_threads validate constraint question_threads_title_size;
alter table public.question_threads validate constraint question_threads_topic_size;
alter table public.question_messages validate constraint question_messages_body_size;

-- Trigger-only functions have no supported direct RPC invocation. Keep all other API,
-- RLS helper, storage helper and legacy ACLs intact pending a separate dependency review.
do $acl$ declare r record; begin
 for r in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','api_web_v1','api_app_v1','core_private')
     and p.prorettype='trigger'::regtype
 loop
   execute format('revoke execute on function %I.%I(%s) from public,anon,authenticated',r.nspname,r.proname,r.args);
 end loop;
end $acl$;
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public,api_web_v1,api_app_v1,core_private
 revoke execute on functions from anon,authenticated;
do $gate$ begin if md5(replace(pg_get_functiondef('public.comment_sync_in_progress()'::regprocedure),chr(13),'')) <> '23d50ce7b8421517a63fbb9e7619ca0e' then raise exception 'HARDENING_SOURCE_DRIFT: public.comment_sync_in_progress'; end if; end $gate$;
alter function public.comment_sync_in_progress() set search_path = '';
do $gate$ begin if md5(replace(pg_get_functiondef('public.notification_cash_label(bigint)'::regprocedure),chr(13),'')) <> 'c38f604ca2d8ff741bf7409368d42d94' then raise exception 'HARDENING_SOURCE_DRIFT: public.notification_cash_label'; end if; end $gate$;
alter function public.notification_cash_label(bigint) set search_path = '';
do $gate$ begin if md5(replace(pg_get_functiondef('public.notification_date_label(timestamptz)'::regprocedure),chr(13),'')) <> 'adf5b5bcdef8a96eda25fb845ffcfb0d' then raise exception 'HARDENING_SOURCE_DRIFT: public.notification_date_label'; end if; end $gate$;
alter function public.notification_date_label(timestamptz) set search_path = '';
do $gate$ begin if md5(replace(pg_get_functiondef('public.payout_run_items_block_mutation()'::regprocedure),chr(13),'')) <> '2374bb2b16b58318397b837475a5506e' then raise exception 'HARDENING_SOURCE_DRIFT: public.payout_run_items_block_mutation'; end if; end $gate$;
alter function public.payout_run_items_block_mutation() set search_path = '';
do $gate$ begin if md5(replace(pg_get_functiondef('public.qna_is_direct_untrusted_writer()'::regprocedure),chr(13),'')) <> '8e2d7b36085f28ae2a590d9c1edc265c' then raise exception 'HARDENING_SOURCE_DRIFT: public.qna_is_direct_untrusted_writer'; end if; end $gate$;
alter function public.qna_is_direct_untrusted_writer() set search_path = '';

-- Same 17 columns, role/approval/deletion/review filters. The invoker view never grants
-- anon table access; the unexposed function returns only the public projection.
create or replace function core_private.mentor_directory_public_rows()
returns table(mentor_id uuid,nickname text,university_name text,department_name text,
 teaching_subjects text[],intro_line text,profile_image_url text,high_school_name text,
 school_verified boolean,school_tier text,verified_major_category text,verified_university_name text,
 verified_department_name text,is_open_for_subscriptions boolean,avg_rating numeric,review_count integer,created_at timestamptz)
language sql stable security definer set search_path = '' as $fn$
 select mp.user_id,u.nickname,mp.university_name,mp.department_name,mp.teaching_subjects,mp.intro_line,
   mp.profile_image_url,mp.high_school_name,sv.mentor_id is not null,sv.school_tier,sv.verified_major_category,
   sv.verified_university_name,sv.verified_department_name,mp.is_open_for_subscriptions,rv.avg_rating,rv.review_count,mp.created_at
 from public.mentor_profiles mp join public.users u on u.id=mp.user_id
 left join lateral (select msv.mentor_id,msv.school_tier,msv.verified_major_category,msv.verified_university_name,msv.verified_department_name
    from public.mentor_school_verifications msv where msv.mentor_id=mp.user_id and msv.status='approved'
    order by coalesce(msv.reviewed_at,msv.updated_at,msv.created_at) desc,msv.created_at desc limit 1) sv on true
 left join lateral (select avg(r.rating) avg_rating,count(*)::integer review_count from public.reviews r
    where r.mentor_id=mp.user_id and r.moderation_state='visible' and not coalesce(r.is_hidden,false) and not coalesce(r.is_blinded,false)) rv on true
 where u.role='mentor' and lower(coalesce(u.status,'active'))='active'
   and lower(coalesce(mp.verification_status,'')) in ('approved','verified','active')
   and not exists(select 1 from public.account_deletion_jobs j where j.user_id=mp.user_id
     and j.state in ('pending','locked','purging','storage_purged','finalized','auth_soft_deleted'))
$fn$;
revoke all on function core_private.mentor_directory_public_rows() from public;
grant execute on function core_private.mentor_directory_public_rows() to anon,authenticated,service_role;
do $gate$ begin if md5(pg_get_viewdef('api_web_v1.mentor_directory_v1'::regclass,true)) <> '61c8b399a23f74c5012cd337bdfcc29d' then raise exception 'HARDENING_SOURCE_DRIFT: mentor_directory_v1'; end if; end $gate$;
create or replace view api_web_v1.mentor_directory_v1 with (security_invoker=true) as
 select * from core_private.mentor_directory_public_rows();

-- Bound the renewal scans and support their FK/ledger joins. No unrelated index removals.
create index if not exists subscriptions_renewal_due_idx on public.subscriptions(next_billing_at)
 where status in ('active','past_due');
create index if not exists subscription_billing_events_payment_idx on public.subscription_billing_events(payment_id);
create index if not exists subscription_billing_events_ledger_idx on public.subscription_billing_events(ledger_id);
notify pgrst, 'reload schema';
commit;
