CREATE OR REPLACE FUNCTION core_private.community_post_create_impl(p_author_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_role     text;
  v_status   text;
  v_susp     timestamptz;
  v_nickname text;
  v_title    text;
  v_body     text;
  v_val      jsonb;
  v_id       uuid;
  v_norm     text;
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

  -- [신규 쓰기 검증 — 역할 → 계정 → 본문 → 이미지]
  SELECT u.role, u.status, u.suspended_until, u.nickname
    INTO v_role, v_status, v_susp, v_nickname
    FROM public.users u WHERE u.id = p_author_id;
  -- S3-C 범위 A: 게시판 작성 자격 = active student + active mentor.
  -- admin·unknown role·users 행 부재는 ROLE_NOT_ALLOWED 로 거부한다.
  IF NOT FOUND OR v_role IS NULL OR v_role NOT IN ('student', 'mentor') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROLE_NOT_ALLOWED');
  END IF;
  -- [보정 2차 §1] 계정 상태는 **positive allowlist** 다(fail-open 금지).
  --   허용: 'active' | ('suspended' 이고 suspended_until <= now() = 정지 만료)
  --   그 외(deleted·dormant·빈 문자열·NULL·미지 값)는 ACCOUNT_NOT_ACTIVE.
  --   banned·유효 suspended 는 기존 전용 코드를 유지한다(먼저 판정).
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
END $function$
