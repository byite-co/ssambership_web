-- LOCAL PostgreSQL only. All synthetic data and failure triggers roll back.
begin;
set local search_path = public;
create function pg_temp.check_ok(v boolean, label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'ASSERT: %',label; end if; end $$;
create function pg_temp.error_of(sql text) returns text language plpgsql as $$
begin execute sql; return 'NO_ERROR'; exception when others then return sqlerrm; end $$;
create function pg_temp.as_user(id uuid) returns void language plpgsql as $$
begin
 perform set_config('request.jwt.claim.sub',coalesce(id::text,''),true);
 perform set_config('request.jwt.claims',case when id is null then '{}' else jsonb_build_object('sub',id,'role','authenticated')::text end,true);
end $$;
create temp table results(k text primary key,v jsonb);
grant select,insert,update on results to authenticated,service_role,anon;
create function pg_temp.result(k text) returns jsonb language sql as $$select v from results where results.k=$1$$;

grant execute on function pg_temp.check_ok(boolean,text),pg_temp.error_of(text),pg_temp.as_user(uuid),pg_temp.result(text) to authenticated,service_role,anon;

-- Auth signup triggers and mentor approval/plan seeding run normally.
insert into auth.users(instance_id,id,aud,role,email,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',('00000000-0000-4000-8000-00000000f00'||i)::uuid,
 'authenticated','authenticated','boundary-'||i||'@test.local',
 jsonb_build_object('app_role',case when i<=2 or i=8 then 'mentor' else 'student' end,'full_name','경계검증','nickname','검증'||i,'grade_level','고2'),now(),now()
from generate_series(1,8) i;
update public.mentor_profiles set verification_status='approved',cap_limit=100
 where user_id in ('00000000-0000-4000-8000-00000000f001','00000000-0000-4000-8000-00000000f002');
update public.mentor_plans set amount_cents=5000000 where mentor_id='00000000-0000-4000-8000-00000000f001' and plan_tier='limited';
insert into public.cash_wallets(user_id,balance_cents)
select ('00000000-0000-4000-8000-00000000f00'||i)::uuid,50000000 from generate_series(3,7) i
on conflict(user_id) do update set balance_cents=excluded.balance_cents;
insert into public.payments(id,user_id,mentor_id,status,amount,currency,kind,plan_id)
select ('00000000-0000-4000-8000-00000000f10'||i)::uuid,('00000000-0000-4000-8000-00000000f00'||i)::uuid,
 mp.mentor_id,'pending',50000,'KRW','subscription',mp.id
from public.mentor_plans mp cross join generate_series(3,4) i
where mp.mentor_id='00000000-0000-4000-8000-00000000f001' and mp.plan_tier='limited';

insert into public.payments(id,user_id,mentor_id,status,amount,currency,kind,plan_id)
select '00000000-0000-4000-8000-00000000f203','00000000-0000-4000-8000-00000000f003',mentor_id,'pending',84900,'KRW','subscription',id
from public.mentor_plans where mentor_id='00000000-0000-4000-8000-00000000f001' and plan_tier='standard';

set local role service_role;
insert into results select 'initial',api_web_v1.subscription_checkout_confirm_v3('00000000-0000-4000-8000-00000000f103',
 (select plan_id from public.payments where id='00000000-0000-4000-8000-00000000f103'),5000000,'boundary-initial');
reset role;
select pg_temp.check_ok((pg_temp.result('initial')->>'ok')::boolean,'checkout succeeded');
select pg_temp.check_ok((select count(*)=1 from public.subscription_billing_events where payment_id='00000000-0000-4000-8000-00000000f103' and event_type='initial' and status='succeeded'),'initial event atomic');
select pg_temp.check_ok((select s.last_billing_event_id=e.id from public.subscriptions s join public.subscription_billing_events e on e.payment_id=s.last_payment_id where s.id=(pg_temp.result('initial')->>'subscription_id')::uuid),'last billing event points to initial');

-- Mixed deployment: delayed legacy writes must not replace either payment's event.
create temp table legacy_payload as
 select subscription_id,student_id,mentor_id,event_type,status,period_start,period_end,billing_at,amount_cents,plan_tier,plan_id,
 'sub_initial:'||subscription_id as idempotency_key,ledger_id,payment_id,processed_at
 from public.subscription_billing_events where payment_id='00000000-0000-4000-8000-00000000f103';
grant select on legacy_payload to service_role;
set local role service_role;
insert into results select 'B',api_web_v1.subscription_checkout_confirm_v2('00000000-0000-4000-8000-00000000f203',
 (select plan_id from public.payments where id='00000000-0000-4000-8000-00000000f203'),8490000,'second-intent');
select pg_temp.check_ok((pg_temp.result('B')->>'ok')::boolean,'overlapping legacy checkout completes');
insert into public.subscription_billing_events(subscription_id,student_id,mentor_id,event_type,status,period_start,period_end,billing_at,amount_cents,plan_tier,plan_id,idempotency_key,ledger_id,payment_id,processed_at)
select * from legacy_payload
on conflict(idempotency_key) do update set period_start=excluded.period_start,period_end=excluded.period_end,billing_at=excluded.billing_at,
 amount_cents=excluded.amount_cents,plan_tier=excluded.plan_tier,plan_id=excluded.plan_id,ledger_id=excluded.ledger_id,payment_id=excluded.payment_id,processed_at=excluded.processed_at;
-- Also cover an upsert that returned before B: its standalone pointer UPDATE can still be delayed.
update public.subscriptions set last_payment_id='00000000-0000-4000-8000-00000000f103',
 last_billing_event_id=(select id from public.subscription_billing_events where payment_id='00000000-0000-4000-8000-00000000f103' and event_type='initial')
 where id=(pg_temp.result('initial')->>'subscription_id')::uuid;
reset role;
select pg_temp.check_ok((select count(*)=2 and count(distinct payment_id)=2 from public.subscription_billing_events where subscription_id=(pg_temp.result('initial')->>'subscription_id')::uuid and event_type='initial'),'both payment events survive delayed old web');
select pg_temp.check_ok((select s.payment_id=s.last_payment_id and e.payment_id=s.payment_id and e.amount_cents=8490000
 from public.subscriptions s join public.subscription_billing_events e on e.id=s.last_billing_event_id
 where s.id=(pg_temp.result('initial')->>'subscription_id')::uuid),'old standalone pointer write cannot rewind B');
select pg_temp.check_ok(pg_temp.error_of($q$update public.subscription_billing_events set amount_cents=1 where payment_id='00000000-0000-4000-8000-00000000f203' and event_type='initial'$q$)='INITIAL_BILLING_EVENT_IMMUTABLE','initial financial fields immutable');

-- Legacy missing-event replay after renewal: period comes from the original debit.
update public.subscriptions set current_period_start=((now()-interval '1 hour') at time zone 'Asia/Seoul'-interval '1 month') at time zone 'Asia/Seoul',
 current_period_end=now()-interval '1 hour',next_billing_at=now()-interval '1 hour'
 where id=(pg_temp.result('initial')->>'subscription_id')::uuid;
update public.cash_ledger set created_at=((now()-interval '1 hour') at time zone 'Asia/Seoul'-interval '1 month') at time zone 'Asia/Seoul'
 where idempotency_key='sub_debit_00000000-0000-4000-8000-00000000f203';
create temp table original_period as select current_period_start,current_period_end from public.subscriptions where id=(pg_temp.result('initial')->>'subscription_id')::uuid;
set local role service_role;
insert into results select 'renewed',to_jsonb(r) from public.subscriptions s cross join lateral public.process_subscription_renewal_v2(s.id,s.current_period_end,
 'sub_renewal:'||s.id||':'||to_char(s.current_period_end at time zone 'UTC','YYYY-MM-DD'),now()) r where s.id=(pg_temp.result('initial')->>'subscription_id')::uuid;
reset role;
select pg_temp.check_ok(pg_temp.result('renewed')->>'code'='succeeded','real renewal before repair');
delete from public.subscription_billing_events where payment_id='00000000-0000-4000-8000-00000000f203' and event_type='initial';
set local role service_role;
insert into results select 'repaired',api_web_v1.subscription_checkout_confirm_v3('00000000-0000-4000-8000-00000000f203',
 (select plan_id from public.payments where id='00000000-0000-4000-8000-00000000f203'),8490000,'second-intent');
reset role;
select pg_temp.check_ok((pg_temp.result('repaired')->>'idempotent')::boolean,'missing event replay succeeds');
select pg_temp.check_ok((select e.period_start=o.current_period_start and e.period_end=o.current_period_end from public.subscription_billing_events e cross join original_period o
 where e.payment_id='00000000-0000-4000-8000-00000000f203' and e.event_type='initial'),'repaired initial event retains original month');
select pg_temp.check_ok((select last_billing_event_id=(pg_temp.result('renewed')->>'billing_event_id')::uuid from public.subscriptions where id=(pg_temp.result('initial')->>'subscription_id')::uuid),'repair does not replace latest renewal pointer');

-- A real mentor price edit after notice: no charge, no paid entitlement, finite grace.
update public.users set created_at=now()-interval '50 days' where id='00000000-0000-4000-8000-00000000f003';
update public.subscriptions set current_period_start=now()-interval '40 days',current_period_end=now()-interval '10 days',next_billing_at=now()-interval '10 days'
 where id=(pg_temp.result('initial')->>'subscription_id')::uuid;
insert into results select 'notice',public.record_subscription_renewal_notice(id,current_period_end,now()-interval '13 days') from public.subscriptions where id=(pg_temp.result('initial')->>'subscription_id')::uuid;
select pg_temp.check_ok(pg_temp.result('notice')->>'code'='sent','notice precedes price edit');
select pg_temp.as_user('00000000-0000-4000-8000-00000000f001');
set local role authenticated;
insert into results select 'price_edit',api_web_v1.mentor_plan_prices_set_self(50000,85900,174900);
reset role;
select pg_temp.as_user(null);
select pg_temp.check_ok((pg_temp.result('price_edit')->>'ok')::boolean,'normal mentor price API accepts price');
create temp table blocked as select id,current_period_end,'sub_renewal:'||id||':'||to_char(current_period_end at time zone 'UTC','YYYY-MM-DD') key from public.subscriptions where id=(pg_temp.result('initial')->>'subscription_id')::uuid;
grant select on blocked to service_role;
-- Inject failure in the state step: its failed event must also roll back.
create function pg_temp.fail_block_state() returns trigger language plpgsql as $$begin if new.status='past_due' then raise exception 'FORCED_BLOCK_STATE_FAILURE'; end if;return new;end$$;
create trigger review_fail_block_state before update on public.subscriptions for each row execute function pg_temp.fail_block_state();
set local role service_role;
select pg_temp.check_ok(pg_temp.error_of($q$select public.process_subscription_renewal_v2(id,current_period_end,key,now()) from blocked$q$)='FORCED_BLOCK_STATE_FAILURE','blocked-state failure propagates');
reset role;
select pg_temp.check_ok(not exists(select 1 from public.subscription_billing_events where idempotency_key=(select key from blocked)),'blocked-state failure rolls back failed event');
drop trigger review_fail_block_state on public.subscriptions;
set local role service_role;
insert into results select 'blocked',to_jsonb(r) from blocked b cross join lateral public.process_subscription_renewal_v2(b.id,b.current_period_end,b.key,now()) r;
insert into results select 'blocked_retry',to_jsonb(r) from blocked b cross join lateral public.process_subscription_renewal_v2(b.id,b.current_period_end,b.key,now()+interval '1 day') r;
reset role;
select pg_temp.check_ok(pg_temp.result('blocked')->>'code'='price_changed_since_notice' and pg_temp.result('blocked_retry')->>'code'='price_changed_since_notice','changed price remains fail-closed');
select pg_temp.check_ok((select status='past_due' and grace_until=now()+interval '2 days' from public.subscriptions where id=(select id from blocked)),'retry cannot extend finite grace');
select pg_temp.check_ok(not exists(select 1 from public.cash_ledger where idempotency_key=(select key from blocked)),'price mismatch debits zero');
select pg_temp.check_ok((select status='failed' and attempt_count=2 and failure_code='price_changed_since_notice' from public.subscription_billing_events where idempotency_key=(select key from blocked)),'failure history is persistent and idempotent');
select pg_temp.as_user('00000000-0000-4000-8000-00000000f003');
set local role authenticated;
select pg_temp.check_ok(not (public.get_weekly_question_usage('00000000-0000-4000-8000-00000000f003','00000000-0000-4000-8000-00000000f001')->>'can_ask')::boolean,'blocked subscription has no paid question allowance');
select pg_temp.check_ok(pg_temp.error_of($q$select public.qna_create_question_thread((pg_temp.result('initial')->>'room_id')::uuid,'미결제 질문',null,null,'본문')$q$)='FREE_QUOTA_EXPIRED','existing app/public RPC cannot use an unpaid subscription');
reset role;
select pg_temp.as_user(null);
set local role service_role;
insert into results select 'expired',public.finalize_subscription_terminal_transition(id,'grace_expired',now()+interval '2 days','sub_expired:'||id||':'||to_char(current_period_end at time zone 'UTC','YYYY-MM-DD')) from blocked;
reset role;
select pg_temp.check_ok(pg_temp.result('expired')->>'code'='succeeded','unresolved price block expires');
select pg_temp.check_ok((select status='expired' and next_billing_at is null from public.subscriptions where id=(select id from blocked)),'expired row leaves renewal queue');
select pg_temp.check_ok(not has_function_privilege('anon','public.claim_subscription_renewal_batch(timestamptz,integer)','execute') and not has_function_privilege('authenticated','public.claim_subscription_renewal_batch(timestamptz,integer)','execute'),'batch claiming is server-only');
rollback;
select 'SUBSCRIPTION_REVIEW_REGRESSIONS_PASS' as result;
