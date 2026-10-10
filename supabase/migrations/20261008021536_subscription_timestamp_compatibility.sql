-- Preserve PostgreSQL microseconds and support the existing JS millisecond contract.
begin;
set local lock_timeout='5s';
do $gate$ begin
 if md5(replace(pg_get_functiondef('public.process_subscription_renewal_v2(uuid,timestamptz,text,timestamptz)'::regprocedure),chr(13),'')) <> '8c2fe0b419f409a43d2448b3a2d5318b' then
  raise exception 'FINANCIAL_SOURCE_DRIFT: process_subscription_renewal_v2'; end if;
 if md5(replace(pg_get_functiondef('public.record_subscription_renewal_notice(uuid,timestamptz,timestamptz)'::regprocedure),chr(13),'')) <> '84e2e415b699d410ab2e79b9dac78152' then
  raise exception 'FINANCIAL_SOURCE_DRIFT: record_subscription_renewal_notice'; end if;
end $gate$;

create or replace function public.record_subscription_renewal_notice(
 p_subscription_id uuid,p_period_end timestamptz,p_at timestamptz default now()) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s public.subscriptions%rowtype; p public.mentor_plans%rowtype; v_id uuid; v_key text;
begin
 select * into s from public.subscriptions where id=p_subscription_id for update;
 -- Accept JS millisecond round trips but always persist the locked DB timestamp.
 if date_trunc('milliseconds',s.current_period_end)=date_trunc('milliseconds',p_period_end) then
  p_period_end := s.current_period_end;
 end if;
 if s.id is null or p_period_end is null or p_at is null or s.status <> 'active'
    or s.cancel_at_period_end or s.current_period_end is distinct from p_period_end
    or s.next_billing_at is null or s.next_billing_at<=p_at then
   return jsonb_build_object('ok',false,'code','not_notice_eligible');
 end if;
 select * into p from public.mentor_plans where id=s.plan_id for share;
 if p.id is null or p.mentor_id is distinct from s.mentor_id or p.plan_tier is distinct from s.plan_tier
    or p.amount_cents is null or p.amount_cents<=0 or p.amount_cents%100<>0 then
   return jsonb_build_object('ok',false,'code','price_unavailable');
 end if;
 v_key := 'sub_renewal_notice:'||s.id::text||':'||to_char(p_period_end at time zone 'UTC','YYYY-MM-DD');
 insert into public.subscription_billing_events
   (subscription_id,student_id,mentor_id,event_type,status,period_start,period_end,billing_at,amount_cents,
    plan_tier,plan_id,idempotency_key,failure_code,failure_message,attempt_count,created_at,processed_at)
 values(s.id,s.student_id,s.mentor_id,'renewal','skipped',s.current_period_start,s.current_period_end,s.next_billing_at,
        p.amount_cents,p.plan_tier,p.id,v_key,'pre_renewal_notice_sent','pre-renewal notice marker',0,p_at,p_at)
 on conflict(idempotency_key) do nothing returning id into v_id;
 return jsonb_build_object('ok',true,'code',case when v_id is null then 'already' else 'sent' end);
