-- =============================================================================
-- 20260730090046_comments_author_label_denormalize.sql (S2 M13)
-- =============================================================================
-- comments author label/role 정본화 (V2 선행 비정규화 — baseline 정합 보정 2026-07-30).
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §6 V2·§10.4·§20.2 M13·
--   §20.3 「M13 이전/적용 직후」·§21.7 T-M13-01~16·§22 #8·부록 C-2.
--   - comments.author_label 은 037 선재 컬럼 재사용: ADD/DROP 금지·NOT NULL 유지,
--     default 만 '쌤버십 회원' → '쌤버십 사용자' 정정.
--   - M13 신규 컬럼은 정확히 1개: comments.author_role text NULL.
--   - 트리거 함수 2종(comments_set_author_label·community_comments_set_author_label —
--     SECDEF·search_path=''·완전 수식·같은 트랜잭션 PUBLIC EXECUTE 회수) +
--     트리거 역할 4종(canonical INSERT 덮어쓰기·canonical snapshot UPDATE 거부·
--     legacy board INSERT 덮어쓰기·legacy board snapshot UPDATE 거부, TG_OP 분기 —
--     트리거 명명은 M0 관행 trg_<함수명>_ins/_upd 를 따른다).
--   - 라벨 규칙(§7 F0 승계): public.users.nickname 만 사용,
--     NULL·trim 공백·사용자 행 부재 → 정확히 '쌤버십 사용자'.
--     author_role 은 student/mentor 만 기록, admin·기타·사용자 부재 → NULL.
--     full_name·email·birth_date·grade_level 은 라벨 도출에 사용 금지.
--   - 권위: DB BEFORE INSERT trigger > 163/164 bridge > 웹·앱 클라이언트 > 컬럼 default.
--     163/164 브리지 함수 본문은 수정하지 않는다.
--   - 백필 1회(forward-only 보안 데이터 교정): comments 전행 + community_comments
--     post_type='board' 행. shortform 행 바이트 단위 불변·행 수 불변·비대상 컬럼 불변.
--   - legacy 쪽은 post_type='board' 한정 — shortform 트리거 미발화.
-- 선행조건: M0 (§20.2.1 — M13 : M0).
-- rollback 정본: supabase/rollback/20260730090046_comments_author_label_denormalize_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 구조 게이트 (계약 §20.3 「M13 이전」 — 불일치 시 수정 0건 중단)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_label_default text;
BEGIN
  -- ① comments.author_label: 존재·text·NOT NULL·default '쌤버십 회원' (037 기원 선재)
  SELECT column_default INTO v_label_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'comments'
    AND column_name = 'author_label' AND data_type = 'text' AND is_nullable = 'NO';
  IF NOT FOUND OR v_label_default IS DISTINCT FROM '''쌤버십 회원''::text' THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: comments.author_label shape (found default=%)', v_label_default;
  END IF;

  -- ② comments.author_role: 부재
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'comments'
               AND column_name = 'author_role') THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: comments.author_role already present';
  END IF;

  -- ③ community_comments.author_label: 존재·text·NOT NULL·default '쌤버십 회원' (016 기원 선재)
  SELECT column_default INTO v_label_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'community_comments'
    AND column_name = 'author_label' AND data_type = 'text' AND is_nullable = 'NO';
  IF NOT FOUND OR v_label_default IS DISTINCT FROM '''쌤버십 회원''::text' THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: community_comments.author_label shape (found default=%)', v_label_default;
  END IF;

  -- ④ 163/164 브리지 정본: 최종 함수 4종 + 가드/동기화 트리거 + 매핑 컬럼
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('cc_sync_board_to_canonical', 'comments_mirror_to_legacy',
                          'comments_write_guard', 'cc_write_guard')) <> 4 THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: 163/164 bridge functions missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN ('trg_comments_write_guard', 'trg_comments_mirror_to_legacy',
                       'trg_cc_write_guard', 'trg_cc_sync_board_to_canonical')) <> 4 THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: 163/164 bridge triggers missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'comments'
                   AND column_name = 'legacy_comment_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'community_comments'
                      AND column_name = 'canonical_comment_id') THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: 163/164 mapping columns missing';
  END IF;

  -- ⑤ M13 소유 객체 선재 0 (부분 생성 상태 금지)
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname IN ('comments_set_author_label', 'community_comments_set_author_label')) THEN
    RAISE EXCEPTION 'UNEXPECTED_EXISTING_CONTRACT_OBJECT: M13 trigger functions already present';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. 컬럼 정책 (계약 §10.4)
