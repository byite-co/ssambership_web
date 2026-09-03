-- =============================================================================
-- 194_community_soft_delete_deleted_at.sql  (2026-09-03 · DB-2 묶음 B — 소프트 삭제 ★)
--
-- 오너 결정(2026-09-03): 숏폼(shortform_posts) · 숏폼 댓글(community_comments post_type=shortform) · 게시판 댓글
--   (정본 comments ↔ 레거시 community_comments post_type=board)의 하드 DELETE 를 게시판 글(community_posts)과 같은
--   deleted_at 방식으로 통일한다. "언제 지웠는지" 가 남고 복원이 가능해진다.
--
-- B-1 적용 전 실측(2026-09-03 운영 read-only): community_posts = deleted_at 있음(deleted_by 없음) ·
--     shortform_posts / comments / community_comments = deleted_at·deleted_by 없음 · comments.is_deleted boolean 있음 ·
--     네 테이블 전부 0행(콘텐츠 없음 → 데이터 영향 0).
-- B-2 컬럼: shortform_posts · comments · community_comments 에 deleted_at timestamptz null + deleted_by uuid null,
--     community_posts 에 deleted_by uuid null. deleted_by 는 FK 없는 uuid(auth.users 삭제 시 기록을 잃지 않기 위해 —
--     admin_action_logs.admin_id 와 다르게 감사 대상이 아니라 감사 기록이다).
--     comments.is_deleted 는 유지한다("안 보임" = 숨김 OR 삭제 플래그). 둘의 동기화는 **DB 트리거**
--     (comments_sync_deleted_flag · BEFORE INSERT OR UPDATE OF is_deleted, deleted_at)가 한다 — 앱 코드가 아니다:
--       · deleted_at 이 바뀌면 is_deleted 는 그 결과(삭제 → true · 복원 → false)를 따른다
--       · deleted_at 이 남아 있는 행은 is_deleted 를 false 로 되돌려도 true 로 고정된다(삭제가 숨김보다 강하다)
--       · deleted_at 이 NULL 이면 is_deleted 는 숨김 플래그로 자유롭게 바뀐다(관리자 숨김·복원 경로 불변)
--       · 브리지(app.comment_sync) 안에서는 브리지가 두 값을 함께 계산하므로 개입하지 않는다
-- B-3 읽기 경로 전수(★ 하나라도 빠지면 학생 화면에 지운 숏폼이 보인다) — 아래 본문 순서:
--     [정책] sf_select_published · comments_select_visible · community_comments_select_visible 에 deleted_at IS NULL.
--            관리자(is_admin())는 삭제된 것도 읽는다(복원하려면 보여야 한다). comments_admin_select_all · cp_select_visible 불변.
--     [뷰]   api_web_v1.community_comments_v1 — is_deleted = false AND deleted_at IS NULL (security_invoker 유지).
--            mentor_directory_v1 · community_posts_v1(web/app) 은 이 세 테이블을 참조하지 않는다(실측).
--     [RPC]  shortform_view_record_v2 · increment_shortform_post_view(삭제된 숏폼 조회수 미계수) ·
--            rls_private.report_target_content_valid(삭제된 콘텐츠는 신고 대상 아님 — community_posts 포함) ·
--            community_comment_soft_delete_self(본인 삭제 = deleted_at/deleted_by. 구 본문은 status='deleted' 를 쓰는데
--            community_comments_status_chk(visible·hidden)가 막아 실제로는 실패하던 경로 — 함께 정합화).
--     [트리거] community_refresh_post_comment_count 가 삭제 댓글을 세지 않고, trg_comments_refresh_count 가 deleted_at
--            변경에도 재계산한다(UPDATE OF is_deleted, deleted_at — BEFORE 트리거가 바꾼 컬럼은 UPDATE OF 를 발화하지 않으므로
--            deleted_at 을 목록에 넣어야 한다).
--     [댓글 동기화 트리거] cc_sync_board_to_canonical · comments_mirror_to_legacy (+ DELETE 미러 2종) 가 deleted_at·deleted_by 를
--            양방향으로 옮긴다. 정본 is_deleted = 숨김(status<>visible) OR 삭제(deleted_at) · 레거시 status 는 숨김 전용
--            (삭제는 deleted_at 으로만 전달 — 복원하면 숨김이 아니었던 댓글은 그대로 보인다).
--     [쓰기 가드] shortform_posts_protected_guard · comments_write_guard — deleted_by 단독 변경 금지 · deleted_by 는 auth.uid() 만 ·
--            복원(deleted_at → NULL)은 관리자만(위조 방지 · 심층 방어). 작성자 본인의 직접 UPDATE soft delete 는 그 앞단에서
--            RLS 가 거부한다 — UPDATE 의 새 행도 SELECT 정책(deleted_at IS NULL)을 통과해야 하므로(community_posts 와 같은 성질).
--            본인 삭제는 SECURITY DEFINER RPC 경로(숏폼 댓글 community_comment_soft_delete_self · 게시판 글 community_post_soft_delete).
-- B-4 하드 DELETE 차단(권고 · 오너가 거부하면 "B-4" 블록과 rollback 의 대응 블록만 뺀다): shortform_posts · comments ·
--     community_comments 에 BEFORE DELETE 트리거(ugc_block_hard_delete — payout_run_items_block_mutation 과 같은 패턴).
--     PR-W2 전까지 관리자 삭제 버튼(service_role DELETE)이 DB 에서 거부된다 — 순서상 허용(PR-W2 가 UPDATE 로 바꾼다).
--     계정 삭제 purge(SQL 151·20260820100700 · TS 워커)는 이 세 테이블 행을 DELETE 하지 않는다(실측) → 영향 없음.
--
-- Apply: 저장소 표준 경로(db-apply-pending) — 즉석 실행 금지. 적용 순서 A(193) → B(194) → C(195).
--   pack 등재: supabase/baseline/post_ledger_backfills/20260903200200_community_soft_delete_deleted_at.sql
-- Rollback: supabase/rollback/20260903200200_community_soft_delete_deleted_at_rollback.sql
-- 검증(§6): select table_name, column_name from information_schema.columns
--            where table_name in ('shortform_posts','comments','community_comments') and column_name in ('deleted_at','deleted_by');
--           select polname, pg_get_expr(polqual, polrelid) from pg_policy
--            where polrelid in ('shortform_posts'::regclass,'comments'::regclass) and polcmd='r';
-- =============================================================================

