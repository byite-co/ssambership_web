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
update public.mentor_plans set amount_cents=5000000 where mentor_id='00000000-0000-4000-8000-00000000f001';
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

-- Failing the last step must roll back payment state, wallet, ledger, subscription and room.
create function pg_temp.fail_initial() returns trigger language plpgsql as $$
begin if new.event_type='initial' then raise exception 'FORCED_INITIAL_EVENT_FAILURE'; end if; return new; end $$;
create trigger boundary_fail_initial before insert on public.subscription_billing_events for each row execute function pg_temp.fail_initial();
select pg_temp.check_ok(pg_temp.error_of($q$select api_web_v1.subscription_checkout_confirm_v3('00000000-0000-4000-8000-00000000f104',
 (select plan_id from public.payments where id='00000000-0000-4000-8000-00000000f104'),5000000,'boundary-fail')$q$)='FORCED_INITIAL_EVENT_FAILURE','injected initial error propagated');
select pg_temp.check_ok((select status='pending' from public.payments where id='00000000-0000-4000-8000-00000000f104'),'payment success rolled back; pre-existing intent retained');
select pg_temp.check_ok((select balance_cents=50000000 from public.cash_wallets where user_id='00000000-0000-4000-8000-00000000f004'),'wallet rolled back');
select pg_temp.check_ok(not exists(select 1 from public.cash_ledger where user_id='00000000-0000-4000-8000-00000000f004'),'ledger rolled back');
select pg_temp.check_ok(not exists(select 1 from public.subscriptions where student_id='00000000-0000-4000-8000-00000000f004'),'subscription rolled back');
select pg_temp.check_ok(not exists(select 1 from public.mentor_student_rooms where student_id='00000000-0000-4000-8000-00000000f004'),'room rolled back');

-- Existing app RPC contract is identical, including failure rollback of its in-transaction intent.
select pg_temp.as_user('00000000-0000-4000-8000-00000000f005');
set local role authenticated;
select pg_temp.check_ok(pg_temp.error_of($q$select api_app_v1.subscribe_with_cash('00000000-0000-4000-8000-00000000f001','limited','boundary-app')$q$)='FORCED_INITIAL_EVENT_FAILURE','app failure uses common event');
reset role;
select pg_temp.as_user(null);
select pg_temp.check_ok(not exists(select 1 from public.payments where user_id='00000000-0000-4000-8000-00000000f005'),'app intent rolled back');
drop trigger boundary_fail_initial on public.subscription_billing_events;
set local role service_role;
insert into results select 'old_web',api_web_v1.subscription_checkout_confirm_v2('00000000-0000-4000-8000-00000000f104',
 (select plan_id from public.payments where id='00000000-0000-4000-8000-00000000f104'),5000000,'boundary-fail');
reset role;
select pg_temp.check_ok((pg_temp.result('old_web')->>'ok')::boolean,'old web v2 compatible');
select pg_temp.as_user('00000000-0000-4000-8000-00000000f005');
set local role authenticated;
insert into results select 'app',api_app_v1.subscribe_with_cash('00000000-0000-4000-8000-00000000f001','limited','boundary-app');
insert into results select 'app_replay',api_app_v1.subscribe_with_cash('00000000-0000-4000-8000-00000000f001','limited','boundary-app');
reset role;
select pg_temp.as_user(null);
select pg_temp.check_ok((pg_temp.result('app')->>'ok')::boolean and pg_temp.result('app_replay')=pg_temp.result('app')||'{"idempotent":true}'::jsonb,'app cached result and signature unchanged');
select pg_temp.check_ok((select count(*)=1 from public.subscription_billing_events where payment_id=(pg_temp.result('app')->>'payment_id')::uuid),'app initial event exactly once');

