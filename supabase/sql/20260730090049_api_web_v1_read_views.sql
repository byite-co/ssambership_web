-- =============================================================================
-- 20260730090049_api_web_v1_read_views.sql (S2 M4)
-- =============================================================================
-- api_web_v1 읽기 View 5종 (V1~V5) + view GRANT.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §6 V1~V5·§10.2·§20.2 M4·
--   §20.3 「M4 이전」.
--   - V1 community_posts_v1 / V2 community_comments_v1 / V4 my_wallet_v1 /
--     V5 my_cash_ledger_v1: security_invoker = true.
--   - V3 mentor_directory_v1: security_invoker = false — 계약이 승인한 유일한 예외
--     (§6 V3: 타인 users·mentor_profiles 행의 RLS 는 본인·admin 한정이라 invoker 로
--      성립 불가. 노출 조건이 view 정의에 하드코딩되고 읽기 전용이라는 것이 안전장치.
--      lint 의 security-definer view 경고는 계약된 의도적 예외로 분류한다).
--   - V2 는 M13 비정규화 정본 컬럼(comments.author_label·author_role)을 사용한다.
--   - V5 order_ref 는 ref_type='topup' 인 행의 idempotency_key 만 노출한다(rev 8 A-6).
--     idempotency_key 자체를 별도 필드로 노출하지 않는다.
--   - GRANT: V1·V2·V3 SELECT → anon·authenticated·service_role /
--            V4·V5 SELECT → authenticated·service_role (anon 0).
--     모든 View: PUBLIC 회수 선행, DML(INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
--     TRIGGER) 부여 0. V6·V7 은 RPC 로 M6 소유 — 여기서 생성 금지.
--   - Data API 설정 변경 0 (D-API-W 는 플랫폼 단계 — §20.6).
-- 선행조건: M1 + M13 (§20.2.1 — M4 : M1 + M13. V2 가 M13 비정규화 컬럼 참조).
-- rollback 정본: supabase/rollback/20260730090049_api_web_v1_read_views_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 (계약 §20.3 「M4 이전」 — M1·M13 적용 + PUBLIC 권한 0건 실측)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- M1 적용 확인
  IF (SELECT count(*) FROM pg_namespace WHERE nspname IN ('api_web_v1', 'core_private')) <> 2 THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: M1 schemas missing (M4 requires M1)';
  END IF;

  -- M1 경계 실측: 두 schema 에 PUBLIC 권한 0건
  IF EXISTS (
    SELECT 1
    FROM pg_namespace n, aclexplode(n.nspacl) a
    WHERE n.nspname IN ('api_web_v1', 'core_private') AND a.grantee = 0  -- 0 = PUBLIC
  ) THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: PUBLIC privilege found on api_web_v1/core_private';
  END IF;

  -- M13 적용 확인 (V2 가 정본 비정규화 컬럼을 참조)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'comments'
                   AND column_name = 'author_role') THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_role missing (M4 requires M13)';
  END IF;

  -- M4 소유 객체 선재 0 (부분 생성 상태 금지)
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'api_web_v1'
      AND c.relname IN ('community_posts_v1', 'community_comments_v1', 'mentor_directory_v1',
                        'my_wallet_v1', 'my_cash_ledger_v1')
  ) THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: api_web_v1 view(s) already present';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. V1 api_web_v1.community_posts_v1 (계약 §6 V1 — 앱 계약 §3.2 와 필드 동등)
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
  'S2 M4 V1(계약 §6): 게시판 목록·상세·내 글 — body=coalesce(content,body), image_refs=coalesce(image_urls,{}), deleted_at 필터 명시(XW-09), invoker.';

-- -----------------------------------------------------------------------------
-- C. V2 api_web_v1.community_comments_v1 (계약 §6 V2 — 정본 comments 만)
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
  'S2 M4 V2(계약 §6): 정본 comments 만 노출(레거시 community_comments 미사용) — M13 비정규화 라벨·역할, is_deleted=false, invoker.';

