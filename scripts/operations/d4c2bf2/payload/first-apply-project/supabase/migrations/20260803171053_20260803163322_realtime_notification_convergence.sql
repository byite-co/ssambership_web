-- =============================================================================
-- 20260803163322_realtime_notification_convergence.sql (수렴 M3)
-- =============================================================================
-- Realtime·알림 수렴 (지시서 §14). 선행조건: 수렴 M1(20260803162257) ·
-- M2(20260803162808) 적용.
--
-- 소유 객체 (§23.3):
--   N1. supabase_realtime publication 멱등 추가: notifications ·
--       individual_questions · individual_question_messages ·
--       individual_question_attachments (기존 question_* 3종 보존)
--   N2. 알림 RLS·CHECK 수신자 정본화: recipient_user_id 를 SELECT/UPDATE 정책과
--       notifications_at_least_one_recipient CHECK 에 포함 (레거시 컬럼 OR 유지)
--   N3. 읽음 상태 단일화: 정본 is_read + read_at. 호환 기간 동안 `read` 미러
--       트리거 + backfill. 개별 읽음 canonical RPC(mark_notification_read).
--       기존 mark_all_notifications_read 는 유지(미러는 트리거가 수렴).
--   N4. notification_unread_count_self() — 서버 전체 unread count.
--       앱 분류 정책과 일치: 앱 제외 타입(new_order_message·new_application —
--       앱 kGatedNotificationTypeCodes 정본)과 동일 목록을 count 에서 제외.
--   N5. notification_transport_config (단일행) — push_transport_enabled 기본 false.
--       record_domain_notification 은 인앱 알림 행을 항상 생성하되 outbox 는
--       push_transport_enabled=true 일 때만 생성.
--   N6. 기존 pending outbox 43행(attempt_count=0 · delivery 0) → status='suppressed'
--       (사유 last_error='PUSH_TRANSPORT_DISABLED'). 삭제 0 · 총행수 불변.
--   N7. users.notification_enabled 제거 — DB(proc/view/policy/index/trigger)·웹·앱
--       소스 참조 0 실측(문서 주석 제외). 정본은 notification_settings.
--   N8. OS push 비활성 부수: register_device_token authenticated EXECUTE 회수,
--       notifications/notification_outbox 잉여 클라이언트 grant 정리
--       (notifications 의 authenticated SELECT/UPDATE 는 기존 배포 웹 호환으로 유지)
--
-- rollback 정본: supabase/rollback/20260803163322_realtime_notification_convergence_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 사전 게이트
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass AND tgname='trg_users_protected_columns') THEN
    RAISE EXCEPTION 'M3_BASELINE_MISMATCH: M1 not applied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    RAISE EXCEPTION 'M3_BASELINE_MISMATCH: supabase_realtime publication missing';
  END IF;
  -- 기존 question_* 3종 포함 확인 (보존 대상)
  IF (SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime'
       AND schemaname='public' AND tablename IN ('question_threads','question_messages','question_attachments')) <> 3 THEN
    RAISE EXCEPTION 'M3_BASELINE_MISMATCH: question realtime tables missing';
  END IF;
  IF to_regclass('public.notification_transport_config') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname='public' AND p.proname IN
                   ('mark_notification_read','notification_unread_count_self','notifications_read_state_sync')) THEN
    RAISE EXCEPTION 'M3_BASELINE_MISMATCH: target object already exists';
  END IF;
  -- outbox 상태 분포: suppress 대상 외 상태 존재 시 검토 필요 (pending 외 상태는 건드리지 않음)
  IF EXISTS (SELECT 1 FROM public.notification_outbox WHERE status NOT IN ('pending','leased','sent','failed','dead')) THEN
    RAISE EXCEPTION 'M3_BASELINE_MISMATCH: unexpected outbox status';
  END IF;
  -- users.notification_enabled 참조 0 확인 (DB 객체)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname NOT IN ('pg_catalog','information_schema')
                AND p.prosrc ILIKE '%notification_enabled%')
     OR EXISTS (SELECT 1 FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema')
                 AND definition ILIKE '%notification_enabled%')
     OR EXISTS (SELECT 1 FROM pg_policies WHERE coalesce(qual,'')||coalesce(with_check,'') ILIKE '%notification_enabled%') THEN
    RAISE EXCEPTION 'M3_BASELINE_MISMATCH: notification_enabled still referenced — drop 보류(BLOCKED)';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- N1. Realtime publication 멱등 추가
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notifications','individual_questions',
                           'individual_question_messages','individual_question_attachments'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN
      EXECUTE format('alter publication supabase_realtime add table public.%I', t);
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- N2. 알림 수신자 정본화 (recipient_user_id 포함 — 레거시 OR 유지)
-- -----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_at_least_one_recipient;
alter table public.notifications
  add constraint notifications_at_least_one_recipient
  check (recipient_user_id is not null or user_id is not null or recipient_id is not null
         or student_id is not null or mentor_id is not null
         or target_user_id is not null or owner_id is not null);

