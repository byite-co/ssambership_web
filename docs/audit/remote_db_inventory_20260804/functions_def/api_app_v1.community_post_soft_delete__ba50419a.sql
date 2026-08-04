CREATE OR REPLACE FUNCTION api_app_v1.community_post_soft_delete(p_post_id uuid)
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
  RETURN core_private.community_post_soft_delete_impl(v_uid, p_post_id)
         || jsonb_build_object('contract_version', 1);
END $function$