begin;

-- ── 0. 사전 게이트 — 예상 상태와 다르면 중단(임의 정정 금지) ──────────────────
do $$
declare v_missing text;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public'
                and ((table_name = 'shortform_posts' and column_name in ('deleted_at', 'deleted_by'))
                  or (table_name = 'comments' and column_name in ('deleted_at', 'deleted_by'))
                  or (table_name = 'community_comments' and column_name in ('deleted_at', 'deleted_by'))
                  or (table_name = 'community_posts' and column_name = 'deleted_by'))) then
    raise exception '194_GATE: deleted_at/deleted_by 컬럼이 이미 있다(이미 적용됐거나 전제 불일치)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'community_posts' and column_name = 'deleted_at')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'comments' and column_name = 'is_deleted') then
    raise exception '194_GATE: community_posts.deleted_at / comments.is_deleted 부재(기준 컬럼)';
  end if;

  select string_agg(p, ', ') into v_missing from unnest(array[
    'shortform_posts.sf_select_published', 'comments.comments_select_visible', 'comments.comments_admin_select_all',
    'community_comments.community_comments_select_visible', 'community_posts.cp_select_visible']) p
   where not exists (select 1 from pg_policies where schemaname = 'public'
                       and tablename = split_part(p, '.', 1) and policyname = split_part(p, '.', 2));
  if v_missing is not null then
    raise exception '194_GATE: SELECT 정책 부재 — %', v_missing;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public'
              and policyname in ('sf_select_published', 'comments_select_visible', 'community_comments_select_visible')
              and qual like '%deleted_at%') then
    raise exception '194_GATE: SELECT 정책에 deleted_at 이 이미 있다(이미 적용)';
  end if;

  if to_regclass('api_web_v1.community_comments_v1') is null
     or pg_get_viewdef('api_web_v1.community_comments_v1'::regclass) not like '%is_deleted = false%' then
    raise exception '194_GATE: api_web_v1.community_comments_v1 부재 또는 정의 불일치';
  end if;

  select string_agg(p, ', ') into v_missing from unnest(array[
    'public.cc_sync_board_to_canonical', 'public.cc_sync_board_delete_to_canonical', 'public.comments_mirror_to_legacy',
    'public.comments_mirror_delete_to_legacy', 'public.comments_write_guard', 'public.shortform_posts_protected_guard',
    'public.community_refresh_post_comment_count', 'public.shortform_view_record_v2', 'public.increment_shortform_post_view',
    'public.community_comment_soft_delete_self', 'public.comment_sync_in_progress', 'rls_private.report_target_content_valid']) p
   where not exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
                       where n.nspname = split_part(p, '.', 1) and f.proname = split_part(p, '.', 2));
  if v_missing is not null then
    raise exception '194_GATE: 함수 부재 — %', v_missing;
  end if;

  select string_agg(t, ', ') into v_missing from unnest(array[
    'comments.trg_comments_refresh_count', 'comments.trg_comments_mirror_to_legacy', 'comments.trg_comments_mirror_delete',
    'comments.trg_comments_write_guard', 'community_comments.trg_cc_sync_board_to_canonical',
    'community_comments.trg_cc_sync_board_delete', 'shortform_posts.trg_shortform_posts_protected']) t
   where not exists (select 1 from pg_trigger g where g.tgname = split_part(t, '.', 2)
                       and g.tgrelid = ('public.' || split_part(t, '.', 1))::regclass);
  if v_missing is not null then
    raise exception '194_GATE: 트리거 부재 — %', v_missing;
  end if;
  if exists (select 1 from pg_proc where proname in ('comments_sync_deleted_flag', 'ugc_block_hard_delete')) then
    raise exception '194_GATE: 194 함수가 이미 있다(이미 적용)';
  end if;
