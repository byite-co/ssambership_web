-- =============================================================================
-- 20260730095438_comments_author_label_denormalize.sql (S2 M13)
-- =============================================================================
-- V2 선행 비정규화 — 댓글 author label/role 정본화 (baseline 정합 보정 2026-07-30).
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §6 V2 · §10.4 · §20.2 M13 ·
--            §20.3 「M13 이전/적용 직후」 · §21.7 T-M13-01~16 · §22 #8 · 부록 C-2.
--   - comments.author_label 은 037 기원 선재 컬럼을 재사용한다(ADD/DROP 금지 ·
--     NOT NULL 유지). default 만 '쌤버십 회원' → '쌤버십 사용자' 정정.
--   - M13 신규 컬럼은 public.comments.author_role text NULL 정확히 1개다.
--   - 트리거 함수 2종(comments_set_author_label · community_comments_set_author_label):
--     SECURITY DEFINER + 고정 search_path='' + 완전 수식 + 같은 트랜잭션 PUBLIC
--     EXECUTE 회수. TG_OP 분기 — INSERT 는 서버 규칙으로 무조건 덮어쓰고,
--     UPDATE(snapshot 컬럼 대상) 는 명시적 오류로 거부한다(silent no-op 금지).
--   - 트리거 역할 4종: canonical INSERT 설정 · canonical UPDATE OF author_label,
--     author_role 보호 · legacy board INSERT 설정 · legacy board UPDATE OF
--     author_label 보호. legacy 쪽은 post_type='board' 한정 — shortform 무영향.
--   - 라벨 규칙: public.users.nickname 만 사용. NULL·trim 공백·사용자 행 부재 →
--     정확히 '쌤버십 사용자'. author_role 은 student/mentor 만 기록,
--     admin·기타·사용자 부재 → NULL(관리자 신원 비노출).
--     full_name·email·birth_date·grade_level 은 라벨 도출에 사용 금지.
--   - 권위 사슬: DB BEFORE INSERT trigger > 163/164 bridge > 클라이언트 > default.
--     163/164 브리지 함수 본문은 수정하지 않는다 — 브리지의 양방향 INSERT 가 각
--     테이블의 BEFORE INSERT 트리거를 통과하며 양쪽 라벨이 동일 값으로 수렴한다.
--   - 백필 1회(forward-only 보안 데이터 교정, §22 #8): comments 전행
--     (author_label·author_role) + community_comments board 행(author_label).
--     shortform 행 바이트 단위 불변 · 행 수 불변 · 비대상 컬럼 불변.
--     * 백필 중 163 브리지의 자체 재귀 방지 스위치(GUC app.comment_sync)를 세워
--       동기화 트리거의 2차 쓰기를 차단한다(양 테이블을 본 migration 이 직접
--       정규화하므로 브리지 전파 불요 — 브리지 본문 무수정).
--     * community_comments 의 016 updated_at 트리거(trg_community_comments_set_updated)
--       는 백필 구간에서만 일시 DISABLE 후 즉시 ENABLE 한다(비대상 컬럼
--       updated_at 불변 보장 — 같은 트랜잭션 내 원상복구, 기존 SQL 무수정).
--   - snapshot 보호 오류 식별자: 계약 §10.4 는 「명시적 오류」만 요구하고 신규
--     코드를 정의하지 않으므로(임의 신설 금지 — Batch B 지시 §8.4), 저장소 정본
--     163/164 가 확립한 보호필드 불변 식별자 COMMENT_PROTECTED_FIELDS_IMMUTABLE
--     (canonical) · CC_PROTECTED_FIELDS_IMMUTABLE(legacy) 를 재사용한다 —
--     부록 C-2 가 진단한 「163/164 비교식에 author_label 부재」 결함을 같은 오류
--     표면으로 닫는 정합 보정이다.
-- 선행조건: M0(20260729211929) 적용 완료(§20.2.1 — M13 : M0).
-- rollback 정본: supabase/rollback/20260730095438_comments_author_label_denormalize_rollback.sql
--   (트리거 4종·함수 2종·author_role 제거 + default 복원까지만 — author_label 컬럼과
--    정규화 라벨 데이터는 보존하는 forward-only 예외, §22 #8)
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 구조 게이트 (§20.3 「M13 이전」 — 불일치 시 수정 0건 중단)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_type text;
  v_null text;
  v_def  text;
BEGIN
  -- ① comments.author_label: 존재 · text · NOT NULL · default '쌤버십 회원'
  SELECT data_type, is_nullable, column_default INTO v_type, v_null, v_def
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'author_label';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_label missing';
  END IF;
  IF v_type <> 'text' OR v_null <> 'NO' OR v_def IS DISTINCT FROM '''쌤버십 회원''::text' THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_label type=% null=% default=%',
      v_type, v_null, coalesce(v_def, '<none>');
  END IF;
  -- ② comments.author_role: 부재
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'author_role') THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: comments.author_role already exists';
  END IF;
  -- ③ community_comments.author_label: 존재 · text · NOT NULL · default '쌤버십 회원'
  SELECT data_type, is_nullable, column_default INTO v_type, v_null, v_def
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'community_comments' AND column_name = 'author_label';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: community_comments.author_label missing';
  END IF;
  IF v_type <> 'text' OR v_null <> 'NO' OR v_def IS DISTINCT FROM '''쌤버십 회원''::text' THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: community_comments.author_label type=% null=% default=%',
      v_type, v_null, coalesce(v_def, '<none>');
  END IF;
  -- ④ 163/164 브리지 최종 함수·트리거·매핑 컬럼 존재
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('comment_sync_in_progress', 'comments_write_guard', 'cc_write_guard',
                           'cc_sync_board_to_canonical', 'cc_sync_board_delete_to_canonical',
                           'comments_mirror_to_legacy', 'comments_mirror_delete_to_legacy')) <> 7 THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: 163/164 bridge functions incomplete';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.comments'::regclass AND NOT tgisinternal
         AND tgname IN ('trg_comments_write_guard', 'trg_comments_mirror_to_legacy',
                        'trg_comments_mirror_delete')) <> 3
     OR (SELECT count(*) FROM pg_trigger
          WHERE tgrelid = 'public.community_comments'::regclass AND NOT tgisinternal
            AND tgname IN ('trg_cc_write_guard', 'trg_cc_sync_board_to_canonical',
                           'trg_cc_sync_board_delete', 'trg_community_comments_set_updated')) <> 4 THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: 163/164 bridge triggers incomplete';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'comments' AND column_name = 'legacy_comment_id')
              OR (table_name = 'community_comments' AND column_name = 'canonical_comment_id'))) <> 2 THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: bridge mapping columns incomplete';
  END IF;
  -- ⑤ M13 신규 객체 선재 금지 (부분 생성 상태 은닉 금지)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('comments_set_author_label', 'community_comments_set_author_label'))
     OR EXISTS (SELECT 1 FROM pg_trigger
                 WHERE NOT tgisinternal
                   AND tgname IN ('trg_comments_set_author_label_ins', 'trg_comments_set_author_label_upd',
                                  'trg_community_comments_set_author_label_ins',
                                  'trg_community_comments_set_author_label_upd')) THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: M13 trigger objects already exist';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. 컬럼 — 신규는 author_role 1개뿐 · 선재 author_label 은 default 정정만
