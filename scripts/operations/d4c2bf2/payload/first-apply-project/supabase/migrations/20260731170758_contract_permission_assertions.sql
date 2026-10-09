begin;
DO $$
DECLARE v_role text; v_cnt int;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['api_web_v1','api_app_v1','core_private'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_role) THEN RAISE EXCEPTION 'M10_A_SCHEMA: schema % expected present, measured absent', v_role; END IF;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(v_role, 'core_private', 'USAGE') THEN RAISE EXCEPTION 'M10_A_SCHEMA: core_private USAGE for % expected false, measured true', v_role; END IF;
  END LOOP;
  SELECT count(*) INTO v_cnt FROM pg_namespace n, aclexplode(coalesce(n.nspacl, '{}'::aclitem[])) a WHERE n.nspname IN ('api_web_v1','api_app_v1','core_private') AND a.grantee = 0;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'M10_A_SCHEMA: PUBLIC schema acl entries expected 0, measured %', v_cnt; END IF;
END $$;
DO $$
DECLARE v_cnt int; r record;
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'api_web_v1';
  IF v_cnt <> 5 THEN RAISE EXCEPTION 'M10_B_WEB: api_web_v1 pg_class census expected 5, measured %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'api_web_v1' AND c.relkind = 'v' AND c.relname IN ('community_posts_v1','community_comments_v1','mentor_directory_v1','my_wallet_v1','my_cash_ledger_v1');
  IF v_cnt <> 5 THEN RAISE EXCEPTION 'M10_B_WEB: V1~V5 identity set expected 5, measured %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'api_web_v1' AND c.relkind = 'v' AND ((c.relname = 'mentor_directory_v1' AND 'security_invoker=false' = ANY (coalesce(c.reloptions, '{}'))) OR (c.relname <> 'mentor_directory_v1' AND 'security_invoker=true' = ANY (coalesce(c.reloptions, '{}'))));
  IF v_cnt <> 5 THEN RAISE EXCEPTION 'M10_B_WEB: security_invoker matrix expected 5 conforming, measured %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'api_web_v1';
  IF v_cnt <> 14 THEN RAISE EXCEPTION 'M10_B_WEB: function census expected 14, measured %', v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'api_web_v1' AND (p.proname, pg_get_function_identity_arguments(p.oid)) IN (('my_subscriptions_self',''),('mentor_settlement_self',''),('account_deletion_status_self',''),('weekly_question_usage_self','p_mentor_id uuid'),('ensure_free_question_room','p_mentor_id uuid'),('qna_create_question_thread','p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text'),('community_post_create','p_title text, p_body text, p_category text, p_idempotency_key uuid, p_image_refs text[], p_status text'),('community_post_update','p_post_id uuid, p_title text, p_body text, p_category text, p_expected_updated_at timestamp with time zone, p_image_refs text[], p_status text'),('community_post_soft_delete','p_post_id uuid'),('mentor_profile_update_self','p_university_name text, p_department_name text, p_high_school_name text, p_teaching_subjects text[], p_intro_line text, p_bio text, p_answer_style text, p_profile_image_url text, p_is_open_for_subscriptions boolean'),('mentor_plan_prices_set_self','p_limited_cash_krw integer, p_standard_cash_krw integer, p_premium_cash_krw integer'),('mentor_payout_account_update_self','p_bank_name text, p_account_number text'),('record_cash_topup_v2','p_user_id uuid, p_amount_cents bigint, p_order_ref text'),('subscription_checkout_confirm_v2','p_payment_id uuid, p_plan_id uuid, p_expected_amount_cents integer, p_idempotency_key text'));
  IF v_cnt <> 14 THEN RAISE EXCEPTION 'M10_B_WEB: identity argument set expected 14, measured %', v_cnt; END IF;
  FOR r IN SELECT p.oid,p.proname,p.prosecdef,p.proconfig,p.proacl,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='api_web_v1' LOOP
    IF NOT r.prosecdef THEN RAISE EXCEPTION 'M10_B_WEB: % prosecdef expected true, measured false', r.proname; END IF;
    IF NOT (coalesce(r.proconfig,'{}') @> ARRAY['search_path=""']) THEN RAISE EXCEPTION 'M10_B_WEB: % proconfig expected pinned empty search_path, measured %', r.proname,r.proconfig; END IF;
    IF r.owner <> 'postgres' THEN RAISE EXCEPTION 'M10_B_WEB: % owner expected postgres, measured %', r.proname,r.owner; END IF;
    IF r.proacl IS NULL THEN RAISE EXCEPTION 'M10_B_WEB: % proacl NULL(기본 PUBLIC EXECUTE) — expected explicit acl', r.proname; END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee=0) THEN RAISE EXCEPTION 'M10_B_WEB: % PUBLIC EXECUTE expected 0, measured present', r.proname; END IF;
  END LOOP;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='api_web_v1' AND p.proname NOT IN ('record_cash_topup_v2','subscription_checkout_confirm_v2') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE');
  IF v_cnt <> 12 THEN RAISE EXCEPTION 'M10_B_WEB: T2 EXECUTE matrix expected 12 conforming, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='api_web_v1' AND p.proname IN ('record_cash_topup_v2','subscription_checkout_confirm_v2') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE');
  IF v_cnt <> 2 THEN RAISE EXCEPTION 'M10_B_WEB: F11/F12 EXECUTE matrix expected 2 conforming, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='api_web_v1' AND c.relkind='v' AND CASE WHEN c.relname IN ('my_wallet_v1','my_cash_ledger_v1') THEN NOT has_table_privilege('anon',c.oid,'SELECT') ELSE has_table_privilege('anon',c.oid,'SELECT') END AND has_table_privilege('authenticated',c.oid,'SELECT') AND has_table_privilege('service_role',c.oid,'SELECT');
  IF v_cnt <> 5 THEN RAISE EXCEPTION 'M10_B_WEB: view SELECT matrix expected 5 conforming, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) rl(rolname) CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE')) pv(priv) WHERE n.nspname='api_web_v1' AND c.relkind='v' AND has_table_privilege(rl.rolname,c.oid,pv.priv);
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'M10_B_WEB: view DML privileges expected 0, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a WHERE n.nspname='api_web_v1' AND a.grantee=0;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'M10_B_WEB: PUBLIC view acl entries expected 0, measured %',v_cnt; END IF;
END $$;
DO $$
DECLARE v_cnt int; r record;
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core_private';
  IF v_cnt <> 6 THEN RAISE EXCEPTION 'M10_C_PRIV: function census expected 6, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core_private' AND (p.proname,pg_get_function_identity_arguments(p.oid)) IN (('ensure_student_mentor_room','p_student_id uuid, p_mentor_id uuid, p_payment_id uuid, p_subscription_id uuid, p_require_entitlement boolean'),('record_cash_topup_impl','p_user_id uuid, p_amount_cents bigint, p_idempotency_key text'),('community_post_create_impl','p_author_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_idempotency_key uuid'),('community_post_update_impl','p_author_id uuid, p_post_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_expected_updated_at timestamp with time zone'),('community_post_soft_delete_impl','p_author_id uuid, p_post_id uuid'),('community_image_refs_validate','p_owner_id uuid, p_image_refs text[]'));
  IF v_cnt <> 6 THEN RAISE EXCEPTION 'M10_C_PRIV: identity argument set expected 6, measured %',v_cnt; END IF;
  FOR r IN SELECT p.oid,p.proname,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core_private' LOOP
    IF has_function_privilege('anon',r.oid,'EXECUTE') OR has_function_privilege('authenticated',r.oid,'EXECUTE') OR has_function_privilege('service_role',r.oid,'EXECUTE') THEN RAISE EXCEPTION 'M10_C_PRIV: % external EXECUTE expected all false, measured true',r.proname; END IF;
    IF r.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee=0) THEN RAISE EXCEPTION 'M10_C_PRIV: % PUBLIC EXECUTE expected 0, measured NULL-or-present',r.proname; END IF;
  END LOOP;
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='core_private';
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'M10_C_PRIV: pg_class census expected 0, measured %',v_cnt; END IF;
END $$;
DO $$
DECLARE v_cnt int; r record;
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='api_app_v1';
  IF v_cnt<>1 OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='api_app_v1' AND c.relkind='v' AND c.relname='community_posts_v1' AND 'security_invoker=true'=ANY(coalesce(c.reloptions,'{}'))) THEN RAISE EXCEPTION 'M10_D_APP: relation census expected exactly community_posts_v1(invoker), measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='api_app_v1'; IF v_cnt<>5 THEN RAISE EXCEPTION 'M10_D_APP: wrapper census expected 5, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='api_app_v1' AND (p.proname,pg_get_function_identity_arguments(p.oid)) IN (('ensure_free_question_room','p_mentor_id uuid'),('qna_create_question_thread','p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text'),('community_post_create','p_title text, p_body text, p_category text, p_idempotency_key uuid, p_image_refs text[], p_status text'),('community_post_update','p_post_id uuid, p_title text, p_body text, p_category text, p_expected_updated_at timestamp with time zone, p_image_refs text[], p_status text'),('community_post_soft_delete','p_post_id uuid'));
  IF v_cnt<>5 THEN RAISE EXCEPTION 'M10_D_APP: wrapper identity argument set expected 5, measured %',v_cnt; END IF;
  IF NOT has_schema_privilege('authenticated','api_app_v1','USAGE') OR has_schema_privilege('anon','api_app_v1','USAGE') OR has_schema_privilege('service_role','api_app_v1','USAGE') THEN RAISE EXCEPTION 'M10_D_APP: schema USAGE matrix mismatch (expected authenticated only)'; END IF;
  IF NOT has_table_privilege('authenticated','api_app_v1.community_posts_v1','SELECT') OR has_table_privilege('anon','api_app_v1.community_posts_v1','SELECT') OR has_table_privilege('service_role','api_app_v1.community_posts_v1','SELECT') THEN RAISE EXCEPTION 'M10_D_APP: view SELECT matrix mismatch (expected authenticated only)'; END IF;
  SELECT count(*) INTO v_cnt FROM (VALUES ('anon'),('authenticated'),('service_role')) rl(rolname) CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE')) pv(priv) WHERE has_table_privilege(rl.rolname,'api_app_v1.community_posts_v1',pv.priv);
  IF v_cnt<>0 THEN RAISE EXCEPTION 'M10_D_APP: view DML privileges expected 0, measured %',v_cnt; END IF;
  FOR r IN SELECT p.oid,p.proname,p.proacl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='api_app_v1' LOOP
    IF NOT has_function_privilege('authenticated',r.oid,'EXECUTE') OR has_function_privilege('anon',r.oid,'EXECUTE') OR has_function_privilege('service_role',r.oid,'EXECUTE') THEN RAISE EXCEPTION 'M10_D_APP: % EXECUTE matrix mismatch (expected authenticated only)',r.proname; END IF;
    IF r.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee=0) THEN RAISE EXCEPTION 'M10_D_APP: % PUBLIC EXECUTE expected 0, measured NULL-or-present',r.proname; END IF;
  END LOOP;