drop policy if exists notif_select_recipient on public.notifications;
create policy notif_select_recipient on public.notifications
  for select to authenticated
  using (
    ((recipient_user_id is not null) and ((select auth.uid()) = recipient_user_id))
    or ((user_id is not null) and ((select auth.uid()) = user_id))
    or ((recipient_id is not null) and ((select auth.uid()) = recipient_id))
    or ((student_id is not null) and ((select auth.uid()) = student_id))
    or ((mentor_id is not null) and ((select auth.uid()) = mentor_id))
    or ((target_user_id is not null) and ((select auth.uid()) = target_user_id))
    or ((owner_id is not null) and ((select auth.uid()) = owner_id))
  );

drop policy if exists notif_update_recipient_read on public.notifications;
create policy notif_update_recipient_read on public.notifications
  for update to authenticated
  using (
    ((recipient_user_id is not null) and ((select auth.uid()) = recipient_user_id))
    or ((user_id is not null) and ((select auth.uid()) = user_id))
    or ((recipient_id is not null) and ((select auth.uid()) = recipient_id))
    or ((student_id is not null) and ((select auth.uid()) = student_id))
    or ((mentor_id is not null) and ((select auth.uid()) = mentor_id))
    or ((target_user_id is not null) and ((select auth.uid()) = target_user_id))
    or ((owner_id is not null) and ((select auth.uid()) = owner_id))
  )
  with check (
    ((recipient_user_id is not null) and ((select auth.uid()) = recipient_user_id))
    or ((user_id is not null) and ((select auth.uid()) = user_id))
    or ((recipient_id is not null) and ((select auth.uid()) = recipient_id))
    or ((student_id is not null) and ((select auth.uid()) = student_id))
    or ((mentor_id is not null) and ((select auth.uid()) = mentor_id))
    or ((target_user_id is not null) and ((select auth.uid()) = target_user_id))
    or ((owner_id is not null) and ((select auth.uid()) = owner_id))
  );

-- -----------------------------------------------------------------------------
-- N3. 읽음 상태 단일화 — 정본 is_read/read_at, `read` 미러 트리거 + backfill
-- -----------------------------------------------------------------------------
create function public.notifications_read_state_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.is_read is null then new.is_read := coalesce(new.read, false); end if;
    new.read := new.is_read;
    if new.is_read and new.read_at is null then new.read_at := now(); end if;
    return new;
  end if;
  -- UPDATE: 어느 쪽이 갱신되든 정본(is_read)으로 수렴 후 미러
  if new.is_read is distinct from old.is_read then
    new.read := new.is_read;
  elsif coalesce(new.read, false) is distinct from coalesce(old.read, false) then
    new.is_read := coalesce(new.read, false);
    new.read := new.is_read;
  else
    new.read := new.is_read;
  end if;
  if new.is_read then
    if new.read_at is null then new.read_at := now(); end if;
  else
    new.read_at := null;
  end if;
  return new;
end
$fn$;

revoke execute on function public.notifications_read_state_sync() from public, anon, authenticated;

create trigger trg_notifications_read_state_sync
  before insert or update on public.notifications
  for each row execute function public.notifications_read_state_sync();

-- backfill (허용 데이터 변화 — read flag 정합화, 행 수 불변)
update public.notifications set is_read = true
 where coalesce(read, false) = true and is_read is distinct from true;