-- -----------------------------------------------------------------------------
ALTER TABLE public.comments ADD COLUMN author_role text;
ALTER TABLE public.comments ALTER COLUMN author_label SET DEFAULT '쌤버십 사용자';
-- community_comments.author_label 의 default('쌤버십 회원')는 변경하지 않는다
-- (§10.4 — default 정정 대상은 canonical comments 만).

COMMENT ON COLUMN public.comments.author_role IS
  'S2 M13(계약 §10.4): 서버 도출 작성자 역할 스냅샷 — student/mentor 만, admin·기타·사용자 부재는 NULL. 기록은 BEFORE INSERT 트리거 전용.';

-- -----------------------------------------------------------------------------
-- C. 트리거 함수 2종 (§10.4 — SECDEF · search_path='' · TG_OP 분기)
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.comments_set_author_label()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_nickname text;
  v_role     text;
BEGIN
  IF tg_op = 'UPDATE' THEN
    -- snapshot(author_label·author_role) 변조 명시 거부 — silent no-op 금지 (§10.4 ③).
    -- 식별자는 163 보호필드 정본(COMMENT_PROTECTED_FIELDS_IMMUTABLE) 재사용 — 헤더 참조.
    RAISE EXCEPTION 'COMMENT_PROTECTED_FIELDS_IMMUTABLE';
  END IF;
  -- INSERT: 클라이언트·브리지 입력을 신뢰하지 않고 서버 규칙으로 무조건 덮어쓴다.
  SELECT u.nickname, u.role INTO v_nickname, v_role
    FROM public.users u WHERE u.id = new.author_id;
  IF FOUND THEN
    new.author_label := coalesce(nullif(btrim(v_nickname), ''), '쌤버십 사용자');
    new.author_role  := CASE WHEN v_role IN ('student', 'mentor') THEN v_role END;
  ELSE
    -- 사용자 행 부재(이론상 FK 로 차단되나 규칙을 코드로 고정) → fallback.
    new.author_label := '쌤버십 사용자';
    new.author_role  := NULL;
  END IF;
  RETURN new;
