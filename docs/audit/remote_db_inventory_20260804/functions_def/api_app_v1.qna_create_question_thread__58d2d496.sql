CREATE OR REPLACE FUNCTION api_app_v1.qna_create_question_thread(p_room_id uuid, p_title text, p_subject text DEFAULT NULL::text, p_topic text DEFAULT NULL::text, p_first_message_body text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_res  jsonb;
  v_code text;
BEGIN
  v_res := public.qna_create_question_thread(p_room_id, p_title, p_subject, p_topic, p_first_message_body);
  RETURN v_res || jsonb_build_object('contract_version', 1);
EXCEPTION WHEN OTHERS THEN
  v_code := CASE SQLERRM
    WHEN 'FREE_QUESTION_EXPIRED'           THEN 'FREE_QUOTA_EXPIRED'
    WHEN 'FREE_QUESTION_TOTAL_LIMIT'       THEN 'FREE_QUOTA_TOTAL_EXHAUSTED'
    WHEN 'FREE_QUESTION_PER_MENTOR_LIMIT'  THEN 'FREE_QUOTA_MENTOR_EXHAUSTED'
    WHEN 'FREE_QUESTION_STUDENT_NOT_FOUND' THEN 'FREE_QUOTA_STUDENT_NOT_FOUND'
    WHEN 'AUTH_REQUIRED'                 THEN 'AUTH_REQUIRED'
    WHEN 'TITLE_REQUIRED'                THEN 'TITLE_REQUIRED'
    WHEN 'ROOM_NOT_FOUND'                THEN 'ROOM_NOT_FOUND'
    WHEN 'NOT_ROOM_PARTY'                THEN 'NOT_ROOM_PARTY'
    WHEN 'MENTOR_CANNOT_CREATE_THREAD'   THEN 'MENTOR_CANNOT_CREATE_THREAD'
    WHEN 'ACCOUNT_BANNED'                THEN 'ACCOUNT_BANNED'
    WHEN 'ACCOUNT_SUSPENDED'             THEN 'ACCOUNT_SUSPENDED'
    WHEN 'ACCOUNT_DELETION_IN_PROGRESS'  THEN 'ACCOUNT_DELETION_IN_PROGRESS'
    WHEN 'BLOCKED'                       THEN 'BLOCKED'
    WHEN 'MENTOR_NOT_APPROVED'           THEN 'MENTOR_NOT_APPROVED'
    WHEN 'SUBSCRIPTION_REFUND_PENDING'   THEN 'SUBSCRIPTION_REFUND_PENDING'
    WHEN 'WEEKLY_LIMIT_EXHAUSTED'        THEN 'WEEKLY_LIMIT_EXHAUSTED'
    WHEN 'FREE_QUOTA_EXPIRED'            THEN 'FREE_QUOTA_EXPIRED'
    WHEN 'FREE_QUOTA_TOTAL_EXHAUSTED'    THEN 'FREE_QUOTA_TOTAL_EXHAUSTED'
    WHEN 'FREE_QUOTA_MENTOR_EXHAUSTED'   THEN 'FREE_QUOTA_MENTOR_EXHAUSTED'
    ELSE NULL
  END;
  IF v_code IS NULL THEN
    -- 사전에 없는 예외는 삼키지 않고 그대로 전파(앱 계약 §3.3 envelope 규약)
    RAISE;
  END IF;
  RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', v_code);
END $function$
