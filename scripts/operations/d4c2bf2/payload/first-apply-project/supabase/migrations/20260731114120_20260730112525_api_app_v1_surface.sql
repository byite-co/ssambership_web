-- =============================================================================
-- 20260730112525_api_app_v1_surface.sql (S2 M17)
-- =============================================================================
-- api_app_v1 DB 표면 — 소유 객체 정확히 7개: schema 1 + view 1 + wrapper 5.
-- 정본 계약: 앱 계약 api_app_v1_contract_v1_1.md §3.1~§3.4 · §10 Gate 4 /
--            웹 계약 §19.5 #9 · §20.2 M17 · §20.3 「M17 이전/적용 직후」 · §22.
--   - schema: REVOKE ALL FROM PUBLIC, anon · GRANT USAGE → authenticated 만
--     (service_role 은 앱 공개 계약의 호출자가 아니다 — 앱 계약 §3.3 주석.
--      웹 api_web_v1 과의 의도적 차이).
--   - view `api_app_v1.community_posts_v1`: 웹 V1 과 동일 필드·동일 규약
--     (body=coalesce(content,body) · image_refs=coalesce(image_urls,{}) ·
--      deleted_at IS NULL · published 또는 본인 글 · security_invoker=true ·
--      SELECT → authenticated 만).
--   - wrapper 5종(identity argument = 앱 계약 §3.3·§10 Gate 4 완전 동일):
--     ensure_free_question_room(uuid) · qna_create_question_thread(uuid,text,
--     text,text,text) · community_post_create(text,text,text,uuid,text[],text) ·
--     community_post_update(uuid,text,text,text,timestamptz,text[],text) ·
--     community_post_soft_delete(uuid). 전부 SECDEF + SET search_path='' —
--     웹 F2·F3·F4·F5·F6 과 동일한 얇은 껍데기로, 판정·검증은 전부 공용 정본
--     (core_private.ensure_student_mentor_room(F10 — M5) · B-1~B-4(M7) ·
--      public.qna_create_question_thread)이 수행한다. **복제 금지** — 이
--     migration 은 core_private 에 어떤 객체도 만들지 않는다.
--   - F3 상당 wrapper 의 raise→envelope 변환·FREE_QUESTION_* 4쌍 수렴은 웹 F3
--     과 동일 매핑이다(앱 계약 §4.3 — 웹·앱이 같은 상황에서 같은 코드).
--   - default privilege 방어: ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE FROM
--     PUBLIC (계약 원문 유지 — PG17.6 실측상 선행 per-schema GRANT 부재 시 저장
--     no-op 이며 실효 방어선은 함수별 명시 REVOKE. M1 forward 섹션 D 기록과 동일).
--   - Data API(Exposed schemas) 추가는 SQL 이 아닌 플랫폼 단계 D-API-A 다
--     (앱 계약 §3.1 순서 고정 — 본 migration 은 노출 설정을 변경하지 않는다).
-- 선행조건: M5(20260730105244) + M7(20260730105252) 적용 완료(§20.2.1 —
--   M17 : M5 + M7. M1 은 간접 충족 · M13 의존 없음).
-- rollback 정본: supabase/rollback/20260730112525_api_app_v1_surface_rollback.sql
--   (§22 M17 순서 — 운영에서는 노출 제거·config 반영 확인이 DROP 보다 선행.
--    로컬 검증 단계에서는 D-API-A 미실행이므로 wrapper→view→schema DROP 만 해당)
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 (§20.3 「M17 이전」 5항 — 불일치 시 수정 0건 중단)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- ① M5 적용 (F10 identity 일치 — §7 F10)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'core_private' AND p.proname = 'ensure_student_mentor_room'
                    AND pg_get_function_identity_arguments(p.oid)
                        = 'p_student_id uuid, p_mentor_id uuid, p_payment_id uuid, p_subscription_id uuid, p_require_entitlement boolean') THEN
    RAISE EXCEPTION 'BATCH_D_BASELINE_OBJECT_MISMATCH: M5 F10 not applied or identity mismatch';
  END IF;
  -- ② M7 적용 (B-1~B-4 identity 일치 — §7 표)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core_private'
         AND (p.proname, pg_get_function_identity_arguments(p.oid)) IN
             (('community_post_create_impl', 'p_author_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_idempotency_key uuid'),
              ('community_post_update_impl', 'p_author_id uuid, p_post_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_expected_updated_at timestamp with time zone'),
              ('community_post_soft_delete_impl', 'p_author_id uuid, p_post_id uuid'),
              ('community_image_refs_validate', 'p_owner_id uuid, p_image_refs text[]'))) <> 4 THEN
    RAISE EXCEPTION 'BATCH_D_BASELINE_OBJECT_MISMATCH: M7 impl functions not applied or identity mismatch';
  END IF;
  -- ③ View 기반 컬럼 전수 대조 (앱 계약 §3.2 — community_posts)
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'community_posts'
         AND column_name IN ('id','author_id','title','content','body','category','image_urls',
                             'author_label','author_role','like_count','comment_count','view_count',
                             'status','created_at','updated_at','deleted_at')) <> 16 THEN
    RAISE EXCEPTION 'BATCH_D_BASELINE_OBJECT_MISMATCH: community_posts base columns mismatch';
  END IF;
  -- ④ 정본 qna_create_question_thread identity
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'qna_create_question_thread'
                    AND pg_get_function_identity_arguments(p.oid)
                        = 'p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text') THEN
    RAISE EXCEPTION 'BATCH_D_BASELINE_OBJECT_MISMATCH: canonical qna_create_question_thread mismatch';
  END IF;
  -- ⑤ 기존 api_app_v1 부분 객체 없음 (부분 생성 은닉 금지)
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_app_v1') THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: schema api_app_v1 already exists';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. schema (앱 계약 §3.1 — authenticated 만 USAGE)
-- -----------------------------------------------------------------------------
CREATE SCHEMA api_app_v1;
REVOKE ALL ON SCHEMA api_app_v1 FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA api_app_v1 TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA api_app_v1 REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- C. view api_app_v1.community_posts_v1 (앱 계약 §3.2 — 웹 V1 과 동일 규약)
-- -----------------------------------------------------------------------------
CREATE VIEW api_app_v1.community_posts_v1
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.author_id,
  p.title,
  coalesce(p.content, p.body)           AS body,
  p.category,
  coalesce(p.image_urls, '{}'::text[])  AS image_refs,
  p.author_label,
  p.author_role,
  p.like_count,
  p.comment_count,
  p.view_count,
  p.status,
  p.created_at,
  p.updated_at