-- A second purchase after expiry must preserve BOTH historical payment events.
update public.subscriptions set status='expired',next_billing_at=null,expired_at=now() where id=(pg_temp.result('initial')->>'subscription_id')::uuid;
insert into public.payments(id,user_id,mentor_id,status,amount,currency,kind,plan_id)
select '00000000-0000-4000-8000-00000000f203',user_id,mentor_id,'pending',amount,currency,kind,plan_id from public.payments where id='00000000-0000-4000-8000-00000000f103';
insert into results select 'reactivation',api_web_v1.subscription_checkout_confirm_v3('00000000-0000-4000-8000-00000000f203',
 (select plan_id from public.payments where id='00000000-0000-4000-8000-00000000f203'),5000000,'boundary-reactivate');
select pg_temp.check_ok((pg_temp.result('reactivation')->>'ok')::boolean,'reactivation succeeds');
select pg_temp.check_ok((select count(*)=2 and count(distinct payment_id)=2 from public.subscription_billing_events where subscription_id=(pg_temp.result('initial')->>'subscription_id')::uuid and event_type='initial'),'reactivation preserves initial event history');
insert into results select 'old_replay',api_web_v1.subscription_checkout_confirm_v3('00000000-0000-4000-8000-00000000f103',
 (select plan_id from public.payments where id='00000000-0000-4000-8000-00000000f103'),5000000,'boundary-initial');
select pg_temp.check_ok((pg_temp.result('old_replay')->>'idempotent')::boolean,'old payment replay has no extra charge');

-- Renewal fixtures use the real subscription, plan, wallet and notification triggers.
update public.subscriptions set current_period_start=now()-interval '1 month',current_period_end=now()-interval '1 hour',next_billing_at=now()-interval '1 hour',cancel_at_period_end=false
 where id=(pg_temp.result('initial')->>'subscription_id')::uuid;
create temp table renewal as select id,current_period_end,plan_id,
 'sub_renewal:'||id::text||':'||to_char(current_period_end at time zone 'UTC','YYYY-MM-DD') key
 from public.subscriptions where id=(pg_temp.result('initial')->>'subscription_id')::uuid;
grant select on renewal to service_role;
insert into results select 'wallet_before',to_jsonb(balance_cents) from public.cash_wallets where user_id='00000000-0000-4000-8000-00000000f003';
update public.subscriptions set plan_id=null where id=(select id from renewal);
insert into results select 'missing_price',to_jsonb(r) from renewal s cross join lateral public.process_subscription_renewal_v2(s.id,s.current_period_end,s.key,now()) r;
select pg_temp.check_ok(pg_temp.result('missing_price')->>'code'='price_unavailable','missing plan fails closed');
update public.subscriptions set plan_id=(select id from public.mentor_plans where mentor_id='00000000-0000-4000-8000-00000000f002' and plan_tier='limited') where id=(select id from renewal);
insert into results select 'bad_binding',to_jsonb(r) from renewal s cross join lateral public.process_subscription_renewal_v2(s.id,s.current_period_end,s.key,now()) r;
select pg_temp.check_ok(pg_temp.result('bad_binding')->>'code'='price_unavailable','plan binding fails closed');
select pg_temp.check_ok(not exists(select 1 from public.subscription_billing_events where idempotency_key=(select key from renewal) and status='succeeded') and not exists(select 1 from public.cash_ledger where idempotency_key=(select key from renewal)),'price errors create no successful event or ledger');
select pg_temp.check_ok((select to_jsonb(balance_cents)=pg_temp.result('wallet_before') from public.cash_wallets where user_id='00000000-0000-4000-8000-00000000f003'),'price errors debit zero');
update public.subscriptions set plan_id=(select plan_id from renewal) where id=(select id from renewal);
update public.mentor_plans set is_active=false where id=(select plan_id from renewal);
set local role service_role;
insert into results select 'quote',to_jsonb(q) from renewal s cross join lateral public.subscription_renewal_quote(s.id) q;
-- Legacy caller intentionally supplies 1 won; DB must still debit the custom 50,000 won price.
insert into results select 'renewal',to_jsonb(r) from renewal s cross join lateral public.process_subscription_renewal(s.id,s.current_period_end,100,s.key,now()) r;
insert into results select 'renewal_replay',to_jsonb(r) from renewal s cross join lateral public.process_subscription_renewal_v2(s.id,s.current_period_end,s.key,now()) r;
insert into results select 'wrong_key',to_jsonb(r) from renewal s cross join lateral public.process_subscription_renewal_v2(s.id,s.current_period_end,s.key||':different',now()) r;
reset role;
select pg_temp.check_ok(pg_temp.result('renewal')->>'code'='succeeded','inactive plan existing subscription renews');
select pg_temp.check_ok(pg_temp.result('quote')->>'amount_cents'='5000000','quote uses bound custom price');
select pg_temp.check_ok((select delta_cents=-5000000 from public.cash_ledger where idempotency_key=(select key from renewal)),'caller cannot override custom price');
select pg_temp.check_ok(pg_temp.result('renewal_replay')->>'code'='already_succeeded' and pg_temp.result('wrong_key')->>'code'='invalid_idempotency_key','same key replays, different key rejected');
select pg_temp.check_ok((select count(*)=1 from public.cash_ledger where idempotency_key=(select key from renewal)),'exactly one renewal debit');