END $$;
DO $$
DECLARE v_views int; v_fns int; v_schemas int; v_cnt int;
BEGIN
  SELECT count(*) INTO v_views FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('api_web_v1','api_app_v1') AND c.relkind='v';
  SELECT count(*) INTO v_fns FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('api_web_v1','core_private','api_app_v1');
  SELECT count(*) INTO v_schemas FROM pg_namespace WHERE nspname IN ('api_web_v1','api_app_v1','core_private');
  IF v_views<>6 OR v_fns<>25 OR v_schemas<>3 THEN RAISE EXCEPTION 'M10_E_TOTAL: expected view 6/function 25/schema 3, measured %/%/%',v_views,v_fns,v_schemas; END IF;
  SELECT count(*) INTO v_cnt FROM information_schema.columns WHERE table_schema='public' AND table_name='comments' AND column_name='author_role' AND data_type='text' AND is_nullable='YES';
  IF v_cnt<>1 THEN RAISE EXCEPTION 'M10_E_TOTAL: comments.author_role expected text NULL x1, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('api_web_v1','core_private','api_app_v1','public') AND p.proname IN ('user_display_label','user_display_role');
  IF v_cnt<>0 THEN RAISE EXCEPTION 'M10_E_TOTAL: F0 label functions expected absent, measured %',v_cnt; END IF;