end $fn$;
revoke all on function public.record_subscription_renewal_notice(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.record_subscription_renewal_notice(uuid,timestamptz,timestamptz) to service_role;

create or replace function public.process_subscription_renewal_v2(
 p_subscription_id uuid,p_period_end timestamptz,p_idempotency_key text,p_processed_at timestamptz default now()) returns table(ok boolean,code text,message text,billing_event_id uuid,ledger_id uuid,
 next_period_start timestamptz,next_period_end timestamptz,wallet_balance_cents bigint,attempt_count integer)
language plpgsql security definer set search_path = '' as $fn$
declare
 s public.subscriptions%rowtype; p public.mentor_plans%rowtype;
 e public.subscription_billing_events%rowtype; l public.cash_ledger%rowtype;
 v_student uuid; v_mentor uuid; v_amount bigint; v_balance bigint; v_end timestamptz;
 v_key text; v_notice public.subscription_billing_events%rowtype;
begin
 if p_subscription_id is null or p_period_end is null or p_processed_at is null then
   return query select false,'invalid_subscription'::text,'subscription, period and time are required'::text,null::uuid,null::uuid,null::timestamptz,null::timestamptz,null::bigint,0; return;
 end if;
 v_key := 'sub_renewal:'||p_subscription_id::text||':'||to_char(p_period_end at time zone 'UTC','YYYY-MM-DD');
 if p_idempotency_key is distinct from v_key or char_length(p_idempotency_key)>128 then
   return query select false,'invalid_idempotency_key'::text,'key must identify this subscription period'::text,null::uuid,null::uuid,null::timestamptz,null::timestamptz,null::bigint,0; return;
 end if;
 -- Match checkout's pair mutex before row locks. No stale client snapshot decides eligibility.
 select student_id,mentor_id into v_student,v_mentor from public.subscriptions where id=p_subscription_id;
 if v_student is null then
   return query select false,'not_found'::text,'subscription not found'::text,null::uuid,null::uuid,null::timestamptz,null::timestamptz,null::bigint,0; return;
 end if;
 perform pg_advisory_xact_lock(hashtext(v_student::text),hashtext(v_mentor::text));
 select * into s from public.subscriptions where id=p_subscription_id for update;
 if s.id is null or s.student_id is distinct from v_student or s.mentor_id is distinct from v_mentor then
   raise exception 'SUBSCRIPTION_BINDING_MISMATCH';
 end if;
 select * into e from public.subscription_billing_events where idempotency_key=v_key for update;
 -- Older web normalizes timestamps through JS Date (millisecond precision). Bind
 -- to the locked subscription, or the original event on replay, without rounding
 -- stored financial periods. A different millisecond is still a stale request.
 if e.id is not null and e.subscription_id=s.id
    and date_trunc('milliseconds',e.period_start)=date_trunc('milliseconds',p_period_end) then
  p_period_end := e.period_start;
 elsif e.id is null
    and date_trunc('milliseconds',s.current_period_end)=date_trunc('milliseconds',p_period_end) then
  p_period_end := s.current_period_end;
 end if;
 if e.id is not null then
   if e.subscription_id is distinct from s.id or e.student_id is distinct from s.student_id
      or e.mentor_id is distinct from s.mentor_id or e.period_start is distinct from p_period_end
      or e.event_type not in ('renewal','renewal_failed') then
     raise exception 'BILLING_EVENT_BINDING_MISMATCH';
   end if;
   if e.status='succeeded' then
     select * into l from public.cash_ledger where id=e.ledger_id;
     if l.id is null or l.delta_cents is distinct from -e.amount_cents::bigint
        or l.user_id is distinct from s.student_id or l.ref_id is distinct from s.id
        or l.idempotency_key is distinct from v_key or l.reason is distinct from 'subscription_renewal' then
       raise exception 'LEDGER_BINDING_MISMATCH';
     end if;
     return query select true,'already_succeeded'::text,'renewal already processed'::text,e.id,l.id,e.period_start,e.period_end,null::bigint,e.attempt_count; return;
   end if;
   if e.status not in ('failed','skipped') then
     return query select false,'already_processing'::text,'renewal is already processing'::text,e.id,e.ledger_id,e.period_start,e.period_end,null::bigint,e.attempt_count; return;
   end if;
 end if;
 if s.status not in ('active','past_due') or s.cancel_at_period_end
    or (s.status='past_due' and s.grace_until is not null and s.grace_until<=p_processed_at)
    or s.current_period_end is distinct from p_period_end or s.next_billing_at is null
    or s.next_billing_at>p_processed_at or p_period_end>p_processed_at then
   return query select false,'not_renewal_eligible'::text,'subscription state or period changed'::text,e.id,null::uuid,s.current_period_start,s.current_period_end,null::bigint,coalesce(e.attempt_count,0); return;
 end if;
 select * into p from public.mentor_plans where id=s.plan_id for share;
 if p.id is null or p.mentor_id is distinct from s.mentor_id or p.plan_tier is distinct from s.plan_tier
    or p.amount_cents is null or p.amount_cents<=0 or p.amount_cents%100<>0 then
   e := core_private.record_subscription_renewal_block(s.id,'price_unavailable',v_key,p_processed_at);
   return query select false,'price_unavailable'::text,'plan price or binding unavailable'::text,e.id,null::uuid,s.current_period_start,s.current_period_end,null::bigint,coalesce(e.attempt_count,0); return;
 end if;
 -- is_active controls NEW subscriptions only. Existing subscriptions may renew.
 v_amount := p.amount_cents;
 select * into v_notice from public.subscription_billing_events
  where idempotency_key='sub_renewal_notice:'||s.id::text||':'||to_char(p_period_end at time zone 'UTC','YYYY-MM-DD');
 if v_notice.id is not null and (v_notice.amount_cents is distinct from v_amount
    or v_notice.plan_id is distinct from p.id or v_notice.plan_tier is distinct from p.plan_tier) then
   e := core_private.record_subscription_renewal_block(s.id,'price_changed_since_notice',v_key,p_processed_at);
   return query select false,'price_changed_since_notice'::text,'renewal price differs from the sent notice'::text,e.id,null::uuid,s.current_period_start,s.current_period_end,null::bigint,coalesce(e.attempt_count,0); return;
 end if;
 if exists(select 1 from public.cash_ledger where idempotency_key=v_key) then
   raise exception 'LEDGER_WITHOUT_SUCCEEDED_EVENT';
 end if;
 v_end := ((p_period_end at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul');
 if e.id is null then
   insert into public.subscription_billing_events
    (subscription_id,student_id,mentor_id,event_type,status,period_start,period_end,billing_at,
     amount_cents,plan_tier,plan_id,idempotency_key,attempt_count,created_at)
   values(s.id,s.student_id,s.mentor_id,'renewal','processing',p_period_end,v_end,p_processed_at,
          v_amount,p.plan_tier,p.id,v_key,1,p_processed_at) returning * into e;
 else
   update public.subscription_billing_events b set event_type='renewal',status='processing',
     amount_cents=v_amount,plan_id=p.id,plan_tier=p.plan_tier,billing_at=p_processed_at,
     attempt_count=b.attempt_count+1,processed_at=null,failure_code=null,failure_message=null
   where b.id=e.id returning b.* into e;
 end if;
 insert into public.cash_wallets(user_id,balance_cents) values(s.student_id,0) on conflict(user_id) do nothing;
 update public.cash_wallets w set balance_cents=w.balance_cents-v_amount
   where w.user_id=s.student_id and w.balance_cents>=v_amount returning w.balance_cents into v_balance;
 if not found then
   update public.subscription_billing_events b set event_type='renewal_failed',status='failed',
     failure_code='insufficient_cash',failure_message='CASH_INSUFFICIENT',processed_at=p_processed_at where b.id=e.id;
   update public.subscriptions set status='past_due',grace_until=coalesce(grace_until,p_processed_at+interval '2 days'),
     updated_at=p_processed_at,last_billing_event_id=e.id where id=s.id;
   return query select false,'insufficient_cash'::text,'CASH_INSUFFICIENT'::text,e.id,null::uuid,p_period_end,v_end,null::bigint,e.attempt_count; return;
 end if;
 insert into public.cash_ledger(user_id,delta_cents,reason,ref_type,ref_id,idempotency_key,created_at)
 values(s.student_id,-v_amount,'subscription_renewal','subscriptions',s.id,v_key,p_processed_at) returning * into l;
 update public.subscription_billing_events b set event_type='renewal',status='succeeded',ledger_id=l.id,
   processed_at=p_processed_at,failure_code=null,failure_message=null where b.id=e.id;
 update public.subscriptions set status='active',current_period_start=p_period_end,current_period_end=v_end,
   next_billing_at=v_end,last_renewed_at=p_processed_at,last_billing_event_id=e.id,grace_until=null,updated_at=p_processed_at where id=s.id;
 return query select true,'succeeded'::text,'renewal processed'::text,e.id,l.id,p_period_end,v_end,v_balance,e.attempt_count;
end $fn$;
revoke all on function public.process_subscription_renewal_v2(uuid,timestamptz,text,timestamptz) from public,anon,authenticated;
grant execute on function public.process_subscription_renewal_v2(uuid,timestamptz,text,timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;
