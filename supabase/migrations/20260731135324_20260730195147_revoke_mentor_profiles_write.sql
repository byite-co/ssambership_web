-- =============================================================================
-- 20260730195147_revoke_mentor_profiles_write.sql (S2 M11)
-- =============================================================================
-- mentor_profiles 테이블 단위 권한 전면 회수 — XW-02 (가)·(나) 최종 잠금.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §10.6 · §20.2 M11 ·
--            §20.3 「M11 이전」 · §21 T-PERM-09·11·14 · §22 #6.
--   - rev 8 A-3: 컬럼 단위 REVOKE는 테이블 단위 권한이 남아 있으면 실효가 없다
--     (실측 확정) → 테이블 단위 REVOKE ALL + GRANT SELECT 로 교체.
--   - SELECT 는 유지한다(공개 멘토 디렉터리·앱 SELECT 2곳 — §19.4-B 실측).
--   - SECURITY DEFINER 경로(관리자 승인 RPC·가입 트리거 handle_new_auth_user·
--     service_role 의도 경로)는 테이블 단위 REVOKE 의 영향을 받지 않는다(§5.3).
-- 선행 게이트(§20.3 「M11 이전」 — 적용 세션에서 증명 완료):
--   ① M8(F7 mentor_profile_update_self) 적용 + W2 C6 전환 완료
--     (lib/mentor/mentorProfileMutations.ts·mentorSubscribeOpen.ts → F7 RPC)
--   ② M14(F13 mentor_payout_account_update_self) 적용 + C11 전환 완료
--     (lib/mentor/mentorPayoutAccountActions.ts → F13 RPC)
--   ③ syncAfterSignUpWithSession 의 mentor_profiles 백업 upsert 제거 완료
--     (lib/auth/syncAfterSignUpSession.ts — W2(C6) 주석 박제)
--   ④ 웹 anon/authenticated 제품 경로의 mentor_profiles 직접 쓰기 0건 실측.
--     service_role 의도 경로(회수 대상 아님 — 목록화):
--       lib/mentor/mentorActivityService.ts (activity_status·pause 관리)
--       lib/mentor/mentorStudentIdActions.ts (학생증 storedRef 반영)
--       lib/auth/mentorSignupStudentIdAction.ts (가입 창구 학생증 반영)
--       lib/admin/mentorAcademicRecordChangeReviewActions.ts (학적 변경 승인)
--       + 관리자 승인 SECDEF RPC(approve_mentor_school_verification_admin)
--   ⑤ 앱의 mentor_profiles 사용은 SELECT 2곳뿐(§19.4-B + 앱 Gate 4 감사
--     docs/audit/S2_2_APP_TRANSITION_GATE4_20260730.md, commit 1c5d6c019).
-- 사전 ACL 게이트: anon·authenticated 가 테이블 권한 7종(SELECT, INSERT, UPDATE,
--   DELETE, TRUNCATE, REFERENCES, TRIGGER)을 전부 보유해야 한다(§10.6 실측 baseline).
--   다른 ACL 이면 BATCH_F_M11_BASELINE_ACL_MISMATCH 로 중단한다(숨김 금지).
--   * 로컬 검증 스택은 신규 클라우드 기본(auto-expose OFF)이라 fresh clean-install
--     직후 write 권한이 없다 — 로컬 왕복 검증은 적용 전에 운영 baseline(7종)을
--     재현한 뒤 실행한다(scripts/verify/s2_2_batch_f_verify.sql 러너 절차 참조).
-- 금지: service_role·postgres 권한 변경 / RLS 정책 변경 / 테이블·컬럼·데이터 변경 /
--       컬럼 단위 REVOKE 로 축소.
-- rollback 정본: supabase/rollback/20260730195147_revoke_mentor_profiles_write_rollback.sql
--   (§22 #6 — 비SELECT 6종·역할 2종 문자 그대로 대칭 복원. SELECT 는 forward 이후에도
--    존재하므로 복원 대상이 아니다)
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 — 대상 실재 + baseline ACL 7종 실측 (읽기 전용)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_role text;
  v_priv text;
  v_has  boolean;
BEGIN
  IF to_regclass('public.mentor_profiles') IS NULL THEN
    RAISE EXCEPTION 'BATCH_F_M11_BASELINE_ACL_MISMATCH: public.mentor_profiles not found';
  END IF;
  -- 선행 migration 실재(M8 F7 / M14 F13) — §20.2.1 M11 간선
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api_web_v1'
         AND p.proname IN ('mentor_profile_update_self', 'mentor_payout_account_update_self')) <> 2 THEN
    RAISE EXCEPTION 'BATCH_F_M11_BASELINE_ACL_MISMATCH: predecessor RPC (F7/F13) missing — M8/M14 not applied';
  END IF;
  -- baseline ACL: anon·authenticated × 7종 전부 true 여야 한다(§10.6 실측 기준선).
  FOR v_role, v_priv IN
    SELECT r.rolname, p.priv
      FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
  LOOP
    v_has := has_table_privilege(v_role, 'public.mentor_profiles', v_priv);
    IF NOT v_has THEN
      RAISE EXCEPTION
        'BATCH_F_M11_BASELINE_ACL_MISMATCH: expected % % on public.mentor_profiles = true, measured false',
        v_role, v_priv;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- B. 회수 정본 (§10.6 — 문자 그대로)
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.mentor_profiles FROM anon, authenticated;
GRANT SELECT ON public.mentor_profiles TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- C. 적용 직후 게이트 — SELECT 만 true·비SELECT 전부 false·컬럼 단위 잔여 0
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_role text;
  v_priv text;
  v_has  boolean;
  v_cnt  int;
BEGIN
  FOR v_role, v_priv IN
    SELECT r.rolname, p.priv
      FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) AS p(priv)
  LOOP
    v_has := has_table_privilege(v_role, 'public.mentor_profiles', v_priv);
    IF v_priv = 'SELECT' AND NOT v_has THEN
      RAISE EXCEPTION 'M11_POST_ACL_MISMATCH: % SELECT expected true, measured false', v_role;
    ELSIF v_priv <> 'SELECT' AND v_has THEN
      RAISE EXCEPTION 'M11_POST_ACL_MISMATCH: % % expected false, measured true', v_role, v_priv;
    END IF;
  END LOOP;
  -- 컬럼 단위 잔여 write privilege 0 (rev 8 A-3 — T-PERM-09 컬럼 단위 확인)
  SELECT count(*) INTO v_cnt
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'mentor_profiles'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type <> 'SELECT';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M11_POST_ACL_MISMATCH: residual column-level write privileges = % (expected 0)', v_cnt;
  END IF;
  -- 가입 트리거·관리자 승인 SECDEF 경로 실재(기능 동작 검증은 §21.10 로컬 검증기 소유)
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'auth' AND c.relname = 'users'
                   AND NOT t.tgisinternal
                   AND t.tgfoid = 'public.handle_new_auth_user'::regproc) THEN
    RAISE EXCEPTION 'M11_POST_ACL_MISMATCH: signup trigger (handle_new_auth_user) missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public'
                    AND p.proname = 'approve_mentor_school_verification_admin'
                    AND p.prosecdef) THEN
    RAISE EXCEPTION 'M11_POST_ACL_MISMATCH: admin approval SECDEF RPC missing';
  END IF;
END $$;

commit;