END $$;

COMMENT ON FUNCTION public.comments_set_author_label() IS
  'S2 M13(계약 §10.4): canonical comments 의 author_label/author_role 서버 덮어쓰기(BEFORE INSERT) + snapshot UPDATE 명시 거부(BEFORE UPDATE OF). 라벨은 users.nickname 만 사용.';

CREATE FUNCTION public.community_comments_set_author_label()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_nickname text;
BEGIN
  IF tg_op = 'UPDATE' THEN
    -- board 행 snapshot(author_label) 변조 명시 거부 — 식별자는 164 정본 재사용.
    RAISE EXCEPTION 'CC_PROTECTED_FIELDS_IMMUTABLE';
  END IF;
  -- INSERT(post_type='board' 한정 — 트리거 WHEN): 서버 규칙 덮어쓰기.
  SELECT u.nickname INTO v_nickname
    FROM public.users u WHERE u.id = new.author_id;
  IF FOUND THEN
    new.author_label := coalesce(nullif(btrim(v_nickname), ''), '쌤버십 사용자');
  ELSE
    -- community_comments.author_id 는 auth.users FK — public.users 행 부재 가능 → fallback.
    new.author_label := '쌤버십 사용자';
  END IF;
  RETURN new;
END $$;

COMMENT ON FUNCTION public.community_comments_set_author_label() IS
  'S2 M13(계약 §10.4): legacy community_comments board 행의 author_label 서버 덮어쓰기(BEFORE INSERT) + snapshot UPDATE 명시 거부. shortform 행 무영향(트리거 WHEN 한정).';

-- [필수] 함수 생성과 동일 트랜잭션에서 PUBLIC EXECUTE 회수 (§10.4 · T-M13-14)
REVOKE ALL ON FUNCTION public.comments_set_author_label() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_comments_set_author_label() FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- D. 백필 1회 — forward-only 보안 데이터 교정 (§10.4 ④ · §22 #8)
--    트리거 설치 전에 수행한다(UPDATE 보호 트리거가 백필을 막지 않도록 순서 고정).
-- -----------------------------------------------------------------------------
-- 비대상 컬럼(updated_at) 불변 보장 — 016 트리거를 백필 구간에서만 일시 정지.
ALTER TABLE public.community_comments DISABLE TRIGGER trg_community_comments_set_updated;

DO $$
BEGIN
  -- 163 브리지 자체 재귀 방지 스위치 — 백필 중 동기화 트리거 2차 쓰기 차단
  -- (양 테이블을 아래에서 직접 정규화하므로 전파 불요. 트랜잭션 로컬 GUC).
  PERFORM set_config('app.comment_sync', '1', true);

  -- comments 전행: author_label + author_role 정규화 (행 수 불변 — UPDATE only)
  UPDATE public.comments c
     SET author_label = coalesce(
           (SELECT nullif(btrim(u.nickname), '') FROM public.users u WHERE u.id = c.author_id),
           '쌤버십 사용자'),
         author_role = (SELECT CASE WHEN u.role IN ('student', 'mentor') THEN u.role END
                          FROM public.users u WHERE u.id = c.author_id);

  -- community_comments 중 board 행만: author_label 정규화 (shortform 바이트 단위 불변)
  UPDATE public.community_comments cc
     SET author_label = coalesce(
           (SELECT nullif(btrim(u.nickname), '') FROM public.users u WHERE u.id = cc.author_id),
           '쌤버십 사용자')
   WHERE cc.post_type = 'board';

  PERFORM set_config('app.comment_sync', '0', true);
END $$;

ALTER TABLE public.community_comments ENABLE TRIGGER trg_community_comments_set_updated;

-- -----------------------------------------------------------------------------
-- E. 트리거 4종 (§10.4 — 백필 후 설치. 이름은 M0 확립 관행 trg_<함수명>_<ins/upd>)
-- -----------------------------------------------------------------------------
-- 1) canonical INSERT — 서버 라벨·역할 무조건 덮어쓰기
CREATE TRIGGER trg_comments_set_author_label_ins
  BEFORE INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.comments_set_author_label();

