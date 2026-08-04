CREATE OR REPLACE FUNCTION api_app_v1.ensure_free_question_room(p_mentor_id uuid)
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
  IF p_mentor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_FOUND');
  END IF;
  RETURN core_private.ensure_student_mentor_room(v_uid, p_mentor_id, NULL, NULL, true)
         || jsonb_build_object('contract_version', 1);
END $function$
