-- =============================================================================
-- 20260730195150_revoke_mentor_plans_write.sql (S2 M12)
-- =============================================================================
-- mentor_plans 테이블 단위 권한 전면 회수 — XW-03 최종 잠금.
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §10.6 · §20.2 M12 ·
--            §20.3 「M12 이전」 · §21 T-PERM-10 · §22 #6.
--   - SELECT 는 유지한다(공개 플랜 조회·구독 화면 가격 표시 — §10.6).
--   - DELETE 까지 회수해 authenticated 가 자기 플랜 행을 직접 지워
--     confirm_subscription_checkout / F12 를 PLAN_NOT_FOUND 로 실패시키는 경로를
--     원천 차단한다(T-PERM-10 명시 근거).
-- 선행 게이트(§20.3 「M12 이전」 — 적용 세션에서 증명 완료):
--   ① M8(F8 mentor_plan_prices_set_self) 적용 + W2 C6 전환 완료
--     (lib/mentor/mentorProfileMutations.ts → F8 RPC, 클라 선판정 제거)
--   ② 웹 anon/authenticated 제품 경로의 mentor_plans 직접 쓰기 0건 실측.
--     service_role 의도 경로(회수 대상 아님 — 목록화):
--       lib/subscribe/subscribeCheckoutService.ts:397 (권장가 seed INSERT — admin)
--       lib/mentor/mentorActivityService.ts:91·95 (is_active 토글 — admin)
--   ③ 앱의 mentor_plans 사용은 SELECT 뿐(§19.4-B + 앱 Gate 4 감사, commit 1c5d6c019).
-- 사전 ACL 게이트: anon·authenticated 가 테이블 권한 7종을 전부 보유해야 한다
--   (§10.6 실측 baseline). 다르면 BATCH_F_M12_BASELINE_ACL_MISMATCH 로 중단.
--   * 로컬 fresh clean-install 은 auto-expose OFF 라 write 권한이 없다 — 로컬 왕복
--     검증은 운영 baseline(7종) 재현 후 실행한다(M11 헤더와 동일 절차).
-- 금지: service_role·postgres 권한 변경 / RLS 정책 변경 / 테이블·컬럼·데이터 변경 /
--       컬럼 단위 REVOKE 로 축소.
-- rollback 정본: supabase/rollback/20260730195150_revoke_mentor_plans_write_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 — 대상 실재 + baseline ACL 7종 실측 (읽기 전용)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_role text;
  v_priv text;
BEGIN
  IF to_regclass('public.mentor_plans') IS NULL THEN
    RAISE EXCEPTION 'BATCH_F_M12_BASELINE_ACL_MISMATCH: public.mentor_plans not found';
  END IF;
  -- 선행 migration 실재(M8 F8) — §20.2.1 M12 간선
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'api_web_v1' AND p.proname = 'mentor_plan_prices_set_self') THEN
    RAISE EXCEPTION 'BATCH_F_M12_BASELINE_ACL_MISMATCH: predecessor RPC (F8) missing — M8 not applied';
  END IF;
  FOR v_role, v_priv IN
    SELECT r.rolname, p.priv
      FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
  LOOP
    IF NOT has_table_privilege(v_role, 'public.mentor_plans', v_priv) THEN
      RAISE EXCEPTION
        'BATCH_F_M12_BASELINE_ACL_MISMATCH: expected % % on public.mentor_plans = true, measured false',
        v_role, v_priv;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- B. 회수 정본 (§10.6 — 문자 그대로)
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.mentor_plans FROM anon, authenticated;
GRANT SELECT ON public.mentor_plans TO anon, authenticated;

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
    v_has := has_table_privilege(v_role, 'public.mentor_plans', v_priv);
    IF v_priv = 'SELECT' AND NOT v_has THEN
      RAISE EXCEPTION 'M12_POST_ACL_MISMATCH: % SELECT expected true, measured false', v_role;
    ELSIF v_priv <> 'SELECT' AND v_has THEN
      RAISE EXCEPTION 'M12_POST_ACL_MISMATCH: % % expected false, measured true', v_role, v_priv;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_cnt
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'mentor_plans'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type <> 'SELECT';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M12_POST_ACL_MISMATCH: residual column-level write privileges = % (expected 0)', v_cnt;
  END IF;
  -- F12 플랜 조회·확정 경로 실재(기능 동작 검증은 §21.10 로컬 검증기 소유)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'api_web_v1' AND p.proname = 'subscription_checkout_confirm_v2') THEN
    RAISE EXCEPTION 'M12_POST_ACL_MISMATCH: F12 subscription_checkout_confirm_v2 missing';
  END IF;
END $$;

commit;
