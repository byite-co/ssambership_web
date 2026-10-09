-- =============================================================================
-- 20260730095441_api_web_v1_read_views.sql (S2 M4)
-- =============================================================================
-- api_web_v1 읽기 View 5종 (V1~V5) + View GRANT.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §6 V1~V5 · §10.2 · §20.2 M4.
--   - V1 community_posts_v1  : invoker 뷰. body=coalesce(content,body) ·
--     image_refs=coalesce(image_urls,'{}') · deleted_at IS NULL ·
--     published 또는 본인 글만(XW-09 해소 — view 가 deleted_at 필터를 명시).
--   - V2 community_comments_v1: invoker 뷰. 원천은 정본 public.comments 만
--     (레거시 community_comments 는 읽지 않는다). body=content ·
--     is_deleted=false · 라벨은 M13 비정규화 컬럼(author_label·author_role).
--   - V3 mentor_directory_v1 : security_invoker=false — 계약이 승인한 유일한
--     의도적 예외(§6 V3 — 타인 users·mentor_profiles 행은 RLS 상 본인·admin 만
--     읽을 수 있어 invoker 로 성립 불가. 노출 조건이 view 정의에 하드코딩되고
--     읽기 전용이라는 것이 안전장치). lint 의 security-definer view 경고는
--     계약된 의도적 예외로 분류한다 — 경고 해소 목적의 invoker 전환 금지.
--     · 노출 조건(모두 AND): users.role='mentor' ·
--       lower(coalesce(users.status,'active'))='active' ·
--       lower(coalesce(verification_status,'')) IN ('approved','verified','active')
--       (individual_question_user_is_approved_mentor 와 동일 판정식 — 실측 대조).
--     · nickname = users.nickname 만. full_name·email·birth_date 비노출(PII 0).
--     · 학교 인증 4필드: mentor_school_verifications status='approved' 최신 1건을
--       LEFT JOIN LATERAL — 정렬은 기존 mentor_profiles_for_directory_v2 와 동일
--       (coalesce(reviewed_at, updated_at, created_at) DESC, created_at DESC).
--     · avg_rating/review_count 는 reviews 실계산 — coalesce(is_hidden,false)=false
--       AND coalesce(is_blinded,false)=false 행만(hidden/blinded 제외).
--       (mentor_profiles 에는 avg_rating·review_count 컬럼이 없음 — 실측 §3.7 #7.)
--   - V4 my_wallet_v1 : invoker 뷰. balance_krw = balance_cents / 100 (1캐시=1원).
--   - V5 my_cash_ledger_v1: invoker 뷰. order_ref 는 ref_type='topup' 행의
--     idempotency_key 만(CASE 한정 — rev 8 A-6). idempotency_key 자체를 별도
--     필드로 전행 노출하지 않는다.
--   - GRANT(§10.2): V1·V2·V3 SELECT → anon·authenticated·service_role /
--     V4·V5 SELECT → authenticated·service_role (anon 0).
--     전 View: PUBLIC 회수 선행 · INSERT/UPDATE/DELETE 등 DML 은 어떤 역할에도 0.
--   - V6·V7 은 여기서 만들지 않는다(범위 제한 SECDEF RPC — M6 소유).
--   - Data API 설정 변경 없음(D-API-W 는 별도 플랫폼 단계 — §20.6).
-- 선행조건: M1(20260730095435) + M13(20260730095438) 적용 완료(§20.2.1 — M4 : M1+M13).
-- rollback 정본: supabase/rollback/20260730095441_api_web_v1_read_views_rollback.sql
--   (View 5종만 역순 DROP — schema 는 M1 rollback 소유 · CASCADE 금지)
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 (§20.3 「M4 이전」 — M1·M13 적용 + PUBLIC 권한 0건 + 기반 매핑 실측)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_acl text;
  v_missing text;
BEGIN
  -- M1 적용 확인: schema 2종 + PUBLIC 권한 0건 실측
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_web_v1')
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core_private') THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: M1 schemas not applied';
  END IF;
  SELECT nspacl::text INTO v_acl FROM pg_namespace WHERE nspname = 'api_web_v1';
  IF v_acl LIKE '{=%' OR v_acl LIKE '%,=%' THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: api_web_v1 has PUBLIC acl entry';
  END IF;
  SELECT nspacl::text INTO v_acl FROM pg_namespace WHERE nspname = 'core_private';
  IF v_acl LIKE '{=%' OR v_acl LIKE '%,=%'
     OR has_schema_privilege('anon', 'core_private', 'USAGE')
     OR has_schema_privilege('authenticated', 'core_private', 'USAGE')
     OR has_schema_privilege('service_role', 'core_private', 'USAGE') THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: core_private boundary violated';
  END IF;
  -- M13 적용 확인 (V2 가 author_role 비정규화 컬럼을 참조)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'comments'
                    AND column_name = 'author_role') THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: M13 comments.author_role not applied';
  END IF;
  -- V1~V5 가 참조하는 기반 컬럼 전수 실측 — 불일치는 추정하지 않고 중단(V3 매핑 게이트)
  SELECT string_agg(m.col, ', ') INTO v_missing FROM (
    SELECT t.tbl || '.' || t.col AS col
      FROM (VALUES
        ('community_posts','id'), ('community_posts','author_id'), ('community_posts','title'),
        ('community_posts','body'), ('community_posts','content'), ('community_posts','category'),
        ('community_posts','image_urls'), ('community_posts','author_label'),
        ('community_posts','author_role'), ('community_posts','like_count'),
        ('community_posts','comment_count'), ('community_posts','view_count'),
        ('community_posts','status'), ('community_posts','created_at'),
        ('community_posts','updated_at'), ('community_posts','deleted_at'),
        ('comments','id'), ('comments','post_id'), ('comments','author_id'),
        ('comments','parent_id'), ('comments','content'), ('comments','like_count'),
        ('comments','author_label'), ('comments','author_role'), ('comments','is_deleted'),
        ('comments','created_at'),
        ('users','id'), ('users','role'), ('users','status'), ('users','nickname'),
        ('mentor_profiles','user_id'), ('mentor_profiles','university_name'),
        ('mentor_profiles','department_name'), ('mentor_profiles','teaching_subjects'),
        ('mentor_profiles','intro_line'), ('mentor_profiles','profile_image_url'),
        ('mentor_profiles','high_school_name'), ('mentor_profiles','is_open_for_subscriptions'),
        ('mentor_profiles','verification_status'), ('mentor_profiles','created_at'),
        ('mentor_school_verifications','mentor_id'), ('mentor_school_verifications','status'),
        ('mentor_school_verifications','school_tier'),
        ('mentor_school_verifications','verified_major_category'),
        ('mentor_school_verifications','verified_university_name'),
        ('mentor_school_verifications','verified_department_name'),
        ('mentor_school_verifications','reviewed_at'), ('mentor_school_verifications','updated_at'),
        ('mentor_school_verifications','created_at'),
        ('reviews','mentor_id'), ('reviews','rating'), ('reviews','is_hidden'), ('reviews','is_blinded'),
        ('cash_wallets','user_id'), ('cash_wallets','balance_cents'),
        ('cash_ledger','id'), ('cash_ledger','delta_cents'), ('cash_ledger','reason'),
        ('cash_ledger','ref_type'), ('cash_ledger','ref_id'), ('cash_ledger','idempotency_key'),
        ('cash_ledger','created_at')
      ) AS t(tbl, col)
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                        WHERE ic.table_schema = 'public'
                          AND ic.table_name = t.tbl AND ic.column_name = t.col)
  ) m;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: base columns missing — %', v_missing;
  END IF;
  -- View 5종 선재 금지 + api_web_v1 는 비어 있어야 한다(부분 생성 은닉 금지)
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'api_web_v1') > 0 THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: api_web_v1 is not empty before M4';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. V1 api_web_v1.community_posts_v1 (invoker)
-- -----------------------------------------------------------------------------
CREATE VIEW api_web_v1.community_posts_v1
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

