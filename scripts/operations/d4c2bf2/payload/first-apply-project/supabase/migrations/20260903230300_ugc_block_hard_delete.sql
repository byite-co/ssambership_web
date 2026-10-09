-- =============================================================================
-- 198_ugc_block_hard_delete.sql  (2026-09-03 · DB-3 묶음 C — 하드 DELETE 차단 ★ · §0 판정 후 포함)
--
-- 왜: DB-2(194 B-4)에서 오너 결정으로 뺐던 하드 DELETE 차단을, 작성자 본인 삭제 RPC(196)가 생긴 뒤 다시 넣는다.
--   숏폼·게시판 댓글·숏폼 댓글은 deleted_at/deleted_by 로만 지운다.
--
-- §0 웹·앱 삭제 경로표(2026-09-03 실측 — 이 파일을 넣는 근거):
--   | 대상            | 웹                                                      | 앱(byite-co/ssambership-app @635ae73)                     |
--   | 숏폼 본인 삭제   | 없음(삭제 UI·액션 없음 — shortform_posts .delete() 0)    | 없음(읽기 중심 — shortform_posts .delete() 0)              |
--   | 숏폼 댓글 본인   | RPC community_comment_soft_delete_self                  | RPC community_comment_soft_delete_self(outbound manifest)  |
--   | 게시판 댓글 본인 | UPDATE comments SET is_deleted = true(RLS 거부 · 실패 중) | 없음(게시판 댓글 읽기 뷰만 · 삭제 UI 없음)                  |
--   앱의 .delete() 는 post_reactions · shortform_reactions · mentor_favorites · user_blocks · connection_notes 뿐 — 세 테이블 직접 DELETE 0.
--   웹 관리자 코드는 PR-W2 로 소프트 삭제 UPDATE 만(communitySoftDeleteReadPaths 트립와이어 · 하드 DELETE 0).
--   → "앱이 직접 DELETE 를 안 쓴다" 조건 충족 — C 포함.
--
-- C-1 트리거: shortform_posts · comments · community_comments 에 BEFORE DELETE 트리거(ugc_block_hard_delete).
--   · current_user 가 anon · authenticated(관리자 세션 포함)이면 UGC_HARD_DELETE_FORBIDDEN(42501).
--   · service_role 은 통과(관리자 코어 · 배치용 — 지시서). 같은 이유로 postgres(SECURITY DEFINER 함수 내부 · pg_cron · 마이그레이션)와
--     supabase_auth_admin(auth.users 삭제 → public.users → author_id ON DELETE CASCADE)도 통과한다 — 194 쓰기 가드 2종과 같은
--     "클라이언트 역할만 차단" 판정이라 cascade · 배치 · 탈퇴 purge 를 깨지 않는다(탈퇴 purge 는 이 세 표를 DELETE 하지 않고
--     auth 는 soft delete — deleteUser(uid, true)).
--   · 기존 comments_write_guard 의 DELETE 분기(관리자 세션 허용)는 그대로 두되, 이 트리거가 이름순(trg_comments_no_delete <
--     trg_comments_write_guard)으로 먼저 발화해 관리자 세션도 거부한다 — 관리자 삭제는 service_role 코어(PR-W2 UPDATE) 경로다.
--   · 정본·레거시 DELETE 미러(cc_sync_board_delete_to_canonical · comments_mirror_delete_to_legacy)는 service_role/postgres 경로에서만
--     발화하게 되며 동작은 불변.
--
-- 적용 전 실측(2026-09-03 운영 read-only): ugc_block_hard_delete 부재 · *_no_delete 트리거 0 · 세 테이블 0행 ·
--   기존 트리거: shortform_posts(adg_shortform_posts · trg_shortform_posts_protected) · comments(mirror 2 · refresh_count · author_label 2 ·
--   sync_deleted_flag · write_guard) · community_comments(author_label 4 · cc_sync 2 · cc_write_guard · set_updated).
--
-- Apply: 저장소 표준 경로(db-apply-pending) — 즉석 실행 금지. 적용 순서 A(196) → B(197) → C(198). **앱·웹 새 버전이 RPC 를 쓰기 전에
--   적용해도 되는 근거는 §0(세 테이블 직접 DELETE 0)** 이다.
--   pack 등재: supabase/baseline/post_ledger_backfills/20260903230300_ugc_block_hard_delete.sql
-- Rollback: supabase/rollback/20260903230300_ugc_block_hard_delete_rollback.sql
-- 검증(§6): select tgrelid::regclass, tgname from pg_trigger where tgname like 'trg_%_no_delete' order by 1;
-- =============================================================================