update public.notifications
   set read_at = coalesce(read_at, read_at_utc, acknowledged_at, opened_at, viewed_at, seen_at, updated_at)
 where is_read = true and read_at is null;
update public.notifications set read = is_read
 where read is distinct from is_read;

-- 개별 읽음 canonical RPC
create function public.mark_notification_read(p_notification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_row public.notifications%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  select * into v_row from public.notifications where id = p_notification_id for update;
  if not found then
    raise exception 'NOTIFICATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not coalesce(
      (v_row.recipient_user_id = v_uid or v_row.user_id = v_uid or v_row.recipient_id = v_uid
       or v_row.student_id = v_uid or v_row.mentor_id = v_uid
       or v_row.target_user_id = v_uid or v_row.owner_id = v_uid), false) then
    raise exception 'NOT_RECIPIENT' using errcode = '42501';
  end if;
  if coalesce(v_row.is_read, false) then
    return jsonb_build_object('ok', true, 'contract_version', 1, 'idempotent_hit', true);
  end if;
  update public.notifications
     set is_read = true, read_at = coalesce(read_at, now()), updated_at = now()
   where id = p_notification_id;
  return jsonb_build_object('ok', true, 'contract_version', 1, 'idempotent_hit', false);
end
$fn$;

revoke execute on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- N4. 서버 전체 unread count (앱 배지 정본)
-- -----------------------------------------------------------------------------
create function public.notification_unread_count_self()
returns jsonb
language sql stable
security definer
set search_path = ''
as $fn$
  select jsonb_build_object(
    'ok', true,
    'contract_version', 1,
    'count', (
      select count(*)
        from public.notifications n
       where n.is_read is distinct from true
         and ((n.recipient_user_id is not null and n.recipient_user_id = (select auth.uid()))
              or (n.user_id is not null and n.user_id = (select auth.uid()))
              or (n.recipient_id is not null and n.recipient_id = (select auth.uid()))
              or (n.student_id is not null and n.student_id = (select auth.uid()))
              or (n.mentor_id is not null and n.mentor_id = (select auth.uid()))
              or (n.target_user_id is not null and n.target_user_id = (select auth.uid()))
              or (n.owner_id is not null and n.owner_id = (select auth.uid())))
         -- 앱 제외 타입 — 앱 classifier(kGatedNotificationTypeCodes)와 단일 정본.
         -- 목록·count 가 같은 predicate 를 쓰도록 앱 계약 테스트가 고정한다.
         and coalesce(n.type, '') not in ('new_order_message', 'new_application')
    )
  );
$fn$;

