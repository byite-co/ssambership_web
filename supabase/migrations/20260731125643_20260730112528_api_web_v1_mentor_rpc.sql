-- =============================================================================
-- 20260730112528_api_web_v1_mentor_rpc.sql (S2 M8)
-- =============================================================================
-- 멘토 자기 관리 RPC — F7 mentor_profile_update_self · F8 mentor_plan_prices_set_self.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §7 F7·F8 · §9.5 · §10.3 ·
--            §11.5 · §20.2 M8 (HD-1 을 얹지 않는다 — rev 8 C 불변).
--   - F7(XW-02 해소): 쓰기 허용 컬럼 allowlist = 시그니처 9개 그 자체
--     (university_name·department_name·high_school_name·teaching_subjects·
--      intro_line·bio·answer_style·profile_image_url·is_open_for_subscriptions).
--     verification_status·cap_limit·payout_*·activity_status 등 특권·분리 컬럼은
--     절대 갱신하지 않는다(payout 은 F13/M14 분리 — rev 8 A-4).
--     teaching_subjects 는 public.subjects.code 실존 값만 남기고 버린다(정본
--     qna subject 검증과 동일 방식). 아바타 ref 는 profile-avatars 정본 형식
--     (public URL 의 /profile-avatars/ marker 또는 순수 경로 — 실측
--      lib/storage/mentorAvatarStorage.ts)에서 경로를 추출해 첫 세그먼트가
--     auth.uid() 인지 검증한다 — 불일치 시 PROFILE_IMAGE_REF_INVALID.
--   - F8(XW-03 해소): 캐시(원) 3값을 받아 amount_cents = cash_krw * 100 변환.
--     가격 밴드를 DB 상수로 강제(정본 lib/subscribe/mentorPlanPricing.ts:13 과
--     동일 — T-REG-02 회귀 감시 대상): limited 29,900~69,900 · standard
--     84,900~149,900 · premium 174,900~329,900. 밴드 밖은 클램프하지 않고
--     PLAN_PRICE_OUT_OF_BAND(tier·min_cash_krw·max_cash_krw·given_cash_krw) 거부.
--     cap_weight 는 tier 고정값 1.0/2.5/4.5 로 함수가 강제(클라이언트 불가 —
--     XW-03 cap 우회 차단). upsert 는 ON CONFLICT (mentor_id, plan_tier)
--     (실측 UNIQUE INDEX uq_mentor_plans_mentor_tier) · 3 tier 단일 트랜잭션.
--   - 공통: auth.uid() 자체 도출(§11.3) · SECDEF + SET search_path='' ·
--     같은 트랜잭션 PUBLIC EXECUTE 회수 · EXECUTE {authenticated, service_role}.
-- 선행조건: M1(20260730095435) 적용 완료(§20.2.1 — M8 : M1).
-- rollback 정본: supabase/rollback/20260730112528_api_web_v1_mentor_rpc_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_web_v1') THEN
    RAISE EXCEPTION 'BATCH_D_BASELINE_OBJECT_MISMATCH: M1 api_web_v1 schema not applied';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'mentor_profiles'
         AND column_name IN ('user_id','university_name','department_name','high_school_name',
                             'teaching_subjects','intro_line','bio','answer_style',
                             'profile_image_url','is_open_for_subscriptions','updated_at')) <> 11
     OR (SELECT count(*) FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'mentor_plans'
            AND column_name IN ('mentor_id','plan_tier','amount_cents','cap_weight','price_updated_at')) <> 5
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                     AND indexname = 'uq_mentor_plans_mentor_tier')
     OR NOT EXISTS (SELECT 1 FROM information_schema.tables
                     WHERE table_schema = 'public' AND table_name = 'subjects') THEN
    RAISE EXCEPTION 'BATCH_D_BASELINE_OBJECT_MISMATCH: mentor base objects mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'api_web_v1'
                AND p.proname IN ('mentor_profile_update_self', 'mentor_plan_prices_set_self')) THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: M8 target functions already exist';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. F7 mentor_profile_update_self (allowlist = 시그니처 9컬럼)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.mentor_profile_update_self(
  p_university_name text, p_department_name text, p_high_school_name text,
  p_teaching_subjects text[], p_intro_line text, p_bio text,
  p_answer_style text, p_profile_image_url text,
  p_is_open_for_subscriptions boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_uid      uuid := (SELECT auth.uid());
  v_role     text;
  v_status   text;
  v_susp     timestamptz;
  v_subjects text[];
  v_avatar_path text;
  v_updated  timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  SELECT u.role, u.status, u.suspended_until INTO v_role, v_status, v_susp
    FROM public.users u WHERE u.id = v_uid;
  IF NOT FOUND OR v_role IS DISTINCT FROM 'mentor' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_NOT_MENTOR');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'suspended' AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_SUSPENDED');
  END IF;
  IF public.account_deletion_write_blocked(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mentor_profiles mp WHERE mp.user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_PROFILE_NOT_FOUND');
  END IF;
  IF btrim(coalesce(p_university_name, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'UNIVERSITY_NAME_REQUIRED');
  END IF;
  IF btrim(coalesce(p_department_name, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'DEPARTMENT_NAME_REQUIRED');
  END IF;

  -- teaching_subjects: subjects.code 실존 값만 보존 (정본 subject 검증 방식 승계)
  SELECT coalesce(array_agg(s.code ORDER BY ord), '{}'::text[]) INTO v_subjects
    FROM unnest(coalesce(p_teaching_subjects, '{}'::text[])) WITH ORDINALITY AS t(code, ord)
    JOIN public.subjects s ON s.code = t.code;

  -- 아바타 ref: NULL 허용(해제). 값이 있으면 profile-avatars 경로 추출 +
  -- 첫 세그먼트 = 본인 uid 검증 (실측 mentorAvatarStorage.ts 추출 규칙과 동일)
  IF p_profile_image_url IS NOT NULL AND btrim(p_profile_image_url) <> '' THEN
    IF position('/profile-avatars/' IN p_profile_image_url) > 0 THEN
      v_avatar_path := split_part(split_part(
        substring(p_profile_image_url FROM position('/profile-avatars/' IN p_profile_image_url) + char_length('/profile-avatars/')),
        '?', 1), '#', 1);
    ELSIF p_profile_image_url !~ '^https?:' THEN
      v_avatar_path := regexp_replace(btrim(p_profile_image_url), '^/+', '');
    ELSE
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PROFILE_IMAGE_REF_INVALID');
    END IF;
    IF v_avatar_path IS NULL OR v_avatar_path = ''
       OR split_part(v_avatar_path, '/', 1) IS DISTINCT FROM v_uid::text
       OR split_part(v_avatar_path, '/', 2) = '' THEN
      RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PROFILE_IMAGE_REF_INVALID');
    END IF;
  END IF;

  UPDATE public.mentor_profiles mp
     SET university_name = btrim(p_university_name),
         department_name = btrim(p_department_name),
         high_school_name = nullif(btrim(coalesce(p_high_school_name, '')), ''),
         teaching_subjects = v_subjects,
         intro_line = nullif(btrim(coalesce(p_intro_line, '')), ''),
         bio = nullif(btrim(coalesce(p_bio, '')), ''),
         answer_style = nullif(btrim(coalesce(p_answer_style, '')), ''),
         profile_image_url = nullif(btrim(coalesce(p_profile_image_url, '')), ''),
         is_open_for_subscriptions = coalesce(p_is_open_for_subscriptions, mp.is_open_for_subscriptions)
   WHERE mp.user_id = v_uid
   RETURNING mp.updated_at INTO v_updated;

  RETURN jsonb_build_object('ok', true, 'contract_version', 1, 'updated_at', v_updated);
END $fn$;

COMMENT ON FUNCTION api_web_v1.mentor_profile_update_self(text, text, text, text[], text, text, text, text, boolean) IS
  'S2 M8 F7(계약 §7 — XW-02 해소): 멘토 자기 프로필 갱신 — allowlist 9컬럼만. 특권·payout 컬럼 불변(payout 은 F13/M14 분리).';

-- -----------------------------------------------------------------------------
-- C. F8 mentor_plan_prices_set_self (밴드 DB 강제 — XW-03 해소)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.mentor_plan_prices_set_self(
  p_limited_cash_krw  integer,
  p_standard_cash_krw integer,
  p_premium_cash_krw  integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v_role   text;
  v_status text;
  v_susp   timestamptz;
  -- 밴드 상수 — 정본 lib/subscribe/mentorPlanPricing.ts:13 와 동일 (T-REG-02).
  -- 잠금값 개정 시 두 정본을 같은 PR 에서 함께 변경한다(계약 §7 F8).
  v_tiers  text[]  := ARRAY['limited', 'standard', 'premium'];
  v_mins   int[]   := ARRAY[29900, 84900, 174900];
  v_maxs   int[]   := ARRAY[69900, 149900, 329900];
  v_caps   numeric[] := ARRAY[1.0, 2.5, 4.5];
  v_given  int[];
  v_i      int;
  v_amount int;
  v_old    int;
  v_updated   jsonb := '[]'::jsonb;
  v_unchanged jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  SELECT u.role, u.status, u.suspended_until INTO v_role, v_status, v_susp
    FROM public.users u WHERE u.id = v_uid;
  IF NOT FOUND OR v_role IS DISTINCT FROM 'mentor' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_NOT_MENTOR');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'suspended' AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_SUSPENDED');
  END IF;
  IF public.account_deletion_write_blocked(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  END IF;

  v_given := ARRAY[p_limited_cash_krw, p_standard_cash_krw, p_premium_cash_krw];

  -- 전건 검증 선행 → 전건 반영 또는 전건 실패 (3 tier 단일 트랜잭션 — T-CONC-07 상당)
  FOR v_i IN 1..3 LOOP
    IF v_given[v_i] IS NULL OR v_given[v_i] < 1 THEN
      RETURN jsonb_build_object('ok', false, 'contract_version', 1,
                                'code', 'PLAN_PRICE_INVALID', 'tier', v_tiers[v_i]);
    END IF;
    IF v_given[v_i] < v_mins[v_i] OR v_given[v_i] > v_maxs[v_i] THEN
      RETURN jsonb_build_object('ok', false, 'contract_version', 1,
                                'code', 'PLAN_PRICE_OUT_OF_BAND', 'tier', v_tiers[v_i],
                                'min_cash_krw', v_mins[v_i], 'max_cash_krw', v_maxs[v_i],
                                'given_cash_krw', v_given[v_i]);
    END IF;
  END LOOP;

  FOR v_i IN 1..3 LOOP
    v_amount := v_given[v_i] * 100;   -- amountCentsFromCashKrw 동일 (1캐시 = 1원 = 100 cents)
    SELECT mp.amount_cents INTO v_old FROM public.mentor_plans mp
     WHERE mp.mentor_id = v_uid AND mp.plan_tier = v_tiers[v_i];
    IF FOUND AND v_old = v_amount
       AND EXISTS (SELECT 1 FROM public.mentor_plans mp
                    WHERE mp.mentor_id = v_uid AND mp.plan_tier = v_tiers[v_i]
                      AND mp.cap_weight = v_caps[v_i]) THEN
      v_unchanged := v_unchanged || jsonb_build_object('plan_tier', v_tiers[v_i], 'amount_cents', v_amount);
    ELSE
      INSERT INTO public.mentor_plans (mentor_id, plan_tier, amount_cents, cap_weight, is_active, price_updated_at)
      VALUES (v_uid, v_tiers[v_i], v_amount, v_caps[v_i], true, now())
      ON CONFLICT (mentor_id, plan_tier) DO UPDATE
        SET amount_cents = excluded.amount_cents,
            cap_weight = excluded.cap_weight,       -- tier 고정값 강제(클라이언트 불가)
            price_updated_at = now();
      v_updated := v_updated || jsonb_build_object('plan_tier', v_tiers[v_i], 'amount_cents', v_amount);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'contract_version', 1,
                            'updated', v_updated, 'unchanged', v_unchanged);
END $fn$;

COMMENT ON FUNCTION api_web_v1.mentor_plan_prices_set_self(integer, integer, integer) IS
  'S2 M8 F8(계약 §7 — XW-03 해소): 멘토 플랜 가격 설정 — 밴드 DB 강제(클램프 없이 거부)·cap_weight tier 고정·3 tier 단일 트랜잭션.';

-- -----------------------------------------------------------------------------
-- D. GRANT (§10.3)
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION api_web_v1.mentor_profile_update_self(text, text, text, text[], text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION api_web_v1.mentor_plan_prices_set_self(integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api_web_v1.mentor_profile_update_self(text, text, text, text[], text, text, text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.mentor_plan_prices_set_self(integer, integer, integer) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- E. 적용 직후 자가 검증
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api_web_v1'
     AND p.prosecdef AND p.proconfig::text LIKE '%search_path=%'
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND (p.proacl IS NULL OR (p.proacl::text NOT LIKE '{=%' AND p.proacl::text NOT LIKE '%,=%'))
     AND (p.proname, pg_get_function_identity_arguments(p.oid)) IN
         (('mentor_profile_update_self', 'p_university_name text, p_department_name text, p_high_school_name text, p_teaching_subjects text[], p_intro_line text, p_bio text, p_answer_style text, p_profile_image_url text, p_is_open_for_subscriptions boolean'),
          ('mentor_plan_prices_set_self', 'p_limited_cash_krw integer, p_standard_cash_krw integer, p_premium_cash_krw integer'));
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'S2_M8_SELFCHECK: F7/F8 hardening mismatch (matched %)', v_cnt;
  END IF;
  -- F7 본문이 특권·분리 컬럼을 참조하지 않는다 (allowlist 밖 갱신 0 — XW-02 방어)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'api_web_v1' AND p.proname = 'mentor_profile_update_self'
                AND p.prosrc ~* '(verification_status|cap_limit|payout_bank_name|payout_account_number|activity_status|student_id_image_url)') THEN
    RAISE EXCEPTION 'S2_M8_SELFCHECK: F7 must not reference privileged/separated columns';
  END IF;
END $$;

commit;