-- 2) canonical snapshot UPDATE 보호 — author_label·author_role 대상 지정 시 명시 거부
CREATE TRIGGER trg_comments_set_author_label_upd
  BEFORE UPDATE OF author_label, author_role ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.comments_set_author_label();

-- 3) legacy board INSERT — 서버 라벨 덮어쓰기 (shortform 은 트리거 미발화)
CREATE TRIGGER trg_community_comments_set_author_label_ins
  BEFORE INSERT ON public.community_comments
  FOR EACH ROW
  WHEN (new.post_type = 'board')
  EXECUTE FUNCTION public.community_comments_set_author_label();

-- 4) legacy board snapshot UPDATE 보호 (shortform 행 라벨은 M13 무영향 — 기존 동작 유지)
CREATE TRIGGER trg_community_comments_set_author_label_upd
  BEFORE UPDATE OF author_label ON public.community_comments
  FOR EACH ROW
  WHEN (old.post_type = 'board')
  EXECUTE FUNCTION public.community_comments_set_author_label();

-- -----------------------------------------------------------------------------
-- F. 적용 직후 자가 검증 (§20.3 「M13 적용 직후」 게이트)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
  v_def text;
BEGIN
  -- ① comments.author_label: text NOT NULL · default '쌤버십 사용자'
  SELECT column_default INTO v_def FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'author_label'
     AND data_type = 'text' AND is_nullable = 'NO';
  IF NOT FOUND OR v_def IS DISTINCT FROM '''쌤버십 사용자''::text' THEN
    RAISE EXCEPTION 'S2_M13_SELFCHECK: comments.author_label default not corrected (%)', coalesce(v_def, '<none>');
  END IF;
  -- ② comments.author_role: text NULL(무 default)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'comments' AND column_name = 'author_role'
                    AND data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'S2_M13_SELFCHECK: comments.author_role shape mismatch';
  END IF;
  -- ③ 트리거 함수 정확히 2종 — SECDEF + 고정 search_path + PUBLIC/외부 EXECUTE 0
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('comments_set_author_label', 'community_comments_set_author_label')
     AND p.prosecdef
     AND p.proconfig::text LIKE '%search_path=%'
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND (p.proacl IS NULL OR (p.proacl::text NOT LIKE '{=%' AND p.proacl::text NOT LIKE '%,=%'));
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'S2_M13_SELFCHECK: trigger functions hardening mismatch (matched=%)', v_cnt;
  END IF;
  -- ④ 계약된 트리거 역할 4개 존재
  SELECT count(*) INTO v_cnt FROM pg_trigger
   WHERE NOT tgisinternal
     AND ((tgrelid = 'public.comments'::regclass
           AND tgname IN ('trg_comments_set_author_label_ins', 'trg_comments_set_author_label_upd'))
          OR (tgrelid = 'public.community_comments'::regclass
              AND tgname IN ('trg_community_comments_set_author_label_ins',
                             'trg_community_comments_set_author_label_upd')));
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'S2_M13_SELFCHECK: expected 4 M13 triggers, found %', v_cnt;
  END IF;
  -- ⑤ 016 updated_at 트리거 원상복구(ENABLE) 확인
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.community_comments'::regclass
                    AND tgname = 'trg_community_comments_set_updated' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'S2_M13_SELFCHECK: trg_community_comments_set_updated not re-enabled';
  END IF;
  -- ⑥ 백필 결과 — 라벨 규칙 위반 0 (comments 전행 · community_comments board 행)
  SELECT count(*) INTO v_cnt
    FROM public.comments c
   WHERE c.author_label IS DISTINCT FROM coalesce(
           (SELECT nullif(btrim(u.nickname), '') FROM public.users u WHERE u.id = c.author_id),
           '쌤버십 사용자')
      OR c.author_role IS DISTINCT FROM (SELECT CASE WHEN u.role IN ('student', 'mentor') THEN u.role END
                                           FROM public.users u WHERE u.id = c.author_id);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S2_M13_SELFCHECK: comments backfill rule violations: %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM public.community_comments cc
   WHERE cc.post_type = 'board'
     AND cc.author_label IS DISTINCT FROM coalesce(
           (SELECT nullif(btrim(u.nickname), '') FROM public.users u WHERE u.id = cc.author_id),
           '쌤버십 사용자');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'S2_M13_SELFCHECK: community_comments board backfill rule violations: %', v_cnt;
  END IF;
END $$;

commit;
