-- =============================================================================
-- 20260730195153_community_direct_write_lockdown.sql (S2 M16 — HD-1)
-- =============================================================================
-- community_posts 직접 쓰기 전면 잠금 — XW-09 최종 해소(rev 8 C).
-- 정본 계약: docs/contracts/api_web_v1_contract_v1_1.md §14.7 · §20.2 M16 ·
--            §20.3 「M16(HD-1) 이전」 · §21 T-PERM-15 · §22 #6.
-- §14.7 확대 게이트 7단계(적용 세션에서 전건 증명 완료 — LOCAL 판정):
--   1. F4/F5/F6 웹 전환(lib/community/communityBoardMutations.ts → api_web_v1 RPC 3종)
--      + 앱 전환(api_app_v1 wrapper — 앱 commit 1c5d6c019, Gate 4 감사 문서
--      docs/audit/S2_2_APP_TRANSITION_GATE4_20260730.md 264행/18,543B/4e9b4018…)
--   2. F4 응답 유실 시 동일 멱등키 replay-first 재시도 구현(웹 communityBoardMutations
--      §14.4 분기 3 · 앱 §6.3 4분기 — T-CONC-10 웹 canonical PASS + 앱 재검증 PASS)
--   3. 앱 deleteOwnPostForCompensation 제거(파일 board_author_gate.dart 전체 삭제)
--   4. 앱 DB 게시글 hard DELETE 제거(실코드 0건 — 감사 §3 실측)
--   5. 웹·앱 anon/authenticated 세션의 직접 INSERT/UPDATE/DELETE 0건 실측
--      (웹: from("community_posts") 잔존 2곳은 admin SELECT 전용 — adminReportEvidence·
--       landingPageQueries 카운트. 앱: grep 0건 — 감사 §3).
--      Storage 신규 객체 보상 삭제는 유지(제거 대상은 DB hard DELETE 뿐 — §14.7)
--   6. service_role 관리자 moderation(lib/admin/communityModerationCore.ts 직접
--      UPDATE)은 의도된 예외로 목록화 — REVOKE … FROM anon, authenticated 의
--      대상이 아니며 계속 동작한다
--   7. 본 마이그레이션(M16) 적용
--   + M17 적용·api_app_v1 LOCAL 노출·앱 Gate 4 LOCAL PASS·T-CONC-10 PASS·
--     D_API_W_LOCAL·D_API_A_LOCAL PASS·core_private 비노출 — 원격 D-API 는
--     NOT_STARTED 유지(이번 적용은 LOCAL 검증 한정, 운영 M16 승인 아님).
-- 사전 baseline(2026-07-29 운영 pg_policies 실측 전수 — §14.7):
--   제거 대상 쓰기 정책 정확히 6종:
--     INSERT: cp_write_self(authenticated) · 로그인 유저 게시글 작성(public)
--     UPDATE: cp_update_own(authenticated) · cp_update_self(authenticated) ·
--             본인 게시글 수정(public)
--     DELETE: cp_delete_own(authenticated)
--   SELECT 정책은 제거하지 않는다(cp_select_own·cp_select_published 등 유지).
--   anon·authenticated 는 테이블 권한 7종을 보유한다(§10.6 과 동일 baseline).
--   하나라도 다르면 BATCH_F_M16_POLICY_BASELINE_MISMATCH 로 중단(숨김 금지 —
--   DROP POLICY IF EXISTS 로 drift 를 은닉하지 않는다).
--   * 한글명 정책 2종(로그인 유저 게시글 작성·본인 게시글 수정)은 대시보드 생성분
--     (레포 SQL 원문 없음 — 2026-07-29 pg_policies 실측이 정본). 로컬 fresh
--     clean-install 에는 없으므로, 로컬 왕복 검증은 적용 전에 운영 baseline
--     (권한 7종 + 정책 6종)을 재현한 뒤 실행한다(s2_2_batch_f_verify.sql 러너 절차).
-- 금지: DROP POLICY IF EXISTS / CASCADE / SELECT 정책 제거 / service_role 권한 회수 /
--       Storage 정책 변경 / 숏폼 정책 변경 / 다른 커뮤니티 테이블 변경 / 데이터 변경.
-- rollback 정본: supabase/rollback/20260730195153_community_direct_write_lockdown_rollback.sql
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 — 정책 6종·ACL 7종 실측 + service_role 기준선 캡처 (읽기 전용)
-- -----------------------------------------------------------------------------
create temporary table m16_pre_state on commit drop as
select p.priv,
       has_table_privilege('service_role', 'public.community_posts', p.priv) as has
  from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
               ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as p(priv);

create temporary table m16_pre_select_policies on commit drop as
select policyname from pg_policies
 where schemaname = 'public' and tablename = 'community_posts' and cmd = 'SELECT';

DO $$
DECLARE
  v_role text;
  v_priv text;
  v_cnt  int;