revoke execute on function public.notification_unread_count_self() from public, anon;
grant execute on function public.notification_unread_count_self() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- N5. 전역 전달 설정 + record_domain_notification outbox 게이트
-- -----------------------------------------------------------------------------
create table public.notification_transport_config (
  id boolean primary key default true check (id),
  push_transport_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.notification_transport_config enable row level security;
revoke all on table public.notification_transport_config from public, anon, authenticated;
insert into public.notification_transport_config (id, push_transport_enabled) values (true, false);

create or replace function public.record_domain_notification(
  p_recipient_user_id uuid, p_event_key text, p_dedup_key text, p_event_type text,
  p_title text, p_body text, p_link text default null, p_metadata jsonb default '{}'::jsonb, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_notif_id uuid; v_outbox_id uuid;
  v_notif_created boolean := false; v_outbox_created boolean := false;
  v_push_enabled boolean := false;
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

  -- OS push 전송로가 꺼져 있으면 outbox 를 새로 적재하지 않는다 (§14.6).
  -- 인앱 알림 행·멱등 계약은 위에서 그대로 유지됐다.
  select c.push_transport_enabled into v_push_enabled
    from public.notification_transport_config c where c.id is true;
  if coalesce(v_push_enabled, false) then
    insert into public.notification_outbox (recipient_user_id, notification_id, event_key, dedup_key, event_type, payload)
    values (p_recipient_user_id, v_notif_id, p_event_key, p_dedup_key, p_event_type,
       coalesce(p_payload,'{}'::jsonb) || jsonb_build_object('event_key', p_event_key, 'notification_id', v_notif_id))
    on conflict (recipient_user_id, dedup_key) do nothing returning id into v_outbox_id;
    v_outbox_created := v_outbox_id is not null;
    if v_outbox_id is null then
      select id into v_outbox_id from public.notification_outbox where recipient_user_id = p_recipient_user_id and dedup_key = p_dedup_key limit 1;
    end if;
  end if;

  return jsonb_build_object('ok',true,'notification_id',v_notif_id,'outbox_id',v_outbox_id,
    'notification_created',v_notif_created,'outbox_created',v_outbox_created);
end;
$fn$;

-- -----------------------------------------------------------------------------
-- N6. 기존 pending outbox suppress (삭제 0 · 총행수 불변)
-- -----------------------------------------------------------------------------
alter table public.notification_outbox drop constraint if exists notification_outbox_status_chk;
alter table public.notification_outbox
  add constraint notification_outbox_status_chk
  check (status = any (array['pending'::text,'leased'::text,'sent'::text,'failed'::text,'dead'::text,'suppressed'::text]));

update public.notification_outbox o
   set status = 'suppressed',
       last_error = 'PUSH_TRANSPORT_DISABLED',
       updated_at = now()
 where o.status = 'pending'
   and o.attempt_count = 0
   and not exists (select 1 from public.notification_deliveries d where d.outbox_id = o.id);

-- -----------------------------------------------------------------------------
-- N7. users.notification_enabled 제거 (참조 0 — 사전 게이트에서 재확인)
-- -----------------------------------------------------------------------------
alter table public.users drop column notification_enabled;

-- -----------------------------------------------------------------------------
-- N8. OS push 비활성 부수 정리
-- -----------------------------------------------------------------------------
revoke execute on function public.register_device_token(text, text) from public, anon, authenticated;
revoke all on table public.notification_outbox from anon, authenticated;
revoke insert, delete, truncate, references, trigger on table public.notifications from anon, authenticated;
revoke select, update on table public.notifications from anon;

-- -----------------------------------------------------------------------------
-- 자가 검증
-- -----------------------------------------------------------------------------
DO $$
DECLARE v_pending int; v_suppressed int; v_total int;
BEGIN
  -- N1: publication 7테이블
  IF (SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'
       AND tablename IN ('question_threads','question_messages','question_attachments',
                         'notifications','individual_questions','individual_question_messages',
                         'individual_question_attachments')) <> 7 THEN
    RAISE EXCEPTION 'M3_SELFCHECK: publication tables incomplete';
  END IF;
  -- N2: recipient_user_id 포함
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='notifications'
                  AND policyname='notif_select_recipient' AND qual LIKE '%recipient_user_id%') THEN
    RAISE EXCEPTION 'M3_SELFCHECK: select policy missing recipient_user_id';
  END IF;
  -- N3: 미러 일치
  IF EXISTS (SELECT 1 FROM public.notifications WHERE read IS DISTINCT FROM is_read) THEN
    RAISE EXCEPTION 'M3_SELFCHECK: read mirror mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE is_read = true AND read_at IS NULL) THEN
    RAISE EXCEPTION 'M3_SELFCHECK: read_at backfill incomplete';
  END IF;
  -- N4/N3: RPC 존재·권한
  IF NOT has_function_privilege('authenticated', 'public.notification_unread_count_self()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.mark_notification_read(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M3_SELFCHECK: notification RPC grants';
  END IF;
  -- N5/N6: push disabled 상태에서 pending=0, suppressed>=0, 총행수 불변식은
  --        migration 전후 카운트 비교(외부 검증 스크립트)로 재확인한다.
  SELECT count(*) FILTER (WHERE status='pending'), count(*) FILTER (WHERE status='suppressed'), count(*)
    INTO v_pending, v_suppressed, v_total FROM public.notification_outbox;
  IF v_pending <> 0 THEN
    RAISE EXCEPTION 'M3_SELFCHECK: pending outbox remains (%). push disabled 상태에서 0 이어야 함', v_pending;
  END IF;
  -- N7
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='notification_enabled') THEN
    RAISE EXCEPTION 'M3_SELFCHECK: notification_enabled still present';
  END IF;
  -- N8
  IF has_function_privilege('authenticated', 'public.register_device_token(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'M3_SELFCHECK: register_device_token still executable';
  END IF;
END $$;

commit;