COMMENT ON VIEW api_web_v1.community_posts_v1 IS
  'S2 M4 V1(계약 §6): 게시판 읽기 — body=coalesce(content,body) · image_refs=coalesce(image_urls,{}) · deleted_at IS NULL · published 또는 본인 글. security_invoker=true.';

-- -----------------------------------------------------------------------------
-- C. V2 api_web_v1.community_comments_v1 (invoker · 원천 = 정본 comments 만)
-- -----------------------------------------------------------------------------
CREATE VIEW api_web_v1.community_comments_v1
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.post_id,
  c.author_id,
  c.parent_id,
  c.content AS body,
  c.like_count,
  c.author_label,
  c.author_role,
  c.created_at
FROM public.comments c
WHERE c.is_deleted = false;

COMMENT ON VIEW api_web_v1.community_comments_v1 IS
  'S2 M4 V2(계약 §6): 정본 comments 단일 원천 — body=content · is_deleted=false · 라벨은 M13 비정규화 컬럼. security_invoker=true.';

-- -----------------------------------------------------------------------------
-- D. V3 api_web_v1.mentor_directory_v1 (security_invoker=false — 계약된 유일 예외)
-- -----------------------------------------------------------------------------
CREATE VIEW api_web_v1.mentor_directory_v1
WITH (security_invoker = false) AS
SELECT
  mp.user_id                       AS mentor_id,
  u.nickname,
  mp.university_name,
  mp.department_name,
  mp.teaching_subjects,
  mp.intro_line,
  mp.profile_image_url,
  mp.high_school_name,
  (sv.mentor_id IS NOT NULL)       AS school_verified,
  sv.school_tier,
  sv.verified_major_category,
  sv.verified_university_name,
  sv.verified_department_name,
  mp.is_open_for_subscriptions,
  rv.avg_rating,
  rv.review_count,
  mp.created_at