BEGIN
  IF to_regclass('public.community_posts') IS NULL THEN
    RAISE EXCEPTION 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: public.community_posts not found';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.community_posts'::regclass) THEN
    RAISE EXCEPTION 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: RLS not enabled on community_posts';
  END IF;
  -- 선행 표면 실재: M7 웹 wrapper 3종 + M17 앱 wrapper 3종 (§20.2.1 M16 간선)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api_web_v1'
         AND p.proname IN ('community_post_create','community_post_update','community_post_soft_delete')) <> 3
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'api_app_v1'
            AND p.proname IN ('community_post_create','community_post_update','community_post_soft_delete')) <> 3 THEN
    RAISE EXCEPTION 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: F4/F5/F6 wrappers (M7/M17) missing';
  END IF;
  -- 쓰기 정책 6종 — 이름·cmd·roles 정확 일치(초과·부족 모두 실패)
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'community_posts'
     AND cmd IN ('INSERT','UPDATE','DELETE');
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: write policies expected 6, measured %', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'community_posts'
     AND ( (policyname = 'cp_write_self'            AND cmd = 'INSERT' AND roles = '{authenticated}')
        OR (policyname = '로그인 유저 게시글 작성'  AND cmd = 'INSERT' AND roles = '{public}')
        OR (policyname = 'cp_update_own'            AND cmd = 'UPDATE' AND roles = '{authenticated}')
        OR (policyname = 'cp_update_self'           AND cmd = 'UPDATE' AND roles = '{authenticated}')
        OR (policyname = '본인 게시글 수정'         AND cmd = 'UPDATE' AND roles = '{public}')
        OR (policyname = 'cp_delete_own'            AND cmd = 'DELETE' AND roles = '{authenticated}') );
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: write policy identity set mismatch (matched %/6)', v_cnt;
  END IF;
  -- SELECT 정책 실재(제거 금지 대상 — 최소 2종 cp_select_own·cp_select_published)
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'community_posts' AND cmd = 'SELECT'
         AND policyname IN ('cp_select_own','cp_select_published')) <> 2 THEN
    RAISE EXCEPTION 'BATCH_F_M16_POLICY_BASELINE_MISMATCH: cp_select_own/cp_select_published missing';
  END IF;
  -- baseline ACL 7종 전부 true (§10.6 동일 기준선)
  FOR v_role, v_priv IN
    SELECT r.rolname, p.priv
      FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
  LOOP
    IF NOT has_table_privilege(v_role, 'public.community_posts', v_priv) THEN
      RAISE EXCEPTION
        'BATCH_F_M16_POLICY_BASELINE_MISMATCH: expected % % on public.community_posts = true, measured false',
        v_role, v_priv;
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- B. HD-1 정본 (§14.7 — 문자 그대로)
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.community_posts FROM anon, authenticated;
GRANT SELECT ON public.community_posts TO anon, authenticated;

-- 쓰기 정책 6종 제거 — 정확한 이름·IF EXISTS 금지(부재 시 즉시 실패가 정본)
DROP POLICY "cp_write_self"           ON public.community_posts;
DROP POLICY "로그인 유저 게시글 작성" ON public.community_posts;
DROP POLICY "cp_update_own"           ON public.community_posts;
DROP POLICY "cp_update_self"          ON public.community_posts;
DROP POLICY "본인 게시글 수정"        ON public.community_posts;
DROP POLICY "cp_delete_own"           ON public.community_posts;

-- -----------------------------------------------------------------------------
-- C. 적용 직후 게이트 — SELECT 만 true·쓰기 정책 0·SELECT 정책 불변·svc 불변
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
    v_has := has_table_privilege(v_role, 'public.community_posts', v_priv);
    IF v_priv = 'SELECT' AND NOT v_has THEN
      RAISE EXCEPTION 'M16_POST_MISMATCH: % SELECT expected true, measured false', v_role;
    ELSIF v_priv <> 'SELECT' AND v_has THEN
      RAISE EXCEPTION 'M16_POST_MISMATCH: % % expected false, measured true', v_role, v_priv;
    END IF;
  END LOOP;
  -- 쓰기 정책 전무 + 제거 대상 6종 부재
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'community_posts'
     AND cmd IN ('INSERT','UPDATE','DELETE');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M16_POST_MISMATCH: write policies expected 0, measured %', v_cnt;
  END IF;
  -- SELECT 정책 불변(사전 캡처 대비 추가·소실 0)
  IF EXISTS (
      SELECT policyname FROM m16_pre_select_policies
      EXCEPT
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'community_posts' AND cmd = 'SELECT')
     OR EXISTS (
      SELECT policyname FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'community_posts' AND cmd = 'SELECT'
      EXCEPT
      SELECT policyname FROM m16_pre_select_policies) THEN
    RAISE EXCEPTION 'M16_POST_MISMATCH: SELECT policy set changed';
  END IF;
  -- service_role 권한 불변(사전 캡처 대비 diff 0)
  SELECT count(*) INTO v_cnt
    FROM m16_pre_state s
   WHERE s.has IS DISTINCT FROM
         has_table_privilege('service_role', 'public.community_posts', s.priv);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'M16_POST_MISMATCH: service_role privilege drift = % entries', v_cnt;
  END IF;
END $$;

commit;
