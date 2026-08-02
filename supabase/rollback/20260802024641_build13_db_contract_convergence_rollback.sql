-- =============================================================================
-- 20260802024641_build13_db_contract_convergence_rollback.sql (S3-C rollback)
-- =============================================================================
-- forward 정본: supabase/sql/20260802024641_build13_db_contract_convergence.sql
-- 대칭 복원 — forward 섹션의 역순(G → F → E → D → C → B)으로 되돌린다.
--
-- 복원 정의의 정본(추정 작성 금지 — 이중 대조):
--   - core_private.community_post_create_impl 본문: 레포 원문
--     supabase/sql/20260730105252_api_web_v1_community_rpc.sql 섹션 C(136~245행) 그대로.
--   - public.account_deletion_write_blocked 본문: 레포 원문
--     supabase/sql/151_p1_10_account_deletion_saga.sql 42행~ 및 2026-08-02 운영
--     pg_get_functiondef 실측(LANGUAGE sql · STABLE · SECURITY DEFINER ·
--     SET search_path TO 'public')과 문자 일치.
--   - 정책 11종(범위 B·C) 및 custom_* 공개 SELECT 4종(범위 E): 2026-08-02 운영
--     pg_policies 실측 정의. 한글명 4종·2종은 대시보드 생성분으로 레포 원문이
--     없으므로 실측이 정본이다.
--
-- 실행 전제:
--   - 오너 승인 후 apply_migration 으로 원장 새 행 append
--     (ledger name = 20260802024641_build13_db_contract_convergence_rollback).
--     forward 원장 행은 삭제·수정하지 않는다.
--   - 실행 전 pg_policies·pg_get_functiondef 스냅샷과 본 파일 정의를 재대조하고,
--     한 문자라도 다르면 실행을 중단하고 원인을 보고한다.
--   - 복원 후 기대: 범위 A~E 전건이 forward 적용 직전 상태와 동일 —
--     게시판 작성은 다시 승인 멘토 전용이 되고(학생 FAIL 재현), custom_* 공개
--     SELECT 4종이 되살아난다. **회귀를 되돌리는 행위임을 인지하고 실행할 것.**
--   - community_posts 직접 쓰기 잠금(M16)은 forward·rollback 어느 쪽에서도
--     건드리지 않는다 — 본 파일은 권한을 복구하지 않는다.
-- 재실행 안전: 전 구간 CREATE OR REPLACE / DROP … IF EXISTS + CREATE.
-- =============================================================================

begin;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'core_private' AND p.proname = 'community_post_create_impl'
                    AND pg_get_function_identity_arguments(p.oid)
                        = 'p_author_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_idempotency_key uuid') THEN
    RAISE EXCEPTION 'S3C_ROLLBACK_BASELINE_MISMATCH: core_private.community_post_create_impl identity mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'account_deletion_write_blocked'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid') THEN
    RAISE EXCEPTION 'S3C_ROLLBACK_BASELINE_MISMATCH: public.account_deletion_write_blocked(uuid) 부재';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- G⁻¹. 범위 E 복원 — custom_* permissive public SELECT 4종 재생성
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "누구나 납품 읽기"   ON public.custom_order_deliverables;
CREATE POLICY "누구나 납품 읽기" ON public.custom_order_deliverables
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "누구나 메시지 읽기" ON public.custom_order_messages;
CREATE POLICY "누구나 메시지 읽기" ON public.custom_order_messages
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "누구나 지원서 읽기" ON public.custom_request_applications;
CREATE POLICY "누구나 지원서 읽기" ON public.custom_request_applications
  FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "누구나 의뢰 읽기"   ON public.custom_request_posts;
CREATE POLICY "누구나 의뢰 읽기" ON public.custom_request_posts
  FOR SELECT TO public USING (true);

-- -----------------------------------------------------------------------------
-- F⁻¹. 범위 C 복원 — content_reports INSERT 정책 원형(reporter_id 만 검사)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "content_reports_insert_reporter" ON public.content_reports;
CREATE POLICY "content_reports_insert_reporter" ON public.content_reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = (SELECT auth.uid()));

-- -----------------------------------------------------------------------------
-- E⁻¹. 범위 B 복원 — UGC 쓰기 정책 원형(계정 상태 게이트 제거)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "comments_insert_own" ON public.comments;
CREATE POLICY "comments_insert_own" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "comments_update_own" ON public.comments;
CREATE POLICY "comments_update_own" ON public.comments
  FOR UPDATE TO authenticated
  USING (author_id = (SELECT auth.uid()))
  WITH CHECK (author_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "community_comments_insert_authenticated" ON public.community_comments;
CREATE POLICY "community_comments_insert_authenticated" ON public.community_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND (SELECT auth.uid()) IS NOT NULL
    AND char_length(btrim(body)) >= 1
    AND char_length(btrim(body)) <= 1000
  );

