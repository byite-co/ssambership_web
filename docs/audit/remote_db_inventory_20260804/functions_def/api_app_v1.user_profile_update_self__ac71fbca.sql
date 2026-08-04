CREATE OR REPLACE FUNCTION api_app_v1.user_profile_update_self(p_nickname text DEFAULT NULL::text, p_grade_level text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select core_private.user_profile_update_self_impl((select auth.uid()), p_nickname, p_grade_level);
$function$
