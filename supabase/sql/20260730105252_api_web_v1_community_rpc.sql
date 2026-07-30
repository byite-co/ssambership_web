-- =============================================================================
-- 20260730105252_api_web_v1_community_rpc.sql (S2 M7)
-- =============================================================================
-- 커뮤니티 글 쓰기 — 공용 구현부 B-1~B-4(core_private) + 웹 wrapper F4·F5·F6.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §7 F4·F5·F6(B-1~B-4) ·
--   §9.4(오류코드 — 앱 계약 §6.4 와 동일 집합) · §14.3(이미지 5종 검증) ·
--   §14.4(멱등 replay-first — 재호출 선행·보상 삭제 후행) · §10.3(GRANT) /
--   앱 계약 §6.1~§6.5(웹·앱 동등 — 동일 공용 구현부 공유).
--   - 작성 자격(rev 8 A-10): F4 create 는 승인 멘토 전용 — users.role='mentor'
--     (위반 ROLE_NOT_MENTOR) + individual_question_user_is_approved_mentor
--     (미승인 MENTOR_NOT_APPROVED). 관리자도 일반 작성 경로에서는 거부.
--     F5 는 작성자 본인 기준 + 학생 글 수정 거부(ROLE_NOT_MENTOR).
--     F6 soft-delete 는 작성자 본인이면 역할 무관 허용(기존 학생 글 보존 규칙).
--   - 멱등(replay-first — §7 F4 4단계): auth 결합 직후, 신규 쓰기 검증보다 먼저
--     (author_id, create_idempotency_key) 기존 커밋 행을 조회해 있으면 즉시
--     idempotent_replay:true 재생 반환(현재 시점 재검증에 좌우되지 않음).
--     근거 = community_posts_author_idem_key UNIQUE INDEX 실측.
--   - 본문 검증(rev 8 D — B-04 동결): 연락처 마스킹만 수행. 금지어 검사 폐지 —
--     POLICY_RESTRICTED 는 예약 코드이며 발생하지 않는다. 마스킹 규칙은 웹 정본
--     lib/customRequest/contactMasking.ts 를 문자 그대로 이식했다(전화/한글전화/
--     난독화 이메일/이메일/메신저 링크/메신저 핸들 — 적용 순서 동일). 제목·본문
--     모두 마스킹한다(웹 communityBoardActions 실측 동작 동일).
--   - 이미지 ref 검증(B-4 — §14.3 5종): 허용 버킷 / path 첫 세그먼트 = 소유자 /
--     storage.objects 실존 / 소유자·MIME·크기 일치 / 개수 ≤ 5.
--   - INSERT 컬럼은 현행 웹 insertCommunityBoardPost 와 동일(body=content 병기,
--     hashtags '{}', author_label·author_role 서버 도출 — 클라이언트 author_* 불수신).
--     라벨 규칙 = §7 F0 승계(nickname → 비면 '쌤버십 사용자', student/mentor 외 NULL).
--   - 보안: 구현부 4종은 SECURITY INVOKER + SET search_path='' + 완전 수식 +
--     외부 EXECUTE 0(§10.3 — SECDEF wrapper 의 소유자 권한 문맥에서만 실행).
--     wrapper 3종은 SECURITY DEFINER + SET search_path=''.
-- 선행조건: M1(20260730095435) 적용 완료(§20.2.1 — M7 : M1).
-- rollback 정본: supabase/rollback/20260730105252_api_web_v1_community_rpc_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'api_web_v1')
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core_private') THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: M1 schemas not applied';
  END IF;
  -- 기반 컬럼 실측 (community_posts — 현행 웹 insert 컬럼 집합)
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'community_posts'
         AND column_name IN ('id','author_id','title','body','content','category','image_urls','hashtags',
                             'status','author_label','author_role','create_idempotency_key',
                             'deleted_at','updated_at')) <> 14 THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: community_posts columns mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                  AND indexname = 'community_posts_author_idem_key') THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: community_posts_author_idem_key missing';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('individual_question_user_is_approved_mentor', 'account_deletion_write_blocked')) <> 2 THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: canonical helper functions missing';
  END IF;
  -- 대상 선재 금지
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE (n.nspname = 'core_private'
                     AND p.proname IN ('community_post_create_impl','community_post_update_impl',
                                       'community_post_soft_delete_impl','community_image_refs_validate'))
                 OR (n.nspname = 'api_web_v1'
                     AND p.proname IN ('community_post_create','community_post_update','community_post_soft_delete'))) THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: M7 target functions already exist';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. B-4 core_private.community_image_refs_validate — 공용 이미지 ref 검증기 (§14.3)