end $$;

-- ── B-2. 컬럼 ─────────────────────────────────────────────────────────────────
alter table public.shortform_posts
  add column deleted_at timestamptz null,
  add column deleted_by uuid null;
alter table public.comments
  add column deleted_at timestamptz null,
  add column deleted_by uuid null;
alter table public.community_comments
  add column deleted_at timestamptz null,
  add column deleted_by uuid null;
alter table public.community_posts
  add column deleted_by uuid null;

comment on column public.shortform_posts.deleted_at is '194: 소프트 삭제 시각(NULL = 살아 있음). 하드 DELETE 금지 — anon·authenticated 읽기 정책이 deleted_at IS NULL 을 건다. 관리자(is_admin)는 삭제된 것도 읽는다.';
comment on column public.shortform_posts.deleted_by is '194: 삭제한 사용자 uuid(관리자 또는 작성자 본인). FK 없음(감사 기록).';
comment on column public.comments.deleted_at is '194: 소프트 삭제 시각(NULL = 살아 있음). is_deleted 는 "안 보임"(숨김 OR 삭제) 플래그로 유지 — comments_sync_deleted_flag 트리거가 동기화한다.';
comment on column public.comments.deleted_by is '194: 삭제한 사용자 uuid. FK 없음(감사 기록).';
comment on column public.community_comments.deleted_at is '194: 소프트 삭제 시각(NULL = 살아 있음). status 는 숨김 전용(visible·hidden). 게시판 댓글은 브리지가 정본 comments 와 양방향 동기화한다.';
comment on column public.community_comments.deleted_by is '194: 삭제한 사용자 uuid. FK 없음(감사 기록).';
comment on column public.community_posts.deleted_by is '194: 삭제한 사용자 uuid(deleted_at 과 짝). FK 없음(감사 기록).';

-- ── B-3a. comments.is_deleted ↔ deleted_at 동기화 트리거 ───────────────────────
create or replace function public.comments_sync_deleted_flag()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- 브리지 안에서는 브리지가 is_deleted 를 (숨김 OR 삭제) 로 직접 계산한다.
  if public.comment_sync_in_progress() then return new; end if;

  if tg_op = 'INSERT' then
    if new.deleted_at is not null then new.is_deleted := true; end if;
    return new;
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    -- 삭제/복원이 명시된 갱신: 플래그가 결과를 따른다(복원 = 다시 보임).
    new.is_deleted := (new.deleted_at is not null);
  elsif new.deleted_at is not null then
    -- 삭제된 행은 숨김 플래그를 풀어도 계속 안 보인다(삭제가 숨김보다 강하다).
    new.is_deleted := true;
  end if;
  return new;
