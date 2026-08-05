CREATE OR REPLACE FUNCTION core_private.community_post_update_impl(p_author_id uuid, p_post_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_expected_updated_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  v_norm       text;
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

  -- 역할·계정 (S3-C 보정 §2: 학생 글 수정 거부 규칙 폐기 — create 와 **문자 그대로 동일** 계약)
  SELECT u.role, u.status, u.suspended_until INTO v_role, v_status, v_susp
    FROM public.users u WHERE u.id = p_author_id;
  IF NOT FOUND OR v_role IS NULL OR v_role NOT IN ('student', 'mentor') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROLE_NOT_ALLOWED');
  END IF;
  -- [보정 2차 §1] create 와 동일한 positive allowlist (fail-open 금지)
  v_norm := lower(btrim(coalesce(v_status, '')));
  IF v_norm = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF v_norm = 'suspended' AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_SUSPENDED');
  END IF;
  IF NOT (v_norm = 'active'
          OR (v_norm = 'suspended' AND v_susp IS NOT NULL AND v_susp <= now())) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_ACTIVE');
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
END $function$