FROM public.mentor_profiles mp
JOIN public.users u ON u.id = mp.user_id
LEFT JOIN LATERAL (
  SELECT
    msv.mentor_id,
    msv.school_tier,
    msv.verified_major_category,
    msv.verified_university_name,
    msv.verified_department_name
  FROM public.mentor_school_verifications msv
  WHERE msv.mentor_id = mp.user_id
    AND msv.status = 'approved'
  ORDER BY coalesce(msv.reviewed_at, msv.updated_at, msv.created_at) DESC, msv.created_at DESC
  LIMIT 1
) sv ON true
LEFT JOIN LATERAL (
  SELECT
    avg(r.rating)::numeric AS avg_rating,
    count(*)::integer      AS review_count
  FROM public.reviews r
  WHERE r.mentor_id = mp.user_id
    AND coalesce(r.is_hidden, false) = false
    AND coalesce(r.is_blinded, false) = false
) rv ON true
WHERE u.role = 'mentor'
  AND lower(coalesce(u.status, 'active')) = 'active'
  AND lower(coalesce(mp.verification_status, '')) IN ('approved', 'verified', 'active');

COMMENT ON VIEW api_web_v1.mentor_directory_v1 IS
  'S2 M4 V3(계약 §6 — 의도적 SECDEF 예외): 승인·활성 멘토만 공개(XW-02b 해소). PII 0(nickname 만). 노출 조건이 정의에 하드코딩된 읽기 전용 view.';

-- -----------------------------------------------------------------------------
-- E. V4 api_web_v1.my_wallet_v1 (invoker — cwal_select 가 본인 행만 남긴다)
-- -----------------------------------------------------------------------------
CREATE VIEW api_web_v1.my_wallet_v1
WITH (security_invoker = true) AS
SELECT
  w.user_id,
  w.balance_cents,
  (w.balance_cents / 100) AS balance_krw
FROM public.cash_wallets w;

COMMENT ON VIEW api_web_v1.my_wallet_v1 IS
  'S2 M4 V4(계약 §6): 자기 지갑 — balance_krw = balance_cents/100 (1캐시=1원). security_invoker=true.';

-- -----------------------------------------------------------------------------
-- F. V5 api_web_v1.my_cash_ledger_v1 (invoker — cled_select 가 본인 행만 남긴다)
-- -----------------------------------------------------------------------------
CREATE VIEW api_web_v1.my_cash_ledger_v1
WITH (security_invoker = true) AS
SELECT
  l.id,
  l.delta_cents,
  (l.delta_cents / 100) AS delta_krw,
  l.reason,
  l.ref_type,
  l.ref_id,
  CASE WHEN l.ref_type = 'topup' THEN l.idempotency_key END AS order_ref,
  l.created_at
FROM public.cash_ledger l;

COMMENT ON VIEW api_web_v1.my_cash_ledger_v1 IS
  'S2 M4 V5(계약 §6): 자기 캐시 원장 — order_ref 는 topup 행의 idempotency_key 만(CASE 한정, rev 8 A-6). security_invoker=true.';

-- -----------------------------------------------------------------------------
-- G. GRANT (§10.2 — PUBLIC 회수 선행 · SELECT 만 · DML 0)
-- -----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA api_web_v1 FROM PUBLIC;
GRANT SELECT ON api_web_v1.community_posts_v1,
               api_web_v1.community_comments_v1,
               api_web_v1.mentor_directory_v1        TO anon, authenticated, service_role;
