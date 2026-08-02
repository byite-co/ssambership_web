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
-- 범위(5종 — 세션 S3-C 지시서 §2~§6):
--   A. community_post_create 역할 계약 — active student + active mentor 허용,
--      guest/anon·admin·unknown role·banned·유효 suspended·삭제 진행 계정 거부.
--      승인 멘토 전용 제한(MENTOR_NOT_APPROVED) 제거.
--   B. 직접 UGC write 계정 상태 게이트 — comments INSERT/UPDATE ·
--      community_comments INSERT · post_reactions INSERT/DELETE ·
--      shortform_reactions INSERT/DELETE 에 banned/suspended/deletion 게이트.
--      (community post RPC 는 이미 구현부에서 동일 게이트를 수행한다 — 보존)
--   C. content_reports 필드 무결성 — 일반 사용자 INSERT 시 reporter_id·status·
--      admin_note·resolved_by·resolved_at·target_type 를 서버가 강제(위조 거부).
--   D. account_deletion_write_blocked self 제한 — 일반 authenticated 는 자기
--      UUID만 조회, 타인 UUID 는 명시적 거부. 내부/서비스 문맥은 무제한 유지.
--   E. latent custom-order 공개 SELECT 정책 4종 제거(당사자·관리자 정책 유지).
--
-- 보존 불변(변경 금지 — 지시서 §2 「반드시 보존」):
--   replay-first · idempotency key · 동시 경합 수렴 · title/body/category/
--   draft·published 검증 · 연락처 마스킹 · image_refs 검증 · author_label·
--   author_role 서버 도출 · community_posts direct INSERT 권한 미복구.
--   RPC 시그니처 3종(api_web_v1 / api_app_v1) 전부 불변 — 본 파일은
--   wrapper 를 건드리지 않고 공용 구현부 본문만 CREATE OR REPLACE 한다.
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
-- 판정: 다음 3상태 중 하나면 false(쓰기 차단), 그 외 true.
--   ① users.status = 'banned'
--   ② users.status = 'suspended' 이고 suspended_until 이 NULL 이거나 미래(= 유효 정지)
--   ③ account_deletion_write_blocked(self) = true
-- 과잉 차단 방지: users 행 자체가 없으면 차단하지 않는다(신고·차단·삭제·고객지원
--   경로와 동일하게, 본 helper 는 **명시된 3상태만** 막는다). 미인증(auth.uid() NULL)은
--   false — 어차피 대상 정책이 전부 `to authenticated` 라 도달하지 않지만 fail-closed 로 둔다.
CREATE OR REPLACE FUNCTION public.ugc_write_allowed()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT CASE
    WHEN (SELECT auth.uid()) IS NULL THEN false
    ELSE NOT EXISTS (
           SELECT 1 FROM public.users u
            WHERE u.id = (SELECT auth.uid())
              AND ( lower(coalesce(u.status, 'active')) = 'banned'
                 OR ( lower(coalesce(u.status, 'active')) = 'suspended'
                      AND (u.suspended_until IS NULL OR u.suspended_until > now()) ) )
         )
         AND NOT public.account_deletion_write_blocked((SELECT auth.uid()))
  END
$fn$;

COMMENT ON FUNCTION public.ugc_write_allowed() IS
  'S3-C 범위 B: 직접 UGC write(댓글·반응) 계정 상태 게이트. self 전용(인자 없음) — banned / 유효 suspended / 삭제 write-blocked 3상태만 차단. 신고·차단·계정삭제·고객지원 경로에는 적용하지 않는다.';

REVOKE ALL ON FUNCTION public.ugc_write_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ugc_write_allowed() TO authenticated, service_role;

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
  IF lower(coalesce(v_status, 'active')) = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'suspended' AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ACCOUNT_SUSPENDED');
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
-- **계정 상태 게이트는 붙이지 않는다** — 신고는 과잉 차단 금지 대상(지시서 §3).
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

  -- ② 직접 INSERT 잠금 유지 (미복구 증명)
  IF has_table_privilege('authenticated', 'public.community_posts', 'INSERT')
     OR has_table_privilege('anon', 'public.community_posts', 'INSERT')
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
     OR v_src NOT LIKE '%target_type%' THEN
    RAISE EXCEPTION 'S3C_SELFCHECK: content_reports INSERT 필드 강제 불일치';
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
