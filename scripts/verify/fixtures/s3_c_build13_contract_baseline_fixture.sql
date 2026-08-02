-- =============================================================================
-- s3_c_build13_contract_baseline_fixture.sql — S3-C 로컬 검증 전용 baseline 스텁
-- =============================================================================
-- 목적: 20260802024641_build13_db_contract_convergence.sql 의 forward/rollback 을
--   오프라인 스크래치 Postgres 에서 그대로 구동하기 위해, **2026-08-02 운영 실측
--   (project lbeqxarxothkmzqvpudy, read-only pg_policies/pg_proc/ACL 조회)** 과
--   동일한 선행 상태를 재현한다.
--
-- ⚠️ staging/production 에 절대 적용 금지 — 실 DB 에는 정본 migration 으로 이미 존재한다.
--
-- 재현 범위(범위 A~E 가 건드리는 표면만 발췌):
--   - Supabase role 3종 · auth.uid() 스텁(GUC request.jwt.claim.sub)
--   - public: users · mentor_profiles · community_posts(+멱등 UNIQUE) ·
--     account_deletion_jobs · comments · community_comments · post_reactions ·
--     shortform_reactions · content_reports · user_blocks ·
--     custom_request_orders · custom_order_deliverables · custom_order_messages ·
--     custom_request_posts · custom_request_applications
--   - 함수: is_admin() · individual_question_user_is_approved_mentor(uuid) ·
--     account_deletion_write_blocked(uuid)  ← 151 원문
--   - core_private: community_image_refs_validate · community_post_create_impl
--     ← M7(20260730105252) 원문(승인 멘토 전용)
--   - api_web_v1 / api_app_v1: community_post_create wrapper ← M7 / M17 원문
--   - RLS 정책: 운영 실측 정의 그대로(한글명 대시보드 정책 포함)
--   - community_posts M16 잠금 상태(anon·authenticated SELECT 만 · 쓰기 정책 0)
-- =============================================================================

-- Supabase 기본 role
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- auth.uid() 스텁 — 테스트는 `set local request.jwt.claim.sub` 로 주체를 바꾼다.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 도메인 테이블(참조 컬럼만 발췌 — FK 일부 생략)
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key,
  role text not null check (role in ('student', 'mentor', 'admin')),
  status text not null default 'active',
  suspended_until timestamptz,
  nickname text,
  full_name text,
  email text
);

create table if not exists public.mentor_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  verification_status text
);

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.users (id) on delete cascade,
  title text not null,
  body text,
  content text,
  category text,
  image_urls text[] default '{}',
  hashtags text[] default '{}',
  status text not null default 'published',
  author_label text,
  author_role text,
  like_count int not null default 0,
  comment_count int not null default 0,
  view_count int not null default 0,
  create_idempotency_key uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- 운영 실측 정의 그대로(부분 인덱스 아님 — ON CONFLICT 추론 대상)
create unique index if not exists community_posts_author_idem_key
  on public.community_posts using btree (author_id, create_idempotency_key);

create table if not exists public.account_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  state text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid,
  author_id uuid not null,
  body text not null,
  author_label text not null default '쌤버십 사용자',
  author_role text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid,
  author_id uuid not null,
  body text not null,
  author_label text,
  status text not null default 'visible',
  created_at timestamptz not null default now()
);

create table if not exists public.post_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid,
  user_id uuid not null,
  type text not null default 'like',
  created_at timestamptz not null default now()
);

create table if not exists public.shortform_reactions (
  id uuid primary key default gen_random_uuid(),
  shortform_id uuid,
  user_id uuid not null,
  type text not null default 'like',
  created_at timestamptz not null default now()
);

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.users (id) on delete set null,
  target_type text not null,
  target_id uuid,
  reason text,
  description text,
  status text not null default 'pending',
  admin_note text,
  resolved_by uuid references public.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_reports_status_allowed check (status = any (array['pending','reviewing','resolved','rejected','dismissed','hidden','removed'])),
  constraint content_reports_target_type_nonempty check (char_length(btrim(target_type)) > 0)
);

