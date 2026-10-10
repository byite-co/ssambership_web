-- Emergency rollback: coordinate with the web release. No financial rows are deleted.
begin;
set local lock_timeout='5s';
set local search_path=public;
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
    ELSE NULL
  END;
  IF v_code IS NULL THEN
    -- 사전에 없는 예외는 삼키지 않고 그대로 전파(앱 계약 §3.3 envelope 규약)
    RAISE;
  END IF;
  RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', v_code);
END $function$
;
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
    ELSE NULL
  END;
  IF v_code IS NULL THEN
    -- 사전에 없는 예외는 삼키지 않고 그대로 전파(§8.2 — T-CON-06)
    RAISE;
  END IF;
  RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', v_code);
END $function$
;
CREATE OR REPLACE FUNCTION public.comment_sync_in_progress()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ select coalesce(current_setting('app.comment_sync', true), '0') = '1' $function$
;
CREATE OR REPLACE FUNCTION public.notification_cash_label(p_amount_cents bigint)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select to_char(greatest(0, round(coalesce(p_amount_cents, 0) / 100.0)), 'FM999,999,999,999') || '캐시';
$function$
;
CREATE OR REPLACE FUNCTION public.notification_date_label(p_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when p_at is null then '예정일'
    else to_char(p_at at time zone 'Asia/Seoul', 'YYYY"년" FMMM"월" FMDD"일"') end;
$function$
;
CREATE OR REPLACE FUNCTION public.payout_run_items_block_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'payout_run_items is append-only (immutable); % not allowed', tg_op
    using errcode = 'P0001';
end;
$function$
;
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
$function$
;
CREATE OR REPLACE FUNCTION public.qna_is_direct_untrusted_writer()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ select current_user in ('authenticated','anon'); $function$
;
create or replace view api_web_v1.mentor_directory_v1 with (security_invoker=false) as
 SELECT mp.user_id AS mentor_id,
    u.nickname,
    mp.university_name,
    mp.department_name,
    mp.teaching_subjects,
    mp.intro_line,
    mp.profile_image_url,
    mp.high_school_name,
    sv.mentor_id IS NOT NULL AS school_verified,
    sv.school_tier,
    sv.verified_major_category,
    sv.verified_university_name,
    sv.verified_department_name,
    mp.is_open_for_subscriptions,
    rv.avg_rating,
    rv.review_count,
    mp.created_at
   FROM mentor_profiles mp
     JOIN users u ON u.id = mp.user_id
     LEFT JOIN LATERAL ( SELECT msv.mentor_id,
            msv.school_tier,
            msv.verified_major_category,
            msv.verified_university_name,
            msv.verified_department_name
           FROM mentor_school_verifications msv
          WHERE msv.mentor_id = mp.user_id AND msv.status = 'approved'::text
          ORDER BY (COALESCE(msv.reviewed_at, msv.updated_at, msv.created_at)) DESC, msv.created_at DESC
         LIMIT 1) sv ON true
     LEFT JOIN LATERAL ( SELECT avg(r.rating) AS avg_rating,
            count(*)::integer AS review_count
           FROM reviews r
          WHERE r.mentor_id = mp.user_id AND r.moderation_state = 'visible'::text AND COALESCE(r.is_hidden, false) = false AND COALESCE(r.is_blinded, false) = false) rv ON true
  WHERE u.role = 'mentor'::text AND lower(COALESCE(u.status, 'active'::text)) = 'active'::text AND (lower(COALESCE(mp.verification_status, ''::text)) = ANY (ARRAY['approved'::text, 'verified'::text, 'active'::text])) AND NOT (EXISTS ( SELECT 1
           FROM account_deletion_jobs j
          WHERE j.user_id = mp.user_id AND (j.state = ANY (ARRAY['pending'::text, 'locked'::text, 'purging'::text, 'storage_purged'::text, 'finalized'::text, 'auth_soft_deleted'::text]))));
drop function core_private.mentor_directory_public_rows();
alter table public.question_threads drop constraint question_threads_title_size;
alter table public.question_threads drop constraint question_threads_topic_size;
alter table public.question_messages drop constraint question_messages_body_size;
drop index public.subscriptions_renewal_due_idx;
drop index public.subscription_billing_events_payment_idx;
drop index public.subscription_billing_events_ledger_idx;
-- Restore only the client privileges revoked in this migration, from the preflight snapshot.
grant execute on function public.handle_new_auth_user() to public,anon,authenticated;
grant execute on function public.set_updated_at() to public,anon,authenticated;
grant execute on function public.cra_backfill_post_fk() to public,anon,authenticated;
grant execute on function public.set_refunds_updated_at() to public,anon,authenticated;
grant execute on function public.community_refresh_shortform_like_count() to public,anon,authenticated;
grant execute on function public.enforce_mentor_cap() to public,anon,authenticated;
grant execute on function public.trg_block_settlement_on_active_dispute() to public,anon,authenticated;
grant execute on function public.keep_subscription_refunded_status() to public,anon,authenticated;
grant execute on function public.cro_backfill_fks() to public,anon,authenticated;
grant execute on function public.check_free_question_usage_limits() to authenticated;
grant execute on function public.set_admin_content_updated_at() to public,anon,authenticated;
grant execute on function public.mentor_acad_change_guard_self_review() to public,anon,authenticated;
grant execute on function public.community_refresh_post_comment_count() to public,anon,authenticated;
grant execute on function public.community_sync_hashtags() to public,anon,authenticated;
grant execute on function public.community_refresh_post_like_count() to public,anon,authenticated;
grant execute on function public.mp_notify_activity_transition() to public,anon,authenticated;
grant execute on function public.sync_subscription_refunded_from_refund() to public,anon,authenticated;
grant execute on function public.mentor_school_verifications_guard_self_review() to public,anon,authenticated;
grant execute on function public.payout_run_items_block_mutation() to public,anon,authenticated;
grant execute on function public.reviews_enforce_update() to public,anon,authenticated;
grant execute on function public.qm_direct_write_guard() to public,anon,authenticated;
grant execute on function public.qt_direct_write_guard() to public,anon,authenticated;
grant execute on function public.qa_direct_answered_after() to public,anon,authenticated;
grant execute on function public.qt_direct_consume_free_usage() to public,anon,authenticated;
grant execute on function public.fqu_legacy_standalone_noop() to public,anon,authenticated;
grant execute on function public.qa_direct_write_guard() to public,anon,authenticated;
grant execute on function public.qm_direct_answered_after() to public,anon,authenticated;
grant execute on function public.account_deletion_write_guard() to public,anon,authenticated;
grant execute on function public.content_reports_dedupe_open() to public;
grant execute on function public.iq_notify_assigned() to public,anon,authenticated;
grant execute on function public.iq_notify_status_transition() to public,anon,authenticated;
grant execute on function public.iqm_notify_message() to public,anon,authenticated;
grant execute on function public.sbe_notify_billing_event() to public,anon,authenticated;
grant execute on function public.sub_notify_expired() to public,anon,authenticated;
grant execute on function public.refund_notify_mentor_termination() to public,anon,authenticated;
grant execute on function public.mplan_notify_price_changed() to public,anon,authenticated;
grant execute on function public.cra_notify_new_application() to public,anon,authenticated;
grant execute on function public.com_notify_new_order_message() to public,anon,authenticated;
grant execute on function public.cc_sync_board_delete_to_canonical() to public,anon,authenticated;
grant execute on function public.cc_write_guard() to public,anon,authenticated;
grant execute on function public.comments_mirror_delete_to_legacy() to public,anon,authenticated;
grant execute on function public.comments_write_guard() to public,anon,authenticated;
grant execute on function public.cc_sync_board_to_canonical() to public,anon,authenticated;
grant execute on function public.comments_mirror_to_legacy() to public,anon,authenticated;
alter default privileges for role postgres grant execute on functions to public;
notify pgrst, 'reload schema';
commit;
