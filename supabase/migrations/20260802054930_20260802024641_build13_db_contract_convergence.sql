-- =============================================================================
-- 20260802024641_build13_db_contract_convergence.sql (S3-C)
-- =============================================================================
-- Build 13 앱이 사용할 서버 정본 수렴 — 범위 A~E 단일 forward.
--
-- 배경(실기기 재현 · 2026-08-02):
--   - 학생 게시판 새 글 등록 FAIL · 멘토 게시판 새 글 등록 FAIL
--   - 앱은 public.community_posts 에 직접 INSERT 하지만 M16(20260730195153)
--     이후 authenticated INSERT 권한·INSERT 정책이 모두 없다(= 직접 쓰기 잠금 유지).
--   - 정본 경로 api_app_v1.community_post_create RPC 는 존재하나 내부 구현부
--     core_private.community_post_create_impl 이 **승인 멘토 전용**이라
--     학생 작성이 계약과 불일치한다.
--   → 본 migration 은 직접 쓰기 잠금을 유지한 채 RPC 역할 계약만 제품 계약
--     (학생·멘토 모두 게시판 작성 가능)으로 수렴시킨다.
--
-- 범위(9종 — 세션 S3-C 지시서 §2~§6 + 교차세션 보정 §1~§4):
--   A. community_post_create 역할 계약 — active student + active mentor 허용,
--      guest/anon·admin·unknown role·banned·유효 suspended·삭제 진행 계정 거부.
--      승인 멘토 전용 제한(MENTOR_NOT_APPROVED) 제거.
--   B. 직접 UGC write 계정 상태 게이트 — comments INSERT/UPDATE ·
--      community_comments INSERT · post_reactions INSERT/DELETE ·
--      shortform_reactions INSERT/DELETE 에 계정 상태 게이트.
--      (community post RPC 는 구현부에서 동일 게이트를 수행한다 — 보존)
--   C. content_reports 필드 무결성 — 일반 사용자 INSERT 시 reporter_id·status·
--      admin_note·resolved_by·resolved_at·target_type 를 서버가 강제(위조 거부).
--   D. account_deletion_write_blocked self 제한 — 일반 authenticated 는 자기
--      UUID만 조회, 타인 UUID 는 명시적 거부. 내부/서비스 문맥은 무제한 유지.
--   E. latent custom-order 공개 SELECT 정책 4종 제거(당사자·관리자 정책 유지).
--   F. [보정 §1] ugc_write_allowed() fail-closed 전환 — "차단 목록"이 아니라
--      **허용 목록**으로 뒤집는다. users 자기 행 부재·admin·deleted·unknown
--      status·status NULL 이 전부 false 다(comments/community_comments/
--      post_reactions 는 users FK 가 없어 helper 자체가 fail-closed 여야 한다).
--   G. [보정 §2] community_post_update 역할 계약 수렴 — F5 도 create 와 동일하게
--      active student + active mentor 자기 글 수정 허용, 승인 요구 제거.
--   H. [보정 §3] 질문방 서버 차단·계정 상태 게이트 — public.qna_append_message /
--      public.qna_register_attachment 에 상호 차단(qna_users_blocked) + 계정
--      상태 4종 게이트를 **당사자 확정 직후·모든 INSERT/상태 전이 이전**에 삽입.
--   I. [보정 §4] target_type='user' 신고 무결성 — 자기 신고 거부 + 대상 사용자
--      실재 강제(public.report_target_user_valid).
--
-- 보존 불변(변경 금지 — 지시서 §2 「반드시 보존」 + 보정 §2·§3 「반드시 보존」):
--   [create] replay-first · idempotency key · 동시 경합 수렴 · title/body/
--     category/draft·published 검증 · 연락처 마스킹 · image_refs 검증 ·
--     author_label·author_role 서버 도출.
--   [update] post row FOR UPDATE · p_expected_updated_at 낙관적 충돌
--     (UPDATE_CONFLICT) · title/body/category/status 검증 · 연락처 마스킹 ·
--     image_refs 검증 · removed_image_refs 차집합 반환.
--   [qna] thread FOR UPDATE · NOT_ROOM_PARTY · THREAD_LOCKED · mentor approval ·
--     구독/환불 게이트 · storage path·소유권 검증 · message/thread 정합 ·
--     INSERT · answered 전이 · 알림 트리거 의미 · 반환 envelope.
--   community_posts direct INSERT/UPDATE 권한 미복구.
--   RPC 시그니처 전부 불변(api_web_v1 / api_app_v1 wrapper 3종 · public qna 2종)
--   — 본 파일은 wrapper 를 건드리지 않고 구현부·정본 함수 본문만
--   CREATE OR REPLACE 한다. contract_version 도 불변(1).
--
-- 재실행 안전성(§7):
--   모든 DDL 이 CREATE OR REPLACE / DROP POLICY IF EXISTS + CREATE POLICY 이며,
--   사전 게이트는 **pre-state 와 post-state 양쪽에서 참인 구조적 사실**만
--   단언한다(정책 실재·cmd·roles·컬럼·RLS). 최종 상태의 정확한 정의는 섹션 I
--   자가 검증이 보증한다 — drift 은닉이 아니라 "게이트는 구조, 보증은 사후검증"
--   분리다. 범위 E 의 제거 대상 4종만 예외적으로 identity(cmd·roles·qual='true')
--   까지 단언하고 부분 집합(1~3개 잔존)이면 즉시 중단한다.
--
-- 선행조건: M7(20260730105252) · M17(20260730112525) · M16(20260730195153) 적용 완료.
-- rollback 정본: supabase/rollback/20260802024641_build13_db_contract_convergence_rollback.sql
-- 운영 적용: 금지(본 세션은 파일 생성·로컬 검증까지). PRODUCTION_APPLIED = NO.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- A. 사전 게이트 (수정 0건 중단 원칙)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
BEGIN
  -- ① 선행 표면 실재 — M7 공용 구현부 identity + M17 앱 wrapper
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'core_private' AND p.proname = 'community_post_create_impl'
                    AND pg_get_function_identity_arguments(p.oid)
                        = 'p_author_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_idempotency_key uuid') THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: core_private.community_post_create_impl identity mismatch (M7 미적용?)';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('api_web_v1', 'api_app_v1')
         AND p.proname = 'community_post_create'
         AND pg_get_function_identity_arguments(p.oid)
             = 'p_title text, p_body text, p_category text, p_idempotency_key uuid, p_image_refs text[], p_status text') <> 2 THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: community_post_create wrapper 2종(web·app) identity mismatch';
  END IF;
  -- 보정 G — update 구현부·wrapper identity
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'core_private' AND p.proname = 'community_post_update_impl'
                    AND pg_get_function_identity_arguments(p.oid)
                        = 'p_author_id uuid, p_post_id uuid, p_title text, p_body text, p_category text, p_image_refs text[], p_status text, p_expected_updated_at timestamp with time zone') THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: core_private.community_post_update_impl identity mismatch';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('api_web_v1', 'api_app_v1')
         AND p.proname = 'community_post_update'
         AND pg_get_function_identity_arguments(p.oid)
             = 'p_post_id uuid, p_title text, p_body text, p_category text, p_expected_updated_at timestamp with time zone, p_image_refs text[], p_status text') <> 2 THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: community_post_update wrapper 2종(web·app) identity mismatch';
  END IF;

  -- 보정 H — 질문방 정본 RPC identity + 게이트가 의존하는 helper 실재
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'qna_append_message'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_thread_id uuid, p_body text'
                    AND p.prosecdef) THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: public.qna_append_message(uuid,text) identity mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'qna_register_attachment'
                    AND pg_get_function_identity_arguments(p.oid)
                        = 'p_thread_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_message_id uuid'
                    AND p.prosecdef) THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: public.qna_register_attachment identity mismatch';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND (p.proname, pg_get_function_identity_arguments(p.oid)) IN
             (('qna_users_blocked', 'p_a uuid, p_b uuid'),
              ('qna_subscription_has_live_refund', 'p_subscription_id uuid'),
              ('individual_question_user_is_approved_mentor', 'p_user_id uuid'))) <> 3 THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: qna 게이트 helper 3종 identity mismatch';
  END IF;

  -- 보정 F/I — 상태 판정에 쓰는 users 컬럼 + 신고 대상 검증에 쓰는 users PK
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'users'
         AND column_name IN ('id', 'role', 'status', 'suspended_until')) <> 4 THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: users 상태 판정 컬럼 집합 불일치';
  END IF;

  -- ② community_posts 직접 쓰기 잠금 실재(M16) — 본 migration 은 이를 복구하지 않는다
  IF has_table_privilege('authenticated', 'public.community_posts', 'INSERT')
     OR has_table_privilege('anon', 'public.community_posts', 'INSERT')
     OR (SELECT count(*) FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'community_posts'
            AND cmd IN ('INSERT', 'UPDATE', 'DELETE')) <> 0 THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: community_posts 직접 쓰기 잠금(M16) 미충족';
  END IF;

  -- ③ 범위 D 대상 함수 identity
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'account_deletion_write_blocked'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid'
                    AND p.prosecdef) THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: public.account_deletion_write_blocked(uuid) SECDEF 부재';
  END IF;
  IF to_regclass('public.account_deletion_jobs') IS NULL THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: public.account_deletion_jobs 부재';
  END IF;

  -- ④ 범위 B 대상 테이블·정책 구조(pre/post 공통 참) — RLS 활성 + 대상 정책 실재
  FOR v_cnt IN
    SELECT 1 FROM (VALUES ('comments'), ('community_comments'),
                          ('post_reactions'), ('shortform_reactions'), ('content_reports')) AS t(rel)
     WHERE NOT coalesce((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                          WHERE n.nspname = 'public' AND c.relname = t.rel), false)
  LOOP
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: 범위 B/C 대상 테이블에 RLS 미활성';
  END LOOP;
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public'
     AND (tablename, policyname, cmd, roles::text) IN
         (('comments',             'comments_insert_own',                    'INSERT', '{authenticated}'),
          ('comments',             'comments_update_own',                    'UPDATE', '{authenticated}'),
          ('community_comments',   'community_comments_insert_authenticated','INSERT', '{authenticated}'),
          ('post_reactions',       'post_reactions_insert_own',              'INSERT', '{authenticated}'),
          ('post_reactions',       'post_reactions_delete_own',              'DELETE', '{authenticated}'),
          ('shortform_reactions',  'shortform_reactions_insert_own',         'INSERT', '{authenticated}'),
          ('shortform_reactions',  'shortform_reactions_delete_own',         'DELETE', '{authenticated}'),
          ('content_reports',      'content_reports_insert_reporter',        'INSERT', '{authenticated}'));
  IF v_cnt <> 8 THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: 범위 B/C 대상 정책 8종 identity 불일치(matched %/8)', v_cnt;
  END IF;

  -- ⑤ 범위 B — post_reactions 한글명 중복 정책(대시보드 생성분)은 permissive OR 로
  --    게이트를 무력화하므로 제거 대상이다. 2종 전부 또는 전무만 허용(부분 = drift).
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'post_reactions'
     AND (policyname, cmd, roles::text) IN
         (('로그인 유저 반응 추가', 'INSERT', '{public}'),
          ('본인 반응 삭제',        'DELETE', '{public}'));
  IF v_cnt NOT IN (0, 2) THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: post_reactions 한글명 중복 쓰기 정책 부분 존재(measured %)', v_cnt;
  END IF;

  -- ⑥ 범위 C — content_reports 관리 필드 컬럼 전수
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'content_reports'
         AND column_name IN ('reporter_id','target_type','target_id','status',
                             'admin_note','resolved_by','resolved_at')) <> 7 THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: content_reports 관리 필드 컬럼 집합 불일치';
  END IF;
  -- 관리자 UPDATE 경로 보존 대상 실재
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'content_reports'
                    AND policyname = 'content_reports_update_admin' AND cmd = 'UPDATE') THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: content_reports_update_admin 부재(관리자 경로 유실)';
  END IF;

  -- ⑦ 범위 E — 제거 대상 permissive public SELECT 4종. 전부(4) 또는 전무(0)만 허용.
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public' AND cmd = 'SELECT' AND roles::text = '{public}'
     AND btrim(coalesce(qual, '')) = 'true'
     AND (tablename, policyname) IN
         (('custom_order_deliverables',    '누구나 납품 읽기'),
          ('custom_order_messages',        '누구나 메시지 읽기'),
          ('custom_request_applications',  '누구나 지원서 읽기'),
          ('custom_request_posts',         '누구나 의뢰 읽기'));
  IF v_cnt NOT IN (0, 4) THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: custom_* public SELECT 정책 부분 존재(measured %/4)', v_cnt;
  END IF;
  -- 유지 대상(당사자·관리자) 4종 실재 — 제거로 정당 경로가 끊기지 않음을 사전 증명
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND cmd = 'SELECT'
         AND (tablename, policyname) IN
             (('custom_order_deliverables',   'cdel_select'),
              ('custom_order_messages',       'cmsg_all_party'),
              ('custom_request_applications', 'cra_select'),
              ('custom_request_posts',        'crp_select'))) <> 4 THEN
    RAISE EXCEPTION 'S3C_BASELINE_MISMATCH: custom_* 당사자·관리자 SELECT 정책 4종 부재';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- B. 범위 D — account_deletion_write_blocked self 제한
