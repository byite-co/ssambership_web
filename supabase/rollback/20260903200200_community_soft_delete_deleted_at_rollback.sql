-- =============================================================================
-- 20260903200200_community_soft_delete_deleted_at_rollback.sql  (DB-2 묶음 B 롤백)
-- =============================================================================
-- forward: supabase/sql/194_community_soft_delete_deleted_at.sql
-- 되돌리는 것(역순):
--   B-3g 쓰기 가드 2종을 운영 적용본(shortform_posts_protected_guard · comments_write_guard = 164 본문)으로 복원
--   B-3f RPC 4종 복원 — shortform_view_record_v2 · increment_shortform_post_view(037/038 본문) ·
--        rls_private.report_target_content_valid(20260806075316 본문) · community_comment_soft_delete_self(20260803162808 본문 —
--        status='deleted' 를 쓰는 원문 그대로. status CHECK(visible·hidden)가 막는 기존 결함도 그대로 돌아온다)
--   B-3e SELECT 정책 3종을 운영 실측 정의(053b · 037 · 101)로 복원
--   B-3d api_web_v1.community_comments_v1 을 M4 정의로 복원(security_invoker=true · COMMENT)
--   B-3c 브리지 함수 4종을 163·164 본문으로 복원
--   B-3b community_refresh_post_comment_count · trg_comments_refresh_count 를 037 정의로 복원
--   B-3a trg_comments_sync_deleted_flag + comments_sync_deleted_flag() DROP
--   데이터: 컬럼을 지우면 삭제 표시가 사라져 지운 글이 다시 보이므로, deleted_at 이 있는 shortform_posts ·
--        community_comments 행은 status='hidden' 으로 바꿔 두고(comments 는 is_deleted 가 이미 true) 건수를
--        admin_action_logs(community_soft_delete_rollback · admin_id NULL)에 남긴다. 되돌린 뒤 이 행들은 "숨김" 이다.
--   B-2  컬럼 DROP(마지막 — 정책·뷰·SQL 함수가 컬럼을 참조하지 않게 된 뒤).
-- 순서 주의: SQL-language 함수(report_target_content_valid · increment_shortform_post_view)와 뷰·정책은 정의 시점에 컬럼을
--   검사하므로 반드시 컬럼 DROP 보다 먼저 복원한다.
-- =============================================================================

begin;

-- B-3g — 운영 적용본(2026-09-03 실측 pg_get_functiondef) 그대로
create or replace function public.shortform_posts_protected_guard()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  -- SECURITY INVOKER 필수 — current_user 게이트가 실제 클라이언트 역할을 봐야 한다.
  if current_user not in ('anon','authenticated') then
    return new;
  end if;
  if coalesce((select public.is_admin()), false) then
    return new;
  end if;
  if new.id                   is distinct from old.id
     or new.author_id            is distinct from old.author_id
     or new.creator_id           is distinct from old.creator_id
     or new.author_role          is distinct from old.author_role
     or new.author_label         is distinct from old.author_label
     or new.source               is distinct from old.source
     or new.created_at           is distinct from old.created_at
     or new.view_count           is distinct from old.view_count
     or new.like_count           is distinct from old.like_count
     or new.create_idempotency_key is distinct from old.create_idempotency_key then
    raise exception 'SHORTFORM_PROTECTED_COLUMNS' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not (old.status in ('draft','published') and new.status in ('draft','published')) then
      raise exception 'SHORTFORM_STATUS_TRANSITION_FORBIDDEN' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

create or replace function public.comments_write_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare v_parent public.comments;
begin
  if public.comment_sync_in_progress() then
    return coalesce(new, old);
  end if;
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if coalesce((select public.is_admin()), false) then return old; end if;
    raise exception 'COMMENT_HARD_DELETE_FORBIDDEN';
  end if;

  if tg_op = 'INSERT' then
    if new.legacy_comment_id is not null then
      raise exception 'COMMENT_LEGACY_ID_FORBIDDEN';
    end if;
    if new.parent_id is not null then
      select * into v_parent from public.comments where id = new.parent_id;
      if not found then raise exception 'COMMENT_PARENT_NOT_FOUND'; end if;
      if v_parent.post_id is distinct from new.post_id then
        raise exception 'COMMENT_PARENT_POST_MISMATCH';
      end if;
      if v_parent.parent_id is not null then
        raise exception 'COMMENT_DEPTH_EXCEEDED';
      end if;
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.post_id is distinct from old.post_id
     or new.author_id is distinct from old.author_id
     or new.parent_id is distinct from old.parent_id
     or new.created_at is distinct from old.created_at
     or new.legacy_comment_id is distinct from old.legacy_comment_id
     or new.like_count is distinct from old.like_count then
    raise exception 'COMMENT_PROTECTED_FIELDS_IMMUTABLE';
  end if;
  return new;
