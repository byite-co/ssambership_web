-- =============================================================================
-- 20260730105244_core_private_room_ensure.sql (S2 M5)
-- =============================================================================
-- F10 core_private.ensure_student_mentor_room — 방 확보 공용 구현부.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §7 F10 · §13.1 · §10.3 ·
--            §11.5(계정 상태 판정식) / 앱 계약 §4.2(원자성 순서 1~7)·§4.3(오류코드).
--   - 웹 F2·앱 ensure_free_question_room·F12(구독 확정 내부 경로)가 전부 이 함수로
--     수렴한다. 자격 판정 로직을 wrapper 마다 복제하지 않는다.
--   - 원자성 순서(앱 §4.2 — 이 함수가 수행): ① 학생 역할 확인 ② 계정 상태·탈퇴
--     write-block ③ 승인 멘토·상호 차단 ④ 학생 행 잠금 + 자격(활성 구독/무료질문)
--     ⑤ 기존 방 조회 ⑥ INSERT … ON CONFLICT (student_id, mentor_id) DO NOTHING
--     ⑦ 최종 방 재조회 반환. 근거 = uq_msr_pair UNIQUE INDEX 실측(§13.1).
--   - 판정식은 정본 public.qna_create_question_thread 와 동일하게 고정한다:
--     계정 상태(§11.5) · 승인(individual_question_user_is_approved_mentor) ·
--     차단(user_blocks 양방향) · 활성 구독(lower(coalesce(status,''))='active') ·
--     무료 자격(가입 7일 / 전역 7회 / 멘토별 3회 — F3 free 분기와 동일 순서).
--   - 방 확보는 무료질문권을 소비하지 않는다(소비는 F3 — §13.2 2단 구조).
--   - p_require_entitlement=false(F12 구독 확정 경로)는 ④의 자격 검사만 건너뛰고
--     entitlement='subscription' 으로 반환한다(§7 F10). room 참조(payment_id·
--     subscription_id) 보정 규칙은 F12(M9) 소유 — 기존 방의 참조를 덮어쓰지 않는다.
--   - 반환(내부 형상 — §8.1 예외): {ok,room_id,created,entitlement} / {ok:false,code}.
--   - 보안: SECURITY DEFINER · SET search_path='' · 완전 수식 · 같은 트랜잭션
--     PUBLIC EXECUTE 회수. anon·authenticated·service_role EXECUTE 전부 미부여
--     (§10.3 — 호출은 SECDEF wrapper 의 소유자 권한 문맥뿐, T-PERM-06).
-- 선행조건: M1(20260730095435) 적용 완료(§20.2.1 — M5 : M1).
-- rollback 정본: supabase/rollback/20260730105244_core_private_room_ensure_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 — M1 경계·기반 객체 실측 (불일치 시 수정 0건 중단)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core_private') THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: M1 core_private schema not applied';
  END IF;
  IF has_schema_privilege('anon', 'core_private', 'USAGE')
     OR has_schema_privilege('authenticated', 'core_private', 'USAGE')
     OR has_schema_privilege('service_role', 'core_private', 'USAGE') THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: core_private boundary violated';
  END IF;
  -- 기반: mentor_student_rooms 확정 컬럼 7종(§13.1 — 프로빙 금지) + uq_msr_pair
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'mentor_student_rooms'
         AND column_name IN ('id','student_id','mentor_id','payment_id','subscription_id','created_at','updated_at')) <> 7 THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: mentor_student_rooms columns mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                  AND tablename = 'mentor_student_rooms' AND indexname = 'uq_msr_pair') THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: uq_msr_pair unique index missing';
  END IF;
  -- 기반 헬퍼·테이블
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('individual_question_user_is_approved_mentor', 'account_deletion_write_blocked')) <> 2 THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: canonical helper functions missing';
  END IF;
  IF (SELECT count(*) FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('users','user_blocks','subscriptions','free_question_usage')) <> 4 THEN
    RAISE EXCEPTION 'BATCH_C_BASELINE_OBJECT_MISMATCH: base tables missing';
  END IF;
  -- 대상 선재 금지 (부분 생성 은닉 금지)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'core_private' AND p.proname = 'ensure_student_mentor_room') THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: core_private.ensure_student_mentor_room already exists';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. F10 — 방 확보 공용 구현부
-- -----------------------------------------------------------------------------
CREATE FUNCTION core_private.ensure_student_mentor_room(
  p_student_id uuid,
  p_mentor_id uuid,
  p_payment_id uuid DEFAULT NULL,
  p_subscription_id uuid DEFAULT NULL,
  p_require_entitlement boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;

COMMENT ON FUNCTION core_private.ensure_student_mentor_room(uuid, uuid, uuid, uuid, boolean) IS
  'S2 M5 F10(계약 §7): 방 확보 공용 구현부 — 웹 F2·앱 wrapper·F12 가 수렴. 외부 EXECUTE 0(SECDEF wrapper 소유자 문맥 전용).';

-- [필수] 같은 트랜잭션에서 PUBLIC EXECUTE 회수 — 외부 역할 EXECUTE 0 (§10.3)
REVOKE ALL ON FUNCTION core_private.ensure_student_mentor_room(uuid, uuid, uuid, uuid, boolean) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- C. 적용 직후 자가 검증
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_oid oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core_private' AND p.proname = 'ensure_student_mentor_room'
     AND pg_get_function_identity_arguments(p.oid)
         = 'p_student_id uuid, p_mentor_id uuid, p_payment_id uuid, p_subscription_id uuid, p_require_entitlement boolean'
     AND p.prosecdef AND p.proconfig::text LIKE '%search_path=%';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'S2_M5_SELFCHECK: F10 identity/attributes mismatch';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'S2_M5_SELFCHECK: F10 external EXECUTE must be 0';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'core_private') <> 1 THEN
    RAISE EXCEPTION 'S2_M5_SELFCHECK: core_private must contain exactly F10 after M5';
  END IF;
END $$;

commit;