-- -----------------------------------------------------------------------------
-- 기존: SECDEF + authenticated EXECUTE → 로그인 사용자가 **타인 UUID** 를 넘겨
--   삭제 진행 여부를 probe 할 수 있었다(정보 유출).
-- 신규 계약:
--   - auth.uid() IS NOT NULL(= 최종 사용자 JWT 문맥): p_user_id 는 자기 UUID 만
--     허용. 그 외(타인·NULL)는 ACCOUNT_DELETION_PROBE_FORBIDDEN(SQLSTATE 42501) 거부.
--   - auth.uid() IS NULL(= service_role 키·내부 worker·postgres 직결 문맥):
--     JWT sub 가 없으므로 종전대로 임의 UUID 조회 허용(worker 계약 보존).
--   - 시그니처·반환형·EXECUTE 대상(authenticated·service_role) 불변 →
--     현행 앱의 "자기 userId" 호출과 기존 호출자 전건이 그대로 동작한다.
-- 기존 호출자 실측(2026-08-02): storage.objects 정책 5종 · public.account_deletion_write_guard()
--   · core_private.ensure_student_mentor_room · community_post_{create,update,soft_delete}_impl
--   · api_web_v1.mentor_{profile_update_self,plan_prices_set_self,payout_account_update_self}
--   — **전건이 auth.uid() 또는 그와 동일한 자기 UUID 를 전달**하므로 회귀 없음.
CREATE OR REPLACE FUNCTION public.account_deletion_write_blocked(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NOT NULL AND p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_PROBE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.account_deletion_jobs j
     WHERE j.user_id = p_user_id
       AND j.state IN ('locked', 'purging', 'storage_purged', 'finalized', 'auth_soft_deleted')
  );
END $fn$;

COMMENT ON FUNCTION public.account_deletion_write_blocked(uuid) IS
  'S3-C 범위 D: 삭제 진행 write 차단 판정. 최종 사용자 JWT 문맥에서는 self UUID 만 허용(타인 probe 는 42501 ACCOUNT_DELETION_PROBE_FORBIDDEN). service_role·내부 문맥(auth.uid() IS NULL)은 종전대로 무제한.';

