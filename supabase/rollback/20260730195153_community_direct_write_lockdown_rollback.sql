-- =============================================================================
-- 20260730195153_community_direct_write_lockdown_rollback.sql (S2 M16 rollback)
-- =============================================================================
-- M16(HD-1)의 대칭 복원 — 계약 §22 #6.
--   ① 회수했던 비SELECT 6종 권한을 anon·authenticated 에 대칭 복원.
--   ② 제거한 쓰기 정책 6종을 정확한 원래 이름·cmd·roles·qual·with_check 로 재생성.
-- 정책 정의 정본(이중 대조 — 추정 작성 금지):
--   - cp_write_self · cp_update_self: 레포 원문 004_p0_cash_disputes_admin_draft.sql
--     235~240행 그대로.
--   - cp_update_own · cp_delete_own: 레포 원문 037_p1_community_board_v2.sql
--     309~319행 그대로.
--   - 로그인 유저 게시글 작성 · 본인 게시글 수정: 대시보드 생성분(레포 원문 없음)
--     — 2026-07-29 운영 pg_policies 실측 정의(계약 §14.7·개정 지시서 A-10:
--     role=public · auth.uid() = author_id)를 정본으로 복원한다.
--   - 운영 실행 시 의무: 적용 직전(M16 forward 전) pg_policies 스냅샷과 본 파일
--     정의를 문자 단위로 재대조하고, 한 문자라도 다르면 실행 중단 후 정규화 표현·
--     기존 migration 원문을 함께 대조해 원인을 보고한다(Batch F 지시 §7).
-- 실행 전제(§22 #2·#4): rollback 역순 최선두(M16 → M12 → M11). 웹·앱 코드가
--   레거시 직접 쓰기로 선복원돼 있어야 한다. 오너 승인 후 apply_migration 으로
--   원장 새 행 append(ledger name = 20260730195153_community_direct_write_lockdown_rollback).
-- 복원 후 기대: 정책·ACL 이 M16 적용 전 기준선과 완전 동일 —
--   쓰기 정책 6종 실재 + anon·authenticated 테이블 권한 7종 true + SELECT 정책 불변.
-- =============================================================================

begin;

DO $$
BEGIN
  IF to_regclass('public.community_posts') IS NULL THEN
    RAISE EXCEPTION 'M16_ROLLBACK_BASELINE_MISMATCH: public.community_posts not found';
  END IF;
  -- 재생성 대상 6종이 이미 존재하면 중단(이중 실행·drift 방지)
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'community_posts'
                AND policyname IN ('cp_write_self','로그인 유저 게시글 작성','cp_update_own',
                                   'cp_update_self','본인 게시글 수정','cp_delete_own')) THEN
    RAISE EXCEPTION 'M16_ROLLBACK_BASELINE_MISMATCH: target write policy already present';
  END IF;
END $$;

-- ① §22 #6 — 회수한 권한 목록(비SELECT 6종·역할 2종)을 문자 그대로 복원
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON public.community_posts
TO anon, authenticated;

-- ② 쓰기 정책 6종 재생성 — 원래 이름·cmd·roles·qual·with_check
-- (레포 원문 004: cp_write_self·cp_update_self)
create policy "cp_write_self" on public.community_posts
  for insert to authenticated
  with check ( author_id = (select auth.uid()) or (select public.is_admin()) = true );
create policy "cp_update_self" on public.community_posts
  for update to authenticated
  using ( author_id = (select auth.uid()) or (select public.is_admin()) = true );

-- (레포 원문 037: cp_update_own·cp_delete_own)
create policy "cp_update_own"
  on public.community_posts for update to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()) = true)
  with check (author_id = (select auth.uid()) or (select public.is_admin()) = true);
create policy "cp_delete_own"
  on public.community_posts for delete to authenticated
  using (author_id = (select auth.uid()) or (select public.is_admin()) = true);

-- (2026-07-29 운영 pg_policies 실측 — 대시보드 생성 레거시 2종, role=public)
create policy "로그인 유저 게시글 작성" on public.community_posts
  for insert to public
  with check ( auth.uid() = author_id );
create policy "본인 게시글 수정" on public.community_posts
  for update to public
  using ( auth.uid() = author_id );

-- 복원 직후 게이트 — 쓰기 정책 6종 실재·ACL 7종 true
DO $$
DECLARE
  v_role text;
  v_priv text;
  v_cnt  int;
BEGIN
  SELECT count(*) INTO v_cnt FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'community_posts'
     AND ( (policyname = 'cp_write_self'            AND cmd = 'INSERT' AND roles = '{authenticated}')
        OR (policyname = '로그인 유저 게시글 작성'  AND cmd = 'INSERT' AND roles = '{public}')
        OR (policyname = 'cp_update_own'            AND cmd = 'UPDATE' AND roles = '{authenticated}')
        OR (policyname = 'cp_update_self'           AND cmd = 'UPDATE' AND roles = '{authenticated}')
        OR (policyname = '본인 게시글 수정'         AND cmd = 'UPDATE' AND roles = '{public}')
        OR (policyname = 'cp_delete_own'            AND cmd = 'DELETE' AND roles = '{authenticated}') );
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION 'M16_ROLLBACK_POLICY_MISMATCH: restored write policy set %/6', v_cnt;
  END IF;
  FOR v_role, v_priv IN
    SELECT r.rolname, p.priv
      FROM (VALUES ('anon'), ('authenticated')) AS r(rolname)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
  LOOP
    IF NOT has_table_privilege(v_role, 'public.community_posts', v_priv) THEN
      RAISE EXCEPTION 'M16_ROLLBACK_ACL_MISMATCH: % % expected true, measured false', v_role, v_priv;
    END IF;
  END LOOP;
END $$;

commit;