DROP POLICY IF EXISTS "post_reactions_insert_own" ON public.post_reactions;
CREATE POLICY "post_reactions_insert_own" ON public.post_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "post_reactions_delete_own" ON public.post_reactions;
CREATE POLICY "post_reactions_delete_own" ON public.post_reactions
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 한글명 중복 정책 2종(대시보드 생성분) 재생성 — 실측 정의 그대로
DROP POLICY IF EXISTS "로그인 유저 반응 추가" ON public.post_reactions;
CREATE POLICY "로그인 유저 반응 추가" ON public.post_reactions
  FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "본인 반응 삭제" ON public.post_reactions;
CREATE POLICY "본인 반응 삭제" ON public.post_reactions
  FOR DELETE TO public
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "shortform_reactions_insert_own" ON public.shortform_reactions;
CREATE POLICY "shortform_reactions_insert_own" ON public.shortform_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND type = ANY (ARRAY['like'::text, 'scrap'::text])
  );

DROP POLICY IF EXISTS "shortform_reactions_delete_own" ON public.shortform_reactions;
CREATE POLICY "shortform_reactions_delete_own" ON public.shortform_reactions
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- -----------------------------------------------------------------------------
-- D⁻¹. 범위 A 복원 — community_post_create_impl 승인 멘토 전용 본문(M7 원문)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core_private.community_post_create_impl(
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
-- D-2⁻¹. 보정 §2 복원 — community_post_update_impl 승인 멘토 전용 본문(M7 원문)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core_private.community_post_update_impl(
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
-- D-3⁻¹. 보정 §3 복원 — 질문방 RPC 2종(2026-08-02 운영 실측 본문 문자 그대로)
-- -----------------------------------------------------------------------------
-- 복원 후에는 상호 차단·suspended·삭제 진행 게이트가 사라진다(= 취약 상태로 회귀).
CREATE OR REPLACE FUNCTION public.qna_append_message(p_thread_id uuid, p_body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_status text; v_thread_status text;
  v_first_answered timestamptz; v_message_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_sub_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_body is null or btrim(p_body)='' then raise exception 'BODY_REQUIRED'; end if;
  select t.mentor_student_room_id, t.status, t.first_answered_at into v_room, v_thread_status, v_first_answered
    from public.question_threads t where t.id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if v_uid=v_mentor then v_is_mentor:=true; elsif v_uid=v_student then v_is_mentor:=false; else raise exception 'NOT_ROOM_PARTY'; end if;
  select status into v_status from public.users where id=v_uid;
  if lower(coalesce(v_status,'active'))='banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;
  if v_is_mentor and not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;
  -- 학생 후속 메시지: 활성 구독 FOR UPDATE + live pending refund 게이트(142 유지).
  if not v_is_mentor then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
  end if;

  -- F2(D-12)+R1: 아래 INSERT 가 AFTER INSERT 알림 트리거를 발화 — 멘토 메시지 행 1건 = 알림 정확히 1건.
  insert into public.question_messages (thread_id, author_id, body) values (p_thread_id, v_uid, btrim(p_body)) returning id into v_message_id;
  if v_is_mentor and v_first_answered is null then
    update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
    v_transitioned := true;
  end if;
  return jsonb_build_object('ok',true,'message_id',v_message_id,'answered_transition',v_transitioned);
end; $function$;

COMMENT ON FUNCTION public.qna_append_message(uuid, text) IS NULL;

CREATE OR REPLACE FUNCTION public.qna_register_attachment(
  p_thread_id uuid, p_storage_path text, p_file_name text DEFAULT NULL::text,
  p_mime_type text DEFAULT NULL::text, p_message_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_thread_status text;
  v_first_answered timestamptz; v_att_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_sub_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_storage_path is null or btrim(p_storage_path)='' then raise exception 'STORAGE_PATH_REQUIRED'; end if;
  select t.mentor_student_room_id, t.status, t.first_answered_at into v_room, v_thread_status, v_first_answered
    from public.question_threads t where t.id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if v_uid=v_mentor then v_is_mentor:=true; elsif v_uid=v_student then v_is_mentor:=false; else raise exception 'NOT_ROOM_PARTY'; end if;
  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;
  if p_storage_path not like (v_room::text || '/' || p_thread_id::text || '/%') then raise exception 'STORAGE_PATH_MISMATCH'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='question-room-attachments' and o.name = btrim(p_storage_path) and o.owner_id = v_uid::text) then raise exception 'STORAGE_OBJECT_NOT_OWNED'; end if;
  if p_message_id is not null and not exists (select 1 from public.question_messages m where m.id=p_message_id and m.thread_id=p_thread_id) then raise exception 'MESSAGE_THREAD_MISMATCH'; end if;
  if not v_is_mentor then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
  end if;

  -- F2(D-12)+R1: 아래 INSERT 가 AFTER INSERT 알림 트리거를 발화 — 멘토 단독 첨부 행 1건 = 알림 정확히 1건.
  insert into public.question_attachments (thread_id, message_id, author_id, storage_path, file_name, mime_type)
  values (p_thread_id, p_message_id, v_uid, btrim(p_storage_path), p_file_name, p_mime_type) returning id into v_att_id;
  if v_is_mentor and v_first_answered is null then
    update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
    v_transitioned := true;
  end if;
  return jsonb_build_object('ok',true,'attachment_id',v_att_id,'answered_transition',v_transitioned);
end; $function$;

COMMENT ON FUNCTION public.qna_register_attachment(uuid, text, text, text, uuid) IS NULL;

REVOKE ALL ON FUNCTION public.qna_append_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qna_append_message(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.qna_register_attachment(uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qna_register_attachment(uuid, text, text, text, uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C⁻¹. helper 2종 제거 — 참조 정책·함수를 모두 원형 복원한 뒤에 DROP 한다
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.ugc_write_allowed();
DROP FUNCTION IF EXISTS public.report_target_user_valid(uuid);

-- -----------------------------------------------------------------------------
-- B⁻¹. 범위 D 복원 — account_deletion_write_blocked self 제한 해제(151 원문)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_deletion_write_blocked(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
  select exists (
    select 1 from public.account_deletion_jobs j
    where j.user_id = p_user_id
      and j.state in ('locked','purging','storage_purged','finalized','auth_soft_deleted')
  );
$fn$;

COMMENT ON FUNCTION public.account_deletion_write_blocked(uuid) IS NULL;

REVOKE ALL ON FUNCTION public.account_deletion_write_blocked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_deletion_write_blocked(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 복원 직후 자가 검증
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core_private' AND p.proname = 'community_post_create_impl';
  IF v_src IS NULL
     OR position('ROLE_NOT_MENTOR' IN v_src) = 0
     OR position('MENTOR_NOT_APPROVED' IN v_src) = 0
     OR position('ROLE_NOT_ALLOWED' IN v_src) > 0 THEN
    RAISE EXCEPTION 'S3C_ROLLBACK_MISMATCH: create_impl 원형 복원 실패';
  END IF;

  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'account_deletion_write_blocked';
  IF v_src IS NULL OR position('ACCOUNT_DELETION_PROBE_FORBIDDEN' IN v_src) > 0 THEN
    RAISE EXCEPTION 'S3C_ROLLBACK_MISMATCH: account_deletion_write_blocked 원형 복원 실패';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('ugc_write_allowed', 'report_target_user_valid')) THEN
    RAISE EXCEPTION 'S3C_ROLLBACK_MISMATCH: S3-C helper(ugc_write_allowed·report_target_user_valid) 잔존';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public'
                AND coalesce(qual, '') || coalesce(with_check, '')
                    LIKE ANY (ARRAY['%ugc_write_allowed%', '%report_target_user_valid%'])) THEN
    RAISE EXCEPTION 'S3C_ROLLBACK_MISMATCH: S3-C helper 참조 정책 잔존';
  END IF;

  -- 보정 §2 — update 구현부 원형(승인 멘토 전용) 복원
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core_private' AND p.proname = 'community_post_update_impl';
  IF v_src IS NULL
     OR position('ROLE_NOT_MENTOR' IN v_src) = 0
     OR position('MENTOR_NOT_APPROVED' IN v_src) = 0
     OR position('ROLE_NOT_ALLOWED' IN v_src) > 0 THEN
    RAISE EXCEPTION 'S3C_ROLLBACK_MISMATCH: update_impl 원형 복원 실패';
  END IF;

  -- 보정 §3 — 질문방 RPC 2종 원형 복원(차단·상태 게이트 부재가 정상)
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'qna_append_message';
  IF v_src IS NULL
     OR position('qna_users_blocked' IN v_src) > 0
     OR position('ACCOUNT_NOT_ACTIVE' IN v_src) > 0
     OR position('ACCOUNT_BANNED' IN v_src) = 0
     OR position('MENTOR_NOT_APPROVED' IN v_src) = 0 THEN
    RAISE EXCEPTION 'S3C_ROLLBACK_MISMATCH: qna_append_message 원형 복원 실패';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'qna_register_attachment';
  IF v_src IS NULL
     OR position('qna_users_blocked' IN v_src) > 0
     OR position('ACCOUNT_NOT_ACTIVE' IN v_src) > 0
     OR position('STORAGE_OBJECT_NOT_OWNED' IN v_src) = 0 THEN
    RAISE EXCEPTION 'S3C_ROLLBACK_MISMATCH: qna_register_attachment 원형 복원 실패';
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND cmd = 'SELECT' AND roles::text = '{public}'
         AND (tablename, policyname) IN
             (('custom_order_deliverables',    '누구나 납품 읽기'),
              ('custom_order_messages',        '누구나 메시지 읽기'),
              ('custom_request_applications',  '누구나 지원서 읽기'),
              ('custom_request_posts',         '누구나 의뢰 읽기'))) <> 4 THEN
    RAISE EXCEPTION 'S3C_ROLLBACK_MISMATCH: custom_* public SELECT 4종 복원 실패';
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'post_reactions'
         AND cmd IN ('INSERT', 'DELETE')) <> 4 THEN
    RAISE EXCEPTION 'S3C_ROLLBACK_MISMATCH: post_reactions 쓰기 정책 4종 복원 실패';
  END IF;
END $$;

commit;