REVOKE ALL ON FUNCTION public.account_deletion_write_blocked(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_deletion_write_blocked(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C. 범위 B 공용 helper — public.ugc_write_allowed()
-- -----------------------------------------------------------------------------
-- 인자 없는 self 전용 판정기다. **UUID 인자를 두지 않는 것이 설계의 핵심** —
--   호출자가 타인 상태를 probe 할 수 있는 표면 자체를 만들지 않는다(범위 D 와 동일 원칙).
-- SECURITY DEFINER 근거: public.users 는 RLS 대상이라 invoker 문맥에서는 자기 행조차
--   정책에 좌우된다. 게이트가 RLS 에 재귀 의존하지 않도록 definer 로 고정하고,
--   search_path='' + 완전 수식 + PUBLIC/anon EXECUTE 0 으로 표면을 최소화한다.
-- [보정 §1] **fail-closed 허용 목록**이다. 종전 "차단 목록"(명시 3상태만 막고 나머지는
--   허용) 구현은 폐기한다 — comments·community_comments·post_reactions 는 users 로의
--   FK 가 없어 "users 행이 없으면 허용"이 곧 우회로가 되기 때문이다.
-- true 조건(전건 AND):
--   ① auth.uid() non-null
--   ② public.users 에 자기 행이 실재
--   ③ role IN ('student','mentor')
--   ④ status = 'active'  또는  status = 'suspended' 이면서 suspended_until <= now()
--      (= 정지 만료)
--   ⑤ account_deletion_write_blocked(self) = false
-- 따라서 다음은 전부 false: users 행 부재 · admin · deleted · unknown status ·
--   status NULL · banned · 유효 suspended(suspended_until NULL 또는 미래) ·
--   삭제 write-blocked · 미인증.
-- SECURITY DEFINER 근거: public.users 는 RLS 대상(자기 행 SELECT 만 허용)이므로
--   invoker 문맥에서는 게이트가 RLS 에 재귀 의존한다. definer 로 고정하고
--   search_path='' + 완전 수식 + PUBLIC/anon EXECUTE 0 으로 표면을 최소화한다.
-- auth.uid() 가 NULL 이면 ② 가 false 라 EXISTS 가 false 이고,
--   account_deletion_write_blocked(NULL) 은 JWT 없는 문맥에서 예외 없이 false 를
--   반환하므로 전체가 false 로 수렴한다(예외 전파 없음).
CREATE OR REPLACE FUNCTION public.ugc_write_allowed()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT EXISTS (
           SELECT 1 FROM public.users u
            WHERE u.id = (SELECT auth.uid())
              AND u.role IN ('student', 'mentor')
              AND ( lower(btrim(coalesce(u.status, ''))) = 'active'
                 OR ( lower(btrim(coalesce(u.status, ''))) = 'suspended'
                      AND u.suspended_until IS NOT NULL
                      AND u.suspended_until <= now() ) )
         )
         AND NOT public.account_deletion_write_blocked((SELECT auth.uid()))
$fn$;

COMMENT ON FUNCTION public.ugc_write_allowed() IS
  'S3-C 범위 B(보정 §1): 직접 UGC write(댓글·반응) 계정 상태 게이트. self 전용(인자 없음) · **fail-closed 허용 목록** — users 자기 행 실재 + role student|mentor + (active | 정지 만료) + 삭제 write-blocked 아님 일 때만 true. users 행 부재·admin·deleted·unknown·NULL status 는 전부 false. 신고·차단·계정삭제·고객지원 경로에는 적용하지 않는다.';

REVOKE ALL ON FUNCTION public.ugc_write_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ugc_write_allowed() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C-2. 보정 §4 helper — public.report_target_user_valid(uuid)
-- -----------------------------------------------------------------------------
-- target_type='user' 신고의 대상 무결성 판정기.
--   true 조건: p_target_id non-null · auth.uid() 와 다름(자기 신고 금지) ·
--              public.users 에 실재.
-- SECURITY DEFINER 근거: public.users RLS 는 authenticated 에게 **자기 행만** 보인다
--   (users_select_own · users_admin_select_all 실측). invoker 문맥의 EXISTS 는
--   타인 UUID 에 대해 항상 false 가 되어 계약이 정반대로 뒤집힌다.
-- 표면 최소화: 두 판정(비-self · 실재)을 하나의 boolean 으로 묶어, 신고 기능이
--   본질적으로 노출할 수밖에 없는 "이 UUID 를 신고 대상으로 쓸 수 있는가" 외의
--   정보를 반환하지 않는다. PUBLIC/anon EXECUTE 0.
CREATE OR REPLACE FUNCTION public.report_target_user_valid(p_target_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT p_target_id IS NOT NULL
     AND p_target_id IS DISTINCT FROM (SELECT auth.uid())
     AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_target_id)
$fn$;

COMMENT ON FUNCTION public.report_target_user_valid(uuid) IS
  'S3-C 보정 §4: content_reports target_type=''user'' 대상 무결성 — 자기 신고 거부 + 대상 사용자 실재 강제. users RLS(자기 행만 조회) 때문에 SECDEF 필수.';

REVOKE ALL ON FUNCTION public.report_target_user_valid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_target_user_valid(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- D. 범위 A — core_private.community_post_create_impl 역할 계약 수렴
-- -----------------------------------------------------------------------------
-- 변경점은 **역할 게이트 1블록**뿐이다.
--   구: users.role = 'mentor' 아니면 ROLE_NOT_MENTOR
--       + individual_question_user_is_approved_mentor() 아니면 MENTOR_NOT_APPROVED
--   신: users.role IN ('student','mentor') 아니면 ROLE_NOT_ALLOWED
--       (승인 여부는 게시판 작성 자격과 무관 — 제품 계약)
-- 그 외 전부 문자 그대로 보존: replay-first · 멱등키 필수 · 계정 3상태 게이트 ·
--   status(draft|published) · title · category · body 최소 길이 · 연락처 마스킹
--   6단계(순서 동일) · B-4 이미지 검증 · INSERT 컬럼·author_label/author_role 도출 ·
--   ON CONFLICT DO NOTHING 후 동시 경합 재생 수렴.
-- 오류코드 영향(S3-D·S3-E 인수인계):
--   - 신설: ROLE_NOT_ALLOWED (admin·unknown role·users 행 부재)
--   - create 경로에서 더 이상 발생하지 않음: ROLE_NOT_MENTOR · MENTOR_NOT_APPROVED
--     (두 코드는 update 경로 F5 에서 계속 유효 — 본 세션 범위는 create 뿐이다)
CREATE OR REPLACE FUNCTION core_private.community_post_create_impl(
  p_author_id uuid, p_title text, p_body text, p_category text,
  p_image_refs text[], p_status text, p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
  v_role     text;
  v_status   text;
  v_susp     timestamptz;
  v_nickname text;
  v_title    text;
  v_body     text;
  v_val      jsonb;
  v_id       uuid;
  v_norm     text;
BEGIN
  IF p_author_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  END IF;
  -- 멱등키 필수(§14.4) — 계약 밖 입력은 전파(§8.2)
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'p_idempotency_key is required';
  END IF;

  -- [replay-first — 신규 쓰기 검증보다 먼저] 기존 커밋 행 재생 (§7 F4 1~2단계)
  SELECT cp.id INTO v_id FROM public.community_posts cp
   WHERE cp.author_id = p_author_id AND cp.create_idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'post_id', v_id, 'idempotent_replay', true);
  END IF;

  -- [신규 쓰기 검증 — 역할 → 계정 → 본문 → 이미지]
  SELECT u.role, u.status, u.suspended_until, u.nickname
    INTO v_role, v_status, v_susp, v_nickname
    FROM public.users u WHERE u.id = p_author_id;
  -- S3-C 범위 A: 게시판 작성 자격 = active student + active mentor.
  -- admin·unknown role·users 행 부재는 ROLE_NOT_ALLOWED 로 거부한다.
  IF NOT FOUND OR v_role IS NULL OR v_role NOT IN ('student', 'mentor') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROLE_NOT_ALLOWED');
  END IF;
  -- [보정 2차 §1] 계정 상태는 **positive allowlist** 다(fail-open 금지).
  --   허용: 'active' | ('suspended' 이고 suspended_until <= now() = 정지 만료)
  --   그 외(deleted·dormant·빈 문자열·NULL·미지 값)는 ACCOUNT_NOT_ACTIVE.
  --   banned·유효 suspended 는 기존 전용 코드를 유지한다(먼저 판정).
  v_norm := lower(btrim(coalesce(v_status, '')));
  IF v_norm = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF v_norm = 'suspended' AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_SUSPENDED');
  END IF;
  IF NOT (v_norm = 'active'
          OR (v_norm = 'suspended' AND v_susp IS NOT NULL AND v_susp <= now())) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_ACTIVE');
  END IF;
  IF public.account_deletion_write_blocked(p_author_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  END IF;
  IF p_status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'p_status must be draft|published';
  END IF;
  v_title := btrim(coalesce(p_title, ''));
  IF v_title = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TITLE_REQUIRED');
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('study', 'school', 'career', 'college', 'free') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CATEGORY_INVALID');
  END IF;
  v_body := btrim(coalesce(p_body, ''));
  IF p_status = 'published' AND char_length(v_body) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BODY_TOO_SHORT');
  END IF;

  -- [연락처 마스킹 — lib/customRequest/contactMasking.ts 정본 이식, 적용 순서 동일.
  --  제목·본문 모두 마스킹(웹 실측 동작). 금지어 검사 없음(rev 8 D — B-04 동결)]
  v_title := regexp_replace(v_title, '(^|[^0-9])(\+82[-._\s]?0?1[0-9][-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4}|0(?:10|11|16|17|18|19|2|[3-6][1-5]|50|70|80)[-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4})(?![0-9])', '\1[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(^|[^0-9])(\+82[-._\s]?0?1[0-9][-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4}|0(?:10|11|16|17|18|19|2|[3-6][1-5]|50|70|80)[-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4})(?![0-9])', '\1[연락처 비공개]', 'g');
  v_title := regexp_replace(v_title, '(공일공|영일영)[\s\-._]*[0-9공영일이삼사오육칠팔구][0-9공영일이삼사오육칠팔구\s\-._]{6,12}', '[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(공일공|영일영)[\s\-._]*[0-9공영일이삼사오육칠팔구][0-9공영일이삼사오육칠팔구\s\-._]{6,12}', '[연락처 비공개]', 'g');
  v_title := regexp_replace(v_title, '[A-Za-z0-9._%+-]+\s*[\[({（]\s*at\s*[\])}）]\s*[A-Za-z0-9.-]+\s*(?:[\[({（]\s*dot\s*[\])}）]|\.)\s*[A-Za-z]{2,}', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '[A-Za-z0-9._%+-]+\s*[\[({（]\s*at\s*[\])}）]\s*[A-Za-z0-9.-]+\s*(?:[\[({（]\s*dot\s*[\])}）]|\.)\s*[A-Za-z]{2,}', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '\y(?:open\.kakao\.com|kakaotalk\.com|t\.me|telegram\.me|instagram\.com|instagr\.am|linktr\.ee)(?:/[^\s<>"'']*)?', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '\y(?:open\.kakao\.com|kakaotalk\.com|t\.me|telegram\.me|instagram\.com|instagr\.am|linktr\.ee)(?:/[^\s<>"'']*)?', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '(카카오톡|카톡|오픈채팅|텔레그램|인스타그램|인스타|디엠)\s*[:：=]?\s*@?[A-Za-z0-9._-]{4,}', '[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(카카오톡|카톡|오픈채팅|텔레그램|인스타그램|인스타|디엠)\s*[:：=]?\s*@?[A-Za-z0-9._-]{4,}', '[연락처 비공개]', 'g');

  -- 이미지 ref 검증 (B-4 공용 검증기)
  v_val := core_private.community_image_refs_validate(p_author_id, coalesce(p_image_refs, '{}'::text[]));
  IF NOT coalesce((v_val ->> 'ok')::boolean, false) THEN
    RETURN v_val;
  END IF;

  -- INSERT (컬럼 집합 = 현행 웹 insertCommunityBoardPost 동일. author_label/role 서버 도출)
  INSERT INTO public.community_posts
    (author_id, title, body, content, category, image_urls, hashtags, status,
     author_label, author_role, create_idempotency_key)
  VALUES
    (p_author_id, v_title, v_body, v_body, p_category,
     coalesce(p_image_refs, '{}'::text[]), '{}'::text[], p_status,
     coalesce(nullif(btrim(v_nickname), ''), '쌤버십 사용자'),
     CASE WHEN v_role IN ('student', 'mentor') THEN v_role END,
     p_idempotency_key)
  ON CONFLICT (author_id, create_idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  -- 동시 경합 패자 → 재생 수렴 (T-CONC-06)
  IF v_id IS NULL THEN
    SELECT cp.id INTO v_id FROM public.community_posts cp
     WHERE cp.author_id = p_author_id AND cp.create_idempotency_key = p_idempotency_key;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'community_post_create_impl: idempotent insert not observable';
    END IF;
    RETURN jsonb_build_object('ok', true, 'post_id', v_id, 'idempotent_replay', true);
  END IF;

  RETURN jsonb_build_object('ok', true, 'post_id', v_id, 'idempotent_replay', false);
END $fn$;

COMMENT ON FUNCTION core_private.community_post_create_impl(uuid, text, text, text, text[], text, uuid) IS
  'S3-C 범위 A(M7 B-1 승계): 게시글 생성 공용 구현부 — replay-first 멱등 · **active student + active mentor** 작성 허용(admin·unknown = ROLE_NOT_ALLOWED) · 계정 3상태 게이트 · 마스킹 · B-4 이미지 검증. 외부 EXECUTE 0.';

-- -----------------------------------------------------------------------------
-- D-2. 보정 §2(범위 G) — core_private.community_post_update_impl 역할 계약 수렴
-- -----------------------------------------------------------------------------
-- 제품 정본은 "학생·멘토 모두 커뮤니티 전 기능"이다. create 만 수렴시키고 update 를
-- 승인 멘토 전용으로 남기면 학생이 **자기 글을 쓰고 지울 수는 있으나 고칠 수 없는**
-- 비대칭이 생기므로, F5 도 create 와 동일한 역할 게이트로 수렴한다.
--   구: role = 'mentor' 아니면 ROLE_NOT_MENTOR + 미승인이면 MENTOR_NOT_APPROVED
--   신: role IN ('student','mentor') 아니면 ROLE_NOT_ALLOWED (승인 요구 없음)
-- 그 외 전부 문자 그대로 보존: 소유 행 FOR UPDATE(비존재·타인 글·삭제 글 모두
--   POST_NOT_FOUND_OR_NOT_OWNED 단일 코드) · 계정 3상태 게이트 · 낙관적 충돌
--   (p_expected_updated_at → UPDATE_CONFLICT) · status/title/category/body 검증 ·
--   연락처 마스킹 6단계(순서 동일) · B-4 이미지 검증 · removed_image_refs 차집합 ·
--   UPDATE 컬럼 집합. wrapper 시그니처·contract_version 불변.
CREATE OR REPLACE FUNCTION core_private.community_post_update_impl(
  p_author_id uuid, p_post_id uuid, p_title text, p_body text, p_category text,
  p_image_refs text[], p_status text, p_expected_updated_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE
  v_role       text;
  v_status     text;
  v_susp       timestamptz;
  v_post       record;
  v_title      text;
  v_body       text;
  v_val        jsonb;
  v_removed    text[];
  v_updated_at timestamptz;
  v_norm       text;
BEGIN
  IF p_author_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  END IF;
  IF p_post_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'POST_NOT_FOUND_OR_NOT_OWNED');
  END IF;

  -- 소유 행 잠금 (비존재·타인 글·삭제 글 동일 코드 — §9.4)
  SELECT cp.id, cp.image_urls, cp.updated_at INTO v_post
    FROM public.community_posts cp
   WHERE cp.id = p_post_id AND cp.author_id = p_author_id AND cp.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'POST_NOT_FOUND_OR_NOT_OWNED');
  END IF;

  -- 역할·계정 (S3-C 보정 §2: 학생 글 수정 거부 규칙 폐기 — create 와 **문자 그대로 동일** 계약)
  SELECT u.role, u.status, u.suspended_until INTO v_role, v_status, v_susp
    FROM public.users u WHERE u.id = p_author_id;
  IF NOT FOUND OR v_role IS NULL OR v_role NOT IN ('student', 'mentor') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROLE_NOT_ALLOWED');
  END IF;
  -- [보정 2차 §1] create 와 동일한 positive allowlist (fail-open 금지)
  v_norm := lower(btrim(coalesce(v_status, '')));
  IF v_norm = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF v_norm = 'suspended' AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_SUSPENDED');
  END IF;
  IF NOT (v_norm = 'active'
          OR (v_norm = 'suspended' AND v_susp IS NOT NULL AND v_susp <= now())) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_ACTIVE');
  END IF;
  IF public.account_deletion_write_blocked(p_author_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  END IF;

  -- 낙관적 충돌 검사 (§7 F5)
  IF v_post.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UPDATE_CONFLICT');
  END IF;

  IF p_status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'p_status must be draft|published';
  END IF;
  v_title := btrim(coalesce(p_title, ''));
  IF v_title = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TITLE_REQUIRED');
  END IF;
  IF p_category IS NULL OR p_category NOT IN ('study', 'school', 'career', 'college', 'free') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CATEGORY_INVALID');
  END IF;
  v_body := btrim(coalesce(p_body, ''));
  IF p_status = 'published' AND char_length(v_body) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BODY_TOO_SHORT');
  END IF;

  -- [연락처 마스킹 — B-1 과 동일 정본 이식(contactMasking.ts) · 동일 순서]
  v_title := regexp_replace(v_title, '(^|[^0-9])(\+82[-._\s]?0?1[0-9][-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4}|0(?:10|11|16|17|18|19|2|[3-6][1-5]|50|70|80)[-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4})(?![0-9])', '\1[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(^|[^0-9])(\+82[-._\s]?0?1[0-9][-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4}|0(?:10|11|16|17|18|19|2|[3-6][1-5]|50|70|80)[-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4})(?![0-9])', '\1[연락처 비공개]', 'g');
  v_title := regexp_replace(v_title, '(공일공|영일영)[\s\-._]*[0-9공영일이삼사오육칠팔구][0-9공영일이삼사오육칠팔구\s\-._]{6,12}', '[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(공일공|영일영)[\s\-._]*[0-9공영일이삼사오육칠팔구][0-9공영일이삼사오육칠팔구\s\-._]{6,12}', '[연락처 비공개]', 'g');
  v_title := regexp_replace(v_title, '[A-Za-z0-9._%+-]+\s*[\[({（]\s*at\s*[\])}）]\s*[A-Za-z0-9.-]+\s*(?:[\[({（]\s*dot\s*[\])}）]|\.)\s*[A-Za-z]{2,}', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '[A-Za-z0-9._%+-]+\s*[\[({（]\s*at\s*[\])}）]\s*[A-Za-z0-9.-]+\s*(?:[\[({（]\s*dot\s*[\])}）]|\.)\s*[A-Za-z]{2,}', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '\y(?:open\.kakao\.com|kakaotalk\.com|t\.me|telegram\.me|instagram\.com|instagr\.am|linktr\.ee)(?:/[^\s<>"'']*)?', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '\y(?:open\.kakao\.com|kakaotalk\.com|t\.me|telegram\.me|instagram\.com|instagr\.am|linktr\.ee)(?:/[^\s<>"'']*)?', '[연락처 비공개]', 'gi');
  v_title := regexp_replace(v_title, '(카카오톡|카톡|오픈채팅|텔레그램|인스타그램|인스타|디엠)\s*[:：=]?\s*@?[A-Za-z0-9._-]{4,}', '[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(카카오톡|카톡|오픈채팅|텔레그램|인스타그램|인스타|디엠)\s*[:：=]?\s*@?[A-Za-z0-9._-]{4,}', '[연락처 비공개]', 'g');

  v_val := core_private.community_image_refs_validate(p_author_id, coalesce(p_image_refs, '{}'::text[]));
  IF NOT coalesce((v_val ->> 'ok')::boolean, false) THEN
    RETURN v_val;
  END IF;

  -- 제거된 ref 차집합 (클라이언트가 commit 후 best-effort 삭제 — §14.4)
  v_removed := ARRAY(SELECT unnest(coalesce(v_post.image_urls, '{}'::text[]))
                     EXCEPT
                     SELECT unnest(coalesce(p_image_refs, '{}'::text[])));

  UPDATE public.community_posts cp
     SET title = v_title, body = v_body, content = v_body, category = p_category,
         image_urls = coalesce(p_image_refs, '{}'::text[]), status = p_status,
         updated_at = now()
   WHERE cp.id = p_post_id
   RETURNING cp.updated_at INTO v_updated_at;

  RETURN jsonb_build_object('ok', true, 'post_id', p_post_id, 'updated_at', v_updated_at,
                            'removed_image_refs', to_jsonb(coalesce(v_removed, '{}'::text[])));
END $fn$;

COMMENT ON FUNCTION core_private.community_post_update_impl(uuid, uuid, text, text, text, text[], text, timestamptz) IS
  'S3-C 보정 §2(M7 B-2 승계): 게시글 수정 공용 구현부 — **active student + active mentor** 자기 글 수정 허용(admin·unknown = ROLE_NOT_ALLOWED, 승인 요구 없음) · 소유·낙관 충돌·마스킹·B-4 검증·removed_image_refs. 외부 EXECUTE 0.';

-- -----------------------------------------------------------------------------
-- D-3. 보정 §3(범위 H) — 질문방 서버 차단·계정 상태 게이트
-- -----------------------------------------------------------------------------
-- S3-E 실측 결과 해소:
--   - qna_append_message: 상호 차단 검사 없음 · banned 만 검사(suspended/삭제 누락)
--   - qna_register_attachment: 계정 상태 검사 자체가 없음 · 상호 차단 검사 없음
-- 게이트 위치: **방 당사자를 확정한 직후**(v_is_mentor 결정 후), THREAD_LOCKED ·
--   mentor approval · 구독/환불 · storage 검증 · 어떤 INSERT/상태 전이보다도 먼저.
--   → 차단 시 message row 0 · attachment row 0 · answered 전이 0 · 알림 0 이 보장된다
--     (알림은 question_messages/question_attachments AFTER INSERT 트리거이므로
--      INSERT 에 도달하지 않으면 발화 자체가 없다).
-- 오류코드(모두 RAISE — 두 함수의 기존 규약과 동일):
--   ACCOUNT_BANNED · ACCOUNT_SUSPENDED · ACCOUNT_DELETION_IN_PROGRESS · BLOCKED
--   + ACCOUNT_NOT_ACTIVE — users 자기 행 부재 / status 가 active·suspended 외
--     (deleted·unknown·NULL). 지시서 4종으로는 "자기 행 존재" 요구를 표현할 수 없어
--     fail-closed 코드 1종을 신설했다(계약 문서 §7 에 기록).
-- 그 외 본문은 2026-08-02 운영 pg_get_functiondef 실측과 **문자 그대로 동일**하다 —
--   thread FOR UPDATE · THREAD_NOT_FOUND · NOT_ROOM_PARTY · THREAD_LOCKED ·
--   mentor approval · 구독 FOR UPDATE + live pending refund 게이트 ·
--   storage path/소유권 검증 · message·thread 정합 · INSERT · answered 전이 ·
--   반환 envelope · SECDEF · search_path='public' · ACL.
CREATE OR REPLACE FUNCTION public.qna_append_message(p_thread_id uuid, p_body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_status text; v_thread_status text;
  v_first_answered timestamptz; v_message_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_sub_id uuid;
  v_susp timestamptz; v_norm text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_body is null or btrim(p_body)='' then raise exception 'BODY_REQUIRED'; end if;
  select t.mentor_student_room_id, t.status, t.first_answered_at into v_room, v_thread_status, v_first_answered
    from public.question_threads t where t.id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if v_uid=v_mentor then v_is_mentor:=true; elsif v_uid=v_student then v_is_mentor:=false; else raise exception 'NOT_ROOM_PARTY'; end if;

  -- [S3-C 보정 §3] 당사자 확정 직후 — 계정 상태 4종 + 상호 차단. 이 아래로는
  -- 어떤 INSERT·상태 전이도 없으므로 차단 시 부수효과 0 이다.
  select u.status, u.suspended_until into v_status, v_susp from public.users u where u.id=v_uid;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  v_norm := lower(btrim(coalesce(v_status,'')));
  if v_norm='banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_norm='suspended' and (v_susp is null or v_susp > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if v_norm not in ('active','suspended') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if public.account_deletion_write_blocked(v_uid) then raise exception 'ACCOUNT_DELETION_IN_PROGRESS'; end if;
  if public.qna_users_blocked(v_student, v_mentor) then raise exception 'BLOCKED'; end if;

  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;
  if v_is_mentor and not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;
  -- 학생 후속 메시지: 활성 구독 FOR UPDATE + live pending refund 게이트(142 유지).
  if not v_is_mentor then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
  end if;

  -- F2(D-12)+R1: 아래 INSERT 가 AFTER INSERT 알림 트리거를 발화 — 멘토 메시지 행 1건 = 알림 정확히 1건.
  insert into public.question_messages (thread_id, author_id, body) values (p_thread_id, v_uid, btrim(p_body)) returning id into v_message_id;
  if v_is_mentor and v_first_answered is null then
    update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
    v_transitioned := true;
  end if;
  return jsonb_build_object('ok',true,'message_id',v_message_id,'answered_transition',v_transitioned);
end; $function$;

COMMENT ON FUNCTION public.qna_append_message(uuid, text) IS
  'S3-C 보정 §3: 질문방 메시지 추가 — 당사자 확정 직후 계정 상태(ACCOUNT_NOT_ACTIVE/ACCOUNT_BANNED/ACCOUNT_SUSPENDED/ACCOUNT_DELETION_IN_PROGRESS) + 상호 차단(BLOCKED) 게이트. 그 외 thread lock·mentor approval·구독/환불·알림 트리거 의미 전부 보존.';

REVOKE ALL ON FUNCTION public.qna_append_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qna_append_message(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.qna_register_attachment(
  p_thread_id uuid, p_storage_path text, p_file_name text DEFAULT NULL::text,
  p_mime_type text DEFAULT NULL::text, p_message_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_thread_status text;
  v_first_answered timestamptz; v_att_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_sub_id uuid;
  v_status text; v_susp timestamptz; v_norm text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_storage_path is null or btrim(p_storage_path)='' then raise exception 'STORAGE_PATH_REQUIRED'; end if;
  select t.mentor_student_room_id, t.status, t.first_answered_at into v_room, v_thread_status, v_first_answered
    from public.question_threads t where t.id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if v_uid=v_mentor then v_is_mentor:=true; elsif v_uid=v_student then v_is_mentor:=false; else raise exception 'NOT_ROOM_PARTY'; end if;

  -- [S3-C 보정 §3] 당사자 확정 직후 — 계정 상태 4종 + 상호 차단(종전 계정 검사 전무).
  select u.status, u.suspended_until into v_status, v_susp from public.users u where u.id=v_uid;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  v_norm := lower(btrim(coalesce(v_status,'')));
  if v_norm='banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_norm='suspended' and (v_susp is null or v_susp > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if v_norm not in ('active','suspended') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if public.account_deletion_write_blocked(v_uid) then raise exception 'ACCOUNT_DELETION_IN_PROGRESS'; end if;
  if public.qna_users_blocked(v_student, v_mentor) then raise exception 'BLOCKED'; end if;

  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;
  -- [S3-C 보정 2차 §2] 미승인 멘토가 **첨부-only 답변**으로 승인 게이트를 우회하지 못하게 한다.
  --   attachment INSERT · answered 전이 · first_answered_at 기록 · 알림 트리거보다 앞이며,
  --   append 와 동일한 코드·동일한 판정기를 쓴다(THREAD_LOCKED 우선순위는 유지).
  if v_is_mentor and not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;
  if p_storage_path not like (v_room::text || '/' || p_thread_id::text || '/%') then raise exception 'STORAGE_PATH_MISMATCH'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='question-room-attachments' and o.name = btrim(p_storage_path) and o.owner_id = v_uid::text) then raise exception 'STORAGE_OBJECT_NOT_OWNED'; end if;
  if p_message_id is not null and not exists (select 1 from public.question_messages m where m.id=p_message_id and m.thread_id=p_thread_id) then raise exception 'MESSAGE_THREAD_MISMATCH'; end if;
  if not v_is_mentor then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
  end if;

  -- F2(D-12)+R1: 아래 INSERT 가 AFTER INSERT 알림 트리거를 발화 — 멘토 단독 첨부 행 1건 = 알림 정확히 1건.
  insert into public.question_attachments (thread_id, message_id, author_id, storage_path, file_name, mime_type)
  values (p_thread_id, p_message_id, v_uid, btrim(p_storage_path), p_file_name, p_mime_type) returning id into v_att_id;
  if v_is_mentor and v_first_answered is null then
    update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
    v_transitioned := true;
  end if;
  return jsonb_build_object('ok',true,'attachment_id',v_att_id,'answered_transition',v_transitioned);
end; $function$;

COMMENT ON FUNCTION public.qna_register_attachment(uuid, text, text, text, uuid) IS
  'S3-C 보정 §3+2차 §2: 질문방 첨부 등록 — 당사자 확정 직후 계정 상태 + 상호 차단 게이트(종전 계정 검사 전무) + 미승인 멘토 첨부-only 답변 차단(MENTOR_NOT_APPROVED). 그 외 thread lock·storage path/소유권·message 정합·구독/환불·알림 트리거 의미 전부 보존.';

REVOKE ALL ON FUNCTION public.qna_register_attachment(uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qna_register_attachment(uuid, text, text, text, uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- E. 범위 B — 직접 UGC write 정책에 계정 상태 게이트 결합
-- -----------------------------------------------------------------------------
-- 원 조건식은 문자 그대로 보존하고 `AND (SELECT public.ugc_write_allowed())` 만 결합한다.
-- (SELECT ...) 래핑은 Supabase 정본 idiom — 행마다 재평가하지 않고 InitPlan 1회로 접는다.

-- E-1. comments INSERT / UPDATE
DROP POLICY IF EXISTS "comments_insert_own" ON public.comments;
CREATE POLICY "comments_insert_own" ON public.comments
  FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()) AND (SELECT public.ugc_write_allowed()));

DROP POLICY IF EXISTS "comments_update_own" ON public.comments;
CREATE POLICY "comments_update_own" ON public.comments
  FOR UPDATE TO authenticated
  USING (author_id = (SELECT auth.uid()) AND (SELECT public.ugc_write_allowed()))
  WITH CHECK (author_id = (SELECT auth.uid()) AND (SELECT public.ugc_write_allowed()));

-- E-2. community_comments INSERT (본문 길이 1~1000 조건 보존)
DROP POLICY IF EXISTS "community_comments_insert_authenticated" ON public.community_comments;
CREATE POLICY "community_comments_insert_authenticated" ON public.community_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND (SELECT auth.uid()) IS NOT NULL
    AND char_length(btrim(body)) >= 1
    AND char_length(btrim(body)) <= 1000
    AND (SELECT public.ugc_write_allowed())
  );

-- E-3. post_reactions INSERT / DELETE
--   한글명 중복 정책 2종은 permissive OR 로 게이트를 무력화한다. 두 정책의 조건은
--   `auth.uid() = user_id` 로 authenticated 정책의 **진부분집합**이므로, 제거해도
--   정당 사용자가 잃는 권한은 없다(role=public 의 anon 분기는 auth.uid() NULL 로 이미 사문).
DROP POLICY IF EXISTS "로그인 유저 반응 추가" ON public.post_reactions;
DROP POLICY IF EXISTS "본인 반응 삭제"        ON public.post_reactions;

DROP POLICY IF EXISTS "post_reactions_insert_own" ON public.post_reactions;
CREATE POLICY "post_reactions_insert_own" ON public.post_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.ugc_write_allowed()));

DROP POLICY IF EXISTS "post_reactions_delete_own" ON public.post_reactions;
CREATE POLICY "post_reactions_delete_own" ON public.post_reactions
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.ugc_write_allowed()));

-- E-4. shortform_reactions INSERT / DELETE (type 허용값 조건 보존)
DROP POLICY IF EXISTS "shortform_reactions_insert_own" ON public.shortform_reactions;
CREATE POLICY "shortform_reactions_insert_own" ON public.shortform_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND type = ANY (ARRAY['like'::text, 'scrap'::text])
    AND (SELECT public.ugc_write_allowed())
  );

DROP POLICY IF EXISTS "shortform_reactions_delete_own" ON public.shortform_reactions;
CREATE POLICY "shortform_reactions_delete_own" ON public.shortform_reactions
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT public.ugc_write_allowed()));