create table if not exists public.user_blocks (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists public.custom_request_orders (
  id uuid primary key default gen_random_uuid(),
  student_id uuid,
  mentor_id uuid,
  buyer_id uuid,
  client_id uuid,
  user_id uuid,
  author_id uuid,
  requester_id uuid,
  title text
);

create table if not exists public.custom_order_deliverables (
  id uuid primary key default gen_random_uuid(),
  custom_request_order_id uuid references public.custom_request_orders (id) on delete cascade,
  mentor_id uuid,
  note text
);

create table if not exists public.custom_order_messages (
  id uuid primary key default gen_random_uuid(),
  custom_request_order_id uuid references public.custom_request_orders (id) on delete cascade,
  author_id uuid,
  body text
);

create table if not exists public.custom_request_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid,
  user_id uuid,
  student_id uuid,
  requester_id uuid,
  client_id uuid,
  title text
);

create table if not exists public.custom_request_applications (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.custom_request_posts (id) on delete cascade,
  mentor_id uuid,
  message text
);

-- -----------------------------------------------------------------------------
-- 공용 함수(운영 실측 정의)
-- -----------------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path to 'public' as $$
  select coalesce((select u.role = 'admin' from public.users u where u.id = auth.uid()), false);
$$;
grant execute on function public.is_admin() to anon, authenticated, service_role;

create or replace function public.individual_question_user_is_approved_mentor(p_user_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.mentor_profiles mp
    where mp.user_id = p_user_id
      and lower(coalesce(mp.verification_status, '')) in ('approved', 'verified', 'active')
  );
$$;
revoke all on function public.individual_question_user_is_approved_mentor(uuid) from public, anon;
grant execute on function public.individual_question_user_is_approved_mentor(uuid) to authenticated, service_role;

-- 151 원문 — S3-C forward 가 self 제한을 얹는 대상
create or replace function public.account_deletion_write_blocked(p_user_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.account_deletion_jobs j
    where j.user_id = p_user_id
      and j.state in ('locked','purging','storage_purged','finalized','auth_soft_deleted')
  );