GRANT SELECT ON api_web_v1.my_wallet_v1,
               api_web_v1.my_cash_ledger_v1          TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- H. 적용 직후 자가 검증 (view 5종 · 옵션 · GRANT 매트릭스 · PII 비노출)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
  v_bad text;
BEGIN
  -- 정확히 view 5종만 존재 (함수 0 · 테이블 0)
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'api_web_v1';
  IF v_cnt <> 5 OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'api_web_v1' AND c.relkind <> 'v') > 0 THEN
    RAISE EXCEPTION 'S2_M4_SELFCHECK: api_web_v1 must contain exactly 5 views (found %)', v_cnt;
  END IF;
  -- security_invoker 옵션: V1·V2·V4·V5 = true / V3 = 의도적 예외(false)
  SELECT count(*) INTO v_cnt FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'api_web_v1'
     AND c.relname IN ('community_posts_v1', 'community_comments_v1', 'my_wallet_v1', 'my_cash_ledger_v1')
     AND c.reloptions::text LIKE '%security_invoker=true%';
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'S2_M4_SELFCHECK: invoker views expected 4, matched %', v_cnt;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'api_web_v1' AND c.relname = 'mentor_directory_v1'
                AND c.reloptions::text LIKE '%security_invoker=true%') THEN
    RAISE EXCEPTION 'S2_M4_SELFCHECK: mentor_directory_v1 must be the contracted SECDEF exception';
  END IF;
  -- GRANT 매트릭스: anon 은 V1~V3 SELECT 만, V4·V5 는 권한 0
  IF NOT (has_table_privilege('anon', 'api_web_v1.community_posts_v1', 'SELECT')
          AND has_table_privilege('anon', 'api_web_v1.community_comments_v1', 'SELECT')
          AND has_table_privilege('anon', 'api_web_v1.mentor_directory_v1', 'SELECT'))
     OR has_table_privilege('anon', 'api_web_v1.my_wallet_v1', 'SELECT')
     OR has_table_privilege('anon', 'api_web_v1.my_cash_ledger_v1', 'SELECT') THEN
    RAISE EXCEPTION 'S2_M4_SELFCHECK: anon grant matrix mismatch';
  END IF;
  SELECT string_agg(v.relname, ', ') INTO v_bad
    FROM pg_class v JOIN pg_namespace n ON n.oid = v.relnamespace
   WHERE n.nspname = 'api_web_v1'
     AND NOT (has_table_privilege('authenticated', v.oid, 'SELECT')
              AND has_table_privilege('service_role', v.oid, 'SELECT'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'S2_M4_SELFCHECK: authenticated/service_role SELECT missing on %', v_bad;
  END IF;
  -- DML 0: 세 역할 모두 INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER 부재 + PUBLIC 항목 0
  SELECT string_agg(DISTINCT v.relname, ', ') INTO v_bad
    FROM pg_class v JOIN pg_namespace n ON n.oid = v.relnamespace,
         unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role),
         unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(priv)
   WHERE n.nspname = 'api_web_v1' AND has_table_privilege(r.role, v.oid, p.priv);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'S2_M4_SELFCHECK: DML privilege leaked on %', v_bad;
  END IF;
  SELECT string_agg(v.relname, ', ') INTO v_bad
    FROM pg_class v JOIN pg_namespace n ON n.oid = v.relnamespace
   WHERE n.nspname = 'api_web_v1'
     AND (v.relacl::text LIKE '{=%' OR v.relacl::text LIKE '%,=%');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'S2_M4_SELFCHECK: PUBLIC acl entry on %', v_bad;
  END IF;
  -- PII 비노출: V3 정의에 full_name·email·birth_date·grade_level 부재
  IF pg_get_viewdef('api_web_v1.mentor_directory_v1'::regclass) ~* '(full_name|email|birth_date|grade_level)' THEN
    RAISE EXCEPTION 'S2_M4_SELFCHECK: mentor_directory_v1 references PII columns';
  END IF;
  -- V5: idempotency_key 를 별도 필드로 노출하지 않는다(order_ref CASE 한정)
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'api_web_v1' AND table_name = 'my_cash_ledger_v1'
                AND column_name = 'idempotency_key') THEN
    RAISE EXCEPTION 'S2_M4_SELFCHECK: my_cash_ledger_v1 must not expose idempotency_key column';
  END IF;
END $$;

commit;