-- Notice amount is authoritative; a subsequent price edit cannot silently change the debit.
insert into results select 'notice',public.record_subscription_renewal_notice(id,current_period_end,now()) from public.subscriptions where id=(select id from renewal);
select pg_temp.check_ok(pg_temp.result('notice')->>'code'='sent','notice written');
update public.mentor_plans set amount_cents=5100000 where id=(select plan_id from renewal);
insert into results select 'changed_notice',to_jsonb(r) from public.subscriptions s cross join lateral public.process_subscription_renewal_v2(s.id,s.current_period_end,'sub_renewal:'||s.id||':'||to_char(s.current_period_end at time zone 'UTC','YYYY-MM-DD'),s.current_period_end) r where s.id=(select id from renewal);
select pg_temp.check_ok(pg_temp.result('changed_notice')->>'code'='price_changed_since_notice','notice/charge mismatch blocked');

-- Terminal insert failure and terminal update failure both roll back the other step.
update public.subscriptions set status='past_due',grace_until=now()-interval '1 minute',current_period_end=now()-interval '3 days',next_billing_at=now()-interval '3 days'
 where id=(pg_temp.result('old_web')->>'subscription_id')::uuid;
create temp table terminal as select id,'sub_expired:'||id||':'||to_char(current_period_end at time zone 'UTC','YYYY-MM-DD') key from public.subscriptions where id=(pg_temp.result('old_web')->>'subscription_id')::uuid;
create function pg_temp.fail_terminal_event() returns trigger language plpgsql as $$begin if new.event_type='expired' then raise exception 'FORCED_TERMINAL_EVENT_FAILURE'; end if;return new;end$$;
create trigger boundary_fail_terminal_event before insert on public.subscription_billing_events for each row execute function pg_temp.fail_terminal_event();
select pg_temp.check_ok(pg_temp.error_of($q$select public.finalize_subscription_terminal_transition(id,'grace_expired',now(),key) from terminal$q$)='FORCED_TERMINAL_EVENT_FAILURE','terminal event failure propagated');
select pg_temp.check_ok((select status='past_due' from public.subscriptions where id=(select id from terminal)),'event failure preserves subscription');
drop trigger boundary_fail_terminal_event on public.subscription_billing_events;
create function pg_temp.fail_terminal_state() returns trigger language plpgsql as $$begin if new.status='expired' then raise exception 'FORCED_TERMINAL_STATE_FAILURE'; end if;return new;end$$;
create trigger boundary_fail_terminal_state before update on public.subscriptions for each row execute function pg_temp.fail_terminal_state();
select pg_temp.check_ok(pg_temp.error_of($q$select public.finalize_subscription_terminal_transition(id,'grace_expired',now(),key) from terminal$q$)='FORCED_TERMINAL_STATE_FAILURE','terminal update failure propagated');
select pg_temp.check_ok(not exists(select 1 from public.subscription_billing_events where idempotency_key=(select key from terminal)),'state failure rolls back event');
drop trigger boundary_fail_terminal_state on public.subscriptions;
insert into results select 'terminal',public.finalize_subscription_terminal_transition(id,'grace_expired',now(),key) from terminal;
insert into results select 'terminal_replay',public.finalize_subscription_terminal_transition(id,'grace_expired',now(),key) from terminal;
select pg_temp.check_ok(pg_temp.result('terminal')->>'code'='succeeded' and pg_temp.result('terminal_replay')->>'code'='already_succeeded','terminal transition replay');
select pg_temp.check_ok((select status='expired' and next_billing_at is null from public.subscriptions where id=(select id from terminal)),'terminal state updated');
update public.subscriptions set cancel_at_period_end=true,current_period_end=now()-interval '1 hour',next_billing_at=now()-interval '1 hour' where id=(pg_temp.result('app')->>'subscription_id')::uuid;
insert into results select 'cancel',public.finalize_subscription_terminal_transition(id,'cancel_at_period_end',now(),'sub_cancel:'||id||':'||to_char(current_period_end at time zone 'UTC','YYYY-MM-DD')) from public.subscriptions where id=(pg_temp.result('app')->>'subscription_id')::uuid;
select pg_temp.check_ok((select event_type='canceled' from public.subscription_billing_events where id=(pg_temp.result('cancel')->>'billing_event_id')::uuid),'cancel is distinct from grace expiry');

