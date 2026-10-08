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

set local role service_role;
insert into results select 'initial',api_web_v1.subscription_checkout_confirm_v3('00000000-0000-4000-8000-00000000f103',
 (select plan_id from public.payments where id='00000000-0000-4000-8000-00000000f103'),5000000,'boundary-initial');
reset role;
select pg_temp.check_ok((pg_temp.result('initial')->>'ok')::boolean,'checkout succeeded');
select pg_temp.check_ok((select count(*)=1 from public.subscription_billing_events where payment_id='00000000-0000-4000-8000-00000000f103' and event_type='initial' and status='succeeded'),'initial event atomic');
select pg_temp.check_ok((select s.last_billing_event_id=e.id from public.subscriptions s join public.subscription_billing_events e on e.payment_id=s.last_payment_id where s.id=(pg_temp.result('initial')->>'subscription_id')::uuid),'last billing event points to initial');

-- Create 49 more subscriptions to the changed-price mentor and one healthy subscription.
insert into auth.users(instance_id,id,aud,role,email,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',('00000000-0000-4000-8000-00000000e'||lpad(i::text,3,'0'))::uuid,
 'authenticated','authenticated','queue-'||i||'@test.local',jsonb_build_object('app_role','student','full_name','배치검증','nickname','배치'||i,'grade_level','고2'),now(),now()
from generate_series(1,50) i;
insert into public.cash_wallets(user_id,balance_cents)
select ('00000000-0000-4000-8000-00000000e'||lpad(i::text,3,'0'))::uuid,50000000 from generate_series(1,50) i;
do $$declare i integer; v_student uuid; v_mentor uuid; v_plan uuid; v_amount integer; v_payment uuid; r jsonb;
begin
 for i in 1..50 loop
  v_student:=('00000000-0000-4000-8000-00000000e'||lpad(i::text,3,'0'))::uuid;
  v_mentor:=case when i=50 then '00000000-0000-4000-8000-00000000f002'::uuid else '00000000-0000-4000-8000-00000000f001'::uuid end;
  select id,amount_cents into v_plan,v_amount from public.mentor_plans where mentor_id=v_mentor and plan_tier='limited';
  insert into public.payments(user_id,mentor_id,status,amount,currency,kind,plan_id)
  values(v_student,v_mentor,'pending',v_amount/100,'KRW','subscription',v_plan) returning id into v_payment;
  r:=api_web_v1.subscription_checkout_confirm_v3(v_payment,v_plan,v_amount,'batch-seed-'||i);
  perform pg_temp.check_ok((r->>'ok')::boolean,'seed checkout '||i||' '||r::text);
 end loop;
end $$;
update public.subscriptions set current_period_start=now()-interval '40 days',current_period_end=date_trunc('milliseconds',now()-interval '10 days')+interval '321 microseconds',next_billing_at=date_trunc('milliseconds',now()-interval '10 days')+interval '321 microseconds'
 where mentor_id='00000000-0000-4000-8000-00000000f001';
select public.record_subscription_renewal_notice(id,current_period_end,now()-interval '13 days')
 from public.subscriptions where mentor_id='00000000-0000-4000-8000-00000000f001';
update public.subscriptions set current_period_start=now()-interval '35 days',current_period_end=date_trunc('milliseconds',now()-interval '5 days')+interval '321 microseconds',next_billing_at=date_trunc('milliseconds',now()-interval '5 days')+interval '321 microseconds'
 where mentor_id='00000000-0000-4000-8000-00000000f002';
select pg_temp.as_user('00000000-0000-4000-8000-00000000f001');
set local role authenticated;
select api_web_v1.mentor_plan_prices_set_self(51000,84900,174900);
reset role;
select pg_temp.as_user(null);

commit;
