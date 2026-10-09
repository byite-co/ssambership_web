-- =============================================================================
-- 20260729211929_mentor_profile_privileged_column_guard.sql (S2 M0)
-- =============================================================================
-- XW-02 선행 완화 — mentor_profiles 특권 컬럼(verification_status·cap_limit) 가드.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §20.5 (rev 8 A-7 — 필수화).
--   - BEFORE INSERT OR UPDATE 트리거로 특권 컬럼 변경을
--     service_role / JWT 없는 직접 DB 세션 / 기존 admin 으로 제한한다.
--   - TG_OP 선분기: INSERT 에서 OLD 는 NULL 이므로 OLD 비교 전에 반드시 분기한다.
--   - 비교는 IS DISTINCT FROM 만 사용한다(일반 <> 금지 — NULL-safe).
--   - 트리거 함수 생성과 같은 트랜잭션에서 PUBLIC EXECUTE 를 회수한다.
--   - 119(enforce_users_role_guard)·리뷰 트리거의 기확립 관행을 복제한 심층 방어다.
-- 범위 밖(금지): mentor_profiles GRANT 회수(전면 회수는 M11), 다른 트리거·컬럼 변경.
-- rollback 정본: supabase/rollback/20260729211929_mentor_profile_privileged_column_guard_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 가드 함수 (계약 §20.5 — TG_OP 선분기 + 3분기 허용 구조)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_mentor_profile_privileged_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_jwt_role  text;
  v_sensitive boolean;
BEGIN
  -- TG_OP 선분기: INSERT 에서 OLD 는 NULL 이므로 OLD 비교 전에 반드시 분기한다.
  IF tg_op = 'INSERT' THEN
    -- 기본값 대비 판정. 28 하드코딩은 컬럼 기본값 변경 시 드리프트하는 취약점이다 —
    -- 기본값을 바꾸는 마이그레이션은 이 조건을 함께 갱신해야 한다(주석 의무).
    v_sensitive := (new.verification_status IS DISTINCT FROM 'pending'
                    OR new.cap_limit IS DISTINCT FROM 28);
  ELSE  -- 'UPDATE'
    v_sensitive := (new.verification_status IS DISTINCT FROM old.verification_status
                    OR new.cap_limit IS DISTINCT FROM old.cap_limit);
  END IF;

  IF v_sensitive THEN
    v_jwt_role := auth.jwt() ->> 'role';
    IF v_jwt_role = 'service_role' THEN RETURN new; END IF;   -- 서버 경유
    IF v_jwt_role IS NULL THEN RETURN new; END IF;            -- SQL Editor·migration
    IF EXISTS (SELECT 1 FROM public.users u
               WHERE u.id = (SELECT auth.uid()) AND u.role = 'admin') THEN
      RETURN new;                                             -- 기존 관리자
    END IF;
    RAISE EXCEPTION 'MENTOR_PROFILE_PRIVILEGED_COLUMN_FORBIDDEN'
      USING errcode = '42501';
  END IF;
  RETURN new;
END $$;

COMMENT ON FUNCTION public.enforce_mentor_profile_privileged_guard() IS
  'S2 M0(계약 §20.5): mentor_profiles.verification_status·cap_limit 변경을 service_role/JWT 없는 세션/admin 으로 제한하는 BEFORE INSERT OR UPDATE 가드.';

-- [필수 — rev 8 A-7] 트리거 함수 생성과 동일 트랜잭션에서 PUBLIC EXECUTE 회수:
REVOKE ALL ON FUNCTION public.enforce_mentor_profile_privileged_guard()
FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- B. 트리거 (이름·WHEN 조건은 계약 §20.5 와 동일 — 재실행 안전은 저장소 관행)
-- -----------------------------------------------------------------------------
-- UPDATE: 특권 컬럼이 바뀔 때만
drop trigger if exists trg_mentor_profile_privileged_guard_upd on public.mentor_profiles;
CREATE TRIGGER trg_mentor_profile_privileged_guard_upd
  BEFORE UPDATE ON public.mentor_profiles
  FOR EACH ROW
  WHEN (old.verification_status IS DISTINCT FROM new.verification_status
        OR old.cap_limit IS DISTINCT FROM new.cap_limit)
  EXECUTE FUNCTION public.enforce_mentor_profile_privileged_guard();

-- INSERT: 'pending' 이외의 verification_status 또는 기본값(28) 이외의 cap_limit 지정을 막는다 (C6)
--   (구 WHEN 조건 new.cap_limit IS NOT NULL 은 기본값 28 NOT NULL 때문에 항상 참 — 폐기)
drop trigger if exists trg_mentor_profile_privileged_guard_ins on public.mentor_profiles;
CREATE TRIGGER trg_mentor_profile_privileged_guard_ins
  BEFORE INSERT ON public.mentor_profiles
  FOR EACH ROW
  WHEN (new.verification_status IS DISTINCT FROM 'pending'
        OR new.cap_limit IS DISTINCT FROM 28)
  EXECUTE FUNCTION public.enforce_mentor_profile_privileged_guard();

commit;
