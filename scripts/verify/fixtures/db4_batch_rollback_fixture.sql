-- db4_batch_rollback_fixture.sql — DB-4 rollback(204 → 199 역순) 후 복원 assertion (오프라인 스크래치 PG 전용).
begin;
set local search_path to public;
create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'RB ok   %', p_label;
  else raise exception 'RB FAIL %', p_label; end if;
end $$;
create or replace function pg_temp.snap(p_key text) returns text language sql as $$ select val from db4_check.snapshot where key = p_key $$;

-- 객체 부재
select pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1'
                    and p.proname in ('subscribe_with_cash','subscription_cancel_at_period_end','subscription_cancel_undo','refund_estimate','refund_request_create',
                                      'mentor_activity_set','mentor_plan_active_set','user_profile_update_self_v2','mentor_student_id_document_set_self',
                                      'create_individual_question_as_student_v2')), 'DB-4 api_app_v1 래퍼 10종 부재');
select pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private' and p.proname = 'subscription_refund_estimate_impl'), 'core_private impl 부재');
-- census 복원
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1')::text = pg_temp.snap('fn_app_count'), 'api_app_v1 함수 수 적용 전과 동일(6)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private')::text = pg_temp.snap('fn_core_count'), 'core_private 함수 수 적용 전과 동일(7)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_web_v1')::text = pg_temp.snap('fn_web_count'), 'api_web_v1 함수 수 불변');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')::text = pg_temp.snap('fn_public_count'), 'public 함수 수 불변');
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'public')::text = pg_temp.snap('policies_count'), 'public 정책 수 불변');
-- 기존 정본 불변(md5)
select pg_temp.ok(md5(pg_get_functiondef('public.create_individual_question_as_student(text,text,text,int,uuid,text)'::regprocedure)) = pg_temp.snap('fn_iq_v1'), 'v1 create_individual_question_as_student md5 불변');
select pg_temp.ok(md5(pg_get_functiondef('api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text)'::regprocedure)) = pg_temp.snap('fn_f12'), 'F12 md5 불변');
select pg_temp.ok(md5(pg_get_functiondef('public.confirm_subscription_checkout(uuid,uuid,text)'::regprocedure)) = pg_temp.snap('fn_confirm'), '정본 confirm md5 불변');
select pg_temp.ok(md5(pg_get_functiondef('api_app_v1.user_profile_update_self(text,text)'::regprocedure)) = pg_temp.snap('fn_profile_v1'), 'v1 user_profile_update_self md5 불변');
select pg_temp.ok(md5(pg_get_functiondef('api_web_v1.mentor_plan_prices_set_self(integer,integer,integer)'::regprocedure)) = pg_temp.snap('fn_f8'), 'F8 md5 불변');
select pg_temp.ok((select coalesce(with_check, '') from pg_policies where tablename = 'refunds' and policyname = 'refund_ins') = pg_temp.snap('pol_refund_ins'), 'refund_ins 정책 불변');
-- forward 기간 데이터 유지(자금 롤백 없음): S4·S5 의 앱 구독(4b·4c) — 구독 active · 원장 차감 1건씩 · 결제 succeeded · 방 · initial billing event
select pg_temp.ok((select count(*) from public.subscriptions where student_id in ('00000000-0000-4000-8000-00000000d4b4','00000000-0000-4000-8000-00000000d4b5') and mentor_id = '00000000-0000-4000-8000-00000000d4a1' and status = 'active') = 2,
                  '데이터: forward 기간 S4·S5 구독 유지');
select pg_temp.ok((select count(*) from public.cash_ledger where user_id in ('00000000-0000-4000-8000-00000000d4b4','00000000-0000-4000-8000-00000000d4b5') and reason = 'subscription_payment') = 2
                  and (select balance_cents from public.cash_wallets where user_id = '00000000-0000-4000-8000-00000000d4b5') = 2010000, '데이터: 원장 차감 1건씩 · S5 잔액 2,010,000(동시 재시도 이중 차감 0)');
select pg_temp.ok((select count(*) from public.payments where external_id in ('sub_app_K-fwd-s4', 'sub_app_K-conc') and status = 'succeeded') = 2, '데이터: 앱 intent 결제 2건 succeeded 유지');
select pg_temp.ok((select count(*) from public.mentor_student_rooms where student_id in ('00000000-0000-4000-8000-00000000d4b4','00000000-0000-4000-8000-00000000d4b5') and mentor_id = '00000000-0000-4000-8000-00000000d4a1') = 2
                  and (select count(*) from public.subscription_billing_events e join public.subscriptions s on s.id = e.subscription_id
                        where s.student_id in ('00000000-0000-4000-8000-00000000d4b4','00000000-0000-4000-8000-00000000d4b5') and e.event_type = 'initial' and e.status = 'succeeded') = 2,
                  '데이터: 방 2 · initial billing event 2 유지');
\echo DB4 ROLLBACK FIXTURE PASS
rollback;
