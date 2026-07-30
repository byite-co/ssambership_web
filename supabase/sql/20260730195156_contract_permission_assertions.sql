-- =============================================================================
-- 20260730195156_contract_permission_assertions.sql (S2 M10)
-- =============================================================================
-- 최종 권한 assertion checkpoint — 상태 0(읽기 전용) 검증 전용.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §20.2 M10 · §20.2.1 ·
--            §21.10(운영 M10 검사 범위) · §21 T-PERM · §11.6 · 부록 A.
-- 적용 조건: M10 자신을 제외한 활성 predecessor 15개 전부 적용 후 실행 —
--   M0·M1·M4·M5·M6·M7·M8·M9·M11·M12·M13·M14·M15·M16·M17 (M2·M3 retired).
-- 검사 범위(§21.10): 카탈로그·ACL·정책·함수 속성의 읽기 전용 assertion 만.
--   포함하지 않는 것(플랫폼 단계·로컬 기능 검증기로 분리): Data API Exposed
--   schemas 목록·실제 HTTP 요청·PGRST106/PGRST002·관리자 승인 동작·가입 동작·
--   service_role moderation 기능·동시성/멱등성/자금 기능.
--   `authenticator`의 pgrst.db_schemas 를 SQL 로 추정 판정하지 않는다(§20.6.1).
-- 허용 문형: SELECT · pg_catalog/information_schema 조회 · has_*_privilege ·
--   DO 블록 조건 판정 + RAISE EXCEPTION. CREATE/ALTER/DROP/GRANT/REVOKE/DML 없음.
-- 실패 메시지: assertion 식별자·기대값·실측값 포함(secret·JWT·사용자 데이터 불포함).
-- rollback: 없음 — 상태를 만들지 않는 checkpoint (§22 #2).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 스키마 존재·경계 (T-PERM-01)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_role text;
  v_cnt  int;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['api_web_v1','api_app_v1','core_private'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = v_role) THEN
      RAISE EXCEPTION 'M10_A_SCHEMA: schema % expected present, measured absent', v_role;
    END IF;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_schema_privilege(v_role, 'core_private', 'USAGE') THEN
      RAISE EXCEPTION 'M10_A_SCHEMA: core_private USAGE for % expected false, measured true', v_role;
    END IF;
  END LOOP;
  -- PUBLIC 경유 외부 권한 0 — nspacl 에 grantee=0(PUBLIC) 엔트리가 없어야 한다
  SELECT count(*) INTO v_cnt
    FROM pg_namespace n, aclexplode(coalesce(n.nspacl, '{}'::aclitem[])) a
   WHERE n.nspname IN ('api_web_v1','api_app_v1','core_private') AND a.grantee = 0;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M10_A_SCHEMA: PUBLIC schema acl entries expected 0, measured %', v_cnt;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. api_web_v1 — view 5 + 조회 RPC 2 + 함수 14 · identity · GRANT 매트릭스
--    (T-PERM-02·06·07·08 + 부록 A)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
  r record;
BEGIN
  -- B-1. view census: 정확히 5종(V1~V5)
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'api_web_v1';
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'M10_B_WEB: api_web_v1 pg_class census expected 5, measured %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'api_web_v1' AND c.relkind = 'v'
     AND c.relname IN ('community_posts_v1','community_comments_v1','mentor_directory_v1',
                       'my_wallet_v1','my_cash_ledger_v1');
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'M10_B_WEB: V1~V5 identity set expected 5, measured %', v_cnt;
  END IF;
  -- B-2. V3 만 SECDEF view(security_invoker=false), 나머지 invoker
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'api_web_v1' AND c.relkind = 'v'
     AND ( (c.relname = 'mentor_directory_v1' AND 'security_invoker=false' = ANY (coalesce(c.reloptions, '{}')))
        OR (c.relname <> 'mentor_directory_v1' AND 'security_invoker=true' = ANY (coalesce(c.reloptions, '{}'))) );
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'M10_B_WEB: security_invoker matrix expected 5 conforming, measured %', v_cnt;
  END IF;
  -- B-3. 함수 census 14 + identity argument 전건 일치(초과·부족·시그니처 변형 실패)
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api_web_v1';
  IF v_cnt <> 14 THEN
    RAISE EXCEPTION 'M10_B_WEB: function census expected 14, measured %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api_web_v1'
     AND (p.proname, pg_get_function_identity_arguments(p.oid)) IN (
       ('my_subscriptions_self',              ''),
       ('mentor_settlement_self',             ''),
       ('account_deletion_status_self',       ''),
       ('weekly_question_usage_self',         'p_mentor_id uuid'),
       ('ensure_free_question_room',          'p_mentor_id uuid'),
       ('qna_create_question_thread',         'p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text'),
       ('community_post_create',              'p_title text, p_body text, p_category text, p_idempotency_key uuid, p_image_refs text[], p_status text'),
       ('community_post_update',              'p_post_id uuid, p_title text, p_body text, p_category text, p_expected_updated_at timestamp with time zone, p_image_refs text[], p_status text'),
       ('community_post_soft_delete',         'p_post_id uuid'),
       ('mentor_profile_update_self',         'p_university_name text, p_department_name text, p_high_school_name text, p_teaching_subjects text[], p_intro_line text, p_bio text, p_answer_style text, p_profile_image_url text, p_is_open_for_subscriptions boolean'),
       ('mentor_plan_prices_set_self',        'p_limited_cash_krw integer, p_standard_cash_krw integer, p_premium_cash_krw integer'),
       ('mentor_payout_account_update_self',  'p_bank_name text, p_account_number text'),
       ('record_cash_topup_v2',               'p_user_id uuid, p_amount_cents bigint, p_order_ref text'),
       ('subscription_checkout_confirm_v2',   'p_payment_id uuid, p_plan_id uuid, p_expected_amount_cents integer, p_idempotency_key text'));
  IF v_cnt <> 14 THEN
    RAISE EXCEPTION 'M10_B_WEB: identity argument set expected 14, measured %', v_cnt;
  END IF;
  -- B-4. 전 함수 SECDEF + pinned 빈 search_path + 소유자 postgres + PUBLIC EXECUTE 0
  FOR r IN SELECT p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl, pg_get_userbyid(p.proowner) AS owner
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'api_web_v1'
  LOOP
    IF NOT r.prosecdef THEN
      RAISE EXCEPTION 'M10_B_WEB: % prosecdef expected true, measured false', r.proname;
    END IF;
    IF NOT (coalesce(r.proconfig, '{}') @> ARRAY['search_path=""']) THEN
      RAISE EXCEPTION 'M10_B_WEB: % proconfig expected pinned empty search_path, measured %', r.proname, r.proconfig;
    END IF;
    IF r.owner <> 'postgres' THEN
      RAISE EXCEPTION 'M10_B_WEB: % owner expected postgres, measured %', r.proname, r.owner;
    END IF;
    IF r.proacl IS NULL THEN
      RAISE EXCEPTION 'M10_B_WEB: % proacl NULL(기본 PUBLIC EXECUTE) — expected explicit acl', r.proname;
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'M10_B_WEB: % PUBLIC EXECUTE expected 0, measured present', r.proname;
    END IF;
  END LOOP;
  -- B-5. EXECUTE 매트릭스(부록 A): T2 12종 = authenticated·service_role / F11·F12 = service_role 만
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api_web_v1'
     AND p.proname NOT IN ('record_cash_topup_v2','subscription_checkout_confirm_v2')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF v_cnt <> 12 THEN
    RAISE EXCEPTION 'M10_B_WEB: T2 EXECUTE matrix expected 12 conforming, measured %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api_web_v1'
     AND p.proname IN ('record_cash_topup_v2','subscription_checkout_confirm_v2')
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'M10_B_WEB: F11/F12 EXECUTE matrix expected 2 conforming, measured %', v_cnt;
  END IF;
  -- B-6. view GRANT 매트릭스(§10.2): V1~V3 anon+auth+svc SELECT / V4·V5 auth+svc 만
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'api_web_v1' AND c.relkind = 'v'
     AND CASE WHEN c.relname IN ('my_wallet_v1','my_cash_ledger_v1')
              THEN NOT has_table_privilege('anon', c.oid, 'SELECT')
              ELSE has_table_privilege('anon', c.oid, 'SELECT') END
     AND has_table_privilege('authenticated', c.oid, 'SELECT')
     AND has_table_privilege('service_role', c.oid, 'SELECT');
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'M10_B_WEB: view SELECT matrix expected 5 conforming, measured %', v_cnt;
  END IF;
  -- B-7. view DML 권한 0 (T-PERM-08) + PUBLIC relacl 엔트리 0
  SELECT count(*) INTO v_cnt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS rl(rolname)
   CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS pv(priv)
   WHERE n.nspname = 'api_web_v1' AND c.relkind = 'v'
     AND has_table_privilege(rl.rolname, c.oid, pv.priv);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M10_B_WEB: view DML privileges expected 0, measured %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
         aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
   WHERE n.nspname = 'api_web_v1' AND a.grantee = 0;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M10_B_WEB: PUBLIC view acl entries expected 0, measured %', v_cnt;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- C. core_private — 함수 6종 · 외부 EXECUTE 0 · 복제 0 (T-PERM-01·06)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
  r record;
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core_private';
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION 'M10_C_PRIV: function census expected 6, measured %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core_private'
     AND (p.proname, pg_get_function_identity_arguments(p.oid)) IN (
       ('ensure_student_mentor_room',      'p_student_id uuid, p_mentor_id uuid, p_payment_id uuid, p_subscription_id uuid, p_require_entitlement boolean'),
       ('record_cash_topup_impl',          'p_user_id uuid, p_amount_cents bigint, p_idempotency_key text'),
       ('community_post_create_impl',      'p_author_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_idempotency_key uuid'),
       ('community_post_update_impl',      'p_author_id uuid, p_post_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_expected_updated_at timestamp with time zone'),
       ('community_post_soft_delete_impl', 'p_author_id uuid, p_post_id uuid'),
       ('community_image_refs_validate',   'p_owner_id uuid, p_image_refs text[]'));
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION 'M10_C_PRIV: identity argument set expected 6, measured %', v_cnt;
  END IF;
  FOR r IN SELECT p.oid, p.proname, p.proacl FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'core_private'
  LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', r.oid, 'EXECUTE')
       OR has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'M10_C_PRIV: % external EXECUTE expected all false, measured true', r.proname;
    END IF;
    IF r.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'M10_C_PRIV: % PUBLIC EXECUTE expected 0, measured NULL-or-present', r.proname;
    END IF;
  END LOOP;
  -- 테이블·뷰 등 다른 객체 0(스키마는 함수 6종만 소유)
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'core_private';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M10_C_PRIV: pg_class census expected 0, measured %', v_cnt;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- D. api_app_v1 — schema 1 + view 1 + wrapper 5 = 7객체 · authenticated 전용
--    (M17 적용 직후 게이트 재확인 + 앱 계약 §3.3)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
  r record;
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'api_app_v1';
  IF v_cnt <> 1 OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'api_app_v1' AND c.relkind = 'v' AND c.relname = 'community_posts_v1'
         AND 'security_invoker=true' = ANY (coalesce(c.reloptions, '{}'))) THEN
    RAISE EXCEPTION 'M10_D_APP: relation census expected exactly community_posts_v1(invoker), measured %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api_app_v1';
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'M10_D_APP: wrapper census expected 5, measured %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api_app_v1'
     AND (p.proname, pg_get_function_identity_arguments(p.oid)) IN (
       ('ensure_free_question_room',  'p_mentor_id uuid'),
       ('qna_create_question_thread', 'p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text'),
       ('community_post_create',      'p_title text, p_body text, p_category text, p_idempotency_key uuid, p_image_refs text[], p_status text'),
       ('community_post_update',      'p_post_id uuid, p_title text, p_body text, p_category text, p_expected_updated_at timestamp with time zone, p_image_refs text[], p_status text'),
       ('community_post_soft_delete', 'p_post_id uuid'));
  IF v_cnt <> 5 THEN
    RAISE EXCEPTION 'M10_D_APP: wrapper identity argument set expected 5, measured %', v_cnt;
  END IF;
  -- 권한: authenticated 만 (anon·PUBLIC·service_role 0 — 앱 공개 계약 호출자에 service_role 불포함)
  IF NOT has_schema_privilege('authenticated', 'api_app_v1', 'USAGE')
     OR has_schema_privilege('anon', 'api_app_v1', 'USAGE')
     OR has_schema_privilege('service_role', 'api_app_v1', 'USAGE') THEN
    RAISE EXCEPTION 'M10_D_APP: schema USAGE matrix mismatch (expected authenticated only)';
  END IF;
  IF NOT has_table_privilege('authenticated', 'api_app_v1.community_posts_v1', 'SELECT')
     OR has_table_privilege('anon', 'api_app_v1.community_posts_v1', 'SELECT')
     OR has_table_privilege('service_role', 'api_app_v1.community_posts_v1', 'SELECT') THEN
    RAISE EXCEPTION 'M10_D_APP: view SELECT matrix mismatch (expected authenticated only)';
  END IF;
  SELECT count(*) INTO v_cnt
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS rl(rolname)
   CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS pv(priv)
   WHERE has_table_privilege(rl.rolname, 'api_app_v1.community_posts_v1', pv.priv);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M10_D_APP: view DML privileges expected 0, measured %', v_cnt;
  END IF;
  FOR r IN SELECT p.oid, p.proname, p.proacl FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'api_app_v1'
  LOOP
    IF NOT has_function_privilege('authenticated', r.oid, 'EXECUTE')
       OR has_function_privilege('anon', r.oid, 'EXECUTE')
       OR has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'M10_D_APP: % EXECUTE matrix mismatch (expected authenticated only)', r.proname;
    END IF;
    IF r.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(r.proacl) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'M10_D_APP: % PUBLIC EXECUTE expected 0, measured NULL-or-present', r.proname;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- E. 신규 객체 총계(부록 A) + F0 부재 (T-PERM-05)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_views int; v_fns int; v_schemas int; v_cnt int;