end;
$$;

comment on function public.comments_sync_deleted_flag() is
  '194: comments.deleted_at ↔ is_deleted 동기화. deleted_at 변경 → is_deleted 추종 · deleted_at 잔존 행은 is_deleted 고정 true · deleted_at NULL 이면 is_deleted 는 숨김 플래그(관리자 숨김·복원 경로 불변). 브리지(app.comment_sync) 안에서는 개입하지 않는다.';

revoke all on function public.comments_sync_deleted_flag() from public, anon, authenticated;

drop trigger if exists trg_comments_sync_deleted_flag on public.comments;
create trigger trg_comments_sync_deleted_flag
  before insert or update of is_deleted, deleted_at on public.comments
  for each row execute function public.comments_sync_deleted_flag();

-- ── B-3b. 댓글 수 — 삭제 댓글 제외 · deleted_at 변경에도 재계산 ───────────────
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
    where c.post_id = pid and c.is_deleted = false and c.deleted_at is null
  )
  where p.id = pid;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_comments_refresh_count on public.comments;
create trigger trg_comments_refresh_count
  after insert or delete or update of is_deleted, deleted_at on public.comments
  for each row execute function public.community_refresh_post_comment_count();

-- ── B-3c. 게시판 댓글 브리지(163·164) — deleted_at·deleted_by 양방향 동기화 ────
-- legacy(board) → canonical: 포인터 우선 수렴(164 본문) + deleted_at/deleted_by · is_deleted = 숨김 OR 삭제
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
      set content = new.body,
          deleted_at = new.deleted_at,
          deleted_by = new.deleted_by,
          is_deleted = (new.status <> 'visible' or new.deleted_at is not null)
    where id = new.canonical_comment_id;
  else
    insert into public.comments (post_id, author_id, content, is_deleted, created_at, legacy_comment_id, deleted_at, deleted_by)
    values (new.post_id, new.author_id, new.body, (new.status <> 'visible' or new.deleted_at is not null), new.created_at, new.id,
            new.deleted_at, new.deleted_by)
    on conflict (legacy_comment_id) where legacy_comment_id is not null
    do update set content = excluded.content, is_deleted = excluded.is_deleted,
                  deleted_at = excluded.deleted_at, deleted_by = excluded.deleted_by
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

-- legacy DELETE → canonical soft delete(163·164 정책 유지) + deleted_at 기록
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
    update public.comments
       set is_deleted = true,
           deleted_at = coalesce(deleted_at, old.deleted_at, now()),
           deleted_by = coalesce(deleted_by, old.deleted_by)
     where id = old.canonical_comment_id;
  else
    update public.comments
       set is_deleted = true,
           deleted_at = coalesce(deleted_at, old.deleted_at, now()),
           deleted_by = coalesce(deleted_by, old.deleted_by)
     where legacy_comment_id = old.id;
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'COMMENT_BRIDGE_TARGET_MISSING';
  end if;

  perform set_config('app.comment_sync', '0', true);
  return old;
end;
$$;

-- canonical → legacy 미러(164 본문): deleted_at/deleted_by 전달 · status 는 숨김 전용(삭제는 status 를 건드리지 않는다)
create or replace function public.comments_mirror_to_legacy()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_body text;
  v_rows int;
  v_status text;
