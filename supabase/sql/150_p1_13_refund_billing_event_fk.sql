-- 150_p1_13_refund_billing_event_fk.sql
-- Phase 1 후속 — refund ↔ billing event 정본 연결(FK) + 질문 자격 게이트를 current billing event 기준으로.
--
-- 배경: refunds 는 지금 subscription_id + request_type + 복사된 payment_id 로만 구독에 연결되고,
--   어느 billing event(구독 결제 주기)에 대한 환불인지 명시 FK 가 없다.
-- 변경:
--   * refunds.billing_event_id uuid FK → subscription_billing_events(id) ON DELETE SET NULL.
--   * 신규 refund 생성 경로(웹)가 current subscriptions.last_billing_event_id 를 기록한다(코드 측 배선).
--   * qna_subscription_has_live_refund 를 current billing event 기준으로 정밀화:
--       billing_event_id 가 있으면 그 값이 구독의 current last_billing_event_id 와 일치하는 pending 만 카운트,
--       billing_event_id 가 NULL(레거시)이면 안전하게 여전히 카운트(추정 백필 금지 — 막는 쪽이 안전).
-- 기존 실제 행 추정 백필 금지. staging refunds=0행(신규 컬럼 안전). 선행: 064·069·142.

begin;
set local lock_timeout='5s';

alter table public.refunds add column if not exists billing_event_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'refunds_billing_event_id_fkey' and conrelid = 'public.refunds'::regclass
  ) then
    alter table public.refunds
      add constraint refunds_billing_event_id_fkey
      foreign key (billing_event_id) references public.subscription_billing_events(id) on delete set null;
  end if;
end $$;

create index if not exists idx_refunds_billing_event on public.refunds (billing_event_id) where billing_event_id is not null;

-- current billing event 기준 pending 환불 잠금(142 helper 정밀화 — 142 미수정, create or replace).
create or replace function public.qna_subscription_has_live_refund(p_subscription_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
    from public.refunds r
    join public.subscriptions s on s.id = r.subscription_id
    where r.subscription_id = p_subscription_id
      and r.status = 'pending'
      and r.request_type in ('subscription_prorated','subscription_mentor_suspended')
      -- 신규 행: current billing event 에 대한 환불만 자격을 막는다.
      -- 레거시(billing_event_id NULL): 추정 없이 안전하게 계속 막는다.
      and (r.billing_event_id is null or r.billing_event_id = s.last_billing_event_id)
  );
$$;
revoke all on function public.qna_subscription_has_live_refund(uuid) from public, anon;
grant execute on function public.qna_subscription_has_live_refund(uuid) to authenticated, service_role;

commit;

-- §진단(production 배포 전 실행 — NULL 레거시 refund 행 파악, 자동 백필 금지):
--   select id, subscription_id, request_type, status, created_at
--   from public.refunds
--   where billing_event_id is null and request_type in ('subscription_prorated','subscription_mentor_suspended')
--   order by created_at desc;
--
-- §V(rollback-only): refunds.billing_event_id FK 존재 · 신규 pending 환불이 current event 이면 게이트 막음 ·
--   다른(과거) event 의 pending 은 current 질문 자격을 막지 않음 · NULL 레거시는 안전하게 계속 막음.