begin;

-- ── 0. 사전 게이트 — 예상 상태와 다르면 중단(임의 정정 금지) ──────────────────
do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public'
       and table_name in ('shortform_posts', 'comments', 'community_comments') and column_name in ('deleted_at', 'deleted_by')) <> 6 then
    raise exception '198_GATE: deleted_at/deleted_by 컬럼 6 개가 아니다 — 194 미적용';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'soft_delete_own_content') then
    raise exception '198_GATE: soft_delete_own_content 부재 — 196 먼저(작성자 삭제 경로 없이 하드 DELETE 를 막지 않는다)';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ugc_block_hard_delete') then
    raise exception '198_GATE: ugc_block_hard_delete 가 이미 있다(이미 적용됐거나 전제 불일치)';
  end if;
  if exists (select 1 from pg_trigger where tgname in ('trg_shortform_posts_no_delete', 'trg_comments_no_delete', 'trg_community_comments_no_delete')) then
    raise exception '198_GATE: *_no_delete 트리거가 이미 있다';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_comments_write_guard' and tgrelid = 'public.comments'::regclass) then
    raise exception '198_GATE: trg_comments_write_guard 부재(164)';
  end if;
end $$;

-- ── C-1. 트리거 함수 — 클라이언트 역할의 하드 DELETE 거부 ─────────────────────
create function public.ugc_block_hard_delete()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  -- SECURITY INVOKER 필수 — current_user 게이트가 실제 클라이언트 역할을 봐야 한다(194 가드와 동일).
  -- service_role · postgres(SECURITY DEFINER 내부 · pg_cron · 마이그레이션) · supabase_auth_admin(cascade)은 통과.
  if current_user in ('anon', 'authenticated') then
    raise exception 'UGC_HARD_DELETE_FORBIDDEN: %.% is soft-delete only (deleted_at/deleted_by · soft_delete_own_content)', tg_table_schema, tg_table_name
      using errcode = '42501';
  end if;
  return old;
end
$$;

comment on function public.ugc_block_hard_delete() is
  '198(DB-3 C): shortform_posts · comments · community_comments 의 하드 DELETE 를 클라이언트 역할(anon · authenticated — 관리자 세션 포함)에 거부한다. service_role · postgres · supabase_auth_admin 은 통과(관리자 코어 · 배치 · cascade). 삭제는 deleted_at/deleted_by 로만.';

revoke all on function public.ugc_block_hard_delete() from public, anon, authenticated;

create trigger trg_shortform_posts_no_delete
  before delete on public.shortform_posts
  for each row execute function public.ugc_block_hard_delete();

create trigger trg_comments_no_delete
  before delete on public.comments
  for each row execute function public.ugc_block_hard_delete();

create trigger trg_community_comments_no_delete
  before delete on public.community_comments
  for each row execute function public.ugc_block_hard_delete();

-- ── 적용 직후 자가 검증 ───────────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_trigger t
   where not t.tgisinternal and t.tgfoid = 'public.ugc_block_hard_delete()'::regprocedure
     and ((t.tgrelid = 'public.shortform_posts'::regclass and t.tgname = 'trg_shortform_posts_no_delete')
       or (t.tgrelid = 'public.comments'::regclass and t.tgname = 'trg_comments_no_delete')
       or (t.tgrelid = 'public.community_comments'::regclass and t.tgname = 'trg_community_comments_no_delete'))
     and pg_get_triggerdef(t.oid) like '%BEFORE DELETE%FOR EACH ROW%';
  if v_n <> 3 then
    raise exception '198_SELFCHECK: no_delete 트리거 % 개(3 기대)', v_n;
  end if;
  if (select prosecdef from pg_proc where oid = 'public.ugc_block_hard_delete()'::regprocedure) then
    raise exception '198_SELFCHECK: 트리거 함수가 SECURITY DEFINER 다(current_user 게이트 무력화)';
  end if;
  if has_function_privilege('anon', 'public.ugc_block_hard_delete()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.ugc_block_hard_delete()', 'EXECUTE') then
    raise exception '198_SELFCHECK: 트리거 함수에 anon·authenticated EXECUTE 잔존';
  end if;
  -- 기존 트리거 불변
  if not exists (select 1 from pg_trigger where tgname = 'trg_comments_write_guard' and tgrelid = 'public.comments'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'trg_comments_sync_deleted_flag' and tgrelid = 'public.comments'::regclass) then
    raise exception '198_SELFCHECK: comments 기존 트리거 소실';
  end if;
end $$;

commit;