END $$;
DO $$
DECLARE v_cnt int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='enforce_mentor_profile_privileged_guard' AND p.prosecdef AND coalesce(p.proconfig,'{}') @> ARRAY['search_path=""']) THEN RAISE EXCEPTION 'M10_F_LEGACY: M0 guard function expected present(SECDEF, pinned), measured absent'; END IF;
  SELECT count(*) INTO v_cnt FROM pg_trigger t WHERE t.tgrelid='public.mentor_profiles'::regclass AND NOT t.tgisinternal AND t.tgname IN ('trg_mentor_profile_privileged_guard_ins','trg_mentor_profile_privileged_guard_upd'); IF v_cnt<>2 THEN RAISE EXCEPTION 'M10_F_LEGACY: M0 guard triggers expected 2, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('comments_set_author_label','community_comments_set_author_label') AND p.prosecdef AND coalesce(p.proconfig,'{}') @> ARRAY['search_path=""'] AND p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0); IF v_cnt<>2 THEN RAISE EXCEPTION 'M10_F_LEGACY: M13 trigger functions expected 2 conforming, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('trg_comments_set_author_label_ins','trg_comments_set_author_label_upd','trg_community_comments_set_author_label_ins','trg_community_comments_set_author_label_upd'); IF v_cnt<>4 THEN RAISE EXCEPTION 'M10_F_LEGACY: M13 triggers expected 4, measured %',v_cnt; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='comments' AND column_name='author_label' AND is_nullable='NO' AND column_default LIKE '%쌤버십 사용자%') THEN RAISE EXCEPTION 'M10_F_LEGACY: comments.author_label default expected 쌤버십 사용자, measured otherwise'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_weekly_question_usage' AND position('[S2 M15]' in p.prosrc)>0) THEN RAISE EXCEPTION 'M10_F_LEGACY: M15 pair-party guard marker expected present, measured absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='record_cash_topup' AND position('core_private.record_cash_topup_impl' in p.prosrc)>0) THEN RAISE EXCEPTION 'M10_F_LEGACY: M9 record_cash_topup delegation marker expected present, measured absent'; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('weekly_question_usage_self','ensure_free_question_room','community_post_create','community_post_update','community_post_soft_delete','mentor_profile_update_self','mentor_plan_prices_set_self','mentor_payout_account_update_self','my_subscriptions_self','mentor_settlement_self','record_cash_topup_v2','subscription_checkout_confirm_v2','ensure_student_mentor_room','record_cash_topup_impl','community_post_create_impl','community_post_update_impl','community_post_soft_delete_impl','community_image_refs_validate'); IF v_cnt<>0 THEN RAISE EXCEPTION 'M10_F_LEGACY: S2 function names in public expected 0, measured %',v_cnt; END IF;