-- -----------------------------------------------------------------------------
-- F. 범위 C — content_reports 필드 무결성
-- -----------------------------------------------------------------------------
-- 커스텀 REST 호출이 관리 필드를 실어 보내면 WITH CHECK 위반(42501)으로 **명시 거부**한다
--   (조용한 정규화 대신 거부 — 위조 시도가 성공한 것처럼 보이지 않게 한다).
-- status 는 DEFAULT 'pending' 이므로 정상 클라이언트(필드 미지정)는 영향 없다.
-- target_type 은 화이트리스트로 고정한다 — 임의 자유 텍스트 확장 금지(S3-E 계약).
--   허용값: community_post · shortform · shortform_post · community_comment ·
--           board_comment · user
--   'user' 는 질문방 신고(S3-E)가 사용할 값이다. DB 제약은 nonempty 뿐이라 별도
--   CHECK 추가 없이 이미 저장 가능하며(관리자 콘솔은 normalize 실패 시 신고 상태만
--   변경 — lib/admin/communityModerationCore.ts), 본 정책이 그 집합의 정본이다.
-- [보정 §4] target_type='user' 일 때만 추가로 대상 무결성을 강제한다 —
--   자기 신고 금지 + 대상 사용자 실재(public.report_target_user_valid).
--   다른 target_type 계약은 그대로 유지한다(대상 실재 검사 없음 — 콘텐츠 신고는
--   soft-delete·삭제 레이스에서 접수 자체가 막히면 안 되기 때문).
-- **계정 상태 게이트는 붙이지 않는다** — 신고는 과잉 차단 금지 대상(지시서 §3).
--   banned reporter 도 정상 상대를 신고할 수 있다.
DROP POLICY IF EXISTS "content_reports_insert_reporter" ON public.content_reports;
CREATE POLICY "content_reports_insert_reporter" ON public.content_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    reporter_id = (SELECT auth.uid())
    AND status = 'pending'
    AND admin_note IS NULL
    AND resolved_by IS NULL
    AND resolved_at IS NULL
    AND target_type = ANY (ARRAY['community_post'::text, 'shortform'::text, 'shortform_post'::text,
                                 'community_comment'::text, 'board_comment'::text, 'user'::text])
    AND (target_type <> 'user' OR public.report_target_user_valid(target_id))
  );