end;
$$;

-- B-3f — 운영 적용본 그대로
create or replace function public.shortform_view_record_v2(p_post_id uuid, p_event_key uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_inserted boolean := false;
begin
  if p_post_id is null or p_event_key is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  -- 게시 상태 공개 글만 계수
  if not exists (select 1 from public.shortform_posts sp
                  where sp.id = p_post_id and sp.status = 'published') then
    raise exception 'POST_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.shortform_view_events (post_id, event_key, viewer_user_id)
  values (p_post_id, p_event_key, v_uid)
  on conflict (post_id, event_key) do nothing;
  v_inserted := found;

  if v_inserted then
    update public.shortform_posts
       set view_count = view_count + 1
     where id = p_post_id;
  end if;

  -- 중복 key 는 idempotent success (계수 증가 없음)
  return jsonb_build_object('ok', true, 'contract_version', 1, 'incremented', v_inserted);
end
$$;

create or replace function public.increment_shortform_post_view(p_post_id uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.shortform_posts set view_count = view_count + 1
  where id = p_post_id and status = 'published';
$$;

create or replace function rls_private.report_target_content_valid(p_target_type text, p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select p_target_id is not null and case p_target_type
    when 'community_post'    then exists (select 1 from public.community_posts   t where t.id = p_target_id)
    when 'shortform_post'    then exists (select 1 from public.shortform_posts   t where t.id = p_target_id)
    when 'community_comment' then exists (select 1 from public.community_comments t where t.id = p_target_id)
    when 'board_comment'     then exists (select 1 from public.comments          t where t.id = p_target_id)
    else false
  end
$$;

create or replace function public.community_comment_soft_delete_self(p_comment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.community_comments%rowtype;
  v_status text;
  v_susp timestamptz;
  v_norm text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_row from public.community_comments where id = p_comment_id for update;
  if not found then
    raise exception 'COMMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.post_type <> 'shortform' then
    raise exception 'COMMENT_TYPE_NOT_SUPPORTED' using errcode = '22023';
  end if;
  if v_row.author_id is distinct from v_uid then
    raise exception 'COMMENT_NOT_OWNED' using errcode = '42501';
  end if;

  -- 계정 게이트 (Build 13 판정과 동일: banned·유효 suspended·unknown/deleted·삭제 진행 차단)
  select u.status, u.suspended_until into v_status, v_susp from public.users u where u.id = v_uid;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  v_norm := lower(btrim(coalesce(v_status,'')));
  if v_norm = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if v_norm not in ('active','suspended') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if public.account_deletion_write_blocked(v_uid) then raise exception 'ACCOUNT_DELETION_IN_PROGRESS'; end if;

  if v_row.status = 'deleted' then
    return jsonb_build_object('ok', true, 'contract_version', 1, 'comment_id', p_comment_id, 'idempotent_hit', true);
  end if;
  if v_row.status <> 'visible' then
    -- 관리자 hidden 처리된 댓글은 본인이 삭제로 덮지 못한다 (moderation 유지)
    raise exception 'COMMENT_MODERATED' using errcode = '42501';
  end if;

  update public.community_comments set status = 'deleted' where id = p_comment_id;

  return jsonb_build_object('ok', true, 'contract_version', 1, 'comment_id', p_comment_id, 'idempotent_hit', false);
end
$$;

-- B-3e — 운영 실측 정의(pg_policies · 2026-09-03) 그대로
drop policy if exists sf_select_published on public.shortform_posts;
create policy sf_select_published
  on public.shortform_posts
  for select
  to anon, authenticated
  using (
    status = 'published'
    or author_id = (select auth.uid())
    or creator_id = (select auth.uid())
    or (select public.is_admin())
  );

drop policy if exists comments_select_visible on public.comments;
create policy comments_select_visible
  on public.comments
  for select
  to anon, authenticated
  using (is_deleted = false);

drop policy if exists community_comments_select_visible on public.community_comments;
create policy community_comments_select_visible
  on public.community_comments
  for select
  to anon, authenticated
  using (
    status = 'visible'
    or author_id = (select auth.uid())
    or ((select public.is_admin()) = true)
  );

-- B-3d — M4(20260730095441) 정의 그대로
create or replace view api_web_v1.community_comments_v1
with (security_invoker = true) as
 select id,
        post_id,
        author_id,
        parent_id,
        content as body,
        like_count,
        author_label,
        author_role,
        created_at
   from public.comments c
  where is_deleted = false;

comment on view api_web_v1.community_comments_v1 is
  'S2 M4 V2(계약 §6): 정본 comments 단일 원천 — body=content · is_deleted=false · 라벨은 M13 비정규화 컬럼. security_invoker=true.';

-- B-3c — 163·164 본문(운영 적용본) 그대로
create or replace function public.cc_sync_board_to_canonical()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_canonical uuid;
  v_target public.comments;
begin
  if public.comment_sync_in_progress() then return new; end if;
  perform set_config('app.comment_sync', '1', true);

  if new.canonical_comment_id is not null then
    select * into v_target from public.comments
    where id = new.canonical_comment_id for update;
    if not found then
      raise exception 'COMMENT_BRIDGE_TARGET_MISSING';
    end if;
    if v_target.post_id is distinct from new.post_id then
      raise exception 'COMMENT_BRIDGE_POST_MISMATCH';
    end if;
    if v_target.author_id is distinct from new.author_id then
      raise exception 'COMMENT_BRIDGE_AUTHOR_MISMATCH';
    end if;
    update public.comments
      set content = new.body, is_deleted = (new.status <> 'visible')
    where id = new.canonical_comment_id;
  else
    insert into public.comments (post_id, author_id, content, is_deleted, created_at, legacy_comment_id)
    values (new.post_id, new.author_id, new.body, new.status <> 'visible', new.created_at, new.id)
    on conflict (legacy_comment_id) where legacy_comment_id is not null
    do update set content = excluded.content, is_deleted = excluded.is_deleted
    returning id into v_canonical;
    if v_canonical is null then
      select id into v_canonical from public.comments where legacy_comment_id = new.id;
    end if;
    update public.community_comments set canonical_comment_id = v_canonical where id = new.id;
  end if;

  perform set_config('app.comment_sync', '0', true);
  return new;
end;
$$;

create or replace function public.cc_sync_board_delete_to_canonical()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_rows int;
begin
  if public.comment_sync_in_progress() then return old; end if;
  perform set_config('app.comment_sync', '1', true);

  if old.canonical_comment_id is not null then
    update public.comments set is_deleted = true where id = old.canonical_comment_id;
  else
    update public.comments set is_deleted = true where legacy_comment_id = old.id;
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'COMMENT_BRIDGE_TARGET_MISSING';
  end if;

  perform set_config('app.comment_sync', '0', true);
  return old;
end;
$$;

create or replace function public.comments_mirror_to_legacy()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_body text;
  v_rows int;
begin
  if public.comment_sync_in_progress() then return new; end if;
  perform set_config('app.comment_sync', '1', true);

  v_body := left(coalesce(new.content, ''), 1000);

  if new.legacy_comment_id is not null then
    if char_length(btrim(v_body)) >= 1 then
      update public.community_comments
        set body = v_body,
            status = case when coalesce(new.is_deleted, false) then 'hidden' else 'visible' end,
            canonical_comment_id = new.id
      where id = new.legacy_comment_id
        and (canonical_comment_id = new.id or canonical_comment_id is null);
    else
      update public.community_comments
        set status = case when coalesce(new.is_deleted, false) then 'hidden' else 'visible' end,
            canonical_comment_id = new.id
      where id = new.legacy_comment_id
        and (canonical_comment_id = new.id or canonical_comment_id is null);
    end if;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'COMMENT_BRIDGE_LEGACY_MISSING';
    end if;
  else
    if char_length(btrim(v_body)) >= 1 then
      insert into public.community_comments (post_id, post_type, author_id, body, status, created_at, canonical_comment_id)
      values (new.post_id, 'board', new.author_id, v_body,
              case when coalesce(new.is_deleted, false) then 'hidden' else 'visible' end,
              coalesce(new.created_at, now()), new.id)
      on conflict (canonical_comment_id) where canonical_comment_id is not null
      do update set body = excluded.body, status = excluded.status;
    end if;
  end if;

  perform set_config('app.comment_sync', '0', true);
  return new;
end;
$$;

create or replace function public.comments_mirror_delete_to_legacy()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.comment_sync_in_progress() then return old; end if;
  perform set_config('app.comment_sync', '1', true);
  update public.community_comments set status = 'hidden'
  where canonical_comment_id = old.id
     or (old.legacy_comment_id is not null and id = old.legacy_comment_id);
  perform set_config('app.comment_sync', '0', true);
  return old;
end;
$$;

-- B-3b — 037 정의 그대로
create or replace function public.community_refresh_post_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  pid uuid;
begin
  pid := coalesce(new.post_id, old.post_id);
  update public.community_posts p
  set comment_count = (
    select count(*)::int from public.comments c
    where c.post_id = pid and c.is_deleted = false
  )
  where p.id = pid;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_comments_refresh_count on public.comments;
create trigger trg_comments_refresh_count
  after insert or update of is_deleted or delete on public.comments
  for each row execute function public.community_refresh_post_comment_count();

-- B-3a
drop trigger if exists trg_comments_sync_deleted_flag on public.comments;
drop function if exists public.comments_sync_deleted_flag();

-- 데이터 — 컬럼을 지우기 전에 삭제 표시를 숨김으로 바꿔 둔다(지운 글이 다시 보이지 않게)
do $$
declare v_sf integer; v_cc integer; v_c integer;
begin
  update public.shortform_posts set status = 'hidden' where deleted_at is not null and status is distinct from 'hidden';
  get diagnostics v_sf = row_count;
  update public.community_comments set status = 'hidden' where deleted_at is not null and status is distinct from 'hidden';
  get diagnostics v_cc = row_count;
  select count(*) into v_c from public.comments where deleted_at is not null;   -- is_deleted 는 이미 true(동기화 트리거)
  if v_sf + v_cc + v_c > 0 then
    insert into public.admin_action_logs (admin_id, action_type, target_type, target_id, detail)
    values (null, 'community_soft_delete_rollback', 'community_content', null,
            jsonb_build_object('shortform_posts_hidden', v_sf, 'community_comments_hidden', v_cc, 'comments_deleted_kept_is_deleted', v_c,
                               'note', '194 rollback — deleted_at 컬럼 제거 전 삭제 행을 숨김으로 전환'));
  end if;
  raise notice '194 rollback 데이터: shortform_posts 숨김 전환 % · community_comments 숨김 전환 % · comments 삭제 행(is_deleted 유지) %', v_sf, v_cc, v_c;
end $$;

-- B-2 — 컬럼 DROP(정책·뷰·함수 복원 뒤)
alter table public.shortform_posts drop column deleted_by, drop column deleted_at;
alter table public.comments drop column deleted_by, drop column deleted_at;
alter table public.community_comments drop column deleted_by, drop column deleted_at;
alter table public.community_posts drop column deleted_by;

-- 복원 검증
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and ((table_name in ('shortform_posts', 'comments', 'community_comments') and column_name in ('deleted_at', 'deleted_by'))
                or (table_name = 'community_posts' and column_name = 'deleted_by')))
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'community_posts' and column_name = 'deleted_at')
     or exists (select 1 from pg_proc where proname = 'comments_sync_deleted_flag')
     or exists (select 1 from pg_trigger where tgname = 'trg_comments_sync_deleted_flag')
     or exists (select 1 from pg_policies where schemaname = 'public'
                 and policyname in ('sf_select_published', 'comments_select_visible', 'community_comments_select_visible') and qual like '%deleted_at%')
     or pg_get_viewdef('api_web_v1.community_comments_v1'::regclass) like '%deleted_at%'
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where ((n.nspname = 'public' and p.proname in ('cc_sync_board_to_canonical', 'cc_sync_board_delete_to_canonical', 'comments_mirror_to_legacy',
                                                              'comments_mirror_delete_to_legacy', 'comments_write_guard', 'shortform_posts_protected_guard',
                                                              'community_refresh_post_comment_count', 'shortform_view_record_v2', 'increment_shortform_post_view',
                                                              'community_comment_soft_delete_self'))
                     or (n.nspname = 'rls_private' and p.proname = 'report_target_content_valid'))
                   and p.prosrc like '%deleted_at%') then
    raise exception '194_ROLLBACK_SELFCHECK: 복원 불일치';
  end if;
end $$;

commit;