BEGIN
  SELECT count(*) INTO v_views FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('api_web_v1','api_app_v1') AND c.relkind = 'v';
  SELECT count(*) INTO v_fns FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('api_web_v1','core_private','api_app_v1');
  SELECT count(*) INTO v_schemas FROM pg_namespace
   WHERE nspname IN ('api_web_v1','api_app_v1','core_private');
  IF v_views <> 6 OR v_fns <> 25 OR v_schemas <> 3 THEN
    RAISE EXCEPTION 'M10_E_TOTAL: expected view 6/function 25/schema 3, measured %/%/%',
      v_views, v_fns, v_schemas;
  END IF;
  -- 신규 column 1: comments.author_role(text·NULL 허용)
  SELECT count(*) INTO v_cnt FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'comments'
     AND column_name = 'author_role' AND data_type = 'text' AND is_nullable = 'YES';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'M10_E_TOTAL: comments.author_role expected text NULL x1, measured %', v_cnt;
  END IF;
  -- F0 부재: user_display_label / user_display_role 함수가 신규 스키마 어디에도 없음
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('api_web_v1','core_private','api_app_v1','public')
     AND p.proname IN ('user_display_label','user_display_role');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M10_E_TOTAL: F0 label functions expected absent, measured %', v_cnt;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- F. 기존 보안 객체 — M0·M13·M15 실재 + 레거시 public 표면 불변 (T-REG-06 상당)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