$$;
revoke all on function public.account_deletion_write_blocked(uuid) from public, anon;
grant execute on function public.account_deletion_write_blocked(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- core_private / api_* — M7·M17 원문
-- -----------------------------------------------------------------------------
create schema if not exists core_private;
revoke all on schema core_private from public, anon, authenticated;

create schema if not exists api_web_v1;
revoke all on schema api_web_v1 from public, anon;
grant usage on schema api_web_v1 to authenticated, service_role;

create schema if not exists api_app_v1;
revoke all on schema api_app_v1 from public, anon;
grant usage on schema api_app_v1 to authenticated;

create or replace function core_private.community_image_refs_validate(
  p_owner_id uuid, p_image_refs text[]
) returns jsonb
language plpgsql security invoker set search_path = '' as $fn$
DECLARE
  v_refs text[] := coalesce(p_image_refs, '{}'::text[]);
BEGIN
  -- 스텁: 개수 상한만 재현한다(storage.objects 미구현 — 이미지 경로는 본 검증 범위 밖).
  IF p_owner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED');
  END IF;
  IF coalesce(array_length(v_refs, 1), 0) > 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_COUNT_EXCEEDED');
  END IF;
  IF coalesce(array_length(v_refs, 1), 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'IMAGE_OBJECT_NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok', true);
END $fn$;
revoke all on function core_private.community_image_refs_validate(uuid, text[]) from public, anon, authenticated, service_role;

-- M7 원문(승인 멘토 전용) — forward 가 CREATE OR REPLACE 로 교체할 대상
create or replace function core_private.community_post_create_impl(
  p_author_id uuid, p_title text, p_body text, p_category text,
  p_image_refs text[], p_status text, p_idempotency_key uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $fn$
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
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'p_idempotency_key is required';
  END IF;

  SELECT cp.id INTO v_id FROM public.community_posts cp
   WHERE cp.author_id = p_author_id AND cp.create_idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'post_id', v_id, 'idempotent_replay', true);
  END IF;

  SELECT u.role, u.status, u.suspended_until, u.nickname
    INTO v_role, v_status, v_susp, v_nickname
    FROM public.users u WHERE u.id = p_author_id;
  IF NOT FOUND OR v_role IS DISTINCT FROM 'mentor' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROLE_NOT_MENTOR');
  END IF;
  IF NOT public.individual_question_user_is_approved_mentor(p_author_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MENTOR_NOT_APPROVED');
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

  v_title := regexp_replace(v_title, '(^|[^0-9])(\+82[-._\s]?0?1[0-9][-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4}|0(?:10|11|16|17|18|19|2|[3-6][1-5]|50|70|80)[-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4})(?![0-9])', '\1[연락처 비공개]', 'g');
  v_body  := regexp_replace(v_body,  '(^|[^0-9])(\+82[-._\s]?0?1[0-9][-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4}|0(?:10|11|16|17|18|19|2|[3-6][1-5]|50|70|80)[-._\s]?[0-9]{3,4}[-._\s]?[0-9]{4})(?![0-9])', '\1[연락처 비공개]', 'g');
  v_title := regexp_replace(v_title, '\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y', '[연락처 비공개]', 'gi');
  v_body  := regexp_replace(v_body,  '\y[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\y', '[연락처 비공개]', 'gi');

  v_val := core_private.community_image_refs_validate(p_author_id, coalesce(p_image_refs, '{}'::text[]));
  IF NOT coalesce((v_val ->> 'ok')::boolean, false) THEN
    RETURN v_val;
  END IF;

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
revoke all on function core_private.community_post_create_impl(uuid, text, text, text, text[], text, uuid)
  from public, anon, authenticated, service_role;

create or replace function api_web_v1.community_post_create(
  p_title text, p_body text, p_category text,
  p_idempotency_key uuid,
  p_image_refs text[] default '{}', p_status text default 'published'
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  RETURN core_private.community_post_create_impl(
           v_uid, p_title, p_body, p_category,
           coalesce(p_image_refs, '{}'::text[]), p_status, p_idempotency_key)
         || jsonb_build_object('contract_version', 1);
END $fn$;
revoke all on function api_web_v1.community_post_create(text, text, text, uuid, text[], text) from public, anon;
grant execute on function api_web_v1.community_post_create(text, text, text, uuid, text[], text) to authenticated, service_role;

create or replace function api_app_v1.community_post_create(
  p_title text, p_body text, p_category text,
  p_idempotency_key uuid,
  p_image_refs text[] default '{}', p_status text default 'published'
) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  RETURN core_private.community_post_create_impl(
           v_uid, p_title, p_body, p_category,
           coalesce(p_image_refs, '{}'::text[]), p_status, p_idempotency_key)
         || jsonb_build_object('contract_version', 1);
END $fn$;
revoke all on function api_app_v1.community_post_create(text, text, text, uuid, text[], text) from public, anon;
grant execute on function api_app_v1.community_post_create(text, text, text, uuid, text[], text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS + 정책(운영 실측)
-- -----------------------------------------------------------------------------
alter table public.community_posts       enable row level security;
alter table public.comments              enable row level security;
alter table public.community_comments    enable row level security;
alter table public.post_reactions        enable row level security;
alter table public.shortform_reactions   enable row level security;
alter table public.content_reports       enable row level security;
alter table public.user_blocks           enable row level security;
alter table public.custom_request_orders enable row level security;
alter table public.custom_order_deliverables    enable row level security;
alter table public.custom_order_messages        enable row level security;
alter table public.custom_request_posts         enable row level security;
alter table public.custom_request_applications  enable row level security;

-- community_posts — M16 적용 상태(SELECT 정책만·쓰기 정책 0)
drop policy if exists "cp_select_own" on public.community_posts;
create policy "cp_select_own" on public.community_posts
  for select to authenticated using (author_id = (select auth.uid()));
drop policy if exists "cp_select_published" on public.community_posts;
create policy "cp_select_published" on public.community_posts
  for select to anon, authenticated using (status = 'published' and deleted_at is null);

-- comments
drop policy if exists "comments_select_visible" on public.comments;
create policy "comments_select_visible" on public.comments
  for select to anon, authenticated using (is_deleted = false);
drop policy if exists "comments_insert_own" on public.comments;
create policy "comments_insert_own" on public.comments
  for insert to authenticated with check (author_id = (select auth.uid()));
drop policy if exists "comments_update_own" on public.comments;
create policy "comments_update_own" on public.comments
  for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
drop policy if exists "comments_delete_own" on public.comments;
create policy "comments_delete_own" on public.comments
  for delete to authenticated using (author_id = (select auth.uid()));
drop policy if exists "comments_admin_update" on public.comments;
create policy "comments_admin_update" on public.comments
  for update to authenticated
  using ((select public.is_admin()) = true) with check ((select public.is_admin()) = true);

-- community_comments
drop policy if exists "community_comments_select_visible" on public.community_comments;
create policy "community_comments_select_visible" on public.community_comments
  for select to anon, authenticated
  using (status = 'visible' or author_id = (select auth.uid()) or (select public.is_admin()) = true);
drop policy if exists "community_comments_insert_authenticated" on public.community_comments;
create policy "community_comments_insert_authenticated" on public.community_comments
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (select auth.uid()) is not null
    and char_length(btrim(body)) >= 1
    and char_length(btrim(body)) <= 1000
  );

-- post_reactions (한글명 중복 정책 2종 포함 — 운영 실측)
drop policy if exists "post_reactions_select_all" on public.post_reactions;
create policy "post_reactions_select_all" on public.post_reactions
  for select to anon, authenticated using (true);
drop policy if exists "post_reactions_insert_own" on public.post_reactions;
create policy "post_reactions_insert_own" on public.post_reactions
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "post_reactions_delete_own" on public.post_reactions;
create policy "post_reactions_delete_own" on public.post_reactions
  for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists "로그인 유저 반응 추가" on public.post_reactions;
create policy "로그인 유저 반응 추가" on public.post_reactions
  for insert to public with check (auth.uid() = user_id);
drop policy if exists "본인 반응 삭제" on public.post_reactions;
create policy "본인 반응 삭제" on public.post_reactions
  for delete to public using (auth.uid() = user_id);

-- shortform_reactions
drop policy if exists "shortform_reactions_select_own" on public.shortform_reactions;
create policy "shortform_reactions_select_own" on public.shortform_reactions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "shortform_reactions_insert_own" on public.shortform_reactions;
create policy "shortform_reactions_insert_own" on public.shortform_reactions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and type = any (array['like'::text, 'scrap'::text]));
drop policy if exists "shortform_reactions_delete_own" on public.shortform_reactions;
create policy "shortform_reactions_delete_own" on public.shortform_reactions
  for delete to authenticated using (user_id = (select auth.uid()));

-- content_reports
drop policy if exists "content_reports_select_reporter" on public.content_reports;
create policy "content_reports_select_reporter" on public.content_reports
  for select to authenticated using (reporter_id = (select auth.uid()));
drop policy if exists "content_reports_select_admin" on public.content_reports;
create policy "content_reports_select_admin" on public.content_reports
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
drop policy if exists "content_reports_insert_reporter" on public.content_reports;
create policy "content_reports_insert_reporter" on public.content_reports
  for insert to authenticated with check (reporter_id = (select auth.uid()));
drop policy if exists "content_reports_update_admin" on public.content_reports;
create policy "content_reports_update_admin" on public.content_reports
  for update to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- user_blocks (차단·차단해제 경로 — 과잉 차단 금지 대상)
drop policy if exists "user_blocks_select_own" on public.user_blocks;
create policy "user_blocks_select_own" on public.user_blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
drop policy if exists "user_blocks_insert_own" on public.user_blocks;
create policy "user_blocks_insert_own" on public.user_blocks
  for insert to authenticated with check (blocker_id = (select auth.uid()));
drop policy if exists "user_blocks_delete_own" on public.user_blocks;
create policy "user_blocks_delete_own" on public.user_blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

-- custom_* — 당사자·관리자 정책 + 제거 대상 공개 SELECT 4종
-- (cdel_select·cmsg_all_party 의 EXISTS 서브쿼리가 custom_request_orders 를 읽으므로
--  주문 테이블의 당사자 SELECT 정책도 함께 재현해야 한다 — 운영 003 원문 cro_select)
drop policy if exists "cro_select" on public.custom_request_orders;
create policy "cro_select" on public.custom_request_orders
  for select to authenticated using (
    student_id = (select auth.uid()) or mentor_id = (select auth.uid())
    or buyer_id = (select auth.uid()) or client_id = (select auth.uid())
    or user_id = (select auth.uid()) or author_id = (select auth.uid())
    or requester_id = (select auth.uid()) or (select public.is_admin()) = true);

drop policy if exists "cdel_select" on public.custom_order_deliverables;
create policy "cdel_select" on public.custom_order_deliverables
  for select to authenticated using (exists (
    select 1 from public.custom_request_orders o
     where o.id = custom_order_deliverables.custom_request_order_id
       and ((select public.is_admin()) = true
            or (select auth.uid()) in (o.student_id, o.mentor_id, o.buyer_id, o.client_id,
                                       o.user_id, o.author_id, o.requester_id))));
drop policy if exists "누구나 납품 읽기" on public.custom_order_deliverables;
create policy "누구나 납품 읽기" on public.custom_order_deliverables
  for select to public using (true);

drop policy if exists "cmsg_all_party" on public.custom_order_messages;
create policy "cmsg_all_party" on public.custom_order_messages
  for select to authenticated using (exists (
    select 1 from public.custom_request_orders o
     where o.id = custom_order_messages.custom_request_order_id
       and ((select public.is_admin()) = true
            or (select auth.uid()) in (o.student_id, o.mentor_id, o.buyer_id, o.client_id,
                                       o.user_id, o.author_id, o.requester_id))));
drop policy if exists "누구나 메시지 읽기" on public.custom_order_messages;
create policy "누구나 메시지 읽기" on public.custom_order_messages
  for select to public using (true);

drop policy if exists "crp_select" on public.custom_request_posts;
create policy "crp_select" on public.custom_request_posts
  for select to authenticated using (
    author_id = (select auth.uid()) or user_id = (select auth.uid())
    or student_id = (select auth.uid()) or requester_id = (select auth.uid())
    or client_id = (select auth.uid()) or (select public.is_admin()) = true);
drop policy if exists "누구나 의뢰 읽기" on public.custom_request_posts;
create policy "누구나 의뢰 읽기" on public.custom_request_posts
  for select to public using (true);

drop policy if exists "cra_select" on public.custom_request_applications;
create policy "cra_select" on public.custom_request_applications
  for select to authenticated using (
    mentor_id = (select auth.uid())
    or exists (select 1 from public.custom_request_posts p
                where p.id = custom_request_applications.post_id
                  and (p.author_id = (select auth.uid()) or p.user_id = (select auth.uid())))
    or (select public.is_admin()) = true);
drop policy if exists "누구나 지원서 읽기" on public.custom_request_applications;
create policy "누구나 지원서 읽기" on public.custom_request_applications
  for select to public using (true);

-- -----------------------------------------------------------------------------
-- 테이블 권한(운영 baseline — community_posts 만 M16 잠금)
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on
  public.comments, public.community_comments, public.post_reactions,
  public.shortform_reactions, public.content_reports, public.user_blocks
to authenticated;
grant select on
  public.comments, public.community_comments, public.post_reactions,
  public.custom_order_deliverables, public.custom_order_messages,
  public.custom_request_posts, public.custom_request_applications
to anon;
grant select on
  public.users, public.mentor_profiles, public.custom_request_orders,
  public.custom_order_deliverables, public.custom_order_messages,
  public.custom_request_posts, public.custom_request_applications
to authenticated;

revoke all on public.community_posts from anon, authenticated;
grant select on public.community_posts to anon, authenticated;