--    author_label: 선재 컬럼 재사용 — default 만 정정. author_role: 신규 1개.
-- -----------------------------------------------------------------------------
ALTER TABLE public.comments
  ALTER COLUMN author_label SET DEFAULT '쌤버십 사용자';

ALTER TABLE public.comments
  ADD COLUMN author_role text NULL;

COMMENT ON COLUMN public.comments.author_role IS
  'S2 M13(계약 §10.4): 작성 시점 역할 스냅샷 — student/mentor 만, admin·기타·사용자 부재는 NULL. 값 기록은 BEFORE INSERT 트리거 전용.';
COMMENT ON COLUMN public.comments.author_label IS
  'S2 M13(계약 §6 V2): 037 선재 표시 라벨 — users.nickname 서버 스냅샷(비었으면 ''쌤버십 사용자''). 값 기록은 BEFORE INSERT 트리거 전용.';

-- -----------------------------------------------------------------------------
-- C. 트리거 함수 2종 (계약 §10.4 — SECDEF·search_path=''·완전 수식·TG_OP 분기)
-- -----------------------------------------------------------------------------
-- C-1. canonical comments: INSERT 라벨·역할 서버 덮어쓰기 / UPDATE snapshot 변조 거부
CREATE FUNCTION public.comments_set_author_label()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_nickname text;
  v_role     text;
BEGIN
  IF tg_op = 'UPDATE' THEN
    -- snapshot 필드 변조를 명시적 오류로 거부한다(성공 no-op 위장 금지 — T-M13-09).
    -- 163 가드의 보호필드 오류코드 관행을 승계한다(신규 코드 발명 금지).
    IF new.author_label IS DISTINCT FROM old.author_label
       OR new.author_role IS DISTINCT FROM old.author_role THEN
      RAISE EXCEPTION 'COMMENT_PROTECTED_FIELDS_IMMUTABLE'
        USING errcode = '42501';
    END IF;
    RETURN new;
  END IF;

  -- INSERT: 클라이언트·브리지 입력을 신뢰하지 않고 무조건 재계산해 덮어쓴다.
  --   라벨은 public.users.nickname 만 사용(PII 금지 — full_name·email·birth_date·grade_level).
  SELECT u.nickname, u.role INTO v_nickname, v_role
  FROM public.users u
  WHERE u.id = new.author_id;

  IF v_nickname IS NULL OR btrim(v_nickname) = '' THEN
    new.author_label := '쌤버십 사용자';
  ELSE
    new.author_label := v_nickname;
  END IF;

  IF v_role IN ('student', 'mentor') THEN
    new.author_role := v_role;
  ELSE
    new.author_role := NULL;  -- admin·기타 role·사용자 행 부재 (관리자 신원 비노출)
  END IF;

  RETURN new;
END $$;

-- C-2. legacy community_comments: board 행 한정 INSERT 라벨 덮어쓰기 / UPDATE 라벨 변조 거부
CREATE FUNCTION public.community_comments_set_author_label()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_nickname text;
BEGIN
  IF tg_op = 'UPDATE' THEN
    -- board snapshot 라벨 변조를 명시적 오류로 거부한다(T-M13-10).
    -- 164 가드의 보호필드 오류코드 관행을 승계한다(신규 코드 발명 금지).
    IF new.author_label IS DISTINCT FROM old.author_label THEN
      RAISE EXCEPTION 'CC_PROTECTED_FIELDS_IMMUTABLE'
        USING errcode = '42501';
    END IF;
    RETURN new;
  END IF;

  -- INSERT(board 한정 — 트리거 WHEN 조건): 서버 라벨 덮어쓰기.
  --   community_comments.author_id 는 auth.users FK 라 public.users 행 부재가 가능하다 → fallback.
  SELECT u.nickname INTO v_nickname
  FROM public.users u
  WHERE u.id = new.author_id;

  IF v_nickname IS NULL OR btrim(v_nickname) = '' THEN
    new.author_label := '쌤버십 사용자';
  ELSE
    new.author_label := v_nickname;
  END IF;

  RETURN new;
END $$;

COMMENT ON FUNCTION public.comments_set_author_label() IS
  'S2 M13(계약 §10.4): canonical comments BEFORE INSERT 라벨·역할 서버 덮어쓰기 + BEFORE UPDATE snapshot 변조 명시 거부(TG_OP 분기).';
COMMENT ON FUNCTION public.community_comments_set_author_label() IS
  'S2 M13(계약 §10.4): legacy community_comments board 한정 BEFORE INSERT 라벨 서버 덮어쓰기 + BEFORE UPDATE snapshot 변조 명시 거부(shortform 무영향).';

