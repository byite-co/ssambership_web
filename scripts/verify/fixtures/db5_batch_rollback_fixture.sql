-- db5_batch_rollback_fixture.sql — DB-5 rollback(208 → 205 역순) 후 복원 assertion (오프라인 스크래치 PG 전용).
begin;
set local search_path to public;
create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'RB ok   %', p_label;
  else raise exception 'RB FAIL %', p_label; end if;
end $$;
create or replace function pg_temp.snap(p_key text) returns text language sql as $$ select val from db5_check.snapshot where key = p_key $$;

-- 객체 부재
select pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where (n.nspname, p.proname) in (('public','plan_price_stats'),('api_app_v1','complete_profile'),('api_app_v1','create_individual_question_as_student_v3'),
                                                     ('api_app_v1','review_eligibility_self'),('core_private','user_signup_provision_impl'),('core_private','review_eligibility_impl'),('public','user_profile_completed'))),
                  'DB-5 신규 함수 7종 부재');
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'profile_completed_at'), 'users.profile_completed_at 부재');
select pg_temp.ok((select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'role') = 'NO', 'users.role NOT NULL 복원');
select pg_temp.ok(not exists (select 1 from pg_constraint where conrelid = 'public.users'::regclass and conname = 'users_role_required_when_completed')
                  and exists (select 1 from pg_constraint where conrelid = 'public.users'::regclass and conname = 'users_role_check'), 'CHECK 복원(신규 제거 · users_role_check 유지)');
-- census 복원
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1')::text = pg_temp.snap('fn_app_count'), 'api_app_v1 함수 수 적용 전과 동일(16)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private')::text = pg_temp.snap('fn_core_count'), 'core_private 함수 수 적용 전과 동일(8)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')::text = pg_temp.snap('fn_public_count'), 'public 함수 수 적용 전과 동일(228)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_web_v1')::text = pg_temp.snap('fn_web_count'), 'api_web_v1 함수 수 불변');
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'public')::text = pg_temp.snap('policies_count'), 'public 정책 수 불변(175)');
select pg_temp.ok((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r')::text = pg_temp.snap('tables_count'), '테이블 수 불변');
-- 본문 원문 복원(md5)
select pg_temp.ok(md5(pg_get_functiondef('public.handle_new_auth_user()'::regprocedure)) = pg_temp.snap('fn_trigger'), 'handle_new_auth_user 원문 복원(122/20260717044250)');
select pg_temp.ok(md5(pg_get_functiondef('public.enforce_users_role_guard()'::regprocedure)) = pg_temp.snap('fn_role_guard'), 'enforce_users_role_guard 원문 복원(119)');
select pg_temp.ok(md5(pg_get_functiondef('public.check_review_eligibility(uuid,uuid)'::regprocedure)) = pg_temp.snap('fn_review'), 'check_review_eligibility 원문 복원(170)');
select pg_temp.ok(md5(pg_get_functiondef('core_private.user_profile_update_self_impl(uuid,text,text)'::regprocedure)) = pg_temp.snap('fn_profile_impl'), 'user_profile_update_self_impl 원문 복원(20260803162257 D)');
select pg_temp.ok(md5(pg_get_functiondef('public.handle_new_auth_user_consent_records()'::regprocedure)) = pg_temp.snap('fn_consent_trigger'), '동의 트리거 불변');
select pg_temp.ok(md5(pg_get_functiondef('api_app_v1.create_individual_question_as_student_v2(text,text,text,int,uuid,text,text)'::regprocedure)) = pg_temp.snap('fn_iq_v2')
                  and md5(pg_get_functiondef('public.create_individual_question_as_student(text,text,text,int,uuid,text)'::regprocedure)) = pg_temp.snap('fn_iq_v1'), 'v1·v2 IQ 래퍼 md5 불변');
select pg_temp.ok((select coalesce(with_check, '') from pg_policies where tablename = 'reviews' and policyname = 'reviews_insert_student') = pg_temp.snap('pol_reviews_insert'), 'reviews_insert_student 정책 불변');
select pg_temp.ok((select md5(string_agg(tablename || '.' || policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''), E'\n' order by tablename, policyname))
                     from pg_policies where schemaname = 'public'
                      and (tablename, policyname) in (('admin_action_logs','관리자만 로그 기록'),('ai_drafts','ai_drafts_insert_own'),('content_reports','content_reports_insert_reporter'),('custom_order_deliverables','멘토만 납품 업로드'),('custom_order_messages','당사자만 메시지 전송'),('custom_request_applications','cra_insert'),('custom_request_applications','멘토만 지원'),('custom_request_orders','cro_insert'),('custom_request_posts','crp_insert'),('custom_request_posts','학생만 의뢰 등록'),('device_tokens','device_tokens_modify_own'),('favorites','favorites_insert_own'),('free_question_usage','fqu_insert_own'),('notification_settings','notif_settings_modify_own'),('payments','payments_insert_intent'),('user_blocks','ub_insert_own'),('verification_logs','ver_logs_insert_own'),('withdrawals','withdrawals_insert_self_requested'))) = pg_temp.snap('pol18_md5'), '정책 18종 원문 복원(md5)');
select pg_temp.ok(not exists (select 1 from pg_policies where schemaname = 'public' and (coalesce(qual, '') || coalesce(with_check, '')) like '%user_profile_completed%'), '완성 조건 잔존 정책 0');
-- 트리거 부착 상태
select pg_temp.ok(exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'auth' and c.relname = 'users' and t.tgname = 'on_auth_user_created' and t.tgfoid = 'public.handle_new_auth_user'::regproc and t.tgenabled <> 'D')
                  and (select tgenabled from pg_trigger where tgrelid = 'public.users'::regclass and tgname = 'trg_users_set_updated') <> 'D', '트리거 부착·활성 상태 유지');
-- forward 기간 데이터 유지: D1(소셜 가입 → 완성 학생) · D2(소셜 가입 → 롤백 전 완성) 행은 남는다(role 채워짐 · NOT NULL 복원 가능)
select pg_temp.ok((select count(*) from public.users where id in ('00000000-0000-4000-8000-00000000d5d1','00000000-0000-4000-8000-00000000d5d2') and role in ('student','mentor')) = 2,
                  '데이터: forward 기간 소셜 가입 완성 사용자 2명 유지(role 채워짐)');
select pg_temp.ok((select count(*) from public.users where id = '00000000-0000-4000-8000-00000000d5d1' and nickname = '포워드닉' and grade_level = '고3' and terms_agreed_at is not null) = 1,
                  '데이터: D1 완성 값(닉네임·학년·약관) 유지');
select pg_temp.ok((select count(*) from public.favorites where user_id = '00000000-0000-4000-8000-00000000d5d1') = 1, '데이터: D1 완성 후 찜 1건 유지');
\echo DB5 ROLLBACK FIXTURE PASS
