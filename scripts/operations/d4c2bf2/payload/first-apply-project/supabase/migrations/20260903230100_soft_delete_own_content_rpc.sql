-- =============================================================================
-- 196_soft_delete_own_content_rpc.sql  (2026-09-03 · DB-3 묶음 A — 작성자 본인 삭제 RPC ★)
--
-- 왜: 게시판 댓글 본인 삭제가 지금 실패한다. 웹은 `UPDATE comments SET is_deleted = true … WHERE id = ? AND author_id = auth.uid()`
--   (RETURNING id) 를 직접 보내는데, UPDATE 의 새 행이 SELECT 정책 comments_select_visible(is_deleted = false AND deleted_at IS NULL)
--   을 통과하지 못해 "new row violates row-level security policy" 로 거부된다(194 이전부터 is_deleted = false 였으므로 194 와 무관하게
--   실패하던 경로 — 로컬 재현: scripts/verify/fixtures/db3_batch_pre_fixture.sql). 숏폼·숏폼 댓글·게시판 글의 본인 삭제도 같은 성질이라
--   SECURITY DEFINER RPC 하나로 경로를 통일한다(194 B-3 주석 "본인 삭제는 SECURITY DEFINER RPC 경로" 의 구현).
--
-- A-1 함수: public.soft_delete_own_content(p_kind text, p_id uuid) returns void · SECURITY DEFINER · search_path ''.
--     p_kind ∈ ('shortform' → shortform_posts · 'shortform_comment' → community_comments(post_type = 'shortform') ·
--              'board_comment' → comments(정본) · 'board_post' → community_posts).
--     · auth.uid() 가 없으면 AUTH_REQUIRED(28000) · p_kind 밖이면 INVALID_KIND(22023) · 행이 없으면 CONTENT_NOT_FOUND(P0001)
--     · 작성자가 아니면 CONTENT_NOT_OWNED(42501) — 숏폼은 기존 정책(sf_update_own · sf_delete_own)과 같은 "본인" 정의(author_id 또는 creator_id)
--     · 'shortform_comment' 인데 post_type 이 'shortform' 이 아니면 CONTENT_KIND_MISMATCH(22023) — 게시판 댓글은 'board_comment'(정본) 로만
--     · 계정 게이트는 community_comment_soft_delete_self(20260803162808 · 194)와 동일: ACCOUNT_BANNED · ACCOUNT_SUSPENDED · ACCOUNT_NOT_ACTIVE ·
--       ACCOUNT_DELETION_IN_PROGRESS
--     · 이미 deleted_at 이 있으면 아무것도 하지 않고 정상 반환(멱등)
--     · 관리자가 숨긴 행(글·숏폼 status = 'hidden' · 숏폼 댓글 status <> 'visible' · 게시판 댓글 is_deleted AND deleted_at IS NULL)은
--       CONTENT_MODERATED(42501) — community_comment_soft_delete_self 의 "moderation 유지" 규칙을 네 종류에 같이 적용한다
--       (게시판 글의 기존 F6 community_post_soft_delete 는 숨김 글도 지우게 두는데, 이 RPC 는 더 엄격하다 — 웹 게시판 글 삭제는 F6 그대로)
--     · deleted_at = now() · deleted_by = auth.uid(). 게시판 댓글의 is_deleted 는 194 동기화 트리거(comments_sync_deleted_flag)가 true 로 올리고,
--       레거시 미러(comments_mirror_to_legacy)가 deleted_at/deleted_by 를 옮기며, 댓글 수 트리거가 재계산한다 — 본문(content)은 보존한다
--       (관리자 복원 대비 · 읽기 경로가 삭제 행을 전부 제외하므로 노출되지 않는다).
--     · 감사 로그를 남기지 않는다(사용자 행위 — 관리자 삭제와 구분). 관리자 화면은 deleted_by = author_id 를 `작성자 삭제` 로 표시한다(PR-W3).
--     · 작성자 복원 RPC 는 만들지 않는다(지운 건 관리자만 복원 — PR-W2 · 지시서 A-3).
--     · 기존 community_comment_soft_delete_self(앱 계약 · outbound_api_manifest)는 그대로 둔다 — 앱은 앱 트랙에서 전환한다.
-- A-2 권한: REVOKE public·anon · GRANT EXECUTE authenticated(+ service_role — 151 패턴). anon 은 호출 자체가 42501.
-- SECURITY DEFINER 근거: 작성자 본인의 직접 UPDATE 는 RLS 가 새 행(SELECT 정책 미통과)을 거부한다. 소유자(postgres) 권한으로 실행해
--   RLS 를 지나되, 작성자·계정 상태·moderation 판정을 함수 안에서 강제한다. 194 쓰기 가드 2종은 current_user 가 클라이언트 역할이
--   아니면 개입하지 않는다(SECURITY DEFINER 내부 = postgres).
--
-- 적용 전 실측(2026-09-03 운영 read-only): 원장 DB-1(20260903100100~100300) · DB-2(20260903200100~200300) 적용 완료 ·
--   soft_delete_own_content 부재 · comments_select_visible qual = ((is_deleted = false) AND (deleted_at IS NULL)) ·
--   community_comment_soft_delete_self ACL anon=false / authenticated=true · 네 콘텐츠 테이블 0행(데이터 영향 0) ·
--   public functions 226 · policies 175 · tables 84.
--
-- Apply: 저장소 표준 경로(db-apply-pending) — 즉석 실행 금지. 적용 순서 A(196) → B(197) → C(198).
--   pack 등재: supabase/baseline/post_ledger_backfills/20260903230100_soft_delete_own_content_rpc.sql
-- Rollback: supabase/rollback/20260903230100_soft_delete_own_content_rpc_rollback.sql
-- 검증(§6): select proname, prosecdef, proconfig, has_function_privilege('anon', oid, 'EXECUTE') anon,
--                  has_function_privilege('authenticated', oid, 'EXECUTE') authenticated
--             from pg_proc where proname = 'soft_delete_own_content';
-- =============================================================================