END $$;
DO $$
DECLARE v_tbl text; v_role text; v_priv text; v_has boolean; v_cnt int;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['mentor_profiles','mentor_plans'] LOOP
    FOR v_role,v_priv IN SELECT r.rolname,p.priv FROM (VALUES ('anon'),('authenticated')) r(rolname) CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv) LOOP
      v_has:=has_table_privilege(v_role,format('public.%I',v_tbl),v_priv);
      IF v_priv='SELECT' AND NOT v_has THEN RAISE EXCEPTION 'M10_GH_REVOKE: %.% SELECT expected true, measured false',v_tbl,v_role; ELSIF v_priv<>'SELECT' AND v_has THEN RAISE EXCEPTION 'M10_GH_REVOKE: %.% % expected false, measured true',v_tbl,v_role,v_priv; END IF;
    END LOOP;
    SELECT count(*) INTO v_cnt FROM information_schema.column_privileges WHERE table_schema='public' AND table_name=v_tbl AND grantee IN ('anon','authenticated') AND privilege_type<>'SELECT'; IF v_cnt<>0 THEN RAISE EXCEPTION 'M10_GH_REVOKE: % residual column write privileges expected 0, measured %',v_tbl,v_cnt; END IF;
  END LOOP;
END $$;
DO $$
DECLARE v_role text; v_priv text; v_has boolean; v_cnt int;
BEGIN
  FOR v_role,v_priv IN SELECT r.rolname,p.priv FROM (VALUES ('anon'),('authenticated')) r(rolname) CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(priv) LOOP
    v_has:=has_table_privilege(v_role,'public.community_posts',v_priv);
    IF v_priv='SELECT' AND NOT v_has THEN RAISE EXCEPTION 'M10_I_HD1: community_posts % SELECT expected true, measured false',v_role; ELSIF v_priv<>'SELECT' AND v_has THEN RAISE EXCEPTION 'M10_I_HD1: community_posts % % expected false, measured true',v_role,v_priv; END IF;
  END LOOP;
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename='community_posts' AND cmd IN ('INSERT','UPDATE','DELETE'); IF v_cnt<>0 THEN RAISE EXCEPTION 'M10_I_HD1: write policies expected 0, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies WHERE schemaname='public' AND tablename='community_posts' AND policyname IN ('cp_write_self','로그인 유저 게시글 작성','cp_update_own','cp_update_self','본인 게시글 수정','cp_delete_own'); IF v_cnt<>0 THEN RAISE EXCEPTION 'M10_I_HD1: dropped policy names expected absent, measured %',v_cnt; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='community_posts' AND cmd='SELECT' AND policyname IN ('cp_select_own','cp_select_published'))<>2 THEN RAISE EXCEPTION 'M10_I_HD1: SELECT policies cp_select_own/cp_select_published expected present'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a WHERE c.oid='public.community_posts'::regclass AND a.grantee='service_role'::regrole) THEN RAISE EXCEPTION 'M10_I_HD1: service_role acl entry expected present, measured absent'; END IF;
END $$;
DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('api_web_v1','api_app_v1','core_private') AND p.prosecdef; IF v_cnt<>20 THEN RAISE EXCEPTION 'M10_J_SECDEF: SECDEF census expected 20, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core_private' AND p.prosecdef; IF v_cnt<>1 OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='core_private' AND p.prosecdef AND p.proname='ensure_student_mentor_room') THEN RAISE EXCEPTION 'M10_J_SECDEF: core_private SECDEF expected F10 only, measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('api_web_v1','api_app_v1') AND c.relkind='v' AND NOT ('security_invoker=true'=ANY(coalesce(c.reloptions,'{}'))); IF v_cnt<>1 THEN RAISE EXCEPTION 'M10_J_SECDEF: SECDEF view census expected 1(mentor_directory_v1), measured %',v_cnt; END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('api_web_v1','api_app_v1','core_private') AND p.prosecdef AND NOT (coalesce(p.proconfig,'{}') @> ARRAY['search_path=""'] AND pg_get_userbyid(p.proowner)='postgres' AND p.proacl IS NOT NULL AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0)); IF v_cnt<>0 THEN RAISE EXCEPTION 'M10_J_SECDEF: nonconforming contract SECDEF functions expected 0, measured %',v_cnt; END IF;
END $$;
commit;