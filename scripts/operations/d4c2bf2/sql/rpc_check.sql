-- 성격: 조회 전용 — READ ONLY 트랜잭션 안의 단일 SELECT. LOCK·DDL·DML 없음.
-- 읽기 전용. 실행: PGSERVICE=<service> psql -X -qAt -v ON_ERROR_STOP=1 -f rpc_check.sql
-- Read-only, one statement. Expected POST-APPLY: 72 rows, every exists=true, owner='postgres', proconfig={search_path=""}, matches_contract=true.
-- Expectations are the EXECUTE/SECDEF flags of docs/operations/pr138-voucher-rpc-contracts.json (71 rows) plus api_web_v1.subscription_checkout_confirm_v2 (baseline function whose EXECUTE the apply re-asserts at :3910/:3925).
-- PRE-APPLY: the 45 'new' functions return exists=false (expected); of the 27 existing ones, 12 show matches_contract=f because their baseline proconfig is {search_path=public} (the apply replaces them). Only the POST-APPLY 72 x matches_contract=t is the acceptance value.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog,public;
WITH required(signature, expect_secdef, expect_anon, expect_authenticated, expect_service_role) AS (VALUES
 ('api_app_v1.mentor_activity_set(text,timestamp with time zone,timestamp with time zone,text)', true, false, true, false),
 ('api_app_v1.qna_create_question_thread(uuid,text,text,text,text)', true, false, true, false),
 ('api_app_v1.refund_request_create(uuid,text)', true, false, true, false),
 ('api_app_v1.subscription_cancel_at_period_end(uuid)', true, false, true, false),
 ('api_app_v1.subscription_cancel_undo(uuid)', true, false, true, false),
 ('api_app_v1.subscription_funding_context()', true, false, true, false),
 ('api_web_v1.mentor_directory_by_ids(uuid[])', true, true, true, true),
 ('api_web_v1.mentor_directory_count()', true, true, true, true),
 ('api_web_v1.mentor_directory_page(jsonb,integer,integer,uuid[],boolean)', true, true, true, true),
 ('api_web_v1.qna_create_question_thread(uuid,text,text,text,text)', true, false, true, true),
 ('api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text)', true, false, false, true),
 ('core_private.confirm_cash_subscription_payment(uuid,uuid,text)', false, false, false, false),
 ('core_private.current_cash_service_period_valid(uuid)', true, false, false, false),
 ('core_private.current_standard_service_period_valid(uuid)', true, false, false, false),
 ('core_private.finalize_subscription_terminal_impl(uuid,timestamp with time zone,uuid,text,timestamp with time zone,text)', false, false, false, false),
 ('core_private.guard_renewal_period_snapshot()', false, false, false, false),
 ('core_private.guard_service_period_extension()', true, false, false, false),
 ('core_private.guard_subscription_refund_write()', true, false, false, false),
 ('core_private.lock_service_period_finance(uuid)', false, false, false, false),
 ('core_private.mentor_directory_base(uuid[])', true, false, false, false),
 ('core_private.mentor_directory_public_rows()', true, true, true, true),
 ('core_private.mentor_directory_rows(uuid[])', true, true, true, true),
 ('core_private.mentor_directory_trim(text)', false, false, false, false),
 ('core_private.mentor_directory_visible_ids()', true, true, true, true),
 ('core_private.mentor_financial_transition_impl(uuid,text,integer,text,timestamp with time zone,timestamp with time zone)', true, false, false, false),
 ('core_private.process_subscription_renewal_impl(uuid,timestamp with time zone,text,timestamp with time zone,boolean)', false, false, false, false),
 ('core_private.qna_assert_text_bound(text,integer)', false, false, false, false),
 ('core_private.qna_cash_weekly_usage(uuid,uuid,timestamp with time zone)', true, false, false, false),
 ('core_private.qna_identity_guard()', false, false, false, false),
 ('core_private.qna_lock_thread_write(uuid,text)', true, false, false, false),
 ('core_private.qna_pair_write_eligibility(uuid,uuid,uuid,timestamp with time zone)', true, false, false, false),
 ('core_private.qna_voucher_weekly_usage(uuid,timestamp with time zone)', true, false, false, false),
 ('core_private.record_initial_subscription_billing_event(uuid,uuid,boolean)', false, false, false, false),
 ('core_private.record_subscription_renewal_notice_impl(uuid,timestamp with time zone,timestamp with time zone,boolean)', false, false, false, false),
 ('core_private.refund_matches_service_period(public.refunds,public.subscription_billing_events)', false, false, false, false),
 ('core_private.service_period_effective_end(uuid)', true, false, false, true),
 ('core_private.service_period_eligibility(uuid,uuid,text,timestamp with time zone)', true, false, false, false),
 ('core_private.service_period_financial_state(uuid)', true, false, false, true),
 ('core_private.service_period_funding(uuid)', true, false, false, false),
 ('core_private.service_period_matches_subscription(uuid,uuid)', true, false, false, false),
 ('core_private.set_subscription_cancel_impl(uuid,boolean,uuid)', false, false, false, false),
 ('core_private.subscription_checkout_confirm_impl(uuid,uuid,integer,text)', false, false, false, false),
 ('core_private.subscription_has_pending_refund(uuid)', true, false, false, false),
 ('core_private.subscription_refund_estimate_impl(uuid,timestamp with time zone)', false, false, false, false),
 ('public.approve_refund_request_admin(uuid,uuid,text)', true, false, false, true),
 ('public.claim_subscription_renewal_batch(timestamp with time zone,integer)', true, false, false, true),
 ('public.claim_subscription_renewal_notice_batch(timestamp with time zone,timestamp with time zone,integer)', true, false, false, true),
 ('public.confirm_subscription_checkout(uuid,uuid,text)', true, false, false, true),
 ('public.expire_voucher_service_period(uuid,uuid)', true, false, false, true),
 ('public.finalize_subscription_terminal_transition(uuid,text,timestamp with time zone,text)', true, false, false, true),
 ('public.finalize_subscription_terminal_transition(uuid,timestamp with time zone,uuid,text,timestamp with time zone)', true, false, false, true),
 ('public.get_weekly_question_usage(uuid,uuid)', true, false, true, true),
 ('public.issue_voucher_entitlement(uuid,text,text,text,text,text,text,text)', true, false, false, true),
 ('public.keep_subscription_refunded_status()', true, false, false, false),
 ('public.mentor_financial_transition(uuid,text,integer,text)', true, false, false, true),
 ('public.pay_due_payouts_for_run(date,text,boolean)', true, false, false, true),
 ('public.preview_voucher(uuid,uuid,text)', true, false, false, true),
 ('public.process_subscription_renewal_exact(uuid,timestamp with time zone,text,timestamp with time zone)', true, false, false, true),
 ('public.process_subscription_renewal_v2(uuid,timestamp with time zone,text,timestamp with time zone)', true, false, false, true),
 ('public.qna_append_message(uuid,text)', true, false, true, true),
 ('public.qna_create_question_thread(uuid,text,text,text,text)', true, false, true, true),
 ('public.qna_register_attachment(uuid,text,text,text,uuid)', true, false, true, true),
 ('public.qna_subscription_has_live_refund(uuid)', true, false, false, true),
 ('public.qra_path_upload_eligible(text)', true, false, true, true),
 ('public.record_subscription_pg_refund_confirmation(uuid,uuid,text,bigint,timestamp with time zone)', true, false, false, true),
 ('public.record_subscription_renewal_notice_exact(uuid,timestamp with time zone,timestamp with time zone)', true, false, false, true),
 ('public.record_subscription_renewal_notice(uuid,timestamp with time zone,timestamp with time zone)', true, false, false, true),
 ('public.record_voucher_external_refund(uuid,text,bigint)', true, false, false, true),
 ('public.redeem_voucher(uuid,uuid,text,uuid)', true, false, false, true),
 ('public.refresh_subscription_settlement_items(timestamp with time zone,timestamp with time zone)', true, false, false, true),
 ('public.set_subscription_cancel_at_period_end(uuid,boolean,uuid)', true, false, false, true),
 ('public.sync_subscription_refunded_from_refund()', true, false, false, false)
)
SELECT r.signature,
       p.oid IS NOT NULL AS exists,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef,
       p.proconfig,
       p.proacl::text AS acl,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
       (p.oid IS NOT NULL
        AND pg_get_userbyid(p.proowner) = 'postgres'
        AND p.prosecdef = r.expect_secdef
        AND p.proconfig = ARRAY['search_path=""']
        AND has_function_privilege('anon', p.oid, 'EXECUTE') = r.expect_anon
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE') = r.expect_authenticated
        AND has_function_privilege('service_role', p.oid, 'EXECUTE') = r.expect_service_role) AS matches_contract
FROM required r
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(r.signature)
ORDER BY r.signature;
ROLLBACK;