-- All successful checkout payments have their own initial event, including reactivation.
select pg_temp.check_ok(not exists(select 1 from public.payments p where p.kind='subscription' and p.status='succeeded' and not exists(select 1 from public.subscription_billing_events e where e.payment_id=p.id and e.event_type='initial' and e.status='succeeded')),'initial-event invariant');
select pg_temp.check_ok(not exists(select 1 from public.subscription_billing_events e join public.cash_ledger l on l.id=e.ledger_id where e.event_type='renewal' and e.status='succeeded' and e.amount_cents<>-l.delta_cents),'renewal-ledger amount invariant');

-- Same errors for web and installed app; no new app code needed.
select pg_temp.as_user('00000000-0000-4000-8000-00000000f003');
set local role authenticated;
do $$declare schema_name text; r jsonb; room uuid:=(pg_temp.result('initial')->>'room_id')::uuid;begin
 foreach schema_name in array array['api_web_v1','api_app_v1'] loop
  execute format('select %I.qna_create_question_thread($1,$2)',schema_name) into r using room,repeat('가',121);
  perform pg_temp.check_ok(r->>'code'='TITLE_TOO_LONG',schema_name||' title');
  execute format('select %I.qna_create_question_thread($1,$2,null,$3)',schema_name) into r using room,'제목',repeat('나',81);
  perform pg_temp.check_ok(r->>'code'='TOPIC_TOO_LONG',schema_name||' topic');
  execute format('select %I.qna_create_question_thread($1,$2,null,null,$3)',schema_name) into r using room,'제목',repeat('다',10001);
  perform pg_temp.check_ok(r->>'code'='MESSAGE_TOO_LONG',schema_name||' first body');
  execute format('select %I.qna_create_question_thread($1,$2,$3)',schema_name) into r using room,'제목','not-a-catalog-code';
  perform pg_temp.check_ok(r->>'code'='SUBJECT_INVALID',schema_name||' subject');
 end loop;