begin;

-- ── 0. 사전 게이트 — 예상 상태와 다르면 중단(임의 정정 금지) ──────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public'
     and ((table_name in ('shortform_posts', 'comments', 'community_comments') and column_name in ('deleted_at', 'deleted_by'))
       or (table_name = 'community_posts' and column_name in ('deleted_at', 'deleted_by')));
  if v_n <> 8 then
    raise exception '196_GATE: deleted_at/deleted_by 컬럼 % 개(8 기대) — 194 미적용', v_n;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_comments_sync_deleted_flag' and tgrelid = 'public.comments'::regclass) then
    raise exception '196_GATE: trg_comments_sync_deleted_flag 부재(194)';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'soft_delete_own_content') then
    raise exception '196_GATE: soft_delete_own_content 가 이미 있다(이미 적용됐거나 전제 불일치)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'account_deletion_write_blocked') then
    raise exception '196_GATE: account_deletion_write_blocked 부재(151)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'community_comment_soft_delete_self') then
    raise exception '196_GATE: community_comment_soft_delete_self 부재(앱 계약 — 그대로 둬야 한다)';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comments' and policyname = 'comments_select_visible' and qual like '%deleted_at IS NULL%') then
    raise exception '196_GATE: comments_select_visible 에 deleted_at 필터가 없다(194 불일치)';
  end if;
end $$;