begin
  if public.comment_sync_in_progress() then return new; end if;
  perform set_config('app.comment_sync', '1', true);

  v_body := left(coalesce(new.content, ''), 1000);
  -- 194: 숨김(is_deleted 이면서 삭제는 아님)만 hidden. 삭제는 deleted_at 으로만 전달한다.
  v_status := case when coalesce(new.is_deleted, false) and new.deleted_at is null then 'hidden' else 'visible' end;

  if new.legacy_comment_id is not null then
    if char_length(btrim(v_body)) >= 1 then
      update public.community_comments
        set body = v_body,
            status = v_status,
            deleted_at = new.deleted_at,
            deleted_by = new.deleted_by,
            canonical_comment_id = new.id
      where id = new.legacy_comment_id
        and (canonical_comment_id = new.id or canonical_comment_id is null);
    else
      update public.community_comments
        set status = v_status,
            deleted_at = new.deleted_at,
            deleted_by = new.deleted_by,
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
      insert into public.community_comments (post_id, post_type, author_id, body, status, created_at, canonical_comment_id, deleted_at, deleted_by)
      values (new.post_id, 'board', new.author_id, v_body, v_status,
              coalesce(new.created_at, now()), new.id, new.deleted_at, new.deleted_by)
      on conflict (canonical_comment_id) where canonical_comment_id is not null
      do update set body = excluded.body, status = excluded.status,
                    deleted_at = excluded.deleted_at, deleted_by = excluded.deleted_by;
    end if;
  end if;

  perform set_config('app.comment_sync', '0', true);
  return new;
end;
$$;

-- canonical DELETE → legacy hidden(163 정책 유지) + deleted_at 기록
create or replace function public.comments_mirror_delete_to_legacy()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.comment_sync_in_progress() then return old; end if;
  perform set_config('app.comment_sync', '1', true);
  update public.community_comments
     set status = 'hidden',
         deleted_at = coalesce(deleted_at, old.deleted_at, now()),
         deleted_by = coalesce(deleted_by, old.deleted_by)
  where canonical_comment_id = old.id
     or (old.legacy_comment_id is not null and id = old.legacy_comment_id);
  perform set_config('app.comment_sync', '0', true);
  return old;
end;
$$;

-- ── B-3d. 뷰 — api_web_v1.community_comments_v1: 삭제 댓글 제외 ─────────────────
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
  where is_deleted = false and deleted_at is null;

comment on view api_web_v1.community_comments_v1 is
  'S2 M4 V2(계약 §6) + 194: 정본 comments 단일 원천 — body=content · is_deleted=false AND deleted_at IS NULL · 라벨은 M13 비정규화 컬럼. security_invoker=true.';

-- ── B-3e. RLS SELECT 정책 — anon·authenticated 는 deleted_at IS NULL · 관리자는 전부 ───
drop policy if exists sf_select_published on public.shortform_posts;
create policy sf_select_published
  on public.shortform_posts
  for select
  to anon, authenticated
  using (
    (deleted_at is null
      and (status = 'published'
           or author_id = (select auth.uid())
           or creator_id = (select auth.uid())))
    or (select public.is_admin())
  );

drop policy if exists comments_select_visible on public.comments;
create policy comments_select_visible
  on public.comments
  for select
  to anon, authenticated
  using (is_deleted = false and deleted_at is null);
-- comments_admin_select_all(is_admin) 불변 — 관리자는 삭제된 것도 읽는다.

drop policy if exists community_comments_select_visible on public.community_comments;
create policy community_comments_select_visible
  on public.community_comments
  for select
  to anon, authenticated
  using (
    (deleted_at is null
      and (status = 'visible'
           or author_id = (select auth.uid())))
    or ((select public.is_admin()) = true)
  );

comment on policy sf_select_published on public.shortform_posts is
  '053b → 194: 살아 있는(deleted_at IS NULL) published 또는 본인 글 · 관리자는 삭제된 것도 읽는다.';
comment on policy comments_select_visible on public.comments is
  '037 → 194: is_deleted = false AND deleted_at IS NULL. 관리자 전체 읽기는 comments_admin_select_all.';
comment on policy community_comments_select_visible on public.community_comments is
  '101 → 194: 살아 있는(deleted_at IS NULL) visible 또는 본인 댓글 · 관리자는 삭제된 것도 읽는다.';

-- ── B-3f. RPC — 삭제된 콘텐츠는 조회수 미계수 · 신고 대상 아님 · 본인 삭제 = deleted_at ───
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
  -- 게시 상태 공개 글만 계수(194: 삭제된 글 제외)
  if not exists (select 1 from public.shortform_posts sp
                  where sp.id = p_post_id and sp.status = 'published' and sp.deleted_at is null) then
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
  where id = p_post_id and status = 'published' and deleted_at is null;
$$;

