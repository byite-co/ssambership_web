CREATE OR REPLACE FUNCTION core_private.ensure_student_mentor_room(p_student_id uuid, p_mentor_id uuid, p_payment_id uuid DEFAULT NULL::uuid, p_subscription_id uuid DEFAULT NULL::uuid, p_require_entitlement boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role       text;
  v_status     text;
  v_susp       timestamptz;
  v_created_at timestamptz;
  v_mrole      text;
  v_total      int;
  v_per        int;
  v_entitlement text;
  v_room       uuid;
  v_created    boolean := false;
BEGIN
  -- 필수 인자(사전에 없는 예외는 전파 — §8.2. wrapper 가 NULL 을 넘기지 않는다)
  IF p_student_id IS NULL OR p_mentor_id IS NULL THEN
    RAISE EXCEPTION 'p_student_id and p_mentor_id are required';
  END IF;

  -- ① 학생 역할 확인
  SELECT u.role, u.status, u.suspended_until, u.created_at
    INTO v_role, v_status, v_susp, v_created_at
    FROM public.users u WHERE u.id = p_student_id;
  IF NOT FOUND OR v_role IS DISTINCT FROM 'student' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROLE_NOT_STUDENT');
  END IF;

  -- ② 계정 상태·탈퇴 write-block (판정식 §11.5 — 정본 qna_create_question_thread 동일)
  IF lower(coalesce(v_status, 'active')) = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'suspended'
     AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_SUSPENDED');
  END IF;
  IF public.account_deletion_write_blocked(p_student_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  END IF;

  -- ③ 승인 멘토·상호 차단
  SELECT u.role INTO v_mrole FROM public.users u WHERE u.id = p_mentor_id;
  IF NOT FOUND OR v_mrole IS DISTINCT FROM 'mentor' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MENTOR_NOT_FOUND');
  END IF;
  IF NOT public.individual_question_user_is_approved_mentor(p_mentor_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MENTOR_NOT_APPROVED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_blocks b
              WHERE (b.blocker_id = p_student_id AND b.blocked_id = p_mentor_id)
                 OR (b.blocker_id = p_mentor_id AND b.blocked_id = p_student_id)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BLOCKED');
  END IF;

  -- ④ 학생 행 잠금 + 자격 확인 (동시 호출 직렬화 — T-CONC-01)
  PERFORM 1 FROM public.users u WHERE u.id = p_student_id FOR UPDATE;
  IF p_require_entitlement THEN
    IF EXISTS (SELECT 1 FROM public.subscriptions s
                WHERE s.student_id = p_student_id AND s.mentor_id = p_mentor_id
                  AND lower(coalesce(s.status, '')) = 'active') THEN
      v_entitlement := 'subscription';
    ELSE
      -- 무료질문 자격 — 정본 F3 free 분기와 동일 규칙·동일 순서(가입 7일/전역 7회/멘토별 3회)
      IF v_created_at IS NOT NULL AND now() >= v_created_at + interval '7 days' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FREE_QUOTA_EXPIRED');
      END IF;
      SELECT count(*) INTO v_total FROM public.free_question_usage f
       WHERE f.student_id = p_student_id;
      IF v_total >= 7 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FREE_QUOTA_TOTAL_EXHAUSTED');
      END IF;
      SELECT count(*) INTO v_per FROM public.free_question_usage f
       WHERE f.student_id = p_student_id AND f.mentor_id = p_mentor_id;
      IF v_per >= 3 THEN
        RETURN jsonb_build_object('ok', false, 'code', 'FREE_QUOTA_MENTOR_EXHAUSTED');
      END IF;
      v_entitlement := 'free';
    END IF;
  ELSE
    -- F12 구독 확정 경로 — 구독이 방금 확정됐으므로 자격 재검사를 건너뛴다(§7 F10)
    v_entitlement := 'subscription';
  END IF;

  -- ⑤ 기존 방 조회
  SELECT r.id INTO v_room FROM public.mentor_student_rooms r
   WHERE r.student_id = p_student_id AND r.mentor_id = p_mentor_id;

  -- ⑥ 없으면 원자 INSERT (uq_msr_pair 추론 — 동시 경합에서 방은 정확히 1개)
  IF v_room IS NULL THEN
    INSERT INTO public.mentor_student_rooms (student_id, mentor_id, payment_id, subscription_id)
    VALUES (p_student_id, p_mentor_id, p_payment_id, p_subscription_id)
    ON CONFLICT (student_id, mentor_id) DO NOTHING
    RETURNING id INTO v_room;
    v_created := v_room IS NOT NULL;
  END IF;

  -- ⑦ 최종 방 재조회 (경합 패자 경로 포함)
  IF v_room IS NULL THEN
    SELECT r.id INTO v_room FROM public.mentor_student_rooms r
     WHERE r.student_id = p_student_id AND r.mentor_id = p_mentor_id;
  END IF;
  IF v_room IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROOM_ENSURE_FAILED');
  END IF;

  RETURN jsonb_build_object('ok', true, 'room_id', v_room, 'created', v_created,
                            'entitlement', v_entitlement);
END $function$
