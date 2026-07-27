-- --------------------------------------------------------------------------
-- 132_notification_outbox_foundation.sql   (P1-11F · 알림 outbox foundation)
-- [적용됨 — ssambership-staging 에 2026-07-19 단일 트랜잭션(lock_timeout 3s) 적용·검증 통과
--   (구조 T1~T5 + 멱등/fan-out/RLS호환 F1~F5 PASS). fixture savepoint 롤백·baseline 0행 복원.
--   원장 미기재 — 적용 이력: docs/audit/sql_apply_manifest.md]
-- 목적(결정 C 계약): 도메인 write 와 같은 트랜잭션에서 인앱 알림 + outbox 를 원자적으로 기록할
--   최소 foundation 을 만든다. 외부 FCM 호출·device token·17개 writer 연결은 P1-11C(별도)에서 완성.
-- 계약:
--   - 수신자별 행 모델. 다중 수신자는 같은 domain event 를 수신자별 행으로 fan-out.
--   - notifications: UNIQUE(recipient_user_id, event_key) — 수신자·이벤트당 인앱 1건(멱등).
--   - notification_outbox: UNIQUE(recipient_user_id, dedup_key) — 수신자·dedup 당 outbox 1건(멱등).
--   - 기록 함수는 SECURITY DEFINER·service_role 전용(public/anon/authenticated 실행 금지).
--   - payload 에 canonical event id(event_key/notification_id) 포함. 외부 발송은 트랜잭션 밖 worker.
-- 선행: 없음(신규 테이블/컬럼). 단 P1-8(127)·P1-13(131) 도메인 RPC 가 본 helper 를 호출하므로
--   클린설치에서 본 파일은 127/131 보다 먼저 적용해야 한다(apply_manifest_prod.md 참조).
-- 실상태: notifications 존재(0행, 6개 레거시 수신자 컬럼·event_key 부재). notification_outbox·device_tokens 부재.
--   기존 RLS(notif_select_recipient/notif_update_recipient_read)는 user_id 등 레거시 컬럼을 검사하므로
--   helper 는 recipient_user_id 와 함께 user_id 도 세팅해 기존 RLS 읽기/읽음 호환을 유지한다.
-- 제외: FCM worker, device token lifecycle, 도메인 writer 연결, type 백필(0행이라 불필요), Flutter.
-- --------------------------------------------------------------------------

-- 1) notifications 정본 컬럼(additive · nullable · 레거시 호환)
alter table public.notifications
  add column if not exists recipient_user_id uuid references public.users(id) on delete cascade;
alter table public.notifications
  add column if not exists event_key text;

-- 수신자·이벤트당 인앱 1건(부분 UNIQUE — 레거시 NULL 행은 제약 밖).
create unique index if not exists uq_notifications_recipient_event
  on public.notifications (recipient_user_id, event_key)
  where recipient_user_id is not null and event_key is not null;

create index if not exists idx_notifications_recipient_user
  on public.notifications (recipient_user_id)
  where recipient_user_id is not null;

-- 2) notification_outbox (신규 · service_role 전용)
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete set null,
  event_key text not null,
  dedup_key text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempt_count int not null default 0,
  max_attempts int not null default 8,
  lease_owner text,
  leased_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_outbox_status_chk
    check (status in ('pending','leased','sent','failed','dead')),
  constraint notification_outbox_recipient_dedup_uq
    unique (recipient_user_id, dedup_key)
);

-- worker claim 용(pending/failed 를 next_attempt_at 순으로).
create index if not exists idx_notification_outbox_claim
  on public.notification_outbox (status, next_attempt_at)
  where status in ('pending','failed');

-- updated_at 자동 갱신(기존 set_updated_at() 재사용).
drop trigger if exists trg_notification_outbox_set_updated on public.notification_outbox;
create trigger trg_notification_outbox_set_updated
  before update on public.notification_outbox
  for each row execute function public.set_updated_at();

-- 3) RLS: outbox 는 service_role 전용(정책 없음 → authenticated/anon 거부, service_role 우회).
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;
grant select, insert, update, delete on public.notification_outbox to service_role;

-- 4) 도메인 알림 기록 helper (도메인 트랜잭션 안에서 호출 · 멱등)
create or replace function public.record_domain_notification(
  p_recipient_user_id uuid,
  p_event_key text,
  p_dedup_key text,
  p_event_type text,
  p_title text,
  p_body text,
  p_link text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_notif_id uuid;
  v_outbox_id uuid;
  v_notif_created boolean := false;
  v_outbox_created boolean := false;
begin
  if p_recipient_user_id is null then
    raise exception 'RECIPIENT_REQUIRED';
  end if;
  if p_event_key is null or p_dedup_key is null or p_event_type is null then
    raise exception 'EVENT_KEYS_REQUIRED';
  end if;

  -- 인앱 알림: 수신자·event_key 당 1건. user_id 도 세팅해 기존 RLS(recipient) 호환.
  insert into public.notifications
    (recipient_user_id, user_id, event_key, type, body, metadata, data, is_read)
  values
    (p_recipient_user_id, p_recipient_user_id, p_event_key, p_event_type, p_body,
     coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('event_key', p_event_key, 'link', p_link),
     jsonb_build_object('title', p_title, 'link', p_link),
     false)
  on conflict (recipient_user_id, event_key)
    where recipient_user_id is not null and event_key is not null
  do nothing
  returning id into v_notif_id;
  v_notif_created := v_notif_id is not null;

  if v_notif_id is null then
    select id into v_notif_id
    from public.notifications
    where recipient_user_id = p_recipient_user_id and event_key = p_event_key
    limit 1;
  end if;

  -- outbox: 수신자·dedup_key 당 1건. payload 에 canonical event id 포함.
  insert into public.notification_outbox
    (recipient_user_id, notification_id, event_key, dedup_key, event_type, payload)
  values
    (p_recipient_user_id, v_notif_id, p_event_key, p_dedup_key, p_event_type,
     coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('event_key', p_event_key, 'notification_id', v_notif_id))
  on conflict (recipient_user_id, dedup_key)
  do nothing
  returning id into v_outbox_id;
  v_outbox_created := v_outbox_id is not null;

  if v_outbox_id is null then
    select id into v_outbox_id
    from public.notification_outbox
    where recipient_user_id = p_recipient_user_id and dedup_key = p_dedup_key
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'notification_id', v_notif_id,
    'outbox_id', v_outbox_id,
    'notification_created', v_notif_created,
    'outbox_created', v_outbox_created
  );
end;
$$;

comment on function public.record_domain_notification(uuid, text, text, text, text, text, text, jsonb, jsonb) is
  'P1-11F: 도메인 트랜잭션 내 인앱 알림+outbox 원자·멱등 기록. 수신자·event_key/dedup_key 당 1건. service_role 전용. 외부 발송은 worker(트랜잭션 밖).';

revoke all on function public.record_domain_notification(uuid, text, text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_domain_notification(uuid, text, text, text, text, text, text, jsonb, jsonb) to service_role;