FROM public.community_posts p
WHERE p.deleted_at IS NULL
  AND (p.status = 'published' OR p.author_id = (SELECT auth.uid()));

COMMENT ON VIEW api_app_v1.community_posts_v1 IS
  'S2 M17(앱 계약 §3.2): 앱 게시판 읽기 — 웹 V1 과 동일 필드·규약. security_invoker=true · SELECT → authenticated 만.';

-- -----------------------------------------------------------------------------
-- D. wrapper 1 — ensure_free_question_room (웹 F2 와 동일 얇은 껍데기)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_app_v1.ensure_free_question_room(p_mentor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  IF p_mentor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_FOUND');
  END IF;
  RETURN core_private.ensure_student_mentor_room(v_uid, p_mentor_id, NULL, NULL, true)
         || jsonb_build_object('contract_version', 1);
END $fn$;

COMMENT ON FUNCTION api_app_v1.ensure_free_question_room(uuid) IS
  'S2 M17(앱 계약 §3.3): 무료질문 방 확보 앱 wrapper — 웹 F2 와 이름·시그니처·반환·오류코드 완전 동일(F10 공용 구현부 호출).';

-- -----------------------------------------------------------------------------
-- E. wrapper 2 — qna_create_question_thread (웹 F3 과 동일 변환 계약)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_app_v1.qna_create_question_thread(
  p_room_id uuid,
  p_title text,
  p_subject text DEFAULT NULL,
  p_topic text DEFAULT NULL,
  p_first_message_body text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_res  jsonb;
  v_code text;
BEGIN
  v_res := public.qna_create_question_thread(p_room_id, p_title, p_subject, p_topic, p_first_message_body);
  RETURN v_res || jsonb_build_object('contract_version', 1);
EXCEPTION WHEN OTHERS THEN
  v_code := CASE SQLERRM
    WHEN 'FREE_QUESTION_EXPIRED'           THEN 'FREE_QUOTA_EXPIRED'
    WHEN 'FREE_QUESTION_TOTAL_LIMIT'       THEN 'FREE_QUOTA_TOTAL_EXHAUSTED'
    WHEN 'FREE_QUESTION_PER_MENTOR_LIMIT'  THEN 'FREE_QUOTA_MENTOR_EXHAUSTED'
    WHEN 'FREE_QUESTION_STUDENT_NOT_FOUND' THEN 'FREE_QUOTA_STUDENT_NOT_FOUND'
    WHEN 'AUTH_REQUIRED'                 THEN 'AUTH_REQUIRED'
    WHEN 'TITLE_REQUIRED'                THEN 'TITLE_REQUIRED'
    WHEN 'ROOM_NOT_FOUND'                THEN 'ROOM_NOT_FOUND'
    WHEN 'NOT_ROOM_PARTY'                THEN 'NOT_ROOM_PARTY'
    WHEN 'MENTOR_CANNOT_CREATE_THREAD'   THEN 'MENTOR_CANNOT_CREATE_THREAD'
    WHEN 'ACCOUNT_BANNED'                THEN 'ACCOUNT_BANNED'
    WHEN 'ACCOUNT_SUSPENDED'             THEN 'ACCOUNT_SUSPENDED'
    WHEN 'ACCOUNT_DELETION_IN_PROGRESS'  THEN 'ACCOUNT_DELETION_IN_PROGRESS'
    WHEN 'BLOCKED'                       THEN 'BLOCKED'
    WHEN 'MENTOR_NOT_APPROVED'           THEN 'MENTOR_NOT_APPROVED'
    WHEN 'SUBSCRIPTION_REFUND_PENDING'   THEN 'SUBSCRIPTION_REFUND_PENDING'
    WHEN 'WEEKLY_LIMIT_EXHAUSTED'        THEN 'WEEKLY_LIMIT_EXHAUSTED'
    WHEN 'FREE_QUOTA_EXPIRED'            THEN 'FREE_QUOTA_EXPIRED'
    WHEN 'FREE_QUOTA_TOTAL_EXHAUSTED'    THEN 'FREE_QUOTA_TOTAL_EXHAUSTED'
    WHEN 'FREE_QUOTA_MENTOR_EXHAUSTED'   THEN 'FREE_QUOTA_MENTOR_EXHAUSTED'
    ELSE NULL
  END;
  IF v_code IS NULL THEN
    -- 사전에 없는 예외는 삼키지 않고 그대로 전파(앱 계약 §3.3 envelope 규약)
    RAISE;
  END IF;
  RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', v_code);
END $fn$;

COMMENT ON FUNCTION api_app_v1.qna_create_question_thread(uuid, text, text, text, text) IS
  'S2 M17(앱 계약 §3.3): 정본 스레드 생성의 앱 wrapper — 웹 F3 과 동일한 raise→envelope 변환·FREE_QUESTION_* 수렴.';

-- -----------------------------------------------------------------------------
-- F. wrapper 3·4·5 — community_post_create/update/soft_delete (웹 F4·F5·F6 동일)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_app_v1.community_post_create(
  p_title text, p_body text, p_category text,
  p_idempotency_key uuid,
  p_image_refs text[] DEFAULT '{}', p_status text DEFAULT 'published'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  RETURN core_private.community_post_create_impl(
           v_uid, p_title, p_body, p_category,
           coalesce(p_image_refs, '{}'::text[]), p_status, p_idempotency_key)
         || jsonb_build_object('contract_version', 1);
END $fn$;

COMMENT ON FUNCTION api_app_v1.community_post_create(text, text, text, uuid, text[], text) IS
  'S2 M17(앱 계약 §3.3 — rev 8 A-1 재배열): 게시글 생성 앱 wrapper — 웹 F4 와 동일(B-1 공용 구현부·replay-first 멱등).';

CREATE FUNCTION api_app_v1.community_post_update(
  p_post_id uuid, p_title text, p_body text, p_category text,
  p_expected_updated_at timestamptz,
  p_image_refs text[] DEFAULT '{}', p_status text DEFAULT 'published'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  RETURN core_private.community_post_update_impl(
           v_uid, p_post_id, p_title, p_body, p_category,
           coalesce(p_image_refs, '{}'::text[]), p_status, p_expected_updated_at)
         || jsonb_build_object('contract_version', 1);
END $fn$;

COMMENT ON FUNCTION api_app_v1.community_post_update(uuid, text, text, text, timestamptz, text[], text) IS
  'S2 M17(앱 계약 §3.3 — rev 8 A-1 재배열): 게시글 수정 앱 wrapper — 웹 F5 와 동일(B-2 공용 구현부).';

CREATE FUNCTION api_app_v1.community_post_soft_delete(p_post_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  RETURN core_private.community_post_soft_delete_impl(v_uid, p_post_id)
         || jsonb_build_object('contract_version', 1);
END $fn$;

COMMENT ON FUNCTION api_app_v1.community_post_soft_delete(uuid) IS
  'S2 M17(앱 계약 §3.3): 게시글 soft-delete 앱 wrapper — 웹 F6 과 동일(B-3 공용 구현부·hard delete 금지).';

-- -----------------------------------------------------------------------------
-- G. GRANT (앱 계약 §3.2·§3.3 공통 권한 블록 원문 — authenticated 만)
-- -----------------------------------------------------------------------------
REVOKE ALL ON api_app_v1.community_posts_v1 FROM PUBLIC, anon;
GRANT SELECT ON api_app_v1.community_posts_v1 TO authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA api_app_v1 FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION api_app_v1.ensure_free_question_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION api_app_v1.qna_create_question_thread(uuid,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION api_app_v1.community_post_create(text,text,text,uuid,text[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION api_app_v1.community_post_update(uuid,text,text,text,timestamptz,text[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION api_app_v1.community_post_soft_delete(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- H. 적용 직후 자가 검증 (§20.3 「M17 적용 직후」 7항)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
  v_acl text;
BEGIN
  -- ①② schema + View 1종
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_app_v1')
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'api_app_v1') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'api_app_v1' AND c.relname = 'community_posts_v1'
                       AND c.relkind = 'v' AND c.reloptions::text LIKE '%security_invoker=true%') THEN
    RAISE EXCEPTION 'S2_M17_SELFCHECK: schema/view census mismatch';
  END IF;
  -- ③ wrapper 5종 identity argument 완전 일치 + SECDEF·search_path
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api_app_v1'
     AND p.prosecdef AND p.proconfig::text LIKE '%search_path=%'
     AND (p.proname, pg_get_function_identity_arguments(p.oid)) IN
         (('ensure_free_question_room', 'p_mentor_id uuid'),
          ('qna_create_question_thread', 'p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text'),
          ('community_post_create', 'p_title text, p_body text, p_category text, p_idempotency_key uuid, p_image_refs text[], p_status text'),
          ('community_post_update', 'p_post_id uuid, p_title text, p_body text, p_category text, p_expected_updated_at timestamp with time zone, p_image_refs text[], p_status text'),
          ('community_post_soft_delete', 'p_post_id uuid'));
  IF v_cnt <> 5 OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = 'api_app_v1') <> 5 THEN
    RAISE EXCEPTION 'S2_M17_SELFCHECK: wrapper identity mismatch (matched %)', v_cnt;
  END IF;
  -- ④ PUBLIC·anon 불필요 권한 0
  SELECT nspacl::text INTO v_acl FROM pg_namespace WHERE nspname = 'api_app_v1';
  IF v_acl LIKE '{=%' OR v_acl LIKE '%,=%' OR v_acl LIKE '%anon=%'
     OR has_schema_privilege('anon', 'api_app_v1', 'USAGE') THEN
    RAISE EXCEPTION 'S2_M17_SELFCHECK: PUBLIC/anon schema privilege leaked (%)', v_acl;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'api_app_v1'
                AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR p.proacl::text LIKE '{=%' OR p.proacl::text LIKE '%,=%'))
     OR has_table_privilege('anon', 'api_app_v1.community_posts_v1', 'SELECT') THEN
    RAISE EXCEPTION 'S2_M17_SELFCHECK: PUBLIC/anon object privilege leaked';
  END IF;
  -- ⑤ authenticated 최소 권한만 (USAGE + View SELECT + 함수 5 EXECUTE, DML 0)
  IF NOT has_schema_privilege('authenticated', 'api_app_v1', 'USAGE')
     OR NOT has_table_privilege('authenticated', 'api_app_v1.community_posts_v1', 'SELECT')
     OR has_table_privilege('authenticated', 'api_app_v1.community_posts_v1', 'INSERT')
     OR has_table_privilege('authenticated', 'api_app_v1.community_posts_v1', 'UPDATE')
     OR has_table_privilege('authenticated', 'api_app_v1.community_posts_v1', 'DELETE')
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'api_app_v1'
            AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) <> 5 THEN
    RAISE EXCEPTION 'S2_M17_SELFCHECK: authenticated minimal grant set mismatch';
  END IF;
  -- ⑥ core_private 구현부 복제 0 (M5+M7 의 5객체 그대로 공유)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core_private') <> 5 THEN
    RAISE EXCEPTION 'S2_M17_SELFCHECK: core_private duplication detected';
  END IF;
  -- ⑦ default privilege 방어 — PUBLIC 부여 항목 0 (PG17.6 저장 no-op 실측은 헤더 기록)
  IF (SELECT count(*) FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace
       WHERE n.nspname = 'api_app_v1'
         AND (d.defaclacl::text LIKE '{=%' OR d.defaclacl::text LIKE '%,=%')) > 0 THEN
    RAISE EXCEPTION 'S2_M17_SELFCHECK: default ACL grants PUBLIC';
  END IF;
END $$;

commit;