-- ── A-1. 함수 ─────────────────────────────────────────────────────────────────
create function public.soft_delete_own_content(p_kind text, p_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author uuid;
  v_creator uuid;
  v_deleted_at timestamptz;
  v_hidden boolean;
  v_post_type text;
  v_status text;
  v_susp timestamptz;
  v_norm text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_id is null or p_kind is null or p_kind not in ('shortform', 'shortform_comment', 'board_comment', 'board_post') then
    raise exception 'INVALID_KIND' using errcode = '22023';
  end if;

  -- 대상 행 잠금 + 작성자 · 삭제 · 숨김(moderation) 상태
  if p_kind = 'shortform' then
    select sp.author_id, sp.creator_id, sp.deleted_at, (sp.status = 'hidden')
      into v_author, v_creator, v_deleted_at, v_hidden
      from public.shortform_posts sp where sp.id = p_id for update;
  elsif p_kind = 'shortform_comment' then
    select cc.author_id, null::uuid, cc.deleted_at, (cc.status <> 'visible'), cc.post_type
      into v_author, v_creator, v_deleted_at, v_hidden, v_post_type
      from public.community_comments cc where cc.id = p_id for update;
  elsif p_kind = 'board_comment' then
    select c.author_id, null::uuid, c.deleted_at, (c.is_deleted and c.deleted_at is null)
      into v_author, v_creator, v_deleted_at, v_hidden
      from public.comments c where c.id = p_id for update;
  else
    select cp.author_id, null::uuid, cp.deleted_at, (cp.status = 'hidden')
      into v_author, v_creator, v_deleted_at, v_hidden
      from public.community_posts cp where cp.id = p_id for update;
  end if;
  if not found then
    raise exception 'CONTENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_kind = 'shortform_comment' and v_post_type is distinct from 'shortform' then
    raise exception 'CONTENT_KIND_MISMATCH' using errcode = '22023';
  end if;
  -- 본인 판정 — 숏폼은 author_id 또는 creator_id(sf_update_own · sf_delete_own 과 같다) · 나머지는 author_id
  if v_author is distinct from v_uid and v_creator is distinct from v_uid then
    raise exception 'CONTENT_NOT_OWNED' using errcode = '42501';
  end if;

  -- 계정 게이트 (community_comment_soft_delete_self 와 동일: banned · 유효 suspended · unknown/deleted · 삭제 진행 차단)
  select u.status, u.suspended_until into v_status, v_susp from public.users u where u.id = v_uid;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  v_norm := lower(btrim(coalesce(v_status, '')));
  if v_norm = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if v_norm not in ('active', 'suspended') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if public.account_deletion_write_blocked(v_uid) then raise exception 'ACCOUNT_DELETION_IN_PROGRESS'; end if;

  -- 멱등: 이미 삭제된 행은 그대로 둔다(누가 지웠든)
  if v_deleted_at is not null then
    return;
  end if;
  -- 관리자가 숨긴 행은 본인이 삭제로 덮지 못한다(moderation 유지)
  if coalesce(v_hidden, false) then
    raise exception 'CONTENT_MODERATED' using errcode = '42501';
  end if;

  if p_kind = 'shortform' then
    update public.shortform_posts set deleted_at = now(), deleted_by = v_uid where id = p_id;
  elsif p_kind = 'shortform_comment' then
    update public.community_comments set deleted_at = now(), deleted_by = v_uid where id = p_id;
  elsif p_kind = 'board_comment' then
    -- is_deleted 는 comments_sync_deleted_flag(194)가 true 로 · 레거시 미러 · 댓글 수 재계산은 기존 트리거
    update public.comments set deleted_at = now(), deleted_by = v_uid where id = p_id;
  else
    update public.community_posts set deleted_at = now(), deleted_by = v_uid where id = p_id;
  end if;
end
$$;

comment on function public.soft_delete_own_content(text, uuid) is
  '196(DB-3 A): 작성자 본인 소프트 삭제 단일 경로 — p_kind shortform|shortform_comment|board_comment|board_post. auth.uid() = 작성자(숏폼은 author_id|creator_id) · 계정 게이트 · 이미 삭제면 멱등 · 관리자 숨김 행은 CONTENT_MODERATED · deleted_at/deleted_by 만 기록(감사 로그 없음 — 관리자 삭제와 구분). 복원은 관리자만.';

-- ── A-2. 권한 — authenticated 만(anon 금지) ────────────────────────────────────
revoke all on function public.soft_delete_own_content(text, uuid) from public, anon;
grant execute on function public.soft_delete_own_content(text, uuid) to authenticated, service_role;

-- ── 적용 직후 자가 검증 ───────────────────────────────────────────────────────
do $$
declare v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'soft_delete_own_content'
     and pg_get_function_identity_arguments(p.oid) = 'p_kind text, p_id uuid';
  if v_oid is null then
    raise exception '196_SELFCHECK: soft_delete_own_content(text, uuid) 부재';
  end if;
  if not (select prosecdef from pg_proc where oid = v_oid)
     or coalesce((select proconfig::text from pg_proc where oid = v_oid), '') not like '%search_path=%' then
    raise exception '196_SELFCHECK: SECURITY DEFINER / search_path 설정 불일치';
  end if;
  if (select prorettype::regtype::text from pg_proc where oid = v_oid) <> 'void' then
    raise exception '196_SELFCHECK: 반환형이 void 가 아니다';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE')
     or not has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '196_SELFCHECK: ACL 불일치(anon 금지 · authenticated/service_role 허용)';
  end if;
  if (select prosrc from pg_proc where oid = v_oid) not like '%''shortform'', ''shortform_comment'', ''board_comment'', ''board_post''%' then
    raise exception '196_SELFCHECK: p_kind 4종 목록 불일치';
  end if;
  -- 기존 본인 삭제 RPC(앱 계약) 불변
  if has_function_privilege('anon', 'public.community_comment_soft_delete_self(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.community_comment_soft_delete_self(uuid)', 'EXECUTE') then
    raise exception '196_SELFCHECK: community_comment_soft_delete_self ACL 변경됨';
  end if;
end $$;

commit;