create or replace function rls_private.report_target_content_valid(p_target_type text, p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select p_target_id is not null and case p_target_type
    when 'community_post'    then exists (select 1 from public.community_posts   t where t.id = p_target_id and t.deleted_at is null)
    when 'shortform_post'    then exists (select 1 from public.shortform_posts   t where t.id = p_target_id and t.deleted_at is null)
    when 'community_comment' then exists (select 1 from public.community_comments t where t.id = p_target_id and t.deleted_at is null)
    when 'board_comment'     then exists (select 1 from public.comments          t where t.id = p_target_id and t.deleted_at is null)
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

  -- 194: 삭제 = deleted_at/deleted_by (구 본문이 status 에 쓰던 삭제 값은 status CHECK(visible·hidden)가 막던 경로)
  if v_row.deleted_at is not null then
    return jsonb_build_object('ok', true, 'contract_version', 1, 'comment_id', p_comment_id, 'idempotent_hit', true);
  end if;
  if v_row.status <> 'visible' then
    -- 관리자 hidden 처리된 댓글은 본인이 삭제로 덮지 못한다 (moderation 유지)
    raise exception 'COMMENT_MODERATED' using errcode = '42501';
  end if;

  update public.community_comments set deleted_at = now(), deleted_by = v_uid where id = p_comment_id;

  return jsonb_build_object('ok', true, 'contract_version', 1, 'comment_id', p_comment_id, 'idempotent_hit', false);
end
$$;

-- ── B-3g. 쓰기 가드 — deleted_at/deleted_by 위조 방지(deleted_by = auth.uid() · 복원은 관리자만 · 심층 방어: 작성자 직접 UPDATE 는 RLS 가 먼저 거부) ───
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
  -- 194: deleted_by = auth.uid() 만 · 복원은 관리자만 · deleted_by 단독 변경 금지(RLS 가 작성자 직접 soft delete 를 먼저 거부하므로 심층 방어)
  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is null then
      raise exception 'SHORTFORM_RESTORE_ADMIN_ONLY' using errcode = '42501';
    end if;
    if new.deleted_by is distinct from (select auth.uid()) then
      raise exception 'SHORTFORM_DELETED_BY_MISMATCH' using errcode = '42501';
    end if;
  elsif new.deleted_by is distinct from old.deleted_by then
    raise exception 'SHORTFORM_PROTECTED_COLUMNS' using errcode = '42501';
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
  -- 194: deleted_by = auth.uid() 만 · 복원은 관리자만 · deleted_by 단독 변경 금지(RLS 가 작성자 직접 soft delete 를 먼저 거부하므로 심층 방어)
  if new.deleted_at is distinct from old.deleted_at then
    if new.deleted_at is null then
      if not coalesce((select public.is_admin()), false) then
        raise exception 'COMMENT_RESTORE_ADMIN_ONLY';
      end if;
    elsif new.deleted_by is distinct from (select auth.uid()) then
      raise exception 'COMMENT_DELETED_BY_MISMATCH';
    end if;
  elsif new.deleted_by is distinct from old.deleted_by then
    raise exception 'COMMENT_PROTECTED_FIELDS_IMMUTABLE';
  end if;
  return new;
end;
$$;

-- ── B-4. 하드 DELETE 차단(권고 · 오너 거부 시 이 블록만 뺀다 — rollback 의 "B-4" 블록도 함께) ───
create or replace function public.ugc_block_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'UGC_HARD_DELETE_FORBIDDEN: % is soft-delete only (set deleted_at); % not allowed', tg_table_name, tg_op
    using errcode = 'P0001';
end;
$$;

comment on function public.ugc_block_hard_delete() is
  '194 B-4: shortform_posts · comments · community_comments 의 하드 DELETE 를 거부한다(payout_run_items_block_mutation 과 같은 패턴). 삭제는 deleted_at/deleted_by 로만.';

revoke all on function public.ugc_block_hard_delete() from public, anon, authenticated;

drop trigger if exists trg_shortform_posts_no_delete on public.shortform_posts;
create trigger trg_shortform_posts_no_delete
  before delete on public.shortform_posts
  for each row execute function public.ugc_block_hard_delete();

drop trigger if exists trg_comments_no_delete on public.comments;
create trigger trg_comments_no_delete
  before delete on public.comments
  for each row execute function public.ugc_block_hard_delete();

drop trigger if exists trg_community_comments_no_delete on public.community_comments;
create trigger trg_community_comments_no_delete
  before delete on public.community_comments
  for each row execute function public.ugc_block_hard_delete();

-- ── 적용 직후 자가 검증 ───────────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public'
     and ((table_name in ('shortform_posts', 'comments', 'community_comments') and column_name in ('deleted_at', 'deleted_by'))
       or (table_name = 'community_posts' and column_name in ('deleted_at', 'deleted_by')));
  if v_n <> 8 then
    raise exception '194_SELFCHECK: deleted_at/deleted_by 컬럼 % 개(8 기대)', v_n;
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and qual like '%deleted_at IS NULL%'
     and ((tablename = 'shortform_posts' and policyname = 'sf_select_published')
       or (tablename = 'comments' and policyname = 'comments_select_visible')
       or (tablename = 'community_comments' and policyname = 'community_comments_select_visible')
       or (tablename = 'community_posts' and policyname = 'cp_select_visible'));
  if v_n <> 4 then
    raise exception '194_SELFCHECK: deleted_at 필터 SELECT 정책 % 개(4 기대)', v_n;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comments' and policyname = 'comments_admin_select_all') then
    raise exception '194_SELFCHECK: comments_admin_select_all 부재';
  end if;

  if pg_get_viewdef('api_web_v1.community_comments_v1'::regclass) not like '%deleted_at IS NULL%'
     or coalesce((select reloptions::text from pg_class where oid = 'api_web_v1.community_comments_v1'::regclass), '') not like '%security_invoker=true%' then
    raise exception '194_SELFCHECK: community_comments_v1 정의/security_invoker 불일치';
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where ((n.nspname = 'public' and p.proname in ('cc_sync_board_to_canonical', 'cc_sync_board_delete_to_canonical',
                                                  'comments_mirror_to_legacy', 'comments_mirror_delete_to_legacy',
                                                  'comments_write_guard', 'shortform_posts_protected_guard',
                                                  'community_refresh_post_comment_count', 'shortform_view_record_v2',
                                                  'increment_shortform_post_view', 'community_comment_soft_delete_self'))
       or (n.nspname = 'rls_private' and p.proname = 'report_target_content_valid'))
     and p.prosrc like '%deleted_at%';
  if v_n <> 11 then
    raise exception '194_SELFCHECK: deleted_at 을 반영한 함수 % 개(11 기대)', v_n;
  end if;
  if exists (select 1 from pg_proc where proname = 'community_comment_soft_delete_self' and prosrc like '%''deleted''%') then
    raise exception '194_SELFCHECK: community_comment_soft_delete_self 에 status=deleted 잔존';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_comments_sync_deleted_flag' and tgrelid = 'public.comments'::regclass)
     or pg_get_triggerdef((select oid from pg_trigger where tgname = 'trg_comments_refresh_count' and tgrelid = 'public.comments'::regclass))
        not like '%UPDATE OF is_deleted, deleted_at%' then
    raise exception '194_SELFCHECK: comments 트리거 불일치';
  end if;
  -- B-4
  if not exists (select 1 from pg_trigger where tgname = 'trg_shortform_posts_no_delete' and tgrelid = 'public.shortform_posts'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'trg_comments_no_delete' and tgrelid = 'public.comments'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'trg_community_comments_no_delete' and tgrelid = 'public.community_comments'::regclass) then
    raise exception '194_SELFCHECK: B-4 하드 DELETE 차단 트리거 부재';
  end if;
  for v_n in select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('comments_sync_deleted_flag', 'ugc_block_hard_delete')
                and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    raise exception '194_SELFCHECK: 트리거 함수에 anon·authenticated EXECUTE 잔존';
  end loop;
  -- 기존 ACL 불변 확인(CREATE OR REPLACE 는 ACL 을 보존한다)
  if has_function_privilege('anon', 'public.community_comment_soft_delete_self(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.community_comment_soft_delete_self(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.increment_shortform_post_view(uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.shortform_view_record_v2(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'rls_private.report_target_content_valid(text, uuid)', 'EXECUTE') then
    raise exception '194_SELFCHECK: 기존 함수 ACL 변경됨';
  end if;
end $$;

commit;
