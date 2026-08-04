CREATE OR REPLACE FUNCTION core_private.community_post_soft_delete_impl(p_author_id uuid, p_post_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
END $function$
