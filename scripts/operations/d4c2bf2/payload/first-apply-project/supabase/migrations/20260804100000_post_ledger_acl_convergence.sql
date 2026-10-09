-- interleave_20260804100000_post_ledger_acl_convergence.sql
-- 원장 재생 종료 시점의 함수 EXECUTE ACL 을 부모 실측(functions.json)으로 수렴.
-- 각 항목은 as-applied 발산(원장·저장소 밖 ACL 변경)의 문서화이자 복원이다.
-- 방식: 4역할 전면 revoke 후 부모 실측 역할만 grant (postgres/owner 는 불변).
-- public._cro_transition_actor_is_mentor(o custom_request_orders, p_actor uuid): local=[] -> parent=['service_role']
revoke all on function public._cro_transition_actor_is_mentor(o custom_request_orders, p_actor uuid) from public, anon, authenticated, service_role;
grant execute on function public._cro_transition_actor_is_mentor(o custom_request_orders, p_actor uuid) to service_role;
-- public._cro_transition_actor_is_student(o custom_request_orders, p_actor uuid): local=[] -> parent=['service_role']
revoke all on function public._cro_transition_actor_is_student(o custom_request_orders, p_actor uuid) from public, anon, authenticated, service_role;
grant execute on function public._cro_transition_actor_is_student(o custom_request_orders, p_actor uuid) to service_role;
-- public._cro_transition_deliverable_count(p_order_id uuid): local=[] -> parent=['service_role']
revoke all on function public._cro_transition_deliverable_count(p_order_id uuid) from public, anon, authenticated, service_role;
grant execute on function public._cro_transition_deliverable_count(p_order_id uuid) to service_role;
-- public._cro_transition_has_active_dispute(p_order_id uuid): local=[] -> parent=['service_role']
revoke all on function public._cro_transition_has_active_dispute(p_order_id uuid) from public, anon, authenticated, service_role;
grant execute on function public._cro_transition_has_active_dispute(p_order_id uuid) to service_role;
-- public._cro_transition_is_terminal(o custom_request_orders): local=[] -> parent=['service_role']
revoke all on function public._cro_transition_is_terminal(o custom_request_orders) from public, anon, authenticated, service_role;
grant execute on function public._cro_transition_is_terminal(o custom_request_orders) to service_role;
-- public._cro_transition_payment_confirmed(o custom_request_orders): local=[] -> parent=['service_role']
revoke all on function public._cro_transition_payment_confirmed(o custom_request_orders) from public, anon, authenticated, service_role;
grant execute on function public._cro_transition_payment_confirmed(o custom_request_orders) to service_role;
-- public._cro_transition_primary_status_col(o custom_request_orders): local=[] -> parent=['service_role']
revoke all on function public._cro_transition_primary_status_col(o custom_request_orders) from public, anon, authenticated, service_role;
grant execute on function public._cro_transition_primary_status_col(o custom_request_orders) to service_role;
-- public._cro_transition_primary_status_norm(o custom_request_orders): local=[] -> parent=['service_role']
revoke all on function public._cro_transition_primary_status_norm(o custom_request_orders) from public, anon, authenticated, service_role;
grant execute on function public._cro_transition_primary_status_norm(o custom_request_orders) to service_role;
-- public._cro_transition_revision_count(p_order_id uuid): local=[] -> parent=['service_role']
revoke all on function public._cro_transition_revision_count(p_order_id uuid) from public, anon, authenticated, service_role;
grant execute on function public._cro_transition_revision_count(p_order_id uuid) to service_role;
-- public.account_deletion_worker_claim(p_limit integer): local=['service_role'] -> parent=[]
revoke all on function public.account_deletion_worker_claim(p_limit integer) from public, anon, authenticated, service_role;
-- public.answer_individual_question(p_question_id uuid, p_body text): local=['authenticated'] -> parent=['authenticated', 'service_role']
revoke all on function public.answer_individual_question(p_question_id uuid, p_body text) from public, anon, authenticated, service_role;
grant execute on function public.answer_individual_question(p_question_id uuid, p_body text) to authenticated, service_role;
-- public.check_free_question_usage_limits(): local=['authenticated'] -> parent=['authenticated', 'service_role']
revoke all on function public.check_free_question_usage_limits() from public, anon, authenticated, service_role;
grant execute on function public.check_free_question_usage_limits() to authenticated, service_role;
-- public.check_review_eligibility(p_mentor_id uuid, p_student_id uuid): local=['authenticated'] -> parent=['authenticated', 'service_role']
revoke all on function public.check_review_eligibility(p_mentor_id uuid, p_student_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.check_review_eligibility(p_mentor_id uuid, p_student_id uuid) to authenticated, service_role;
-- public.claim_individual_question_as_mentor(p_question_id uuid): local=['authenticated'] -> parent=['authenticated', 'service_role']
revoke all on function public.claim_individual_question_as_mentor(p_question_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_individual_question_as_mentor(p_question_id uuid) to authenticated, service_role;
-- public.create_individual_question_as_student(p_question_type text, p_title text, p_body text, p_amount_cents integer, p_designated_mentor_id uuid, p_idempotency_key text): local=['authenticated'] -> parent=['authenticated', 'service_role']
revoke all on function public.create_individual_question_as_student(p_question_type text, p_title text, p_body text, p_amount_cents integer, p_designated_mentor_id uuid, p_idempotency_key text) from public, anon, authenticated, service_role;
grant execute on function public.create_individual_question_as_student(p_question_type text, p_title text, p_body text, p_amount_cents integer, p_designated_mentor_id uuid, p_idempotency_key text) to authenticated, service_role;
-- public.enforce_users_role_guard(): local=[] -> parent=['service_role']
revoke all on function public.enforce_users_role_guard() from public, anon, authenticated, service_role;
grant execute on function public.enforce_users_role_guard() to service_role;
-- public.enforce_users_role_insert_guard(): local=[] -> parent=['service_role']
revoke all on function public.enforce_users_role_insert_guard() from public, anon, authenticated, service_role;
grant execute on function public.enforce_users_role_insert_guard() to service_role;
-- public.get_public_custom_request_post_for_browse(p_post_id uuid): local=['authenticated'] -> parent=['anon', 'authenticated', 'service_role']
revoke all on function public.get_public_custom_request_post_for_browse(p_post_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_public_custom_request_post_for_browse(p_post_id uuid) to anon, authenticated, service_role;
-- public.get_weekly_question_usage(p_student_id uuid, p_mentor_id uuid): local=['authenticated', 'service_role'] -> parent=['anon', 'authenticated', 'service_role']
revoke all on function public.get_weekly_question_usage(p_student_id uuid, p_mentor_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_weekly_question_usage(p_student_id uuid, p_mentor_id uuid) to anon, authenticated, service_role;
-- public.increment_shortform_post_view(p_post_id uuid): local=[] -> parent=['service_role']
revoke all on function public.increment_shortform_post_view(p_post_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.increment_shortform_post_view(p_post_id uuid) to service_role;
-- public.list_open_custom_request_posts_for_mentor_browse(p_limit integer): local=['authenticated'] -> parent=['anon', 'authenticated', 'service_role']
revoke all on function public.list_open_custom_request_posts_for_mentor_browse(p_limit integer) from public, anon, authenticated, service_role;
grant execute on function public.list_open_custom_request_posts_for_mentor_browse(p_limit integer) to anon, authenticated, service_role;
-- public.list_open_individual_questions_for_mentor(p_limit integer): local=['authenticated'] -> parent=['authenticated', 'service_role']
revoke all on function public.list_open_individual_questions_for_mentor(p_limit integer) from public, anon, authenticated, service_role;
grant execute on function public.list_open_individual_questions_for_mentor(p_limit integer) to authenticated, service_role;
-- public.mentor_directory_list(p_limit integer): local=[] -> parent=['service_role']
revoke all on function public.mentor_directory_list(p_limit integer) from public, anon, authenticated, service_role;
grant execute on function public.mentor_directory_list(p_limit integer) to service_role;
-- public.mentor_directory_list_v2(p_limit integer): local=[] -> parent=['service_role']
revoke all on function public.mentor_directory_list_v2(p_limit integer) from public, anon, authenticated, service_role;
grant execute on function public.mentor_directory_list_v2(p_limit integer) to service_role;
-- public.mentor_profiles_for_directory(p_ids uuid[]): local=[] -> parent=['service_role']
revoke all on function public.mentor_profiles_for_directory(p_ids uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.mentor_profiles_for_directory(p_ids uuid[]) to service_role;
-- public.mentor_profiles_for_directory_v2(p_ids uuid[]): local=[] -> parent=['service_role']
revoke all on function public.mentor_profiles_for_directory_v2(p_ids uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.mentor_profiles_for_directory_v2(p_ids uuid[]) to service_role;
-- public.mentor_school_verification_storage_path(p_ref text): local=[] -> parent=['service_role']
revoke all on function public.mentor_school_verification_storage_path(p_ref text) from public, anon, authenticated, service_role;
grant execute on function public.mentor_school_verification_storage_path(p_ref text) to service_role;
-- public.mentor_user_public(p_mentor_id uuid): local=[] -> parent=['service_role']
revoke all on function public.mentor_user_public(p_mentor_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.mentor_user_public(p_mentor_id uuid) to service_role;
-- public.mentor_user_public_v2(p_mentor_id uuid): local=[] -> parent=['service_role']
revoke all on function public.mentor_user_public_v2(p_mentor_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.mentor_user_public_v2(p_mentor_id uuid) to service_role;
-- public.mp_seed_default_plans_on_approval(): local=[] -> parent=['service_role']
revoke all on function public.mp_seed_default_plans_on_approval() from public, anon, authenticated, service_role;
grant execute on function public.mp_seed_default_plans_on_approval() to service_role;
-- public.notification_cash_label(p_amount_cents bigint): local=[] -> parent=['anon', 'authenticated', 'service_role']
revoke all on function public.notification_cash_label(p_amount_cents bigint) from public, anon, authenticated, service_role;
grant execute on function public.notification_cash_label(p_amount_cents bigint) to anon, authenticated, service_role;
-- public.notification_date_label(p_at timestamp with time zone): local=[] -> parent=['anon', 'authenticated', 'service_role']
revoke all on function public.notification_date_label(p_at timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function public.notification_date_label(p_at timestamp with time zone) to anon, authenticated, service_role;
-- public.notification_display_name(p_user_id uuid): local=[] -> parent=['service_role']
revoke all on function public.notification_display_name(p_user_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.notification_display_name(p_user_id uuid) to service_role;
-- public.notification_mentor_label(p_user_id uuid): local=[] -> parent=['service_role']
revoke all on function public.notification_mentor_label(p_user_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.notification_mentor_label(p_user_id uuid) to service_role;
-- public.refund_individual_question(p_question_id uuid): local=['authenticated'] -> parent=['authenticated', 'service_role']
revoke all on function public.refund_individual_question(p_question_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.refund_individual_question(p_question_id uuid) to authenticated, service_role;
-- public.release_individual_question(p_question_id uuid): local=['authenticated'] -> parent=['authenticated', 'service_role']
revoke all on function public.release_individual_question(p_question_id uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_individual_question(p_question_id uuid) to authenticated, service_role;
-- public.set_individual_question_price(p_amount_cents integer): local=['authenticated'] -> parent=['authenticated', 'service_role']
revoke all on function public.set_individual_question_price(p_amount_cents integer) from public, anon, authenticated, service_role;
grant execute on function public.set_individual_question_price(p_amount_cents integer) to authenticated, service_role;
-- 부모 부재 함수 정리 (as-applied 발산: 로컬 재구축만 생성)
drop function if exists public.pay_due_payouts_for_run(date, text);
drop function if exists public.mark_individual_question_released(uuid);