-- -----------------------------------------------------------------------------
CREATE FUNCTION core_private.community_image_refs_validate(
  p_owner_id uuid, p_image_refs text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
  v_refs  text[] := coalesce(p_image_refs, '{}'::text[]);
  v_ref   text;
  v_path  text;
  v_meta  jsonb;
  v_owner uuid;
BEGIN
  IF p_owner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  END IF;
  IF coalesce(array_length(v_refs, 1), 0) > 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_COUNT_EXCEEDED');
  END IF;
  FOREACH v_ref IN ARRAY v_refs LOOP
    -- ① 허용 버킷 (정본 ref 형식: community-post-images/{uid}/{object} — §14.1)
    IF v_ref IS NULL OR v_ref !~ '^community-post-images/' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_REF_INVALID');
    END IF;
    v_path := substring(v_ref FROM char_length('community-post-images/') + 1);
    IF split_part(v_path, '/', 2) = '' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_REF_INVALID');
    END IF;
    -- ② path 첫 세그먼트 = 소유자
    IF split_part(v_path, '/', 1) IS DISTINCT FROM p_owner_id::text THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_NOT_OWNED');
    END IF;
    -- ③ storage.objects 실존
    SELECT o.metadata, coalesce(o.owner, nullif(o.owner_id, '')::uuid)
      INTO v_meta, v_owner
      FROM storage.objects o
     WHERE o.bucket_id = 'community-post-images' AND o.name = v_path;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_OBJECT_NOT_FOUND');
    END IF;
    -- ④ 소유자·MIME·크기 (버킷 정책 실측값 — 5 MiB · 4종 MIME)
    IF v_owner IS DISTINCT FROM p_owner_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_NOT_OWNED');
    END IF;
    IF coalesce(v_meta ->> 'mimetype', '')
       NOT IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_MIME_NOT_ALLOWED');
    END IF;
    IF coalesce((v_meta ->> 'size')::bigint, 0) > 5242880 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_SIZE_EXCEEDED');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END $fn$;

COMMENT ON FUNCTION core_private.community_image_refs_validate(uuid, text[]) IS
  'S2 M7 B-4(계약 §7): 커뮤니티 이미지 ref 공용 검증기(§14.3 5종). 외부 EXECUTE 0.';

-- -----------------------------------------------------------------------------
-- C. B-1 core_private.community_post_create_impl (replay-first — §7 F4)
-- -----------------------------------------------------------------------------
CREATE FUNCTION core_private.community_post_create_impl(
  p_author_id uuid, p_title text, p_body text, p_category text,
  p_image_refs text[], p_status text, p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
  v_role     text;
  v_status   text;
  v_susp     timestamptz;
  v_nickname text;
  v_title    text;
  v_body     text;
  v_val      jsonb;
  v_id       uuid;
BEGIN
  IF p_author_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  END IF;
  -- 멱등키 필수(§14.4) — 계약 밖 입력은 전파(§8.2)
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'p_idempotency_key is required';
  END IF;

  -- [replay-first — 신규 쓰기 검증보다 먼저] 기존 커밋 행 재생 (§7 F4 1~2단계)
  SELECT cp.id INTO v_id FROM public.community_posts cp
   WHERE cp.author_id = p_author_id AND cp.create_idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'post_id', v_id, 'idempotent_replay', true);
  END IF;

  -- [신규 쓰기 검증 — 역할 → 승인 → 계정 → 본문 → 이미지 (§7 F4 3단계)]
  SELECT u.role, u.status, u.suspended_until, u.nickname
    INTO v_role, v_status, v_susp, v_nickname
    FROM public.users u WHERE u.id = p_author_id;
  IF NOT FOUND OR v_role IS DISTINCT FROM 'mentor' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROLE_NOT_MENTOR');
  END IF;
  IF NOT public.individual_question_user_is_approved_mentor(p_author_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MENTOR_NOT_APPROVED');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'suspended' AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_SUSPENDED');
  END IF;
  IF public.account_deletion_write_blocked(p_author_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  END IF;
  IF p_status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'p_status must be draft|published';
  END IF;
  v_title := btrim(coalesce(p_title, ''));
  IF v_title = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TITLE_REQUIRED');
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('study', 'school', 'career', 'college', 'free') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CATEGORY_INVALID');
  END IF;
  v_body := btrim(coalesce(p_body, ''));
  IF p_status = 'published' AND char_length(v_body) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BODY_TOO_SHORT');
  END IF;

  -- [연락처 마스킹 — lib/customRequest/contactMasking.ts 정본 이식, 적용 순서 동일.
  --  제목·본문 모두 마스킹(웹 실측 동작). 금지어 검사 없음(rev 8 D — B-04 동결)]
  v_title := regexp_replace(v_title, '(^|[^0-9])(\+82[-._\s]?0?1[0-9][-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4}|0(?:10|11|16|17|18|19|2|[3-6][1-5]|50|70|80)[-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4})(?![0-9])', '\1[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(^|[^0-9])(\+82[-._\s]?0?1[0-9][-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4}|0(?:10|11|16|17|18|19|2|[3-6][1-5]|50|70|80)[-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4})(?![0-9])', '\1[연락처 비공개]', 'g');
  v_title := regexp_replace(v_title, '(공일공|영일영)[\s\-._]*[0-9공영일이삼사오육칠팔구][0-9공영일이삼사오육칠팔구\s\-._]{6,12}', '[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(공일공|영일영)[\s\-._]*[0-9공영일이삼사오육칠팔구][0-9공영일이삼사오육칠팔구\s\-._]{6,12}', '[연락처 비공개]', 'g');
  v_title := regexp_replace(v_title, '[A-Za-z0-9._%+-]+\s*[\[({（]\s*at\s*[\])}）]\s*[A-Za-z0-9.-]+\s*(?:[\[({（]\s*dot\s*[\])}）]|\.)\s*[A-Za-z]{2,}', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '[A-Za-z0-9._%+-]+\s*[\[({（]\s*at\s*[\])}）]\s*[A-Za-z0-9.-]+\s*(?:[\[({（]\s*dot\s*[\])}）]|\.)\s*[A-Za-z]{2,}', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '\y(?:open\.kakao\.com|kakaotalk\.com|t\.me|telegram\.me|instagram\.com|instagr\.am|linktr\.ee)(?:/[^\s<>"'']*)?', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '\y(?:open\.kakao\.com|kakaotalk\.com|t\.me|telegram\.me|instagram\.com|instagr\.am|linktr\.ee)(?:/[^\s<>"'']*)?', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '(카카오톡|카톡|오픈채팅|텔레그램|인스타그램|인스타|디엠)\s*[:：=]?\s*@?[A-Za-z0-9._-]{4,}', '[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(카카오톡|카톡|오픈채팅|텔레그램|인스타그램|인스타|디엠)\s*[:：=]?\s*@?[A-Za-z0-9._-]{4,}', '[연락처 비공개]', 'g');

  -- 이미지 ref 검증 (B-4 공용 검증기)
  v_val := core_private.community_image_refs_validate(p_author_id, coalesce(p_image_refs, '{}'::text[]));
  IF NOT coalesce((v_val ->> 'ok')::boolean, false) THEN
    RETURN v_val;
  END IF;

  -- INSERT (컬럼 집합 = 현행 웹 insertCommunityBoardPost 동일. author_label/role 서버 도출)
  INSERT INTO public.community_posts
    (author_id, title, body, content, category, image_urls, hashtags, status,
     author_label, author_role, create_idempotency_key)
  VALUES
    (p_author_id, v_title, v_body, v_body, p_category,
     coalesce(p_image_refs, '{}'::text[]), '{}'::text[], p_status,
     coalesce(nullif(btrim(v_nickname), ''), '쌤버십 사용자'),
     CASE WHEN v_role IN ('student', 'mentor') THEN v_role END,
     p_idempotency_key)
  ON CONFLICT (author_id, create_idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  -- 동시 경합 패자 → 재생 수렴 (T-CONC-06)
  IF v_id IS NULL THEN
    SELECT cp.id INTO v_id FROM public.community_posts cp
     WHERE cp.author_id = p_author_id AND cp.create_idempotency_key = p_idempotency_key;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'community_post_create_impl: idempotent insert not observable';
    END IF;
    RETURN jsonb_build_object('ok', true, 'post_id', v_id, 'idempotent_replay', true);
  END IF;

  RETURN jsonb_build_object('ok', true, 'post_id', v_id, 'idempotent_replay', false);
END $fn$;

COMMENT ON FUNCTION core_private.community_post_create_impl(uuid, text, text, text, text[], text, uuid) IS
  'S2 M7 B-1(계약 §7): 게시글 생성 공용 구현부 — replay-first 멱등·승인 멘토 전용·마스킹·B-4 이미지 검증. 외부 EXECUTE 0.';

-- -----------------------------------------------------------------------------
-- D. B-2 core_private.community_post_update_impl (§7 F5)
-- -----------------------------------------------------------------------------
CREATE FUNCTION core_private.community_post_update_impl(
  p_author_id uuid, p_post_id uuid, p_title text, p_body text, p_category text,
  p_image_refs text[], p_status text, p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
  v_role       text;
  v_status     text;
  v_susp       timestamptz;
  v_post       record;
  v_title      text;
  v_body       text;
  v_val        jsonb;
  v_removed    text[];
  v_updated_at timestamptz;
BEGIN
  IF p_author_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  END IF;
  IF p_post_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'POST_NOT_FOUND_OR_NOT_OWNED');
  END IF;

  -- 소유 행 잠금 (비존재·타인 글·삭제 글 동일 코드 — §9.4)
  SELECT cp.id, cp.image_urls, cp.updated_at INTO v_post
    FROM public.community_posts cp
   WHERE cp.id = p_post_id AND cp.author_id = p_author_id AND cp.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'POST_NOT_FOUND_OR_NOT_OWNED');
  END IF;

  -- 역할·승인·계정 (학생 글 보존 규칙 — 학생은 수정 거부 ROLE_NOT_MENTOR)
  SELECT u.role, u.status, u.suspended_until INTO v_role, v_status, v_susp
    FROM public.users u WHERE u.id = p_author_id;
  IF NOT FOUND OR v_role IS DISTINCT FROM 'mentor' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROLE_NOT_MENTOR');
  END IF;
  IF NOT public.individual_question_user_is_approved_mentor(p_author_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MENTOR_NOT_APPROVED');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'suspended' AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_SUSPENDED');
  END IF;
  IF public.account_deletion_write_blocked(p_author_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  END IF;

  -- 낙관적 충돌 검사 (§7 F5)
  IF v_post.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UPDATE_CONFLICT');
  END IF;

  IF p_status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'p_status must be draft|published';
  END IF;
  v_title := btrim(coalesce(p_title, ''));
  IF v_title = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TITLE_REQUIRED');
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('study', 'school', 'career', 'college', 'free') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CATEGORY_INVALID');
  END IF;
  v_body := btrim(coalesce(p_body, ''));
  IF p_status = 'published' AND char_length(v_body) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BODY_TOO_SHORT');
  END IF;

  -- [연락처 마스킹 — B-1 과 동일 정본 이식(contactMasking.ts) · 동일 순서]
  v_title := regexp_replace(v_title, '(^|[^0-9])(\+82[-._\s]?0?1[0-9][-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4}|0(?:10|11|16|17|18|19|2|[3-6][1-5]|50|70|80)[-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4})(?![0-9])', '\1[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(^|[^0-9])(\+82[-._\s]?0?1[0-9][-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4}|0(?:10|11|16|17|18|19|2|[3-6][1-5]|50|70|80)[-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4})(?![0-9])', '\1[연락처 비공개]', 'g');
  v_title := regexp_replace(v_title, '(공일공|영일영)[\s\-._]*[0-9공영일이삼사오육칠팔구][0-9공영일이삼사오육칠팔구\s\-._]{6,12}', '[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(공일공|영일영)[\s\-._]*[0-9공영일이삼사오육칠팔구][0-9공영일이삼사오육칠팔구\s\-._]{6,12}', '[연락처 비공개]', 'g');
  v_title := regexp_replace(v_title, '[A-Za-z0-9._%+-]+\s*[\[({（]\s*at\s*[\])}）]\s*[A-Za-z0-9.-]+\s*(?:[\[({（]\s*dot\s*[\])}）]|\.)\s*[A-Za-z]{2,}', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '[A-Za-z0-9._%+-]+\s*[\[({（]\s*at\s*[\])}）]\s*[A-Za-z0-9.-]+\s*(?:[\[({（]\s*dot\s*[\])}）]|\.)\s*[A-Za-z]{2,}', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '\y(?:open\.kakao\.com|kakaotalk\.com|t\.me|telegram\.me|instagram\.com|instagr\.am|linktr\.ee)(?:/[^\s<>"'']*)?', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '\y(?:open\.kakao\.com|kakaotalk\.com|t\.me|telegram\.me|instagram\.com|instagr\.am|linktr\.ee)(?:/[^\s<>"'']*)?', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '(카카오톡|카톡|오픈채팅|텔레그램|인스타그램|인스타|디엠)\s*[:：=]?\s*@?[A-Za-z0-9._-]{4,}', '[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(카카오톡|카톡|오픈채팅|텔레그램|인스타그램|인스타|디엠)\s*[:：=]?\s*@?[A-Za-z0-9._-]{4,}', '[연락처 비공개]', 'g');

  v_val := core_private.community_image_refs_validate(p_author_id, coalesce(p_image_refs, '{}'::text[]));
  IF NOT coalesce((v_val ->> 'ok')::boolean, false) THEN
    RETURN v_val;
  END IF;

  -- 제거된 ref 차집합 (클라이언트가 commit 후 best-effort 삭제 — §14.4)
  v_removed := ARRAY(SELECT unnest(coalesce(v_post.image_urls, '{}'::text[]))
                     EXCEPT
                     SELECT unnest(coalesce(p_image_refs, '{}'::text[])));

  UPDATE public.community_posts cp
     SET title = v_title, body = v_body, content = v_body, category = p_category,
         image_urls = coalesce(p_image_refs, '{}'::text[]), status = p_status,
         updated_at = now()
   WHERE cp.id = p_post_id
   RETURNING cp.updated_at INTO v_updated_at;

  RETURN jsonb_build_object('ok', true, 'post_id', p_post_id, 'updated_at', v_updated_at,
                            'removed_image_refs', to_jsonb(coalesce(v_removed, '{}'::text[])));
END $fn$;

COMMENT ON FUNCTION core_private.community_post_update_impl(uuid, uuid, text, text, text, text[], text, timestamptz) IS
  'S2 M7 B-2(계약 §7): 게시글 수정 공용 구현부 — 소유·낙관 충돌·마스킹·B-4 검증·removed_image_refs. 외부 EXECUTE 0.';

-- -----------------------------------------------------------------------------
-- E. B-3 core_private.community_post_soft_delete_impl (§7 F6)
-- -----------------------------------------------------------------------------
CREATE FUNCTION core_private.community_post_soft_delete_impl(
  p_author_id uuid, p_post_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
  v_status  text;
  v_susp    timestamptz;
  v_deleted timestamptz;
BEGIN
  IF p_author_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  END IF;
  IF p_post_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'POST_NOT_FOUND_OR_NOT_OWNED');
  END IF;

  -- 소유 행 잠금 — 역할 게이트 없음(작성자 본인 soft-delete 는 학생 글 보존 규칙상 허용)
  SELECT cp.deleted_at INTO v_deleted
    FROM public.community_posts cp
   WHERE cp.id = p_post_id AND cp.author_id = p_author_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'POST_NOT_FOUND_OR_NOT_OWNED');
  END IF;

  -- 계정 쓰기 게이트 (§11.5 fail-closed)
  SELECT u.status, u.suspended_until INTO v_status, v_susp
    FROM public.users u WHERE u.id = p_author_id;
  IF lower(coalesce(v_status, 'active')) = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'suspended' AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_SUSPENDED');
  END IF;
  IF public.account_deletion_write_blocked(p_author_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  END IF;

  -- 이미 삭제면 ok:true + already_deleted:true (§8.3 F6)
  IF v_deleted IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'post_id', p_post_id, 'deleted_at', v_deleted,
                              'already_deleted', true);
  END IF;

  -- soft delete — 행·이미지 참조 보존, hard delete 금지 (§14.4)
  UPDATE public.community_posts cp SET deleted_at = now()
   WHERE cp.id = p_post_id
   RETURNING cp.deleted_at INTO v_deleted;

  RETURN jsonb_build_object('ok', true, 'post_id', p_post_id, 'deleted_at', v_deleted);
END $fn$;

COMMENT ON FUNCTION core_private.community_post_soft_delete_impl(uuid, uuid) IS
  'S2 M7 B-3(계약 §7): 게시글 soft-delete 공용 구현부 — 작성자 본인·행 보존·hard delete 금지. 외부 EXECUTE 0.';

-- -----------------------------------------------------------------------------
-- F. F4·F5·F6 wrapper (SECDEF — auth.uid() 결합 + envelope 전달만)
-- -----------------------------------------------------------------------------
CREATE FUNCTION api_web_v1.community_post_create(
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

COMMENT ON FUNCTION api_web_v1.community_post_create(text, text, text, uuid, text[], text) IS
  'S2 M7 F4(계약 §7 — rev 8 A-1 재배열): 게시글 생성 wrapper — 승인 멘토 전용·replay-first 멱등. 앱 동명 함수와 시그니처·오류코드 동일.';

CREATE FUNCTION api_web_v1.community_post_update(
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

COMMENT ON FUNCTION api_web_v1.community_post_update(uuid, text, text, text, timestamptz, text[], text) IS
  'S2 M7 F5(계약 §7 — rev 8 A-1 재배열): 게시글 수정 wrapper — 낙관 충돌 검사·removed_image_refs 반환.';

CREATE FUNCTION api_web_v1.community_post_soft_delete(p_post_id uuid)
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

COMMENT ON FUNCTION api_web_v1.community_post_soft_delete(uuid) IS
  'S2 M7 F6(계약 §7): 게시글 soft-delete wrapper — 작성자 본인, hard delete 금지.';

-- -----------------------------------------------------------------------------
-- G. GRANT (§10.3) — 구현부 4종 외부 EXECUTE 0 · wrapper 3종 authenticated/service_role
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION core_private.community_image_refs_validate(uuid, text[])                                        FROM PUBLIC;
REVOKE ALL ON FUNCTION core_private.community_post_create_impl(uuid, text, text, text, text[], text, uuid)             FROM PUBLIC;
REVOKE ALL ON FUNCTION core_private.community_post_update_impl(uuid, uuid, text, text, text, text[], text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION core_private.community_post_soft_delete_impl(uuid, uuid)                                        FROM PUBLIC;

REVOKE ALL ON FUNCTION api_web_v1.community_post_create(text, text, text, uuid, text[], text)                          FROM PUBLIC;
REVOKE ALL ON FUNCTION api_web_v1.community_post_update(uuid, text, text, text, timestamptz, text[], text)             FROM PUBLIC;
REVOKE ALL ON FUNCTION api_web_v1.community_post_soft_delete(uuid)                                                     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION api_web_v1.community_post_create(text, text, text, uuid, text[], text)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.community_post_update(uuid, text, text, text, timestamptz, text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION api_web_v1.community_post_soft_delete(uuid)                                         TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- H. 적용 직후 자가 검증
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
BEGIN
  -- 구현부 4종: INVOKER + search_path + 외부(EXECUTE service_role 포함) 0
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core_private'
     AND p.proname IN ('community_image_refs_validate', 'community_post_create_impl',
                       'community_post_update_impl', 'community_post_soft_delete_impl')
     AND NOT p.prosecdef
     AND p.proconfig::text LIKE '%search_path=%'
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
     AND (p.proacl IS NULL OR (p.proacl::text NOT LIKE '{=%' AND p.proacl::text NOT LIKE '%,=%'));
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'S2_M7_SELFCHECK: impl hardening mismatch (matched %)', v_cnt;
  END IF;
  -- wrapper 3종: SECDEF + grant 매트릭스
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api_web_v1'
     AND p.proname IN ('community_post_create', 'community_post_update', 'community_post_soft_delete')
     AND p.prosecdef AND p.proconfig::text LIKE '%search_path=%'
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'S2_M7_SELFCHECK: wrapper hardening mismatch (matched %)', v_cnt;
  END IF;
  -- census: api_web_v1 = view 5 + fn 9 / core_private = fn 5 (F10 + 구현부 4)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api_web_v1') <> 9
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'core_private') <> 5
     OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core_private') <> 0 THEN
    RAISE EXCEPTION 'S2_M7_SELFCHECK: object census mismatch after M7';
  END IF;
END $$;

commit;
