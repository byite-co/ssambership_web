-- =============================================================================
-- 20260803163322_realtime_notification_convergence_rollback.sql
-- =============================================================================
-- forward(수렴 M3)의 소유 객체를 역순으로 되돌린다. 로컬 왕복 검증·비상 복구 전용.
-- suppression 원복은 이 migration 이 만든 사유(PUSH_TRANSPORT_DISABLED) 행만 대상.
-- read backfill(정합화)은 정보 손실 없는 미러였으므로 값 원복 없이 트리거만 제거한다.
-- =============================================================================

begin;

-- N8 원복 (notification_outbox 는 forward 이전에도 클라이언트 grant 0 — 재부여 없음)
grant execute on function public.register_device_token(text, text) to authenticated;
grant insert, delete, truncate, references, trigger on table public.notifications to anon, authenticated;
grant select, update on table public.notifications to anon;

-- N7 원복 (실측: 제거 시점 전 전 행 true — default true 재부여로 무손실)
alter table public.users add column notification_enabled boolean not null default true;

-- N6 원복 — 이 migration 이 suppress 한 행만 pending 으로
update public.notification_outbox
   set status = 'pending', last_error = null, updated_at = now()
 where status = 'suppressed' and last_error = 'PUSH_TRANSPORT_DISABLED';

alter table public.notification_outbox drop constraint if exists notification_outbox_status_chk;
alter table public.notification_outbox
  add constraint notification_outbox_status_chk
  check (status = any (array['pending'::text,'leased'::text,'sent'::text,'failed'::text,'dead'::text]));

-- N5 원복 — record_domain_notification 을 무조건 outbox 적재로 되돌리고 config 제거
create or replace function public.record_domain_notification(
  p_recipient_user_id uuid, p_event_key text, p_dedup_key text, p_event_type text,
  p_title text, p_body text, p_link text default null, p_metadata jsonb default '{}'::jsonb, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare v_notif_id uuid; v_outbox_id uuid; v_notif_created boolean := false; v_outbox_created boolean := false;
begin
  if p_recipient_user_id is null then raise exception 'RECIPIENT_REQUIRED'; end if;
  if p_event_key is null or p_dedup_key is null or p_event_type is null then raise exception 'EVENT_KEYS_REQUIRED'; end if;
  insert into public.notifications (recipient_user_id, user_id, event_key, type, body, metadata, data, is_read)
  values (p_recipient_user_id, p_recipient_user_id, p_event_key, p_event_type, p_body,
     coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('event_key', p_event_key, 'link', p_link),
     jsonb_build_object('title', p_title, 'link', p_link), false)
  on conflict (recipient_user_id, event_key) where recipient_user_id is not null and event_key is not null
  do nothing returning id into v_notif_id;
  v_notif_created := v_notif_id is not null;
  if v_notif_id is null then
    select id into v_notif_id from public.notifications where recipient_user_id = p_recipient_user_id and event_key = p_event_key limit 1;
  end if;
  insert into public.notification_outbox (recipient_user_id, notification_id, event_key, dedup_key, event_type, payload)
  values (p_recipient_user_id, v_notif_id, p_event_key, p_dedup_key, p_event_type,
     coalesce(p_payload,'{}'::jsonb) || jsonb_build_object('event_key', p_event_key, 'notification_id', v_notif_id))
  on conflict (recipient_user_id, dedup_key) do nothing returning id into v_outbox_id;
  v_outbox_created := v_outbox_id is not null;
  if v_outbox_id is null then
    select id into v_outbox_id from public.notification_outbox where recipient_user_id = p_recipient_user_id and dedup_key = p_dedup_key limit 1;
  end if;
  return jsonb_build_object('ok',true,'notification_id',v_notif_id,'outbox_id',v_outbox_id,
    'notification_created',v_notif_created,'outbox_created',v_outbox_created);
end;
$fn$;

drop table if exists public.notification_transport_config;

-- N4/N3 원복
drop function if exists public.notification_unread_count_self();
drop function if exists public.mark_notification_read(uuid);
drop trigger if exists trg_notifications_read_state_sync on public.notifications;
drop function if exists public.notifications_read_state_sync();

-- N2 원복
drop policy if exists notif_select_recipient on public.notifications;
create policy notif_select_recipient on public.notifications
  for select to authenticated
  using (
    ((user_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))
    OR ((recipient_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = recipient_id))
    OR ((student_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = student_id))
    OR ((mentor_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = mentor_id))
    OR ((target_user_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = target_user_id))
    OR ((owner_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = owner_id))
  );

drop policy if exists notif_update_recipient_read on public.notifications;
create policy notif_update_recipient_read on public.notifications
  for update to authenticated
  using (
    ((user_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))
    OR ((recipient_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = recipient_id))
    OR ((student_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = student_id))
    OR ((mentor_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = mentor_id))
    OR ((target_user_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = target_user_id))
    OR ((owner_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = owner_id))
  )
  with check (
    ((user_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = user_id))
    OR ((recipient_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = recipient_id))
    OR ((student_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = student_id))
    OR ((mentor_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = mentor_id))
    OR ((target_user_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = target_user_id))
    OR ((owner_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) = owner_id))
  );

alter table public.notifications drop constraint if exists notifications_at_least_one_recipient;
alter table public.notifications
  add constraint notifications_at_least_one_recipient
  check ((user_id IS NOT NULL) OR (recipient_id IS NOT NULL) OR (student_id IS NOT NULL)
         OR (mentor_id IS NOT NULL) OR (target_user_id IS NOT NULL) OR (owner_id IS NOT NULL));

-- N1 원복 — M3 가 추가한 4테이블만 제거 (question_* 3종 보존)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notifications','individual_questions',
                           'individual_question_messages','individual_question_attachments'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables
                WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('alter publication supabase_realtime drop table public.%I', t);
    END IF;
  END LOOP;
END $$;

-- 자가 검증
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'
       AND tablename IN ('question_threads','question_messages','question_attachments')) <> 3 THEN
    RAISE EXCEPTION 'M3_ROLLBACK_SELFCHECK: question realtime tables lost';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
              AND schemaname='public' AND tablename='notifications') THEN
    RAISE EXCEPTION 'M3_ROLLBACK_SELFCHECK: notifications still in publication';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE status = 'suppressed') THEN
    RAISE EXCEPTION 'M3_ROLLBACK_SELFCHECK: suppressed rows remain';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='notification_enabled') THEN
    RAISE EXCEPTION 'M3_ROLLBACK_SELFCHECK: notification_enabled not restored';
  END IF;
END $$;

commit;