end $$;
select pg_temp.check_ok(pg_temp.error_of($q$select public.qna_append_message(gen_random_uuid(),repeat('가',10001))$q$)='MESSAGE_TOO_LONG','append length same canonical code');
insert into results select 'question',api_app_v1.qna_create_question_thread((pg_temp.result('initial')->>'room_id')::uuid,repeat('가',120),null,repeat('나',80),repeat('다',10000));
reset role;
select pg_temp.as_user(null);
select pg_temp.check_ok((pg_temp.result('question')->>'ok')::boolean,'exact length limits accepted');
select pg_temp.check_ok(pg_temp.error_of($q$update public.question_threads set title=repeat('가',121) where id=(pg_temp.result('question')->>'thread_id')::uuid$q$) like '%question_threads_title_size%','direct write title CHECK');
select pg_temp.check_ok(pg_temp.error_of($q$update public.question_messages set body=repeat('가',10001) where thread_id=(pg_temp.result('question')->>'thread_id')::uuid$q$) like '%question_messages_body_size%','direct write message CHECK');

-- Directory tests include pending/deleting mentors, a student and an admin with profiles,
-- hidden/blinded/moderated reviews and private verification document paths.
insert into public.mentor_profiles(user_id,university_name,department_name,high_school_name)
values ('00000000-0000-4000-8000-00000000f006','검증대','검증학과','검증고'),('00000000-0000-4000-8000-00000000f007','검증대','검증학과','검증고');
update public.mentor_profiles set verification_status='approved' where user_id in ('00000000-0000-4000-8000-00000000f006','00000000-0000-4000-8000-00000000f007');
update public.users set role='admin' where id='00000000-0000-4000-8000-00000000f007';
insert into public.account_deletion_jobs(user_id,state) values('00000000-0000-4000-8000-00000000f002','pending');
insert into public.reviews(mentor_id,author_id,rating,body,is_hidden,is_blinded,moderation_state)
values ('00000000-0000-4000-8000-00000000f001','00000000-0000-4000-8000-00000000f003',5,'visible',false,false,'visible'),
       ('00000000-0000-4000-8000-00000000f001','00000000-0000-4000-8000-00000000f004',1,'hidden',true,false,'visible'),
       ('00000000-0000-4000-8000-00000000f001','00000000-0000-4000-8000-00000000f005',1,'blinded',false,true,'visible'),
       ('00000000-0000-4000-8000-00000000f001','00000000-0000-4000-8000-00000000f006',1,'moderated',false,false,'hidden');
update public.mentor_school_verifications set status='approved',document_storage_ref='private/sensitive-proof.pdf',verified_university_name='검증대'
 where mentor_id='00000000-0000-4000-8000-00000000f001';
-- No new base table grants: RLS must still hide the entire private row set from anon.
set local role anon;
select pg_temp.check_ok(exists(select 1 from api_web_v1.mentor_directory_v1 where mentor_id='00000000-0000-4000-8000-00000000f001'),'anon directory usable');
select pg_temp.check_ok(not exists(select 1 from public.mentor_school_verifications),'anon cannot read verification originals');
select pg_temp.check_ok(not exists(select 1 from public.users) and not exists(select 1 from public.mentor_profiles),'anon cannot read private base profiles');
select pg_temp.check_ok(not exists(select 1 from api_web_v1.mentor_directory_v1 where mentor_id in ('00000000-0000-4000-8000-00000000f002','00000000-0000-4000-8000-00000000f006','00000000-0000-4000-8000-00000000f007','00000000-0000-4000-8000-00000000f008')),'deleting/pending/student/admin excluded');
select pg_temp.check_ok((select review_count=1 and avg_rating=5 from api_web_v1.mentor_directory_v1 where mentor_id='00000000-0000-4000-8000-00000000f001'),'only public reviews aggregated');
select pg_temp.check_ok(pg_temp.error_of('select document_storage_ref from api_web_v1.mentor_directory_v1') like 'column%does not exist','sensitive verification field not projected');
reset role;
select pg_temp.check_ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','api_web_v1','api_app_v1','core_private') and p.prorettype='trigger'::regtype and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))),'trigger direct execute revoked');
select 'SUBSCRIPTION_BOUNDARIES_PASS' as result;
rollback;