BEGIN
  -- M0: 특권 컬럼 가드 함수 + 트리거 2
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'enforce_mentor_profile_privileged_guard'
                    AND p.prosecdef AND coalesce(p.proconfig, '{}') @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'M10_F_LEGACY: M0 guard function expected present(SECDEF, pinned), measured absent';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_trigger t
   WHERE t.tgrelid = 'public.mentor_profiles'::regclass AND NOT t.tgisinternal
     AND t.tgname IN ('trg_mentor_profile_privileged_guard_ins','trg_mentor_profile_privileged_guard_upd');
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'M10_F_LEGACY: M0 guard triggers expected 2, measured %', v_cnt;
  END IF;
  -- M13: 트리거 함수 2(SECDEF·pinned·PUBLIC 0) + 트리거 4 + default '쌤버십 사용자'
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('comments_set_author_label','community_comments_set_author_label')
     AND p.prosecdef AND coalesce(p.proconfig, '{}') @> ARRAY['search_path=""']
     AND p.proacl IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0);
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'M10_F_LEGACY: M13 trigger functions expected 2 conforming, measured %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_trigger t
   WHERE NOT t.tgisinternal
     AND t.tgname IN ('trg_comments_set_author_label_ins','trg_comments_set_author_label_upd',
                      'trg_community_comments_set_author_label_ins','trg_community_comments_set_author_label_upd');
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'M10_F_LEGACY: M13 triggers expected 4, measured %', v_cnt;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'comments'
                    AND column_name = 'author_label' AND is_nullable = 'NO'
                    AND column_default LIKE '%쌤버십 사용자%') THEN
    RAISE EXCEPTION 'M10_F_LEGACY: comments.author_label default expected 쌤버십 사용자, measured otherwise';
  END IF;
  -- M15: pair-party 가드 본문 마커([S2 M15]) — 계약된 본문 교체 1
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'get_weekly_question_usage'
                    AND position('[S2 M15]' in p.prosrc) > 0) THEN
    RAISE EXCEPTION 'M10_F_LEGACY: M15 pair-party guard marker expected present, measured absent';
  END IF;
  -- M9 2층: record_cash_topup 본문이 F11i 위임 — 계약된 본문 교체 2
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'record_cash_topup'
                    AND position('core_private.record_cash_topup_impl' in p.prosrc) > 0) THEN
    RAISE EXCEPTION 'M10_F_LEGACY: M9 record_cash_topup delegation marker expected present, measured absent';
  END IF;
  -- 레거시 public 에 S2 신규 함수 이름 유출 0 (public 정본으로 실존하는
  -- qna_create_question_thread·account_deletion_status_self 는 대상에서 제외)
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('weekly_question_usage_self','ensure_free_question_room',
                       'community_post_create','community_post_update','community_post_soft_delete',
                       'mentor_profile_update_self','mentor_plan_prices_set_self',
                       'mentor_payout_account_update_self','my_subscriptions_self',
                       'mentor_settlement_self','record_cash_topup_v2',
                       'subscription_checkout_confirm_v2','ensure_student_mentor_room',
                       'record_cash_topup_impl','community_post_create_impl',
                       'community_post_update_impl','community_post_soft_delete_impl',
                       'community_image_refs_validate');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M10_F_LEGACY: S2 function names in public expected 0, measured %', v_cnt;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- G/H. M11·M12 — mentor_profiles·mentor_plans SELECT 만 true (T-PERM-09·10·14)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_tbl  text;
  v_role text;
  v_priv text;
  v_has  boolean;
  v_cnt  int;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['mentor_profiles','mentor_plans'] LOOP
    FOR v_role, v_priv IN
      SELECT r.rolname, p.priv
        FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
       CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(priv)
    LOOP
      v_has := has_table_privilege(v_role, format('public.%I', v_tbl), v_priv);
      IF v_priv = 'SELECT' AND NOT v_has THEN
        RAISE EXCEPTION 'M10_GH_REVOKE: %.% SELECT expected true, measured false', v_tbl, v_role;
      ELSIF v_priv <> 'SELECT' AND v_has THEN
        RAISE EXCEPTION 'M10_GH_REVOKE: %.% % expected false, measured true', v_tbl, v_role, v_priv;
      END IF;
    END LOOP;
    SELECT count(*) INTO v_cnt FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name = v_tbl
       AND grantee IN ('anon','authenticated') AND privilege_type <> 'SELECT';
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'M10_GH_REVOKE: % residual column write privileges expected 0, measured %', v_tbl, v_cnt;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- I. M16 — community_posts SELECT 만 true · 쓰기 정책 6종 부재 · SELECT 정책 존재
--    (T-PERM-15 카탈로그 부분)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_role text;
  v_priv text;
  v_has  boolean;
  v_cnt  int;