-- -----------------------------------------------------------------------------
-- D. V3 api_web_v1.mentor_directory_v1 (계약 §6 V3 — SECDEF 뷰, 의도된 유일 예외)
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
JOIN public.users u
  ON u.id = mp.user_id
 AND u.role = 'mentor'
 AND lower(coalesce(u.status, 'active')) = 'active'
LEFT JOIN LATERAL (
  -- 최신 승인 학교 검증 1건 — mentor_profiles_for_directory_v2 와 동일 정렬
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
  -- hidden/blinded 제외 평점·개수 (§6 V3 — mentor_profiles 에 해당 컬럼 없음, 실측)
  SELECT avg(r.rating)::numeric AS avg_rating, count(*)::integer AS review_count
  FROM public.reviews r
  WHERE r.mentor_id = mp.user_id
    AND coalesce(r.is_hidden, false) = false
    AND coalesce(r.is_blinded, false) = false
) rv ON true
WHERE lower(coalesce(mp.verification_status, '')) IN ('approved', 'verified', 'active');

COMMENT ON VIEW api_web_v1.mentor_directory_v1 IS
  'S2 M4 V3(계약 §6): 승인·활성 멘토 공개 디렉터리(XW-02b 해소) — security_invoker=false 는 계약이 승인한 유일한 의도적 예외. PII(full_name·email·birth_date) 비노출.';

-- -----------------------------------------------------------------------------
-- E. V4 api_web_v1.my_wallet_v1 (계약 §6 V4)
-- -----------------------------------------------------------------------------
CREATE VIEW api_web_v1.my_wallet_v1
WITH (security_invoker = true) AS
SELECT
  w.user_id,
  w.balance_cents,
  w.balance_cents / 100 AS balance_krw
FROM public.cash_wallets w;

COMMENT ON VIEW api_web_v1.my_wallet_v1 IS
  'S2 M4 V4(계약 §6): 자기 지갑 — balance_krw=balance_cents/100(1캐시=1원 잠금값), invoker(cwal_select 로 본인 행만).';

-- -----------------------------------------------------------------------------
-- F. V5 api_web_v1.my_cash_ledger_v1 (계약 §6 V5 — rev 8 A-6)
-- -----------------------------------------------------------------------------
CREATE VIEW api_web_v1.my_cash_ledger_v1
WITH (security_invoker = true) AS
SELECT
  l.id,
  l.delta_cents,
  l.delta_cents / 100 AS delta_krw,
  l.reason,
  l.ref_type,
  l.ref_id,
  CASE WHEN l.ref_type = 'topup' THEN l.idempotency_key END AS order_ref,
  l.created_at
FROM public.cash_ledger l;

COMMENT ON VIEW api_web_v1.my_cash_ledger_v1 IS
  'S2 M4 V5(계약 §6): 자기 캐시 원장 — order_ref 는 topup 행의 idempotency_key 만(그 외 NULL), 멱등키 전면 노출 컬럼 없음, invoker(cled_select 로 본인 행만).';

-- -----------------------------------------------------------------------------
-- G. GRANT (계약 §10.2 — PUBLIC 회수 선행, SELECT 만 부여, DML 0)
-- -----------------------------------------------------------------------------
REVOKE ALL ON api_web_v1.community_posts_v1,
              api_web_v1.community_comments_v1,
              api_web_v1.mentor_directory_v1,
              api_web_v1.my_wallet_v1,
              api_web_v1.my_cash_ledger_v1
FROM PUBLIC;

GRANT SELECT ON api_web_v1.community_posts_v1,
                api_web_v1.community_comments_v1,
                api_web_v1.mentor_directory_v1
TO anon, authenticated, service_role;

GRANT SELECT ON api_web_v1.my_wallet_v1,
                api_web_v1.my_cash_ledger_v1
TO authenticated, service_role;
-- V4·V5 는 anon 권한 0 (계약 §10.2).

commit;
