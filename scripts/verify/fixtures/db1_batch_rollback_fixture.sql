-- db1_batch_rollback_fixture.sql — DB-1 rollback(192 → 191 → 190) 후 복원 assertion (오프라인 스크래치 PG 전용).
begin;
set local search_path to public;
create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'RB ok   %', p_label;
  else raise exception 'RB FAIL %', p_label; end if;
end $$;
create or replace function pg_temp.snap(p_key text) returns text language sql as $$ select val from db1_check.snapshot where key = p_key $$;

-- A
select pg_temp.ok(public.subscription_cap_weight('standard') = 2.5 and public.subscription_cap_weight('premium') = 4.5, 'A 가중치 1.0/2.5/4.5 복원');
select pg_temp.ok(public.mentor_cap_limit(gen_random_uuid()) = 28 and (select string_agg(distinct cap_limit::text, ',') from public.mentor_profiles) = '28', 'A 한도 28 복원(폴백 · 행)');
select pg_temp.ok((select column_default from information_schema.columns where table_name = 'mentor_profiles' and column_name = 'cap_limit') = '28', 'A cap_limit 기본값 28 복원');
select pg_temp.ok((select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_web_v1' and p.proname = 'mentor_plan_prices_set_self') = pg_temp.snap('f8_md5'), 'A F8 정의 md5 사전 스냅샷과 일치');
select pg_temp.ok((select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'mp_seed_default_plans_on_approval') = pg_temp.snap('seed_md5'), 'A 시드 함수 정의 md5 일치');
select pg_temp.ok((select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'enforce_mentor_profile_privileged_guard') = pg_temp.snap('guard_md5'), 'A M0 가드 정의 md5 일치');
select pg_temp.ok((select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgname = 'trg_mentor_profile_privileged_guard_ins') = pg_temp.snap('guard_ins_trg'), 'A INSERT 가드 트리거 정의 일치(28)');
select pg_temp.ok((select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'subscription_cap_weight') = pg_temp.snap('cap_w_md5')
                  and (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'mentor_cap_limit') = pg_temp.snap('cap_l_md5'), 'A cap 함수 2종 정의 md5 일치');
select pg_temp.ok((select string_agg(plan_tier || '=' || cap_weight, ',' order by plan_tier) from public.mentor_plans where mentor_id = '00000000-0000-4000-8000-00000000d1a1') = 'limited=1.0,premium=4.5,standard=2.5', 'A mentor_plans.cap_weight 2.5/4.5 복원');
select pg_temp.ok((select updated_at::text from public.mentor_profiles where user_id = '00000000-0000-4000-8000-00000000d1a1') = pg_temp.snap('mp_updated_at_m1'), 'A 롤백도 mentor_profiles.updated_at 불변');
-- C
select pg_temp.ok((select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'record_custom_order_dispute_split') = pg_temp.snap('split_md5'), 'C 125 본문 md5 일치');
-- B
select pg_temp.ok((select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'approve_mentor_school_verification_admin') = pg_temp.snap('rpc174_md5'), 'B RPC 174 정의 md5 일치');
select pg_temp.ok((select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.proname = 'tmp_auto_school_verification') = pg_temp.snap('tmp_fn_md5')
                  and (select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgname = 'trg_tmp_auto_school_verification') = pg_temp.snap('tmp_trg'), 'B tmp 트리거/함수 20260830150838 복원');
select pg_temp.ok(not exists (select 1 from pg_proc where proname in ('auto_school_verification', 'school_verification_reassess_on_academic_change', 'school_tier_suggest', 'major_category_suggest')), 'B 신규 함수 4종 부재');
select pg_temp.ok((select count(*) from public.mentor_school_verifications v join public.mentor_profiles p on p.user_id = v.mentor_id
                    where v.status = 'approved' and v.reviewed_by is null and p.verification_status = 'approved') = 2, 'B-1 일괄 확정 2건 되돌림(M1·M3 잠정)');
select pg_temp.ok((select reviewed_at::text from public.mentor_school_verifications where mentor_id = '00000000-0000-4000-8000-00000000d1a2') = pg_temp.snap('msv_m2_reviewed_at'), 'B-1 M2(기존 확정) 불변');
select pg_temp.ok((select (detail ->> 'count')::int from public.admin_action_logs where action_type = 'school_verification_bulk_confirm_reverted' order by created_at desc limit 1) = 2, 'B-1 되돌림 기록 count 2');
\echo DB1 ROLLBACK FIXTURE PASS
rollback;