BEGIN
  FOR v_role, v_priv IN
    SELECT r.rolname, p.priv
      FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(priv)
  LOOP
    v_has := has_table_privilege(v_role, 'public.community_posts', v_priv);
    IF v_priv = 'SELECT' AND NOT v_has THEN
      RAISE EXCEPTION 'M10_I_HD1: community_posts % SELECT expected true, measured false', v_role;
    ELSIF v_priv <> 'SELECT' AND v_has THEN
      RAISE EXCEPTION 'M10_I_HD1: community_posts % % expected false, measured true', v_role, v_priv;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'community_posts'
     AND cmd IN ('INSERT','UPDATE','DELETE');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M10_I_HD1: write policies expected 0, measured %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'community_posts'
     AND policyname IN ('cp_write_self','로그인 유저 게시글 작성','cp_update_own',
                        'cp_update_self','본인 게시글 수정','cp_delete_own');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M10_I_HD1: dropped policy names expected absent, measured %', v_cnt;
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'community_posts' AND cmd = 'SELECT'
         AND policyname IN ('cp_select_own','cp_select_published')) <> 2 THEN
    RAISE EXCEPTION 'M10_I_HD1: SELECT policies cp_select_own/cp_select_published expected present';
  END IF;
  -- service_role 권한 존재 형태 유지(REVOKE 대상 아님 — 회수 흔적 감시:
  -- service_role 의 community_posts acl 엔트리가 완전 소거되지 않았는지)
  IF NOT EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
                  WHERE c.oid = 'public.community_posts'::regclass
                    AND a.grantee = 'service_role'::regrole) THEN
    RAISE EXCEPTION 'M10_I_HD1: service_role acl entry expected present, measured absent';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- J. SECDEF 화이트리스트(§11.6·T-PERM-04) — 신규 3스키마 전수 + M0·M13 부수
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
BEGIN
  -- 신규 3스키마의 SECDEF 함수 = 정확히 20
  --   api_web_v1 14(F1~F9·F11~F13·V6·V7) + api_app_v1 5(wrapper) + core_private 1(F10)
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('api_web_v1','api_app_v1','core_private') AND p.prosecdef;
  IF v_cnt <> 20 THEN
    RAISE EXCEPTION 'M10_J_SECDEF: SECDEF census expected 20, measured %', v_cnt;
  END IF;
  -- core_private 내부 구현부 5종은 INVOKER(F10 만 SECDEF)
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core_private' AND p.prosecdef;
  IF v_cnt <> 1 OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core_private' AND p.prosecdef AND p.proname = 'ensure_student_mentor_room') THEN
    RAISE EXCEPTION 'M10_J_SECDEF: core_private SECDEF expected F10 only, measured %', v_cnt;
  END IF;
  -- SECDEF view 는 mentor_directory_v1 1건뿐(§11.6) — B-2 에서 옵션 검증, 여기서 census
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('api_web_v1','api_app_v1') AND c.relkind = 'v'
     AND NOT ('security_invoker=true' = ANY (coalesce(c.reloptions, '{}')));
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'M10_J_SECDEF: SECDEF view census expected 1(mentor_directory_v1), measured %', v_cnt;
  END IF;
  -- 계약 SECDEF 전건: pinned 빈 search_path + 소유자 postgres + PUBLIC EXECUTE 0
  SELECT count(*) INTO v_cnt FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('api_web_v1','api_app_v1','core_private') AND p.prosecdef
     AND NOT ( coalesce(p.proconfig, '{}') @> ARRAY['search_path=""']
               AND pg_get_userbyid(p.proowner) = 'postgres'
               AND p.proacl IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) );
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M10_J_SECDEF: nonconforming contract SECDEF functions expected 0, measured %', v_cnt;
  END IF;
END $$;

commit;