-- -----------------------------------------------------------------------------
-- G. 범위 E — latent custom-order 공개 SELECT 정책 제거
-- -----------------------------------------------------------------------------
-- 4종 모두 `USING (true)` · role=public 이라 **anon 포함 전원이 전 행을 읽는다**.
-- 당사자·관리자 정책(cdel_select · cmsg_all_party · cra_select · crp_select)은
-- 그대로 두므로 정당 경로는 불변이다. 현재 행 수가 0이라는 사실에는 의존하지 않는다
-- (섹션 A ⑦ 에서 identity 를 단언했고, 여기서는 그 4종만 정확히 제거한다).
DROP POLICY IF EXISTS "누구나 납품 읽기"     ON public.custom_order_deliverables;
DROP POLICY IF EXISTS "누구나 메시지 읽기"   ON public.custom_order_messages;
DROP POLICY IF EXISTS "누구나 지원서 읽기"   ON public.custom_request_applications;
DROP POLICY IF EXISTS "누구나 의뢰 읽기"     ON public.custom_request_posts;

-- -----------------------------------------------------------------------------
-- H. 적용 직후 자가 검증 (최종 상태 보증)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_cnt int;
  v_src text;
BEGIN
  -- ① 범위 A — 구현부 본문 계약
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core_private' AND p.proname = 'community_post_create_impl';
  IF v_src IS NULL
     OR position('ROLE_NOT_ALLOWED' IN v_src) = 0
     OR position('MENTOR_NOT_APPROVED' IN v_src) > 0
     OR position('ROLE_NOT_MENTOR' IN v_src) > 0 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: create_impl 역할 계약 수렴 실패';
  END IF;
  -- 보존 불변 — replay-first · 멱등 · 계정 3상태 · 검증 · 마스킹 · 이미지 · author 도출
  IF position('create_idempotency_key' IN v_src) = 0
     OR position('idempotent_replay' IN v_src) = 0
     OR position('ON CONFLICT (author_id, create_idempotency_key) DO NOTHING' IN v_src) = 0
     OR position('ACCOUNT_BANNED' IN v_src) = 0
     OR position('ACCOUNT_SUSPENDED' IN v_src) = 0
     OR position('ACCOUNT_DELETION_IN_PROGRESS' IN v_src) = 0
     -- [보정 2차 §1] 계정 상태 positive allowlist (fail-open 잔재 0)
     OR position('ACCOUNT_NOT_ACTIVE' IN v_src) = 0
     OR position('v_norm = ''active''' IN v_src) = 0
     OR position('coalesce(v_status, ''active'')' IN v_src) > 0
     OR position('TITLE_REQUIRED' IN v_src) = 0
     OR position('CATEGORY_INVALID' IN v_src) = 0
     OR position('BODY_TOO_SHORT' IN v_src) = 0
     OR position('[연락처 비공개]' IN v_src) = 0
     OR position('community_image_refs_validate' IN v_src) = 0
     OR position('author_label' IN v_src) = 0
     OR position('author_role' IN v_src) = 0 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: create_impl 보존 불변 손실';
  END IF;
  -- 구현부 하드닝 불변 (INVOKER + search_path + 외부 EXECUTE 0)
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'core_private' AND p.proname = 'community_post_create_impl'
                    AND NOT p.prosecdef AND p.proconfig::text LIKE '%search_path=%'
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: create_impl 하드닝(INVOKER·search_path·외부 EXECUTE 0) 손실';
  END IF;
  -- wrapper 시그니처 불변 (web·app 2종)
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('api_web_v1', 'api_app_v1') AND p.proname = 'community_post_create'
         AND pg_get_function_identity_arguments(p.oid)
             = 'p_title text, p_body text, p_category text, p_idempotency_key uuid, p_image_refs text[], p_status text'
         AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) <> 2 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: community_post_create wrapper 시그니처·권한 변동';
  END IF;

  -- ①-2 보정 §2(범위 G) — update 구현부 역할 계약 + 보존 불변
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'core_private' AND p.proname = 'community_post_update_impl';
  IF v_src IS NULL
     OR position('ROLE_NOT_ALLOWED' IN v_src) = 0
     OR position('MENTOR_NOT_APPROVED' IN v_src) > 0
     OR position('ROLE_NOT_MENTOR' IN v_src) > 0 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: update_impl 역할 계약 수렴 실패';
  END IF;
  IF position('FOR UPDATE' IN v_src) = 0
     OR position('UPDATE_CONFLICT' IN v_src) = 0
     OR position('p_expected_updated_at' IN v_src) = 0
     OR position('POST_NOT_FOUND_OR_NOT_OWNED' IN v_src) = 0
     OR position('removed_image_refs' IN v_src) = 0
     OR position('[연락처 비공개]' IN v_src) = 0
     OR position('community_image_refs_validate' IN v_src) = 0
     OR position('ACCOUNT_BANNED' IN v_src) = 0
     OR position('ACCOUNT_SUSPENDED' IN v_src) = 0
     OR position('ACCOUNT_DELETION_IN_PROGRESS' IN v_src) = 0
     -- [보정 2차 §1] create 와 동일한 positive allowlist
     OR position('ACCOUNT_NOT_ACTIVE' IN v_src) = 0
     OR position('v_norm = ''active''' IN v_src) = 0
     OR position('coalesce(v_status, ''active'')' IN v_src) > 0 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: update_impl 보존 불변·allowlist 손실';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('api_web_v1', 'api_app_v1') AND p.proname = 'community_post_update'
         AND pg_get_function_identity_arguments(p.oid)
             = 'p_post_id uuid, p_title text, p_body text, p_category text, p_expected_updated_at timestamp with time zone, p_image_refs text[], p_status text'
         AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) <> 2 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: community_post_update wrapper 시그니처·권한 변동';
  END IF;

  -- ①-3 보정 §3(범위 H) — 질문방 RPC 게이트 + 보존 불변
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'qna_append_message';
  IF v_src IS NULL
     OR position('qna_users_blocked' IN v_src) = 0
     OR position('BLOCKED' IN v_src) = 0
     OR position('ACCOUNT_SUSPENDED' IN v_src) = 0
     OR position('ACCOUNT_DELETION_IN_PROGRESS' IN v_src) = 0
     OR position('ACCOUNT_NOT_ACTIVE' IN v_src) = 0
     OR position('ACCOUNT_BANNED' IN v_src) = 0
     -- 보존 불변
     OR position('for update' IN v_src) = 0
     OR position('NOT_ROOM_PARTY' IN v_src) = 0
     OR position('THREAD_LOCKED' IN v_src) = 0
     OR position('MENTOR_NOT_APPROVED' IN v_src) = 0
     OR position('SUBSCRIPTION_REFUND_PENDING' IN v_src) = 0
     OR position('insert into public.question_messages' IN v_src) = 0
     OR position('answered_transition' IN v_src) = 0 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: qna_append_message 게이트·보존 불변 불일치';
  END IF;
  -- 게이트가 INSERT 보다 앞에 있어야 한다(부수효과 0 보장)
  IF position('qna_users_blocked' IN v_src) > position('insert into public.question_messages' IN v_src) THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: qna_append_message 차단 게이트가 INSERT 뒤에 있다';
  END IF;

  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'qna_register_attachment';
  IF v_src IS NULL
     OR position('qna_users_blocked' IN v_src) = 0
     OR position('BLOCKED' IN v_src) = 0
     OR position('ACCOUNT_BANNED' IN v_src) = 0
     OR position('ACCOUNT_SUSPENDED' IN v_src) = 0
     OR position('ACCOUNT_DELETION_IN_PROGRESS' IN v_src) = 0
     OR position('ACCOUNT_NOT_ACTIVE' IN v_src) = 0
     -- 보존 불변
     OR position('for update' IN v_src) = 0
     OR position('NOT_ROOM_PARTY' IN v_src) = 0
     OR position('THREAD_LOCKED' IN v_src) = 0
     OR position('STORAGE_PATH_MISMATCH' IN v_src) = 0
     OR position('STORAGE_OBJECT_NOT_OWNED' IN v_src) = 0
     OR position('MESSAGE_THREAD_MISMATCH' IN v_src) = 0
     OR position('SUBSCRIPTION_REFUND_PENDING' IN v_src) = 0
     OR position('insert into public.question_attachments' IN v_src) = 0
     OR position('answered_transition' IN v_src) = 0
     -- [보정 2차 §2] 첨부-only 답변의 멘토 승인 게이트
     OR position('MENTOR_NOT_APPROVED' IN v_src) = 0
     OR position('individual_question_user_is_approved_mentor' IN v_src) = 0 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: qna_register_attachment 게이트·보존 불변 불일치';
  END IF;
  IF position('qna_users_blocked' IN v_src) > position('insert into public.question_attachments' IN v_src)
     OR position('MENTOR_NOT_APPROVED' IN v_src) > position('insert into public.question_attachments' IN v_src) THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: qna_register_attachment 차단·승인 게이트가 INSERT 뒤에 있다';
  END IF;
  -- 두 RPC 의 SECDEF·search_path·ACL 불변
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('qna_append_message', 'qna_register_attachment')
         AND p.prosecdef AND p.proconfig::text LIKE '%search_path=%'
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
         AND has_function_privilege('service_role', p.oid, 'EXECUTE')
         AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) <> 2 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: qna RPC 2종 SECDEF·search_path·ACL 불일치';
  END IF;

  -- ② 직접 INSERT/UPDATE 잠금 유지 (미복구 증명)
  IF has_table_privilege('authenticated', 'public.community_posts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.community_posts', 'UPDATE')
     OR has_table_privilege('anon', 'public.community_posts', 'INSERT')
     OR has_table_privilege('anon', 'public.community_posts', 'UPDATE')
     OR (SELECT count(*) FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'community_posts'
            AND cmd IN ('INSERT', 'UPDATE', 'DELETE')) <> 0 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: community_posts 직접 쓰기 권한이 복구됨(금지)';
  END IF;

  -- ③ 범위 D — self 제한 + 권한 매트릭스
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'account_deletion_write_blocked';
  IF v_src IS NULL OR position('ACCOUNT_DELETION_PROBE_FORBIDDEN' IN v_src) = 0 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: account_deletion_write_blocked self 제한 미적용';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'account_deletion_write_blocked'
                    AND p.prosecdef AND p.proconfig::text LIKE '%search_path=%'
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: account_deletion_write_blocked 권한 매트릭스 불일치';
  END IF;

  -- ④ 범위 B — helper 하드닝 + 게이트 결합 정책 7종
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'ugc_write_allowed'
                    AND pg_get_function_identity_arguments(p.oid) = ''
                    AND p.prosecdef AND p.proconfig::text LIKE '%search_path=%'
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    AND (p.proacl IS NULL OR (p.proacl::text NOT LIKE '{=%' AND p.proacl::text NOT LIKE '%,=%'))) THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: ugc_write_allowed() 하드닝·권한 불일치';
  END IF;
  -- ④-2 보정 §1 — helper 가 fail-closed 허용 목록 형태인지(부정 목록 잔재 0)
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ugc_write_allowed';
  IF v_src IS NULL
     OR position('EXISTS' IN v_src) = 0
     OR position('NOT EXISTS' IN v_src) > 0                      -- 구 "차단 목록" 구현 잔재
     OR position('u.role IN (''student'', ''mentor'')' IN v_src) = 0
     OR position('''active''' IN v_src) = 0
     OR position('u.suspended_until IS NOT NULL' IN v_src) = 0
     OR position('account_deletion_write_blocked' IN v_src) = 0 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: ugc_write_allowed() 가 fail-closed 허용 목록이 아니다';
  END IF;
  -- ④-3 보정 §4 — report_target_user_valid 하드닝·권한
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'report_target_user_valid'
                    AND pg_get_function_identity_arguments(p.oid) = 'p_target_id uuid'
                    AND p.prosecdef AND p.proconfig::text LIKE '%search_path=%'
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    AND (p.proacl IS NULL OR (p.proacl::text NOT LIKE '{=%' AND p.proacl::text NOT LIKE '%,=%'))) THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: report_target_user_valid(uuid) 하드닝·권한 불일치';
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public'
     AND (tablename, policyname) IN
         (('comments',            'comments_insert_own'),
          ('comments',            'comments_update_own'),
          ('community_comments',  'community_comments_insert_authenticated'),
          ('post_reactions',      'post_reactions_insert_own'),
          ('post_reactions',      'post_reactions_delete_own'),
          ('shortform_reactions', 'shortform_reactions_insert_own'),
          ('shortform_reactions', 'shortform_reactions_delete_own'))
     AND roles::text = '{authenticated}'
     AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%ugc_write_allowed%';
  IF v_cnt <> 7 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: UGC 상태 게이트 결합 정책 7종 미충족(matched %/7)', v_cnt;
  END IF;
  -- 중복 우회 경로 0 — post_reactions 쓰기 정책은 authenticated 2종만 남는다
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'post_reactions'
         AND cmd IN ('INSERT', 'UPDATE', 'DELETE')) <> 2 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: post_reactions 쓰기 정책 우회 경로 잔존';
  END IF;
  -- 과잉 차단 금지 — 신고·차단·계정삭제 경로에는 게이트가 붙지 않았다
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename IN ('content_reports', 'user_blocks')
                AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%ugc_write_allowed%') THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: 신고·차단 경로에 UGC 게이트가 잘못 결합됨(과잉 차단)';
  END IF;

  -- ⑤ 범위 C — 관리 필드 강제 + 관리자 UPDATE 보존
  SELECT coalesce(with_check, '') INTO v_src FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'content_reports'
     AND policyname = 'content_reports_insert_reporter';
  IF v_src IS NULL
     OR v_src NOT LIKE '%reporter_id%'
     OR v_src NOT LIKE '%pending%'
     OR v_src NOT LIKE '%admin_note IS NULL%'
     OR v_src NOT LIKE '%resolved_by IS NULL%'
     OR v_src NOT LIKE '%resolved_at IS NULL%'
     OR v_src NOT LIKE '%target_type%'
     OR v_src NOT LIKE '%report_target_user_valid%' THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: content_reports INSERT 필드·user 대상 무결성 강제 불일치';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'content_reports'
                    AND policyname = 'content_reports_update_admin' AND cmd = 'UPDATE') THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: content_reports 관리자 UPDATE 경로 유실';
  END IF;

  -- ⑥ 범위 E — 공개 정책 0 · 당사자 정책 4종 유지
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename IN ('custom_order_deliverables', 'custom_order_messages',
                           'custom_request_applications', 'custom_request_posts')
         AND cmd = 'SELECT' AND roles::text = '{public}') <> 0 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: custom_* public SELECT 정책 잔존';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND cmd = 'SELECT'
         AND (tablename, policyname) IN
             (('custom_order_deliverables',   'cdel_select'),
              ('custom_order_messages',       'cmsg_all_party'),
              ('custom_request_applications', 'cra_select'),
              ('custom_request_posts',        'crp_select'))) <> 4 THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: custom_* 당사자·관리자 SELECT 정책이 함께 제거됨';
  END IF;
END $$;

commit;