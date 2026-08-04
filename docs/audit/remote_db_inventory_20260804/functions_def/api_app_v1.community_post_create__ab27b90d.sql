CREATE OR REPLACE FUNCTION api_app_v1.community_post_create(p_title text, p_body text, p_category text, p_idempotency_key uuid, p_image_refs text[] DEFAULT '{}'::text[], p_status text DEFAULT 'published'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$