-- [필수] 같은 트랜잭션에서 PUBLIC EXECUTE 회수 (supabase public 스키마 기본 GRANT 포함 회수)
REVOKE ALL ON FUNCTION public.comments_set_author_label() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_comments_set_author_label() FROM PUBLIC, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- D. INSERT 트리거 2종 (역할 ①·③ — 계약 §10.4)
--    UPDATE 보호 트리거는 백필(E) 이후에 생성한다 — 백필 UPDATE 를 막지 않기 위한
--    순서이며, 같은 트랜잭션 안이므로 중간 상태는 외부에 노출되지 않는다.
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_comments_set_author_label_ins
  BEFORE INSERT ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.comments_set_author_label();

CREATE TRIGGER trg_community_comments_set_author_label_ins
  BEFORE INSERT ON public.community_comments
  FOR EACH ROW
  WHEN (new.post_type = 'board')
  EXECUTE FUNCTION public.community_comments_set_author_label();

-- -----------------------------------------------------------------------------
-- E. 백필 1회 (계약 §6 V2 ④ — forward-only 보안 데이터 교정)
--    - comments 전행: author_label·author_role 을 현재 users.nickname/role 로 정규화.
--    - community_comments board 행: author_label 정규화. shortform 행 무접촉.
--    - 브리지 왕복 동기화는 163/164 자체의 재귀 방지 GUC(app.comment_sync,
--      트랜잭션 로컬)로 차단한다 — 브리지 본문 수정 없음. 양쪽을 같은 규칙으로
--      독립 백필하므로 board 매핑 행은 같은 라벨로 수렴한다.
--    - 016 의 updated_at 자동 갱신 트리거는 백필 동안만 비활성화해 비대상 컬럼
--      (updated_at) 불변을 보장한다(같은 트랜잭션 안에서 즉시 복원).
-- -----------------------------------------------------------------------------
SELECT set_config('app.comment_sync', '1', true);

ALTER TABLE public.community_comments DISABLE TRIGGER trg_community_comments_set_updated;

UPDATE public.comments c
SET
  author_label = CASE
    WHEN u.nickname IS NULL OR btrim(u.nickname) = '' THEN '쌤버십 사용자'
    ELSE u.nickname
  END,
  author_role = CASE
    WHEN u.role IN ('student', 'mentor') THEN u.role
    ELSE NULL
  END
FROM public.users u
WHERE u.id = c.author_id;

-- comments.author_id 는 public.users FK(NOT NULL)라 위 join 이 전행을 덮는다.
-- 방어적 확인: 미정규화 잔여 행이 있으면 중단한다(추정 진행 금지).
DO $$
DECLARE v_missed bigint;
BEGIN
  SELECT count(*) INTO v_missed
  FROM public.comments c
  WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = c.author_id);
  IF v_missed <> 0 THEN
    RAISE EXCEPTION 'BATCH_B_BASELINE_OBJECT_MISMATCH: % comments rows without public.users author (backfill incomplete)', v_missed;
  END IF;
END $$;

UPDATE public.community_comments cc
SET author_label = COALESCE(
  (SELECT CASE
            WHEN u.nickname IS NULL OR btrim(u.nickname) = '' THEN '쌤버십 사용자'
            ELSE u.nickname
          END
   FROM public.users u
   WHERE u.id = cc.author_id),
  '쌤버십 사용자')                      -- public.users 행 부재(auth.users FK) → fallback
WHERE cc.post_type = 'board';

ALTER TABLE public.community_comments ENABLE TRIGGER trg_community_comments_set_updated;

SELECT set_config('app.comment_sync', '0', true);

-- -----------------------------------------------------------------------------
-- F. snapshot UPDATE 보호 트리거 2종 (역할 ②·④ — 계약 §10.4)
--    UPDATE OF 컬럼 한정: 163/164 의 body/content/status/is_deleted/매핑 포인터
--    동기화는 라벨 컬럼을 SET 하지 않으므로 계속 허용된다(T-M13-11).
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_comments_set_author_label_upd
  BEFORE UPDATE OF author_label, author_role ON public.comments
  FOR EACH ROW
  EXECUTE FUNCTION public.comments_set_author_label();

-- post_type 은 164 가드가 불변으로 강제하므로 old 기준 board 판정이 정본이다.
CREATE TRIGGER trg_community_comments_set_author_label_upd
  BEFORE UPDATE OF author_label ON public.community_comments
  FOR EACH ROW
  WHEN (old.post_type = 'board')
  EXECUTE FUNCTION public.community_comments_set_author_label();

commit;
