-- =============================================================================
-- full_convergence_supplement_fixture.sql — 수렴 M1~M3 로컬 왕복 검증용 보강 fixture
-- =============================================================================
-- s3_c_build13_contract_baseline_fixture.sql + Build13 forward + 드리프트 2건
-- (iq_append_message_v1 · iq_attachment_author_v1) 적용 후에 실행한다.
-- 스테이징(lbeqxarxothkmzqvpudy) 2026-08-03 실측 상태 중 수렴 M1~M3 이 만지는
-- 객체를 재현한다. 오프라인 스크래치 Postgres 전용.
-- =============================================================================

-- auth.role() 스텁 — set local request.jwt.claim.role 로 전환
create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
grant execute on function auth.role() to anon, authenticated, service_role;

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

create or replace function public.is_mentor() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users u where u.id = (select auth.uid()) and u.role = 'mentor')
$$;
grant execute on function public.is_mentor() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- users — 스테이징 컬럼 형상으로 보강 + 결함 상태 권한/정책 재현
-- -----------------------------------------------------------------------------
alter table public.users
  add column if not exists grade_level text,
  add column if not exists student_status text,
  add column if not exists birth_date date,
  add column if not exists terms_agreed_at timestamptz,
  add column if not exists privacy_agreed_at timestamptz,
  add column if not exists marketing_agreed boolean not null default false,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists notification_enabled boolean not null default true,
  add column if not exists status_reason text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid;

grant insert, update, delete, truncate, references, trigger, select on table public.users to anon, authenticated;

drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
drop policy if exists users_insert_own on public.users;
create policy users_insert_own on public.users
  for insert to authenticated with check (id = (select auth.uid()));

drop trigger if exists trg_users_set_updated on public.users;
create trigger trg_users_set_updated before update on public.users
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- user_consent_records
-- -----------------------------------------------------------------------------
create table if not exists public.user_consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  consent_type text not null constraint user_consent_records_consent_type_check
    check (consent_type = any (array['terms','privacy','marketing','minor_guardian_consent'])),
  consent_actor text not null constraint user_consent_records_consent_actor_check
    check (consent_actor = any (array['user','guardian'])),
  is_minor boolean,
  guardian_consent boolean,
  consent_version text,
  guardian_ref text,
  agreed_at timestamptz,
  source text,
  metadata jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
alter table public.user_consent_records enable row level security;
grant select on table public.user_consent_records to authenticated;
drop policy if exists ucr_select_own on public.user_consent_records;
create policy ucr_select_own on public.user_consent_records
  for select to authenticated using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- reviews + 수정 강제 트리거 (실측 본문)
-- -----------------------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null,
  author_id uuid not null,
  rating smallint not null,
  body text,
  created_at timestamptz not null default now(),
  is_hidden boolean,
  is_blinded boolean,
  moderation_state text,
  moderated_at timestamptz,
  moderated_by uuid,
  subscription_count integer,
  mentor_reply text,
  mentor_replied_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
grant insert, update, delete, truncate, references, trigger, select on table public.reviews to anon, authenticated;

drop policy if exists reviews_select_public_visible on public.reviews;
create policy reviews_select_public_visible on public.reviews
  for select to anon, authenticated
  using ((coalesce(is_hidden, false) = false) and (coalesce(is_blinded, false) = false));
drop policy if exists reviews_select_author on public.reviews;
create policy reviews_select_author on public.reviews
  for select to authenticated using (author_id = (select auth.uid()));
drop policy if exists reviews_update_author on public.reviews;
create policy reviews_update_author on public.reviews
  for update to authenticated
  using (((select auth.uid()) = author_id) and (coalesce(is_hidden,false) = false) and (coalesce(is_blinded,false) = false))
  with check ((select auth.uid()) = author_id);

create or replace function public.reviews_enforce_update() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean := coalesce((select public.is_admin()), false);
  v_is_author boolean;
begin
  if coalesce(auth.role(), '') = 'service_role' then return new; end if;
  v_is_author := (not v_is_admin) and v_uid is not null and v_uid = old.author_id;
  if new.id is distinct from old.id or new.mentor_id is distinct from old.mentor_id
     or new.author_id is distinct from old.author_id
     or new.subscription_count is distinct from old.subscription_count
     or new.created_at is distinct from old.created_at then
    raise exception 'reviews: protected columns are immutable';
  end if;
  if not v_is_author then
    if new.rating is distinct from old.rating or new.body is distinct from old.body then
      raise exception 'reviews: protected columns are immutable';
    end if;
  end if;
  if v_is_admin then
    new.moderated_at := now(); new.moderated_by := v_uid; new.updated_at := old.updated_at;
    return new;
  end if;
  if v_is_author then
    if coalesce(old.is_hidden, false) or coalesce(old.is_blinded, false) then
      raise exception 'reviews: moderated review is not editable by author';
    end if;
    if new.is_hidden is distinct from old.is_hidden or new.is_blinded is distinct from old.is_blinded
       or new.moderation_state is distinct from old.moderation_state
       or new.moderated_at is distinct from old.moderated_at
       or new.moderated_by is distinct from old.moderated_by
       or new.mentor_reply is distinct from old.mentor_reply
       or new.mentor_replied_at is distinct from old.mentor_replied_at then
      raise exception 'reviews: author must not change moderation or mentor reply fields';
    end if;
    new.updated_at := now();
    return new;
  end if;
  if v_uid is not null and v_uid = old.mentor_id then
    return new;
  end if;
  raise exception 'reviews: not permitted to update this review';
end
$fn$;
drop trigger if exists trg_reviews_enforce_update on public.reviews;
create trigger trg_reviews_enforce_update before update on public.reviews
  for each row execute function public.reviews_enforce_update();

create or replace function public.get_mentor_review_stats(p_mentor_id uuid, p_include_hidden boolean default false)
returns table(review_count integer, avg_rating numeric, d1 integer, d2 integer, d3 integer, d4 integer, d5 integer)
language plpgsql stable security definer set search_path to 'public' as $fn$
declare v_include_hidden boolean := coalesce(p_include_hidden, false);
begin
  if v_include_hidden and not coalesce(public.is_admin(), false) then v_include_hidden := false; end if;
  return query
  select count(*)::integer,
    case when count(*) > 0 then round(avg(r.rating)::numeric, 1) else null end,
    count(*) filter (where round(r.rating)=1)::integer, count(*) filter (where round(r.rating)=2)::integer,
    count(*) filter (where round(r.rating)=3)::integer, count(*) filter (where round(r.rating)=4)::integer,
    count(*) filter (where round(r.rating)=5)::integer
  from public.reviews r
  where r.mentor_id = p_mentor_id
    and (v_include_hidden or (coalesce(r.is_hidden,false)=false and coalesce(r.is_blinded,false)=false));
end;
$fn$;
grant execute on function public.get_mentor_review_stats(uuid, boolean) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 멘토 찾기 — 학교 인증 + 원본 뷰 + legacy RPC (스텁: 실측 identity·grant 재현)
-- -----------------------------------------------------------------------------
create table if not exists public.mentor_school_verifications (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null,
  status text,
  school_tier text,
  verified_major_category text,
  verified_university_name text,
  verified_department_name text,
  reviewed_at timestamptz,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.mentor_profiles
  add column if not exists university_name text,
  add column if not exists department_name text,
  add column if not exists teaching_subjects text[],
  add column if not exists intro_line text,
  add column if not exists profile_image_url text,
  add column if not exists high_school_name text,
  add column if not exists is_open_for_subscriptions boolean,
  add column if not exists created_at timestamptz not null default now();

create or replace view api_web_v1.mentor_directory_v1 as
 SELECT mp.user_id AS mentor_id, u.nickname, mp.university_name, mp.department_name,
    mp.teaching_subjects, mp.intro_line, mp.profile_image_url, mp.high_school_name,
    sv.mentor_id IS NOT NULL AS school_verified, sv.school_tier, sv.verified_major_category,
    sv.verified_university_name, sv.verified_department_name, mp.is_open_for_subscriptions,
    rv.avg_rating, rv.review_count, mp.created_at
   FROM mentor_profiles mp
     JOIN users u ON u.id = mp.user_id
     LEFT JOIN LATERAL ( SELECT msv.mentor_id, msv.school_tier, msv.verified_major_category,
            msv.verified_university_name, msv.verified_department_name
           FROM mentor_school_verifications msv
          WHERE msv.mentor_id = mp.user_id AND msv.status = 'approved'::text
          ORDER BY (COALESCE(msv.reviewed_at, msv.updated_at, msv.created_at)) DESC, msv.created_at DESC
         LIMIT 1) sv ON true
     LEFT JOIN LATERAL ( SELECT avg(r.rating) AS avg_rating, count(*)::integer AS review_count
           FROM reviews r
          WHERE r.mentor_id = mp.user_id AND COALESCE(r.is_hidden, false) = false AND COALESCE(r.is_blinded, false) = false) rv ON true
  WHERE u.role = 'mentor'::text AND lower(COALESCE(u.status, 'active'::text)) = 'active'::text
    AND (lower(COALESCE(mp.verification_status, ''::text)) = ANY (ARRAY['approved'::text, 'verified'::text, 'active'::text]));
alter view api_web_v1.mentor_directory_v1 set (security_invoker = false);
grant usage on schema api_web_v1 to anon, authenticated, service_role;
grant usage on schema api_app_v1 to authenticated;
grant select on api_web_v1.mentor_directory_v1 to anon, authenticated;

create or replace function public.mentor_directory_list_v2(p_limit integer default 80)
returns table(id uuid, full_name text, nickname text, status text, created_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select u.id, u.full_name, u.nickname, u.status, coalesce(mp.created_at, now())
  from public.users u join public.mentor_profiles mp on mp.user_id = u.id
  where u.role = 'mentor'
  limit least(coalesce(p_limit, 80), 200)
$$;
grant execute on function public.mentor_directory_list_v2(integer) to anon, authenticated;

create or replace function public.mentor_profiles_for_directory_v2(p_ids uuid[])
returns setof public.mentor_profiles
language sql stable security definer set search_path to 'public' as $$
  select * from public.mentor_profiles where user_id = any (p_ids)
$$;
grant execute on function public.mentor_profiles_for_directory_v2(uuid[]) to anon, authenticated;

create or replace function public.mentor_user_public_v2(p_mentor_id uuid)
returns table(id uuid, full_name text, nickname text)
language sql stable security definer set search_path to 'public' as $$
  select u.id, u.full_name, u.nickname from public.users u where u.id = p_mentor_id and u.role = 'mentor'
$$;
grant execute on function public.mentor_user_public_v2(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 숏폼 — 테이블·정책·legacy 증가 RPC (실측 재현)
-- -----------------------------------------------------------------------------
create table if not exists public.shortform_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid,
  title text,
  body text,
  category text,
  source text,
  created_at timestamptz not null default now(),
  author_role text,
  creator_id uuid,
  video_url text,
  thumbnail_url text,
  description text,
  tags text[],
  status text not null default 'published',
  view_count integer not null default 0,
  like_count integer not null default 0,
  updated_at timestamptz not null default now(),
  author_label text,
  create_idempotency_key uuid
);
alter table public.shortform_posts enable row level security;
grant insert, update, delete, truncate, references, trigger, select on table public.shortform_posts to anon, authenticated;

drop policy if exists sf_select_published on public.shortform_posts;
create policy sf_select_published on public.shortform_posts
  for select to anon, authenticated
  using ((status = 'published') or (author_id = (select auth.uid())) or (creator_id = (select auth.uid())) or (select public.is_admin()));
drop policy if exists sf_insert_mentor on public.shortform_posts;
create policy sf_insert_mentor on public.shortform_posts
  for insert to authenticated
  with check (((select public.is_mentor()) = true) and ((author_id = (select auth.uid())) or (creator_id = (select auth.uid()))));
drop policy if exists sf_update_own on public.shortform_posts;
create policy sf_update_own on public.shortform_posts
  for update to authenticated
  using ((author_id = (select auth.uid())) or (creator_id = (select auth.uid())))
  with check ((author_id = (select auth.uid())) or (creator_id = (select auth.uid())));
drop policy if exists sp_update_self on public.shortform_posts;
create policy sp_update_self on public.shortform_posts
  for update to authenticated
  using ((author_id = (select auth.uid())) or ((select public.is_admin()) = true));
drop policy if exists sf_delete_own on public.shortform_posts;
create policy sf_delete_own on public.shortform_posts
  for delete to authenticated
  using ((author_id = (select auth.uid())) or (creator_id = (select auth.uid())));

create or replace function public.increment_shortform_post_view(p_post_id uuid)
returns void language sql security definer set search_path to 'public' as $$
  update public.shortform_posts set view_count = view_count + 1
  where id = p_post_id and status = 'published';
$$;
grant execute on function public.increment_shortform_post_view(uuid) to public;

-- community_comments — 스테이징 형상 보강 (post_type/updated_at/canonical_comment_id)
alter table public.community_comments
  add column if not exists post_type text not null default 'board',
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists canonical_comment_id uuid;

-- community_comments status CHECK (실측: visible/hidden)
alter table public.community_comments drop constraint if exists community_comments_status_check;
alter table public.community_comments
  add constraint community_comments_status_check
  check (status = any (array['visible'::text, 'hidden'::text]));

create or replace function public.community_comments_set_author_label() returns trigger
language plpgsql security definer set search_path to 'public' as $fn$
declare v_nickname text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'CC_PROTECTED_FIELDS_IMMUTABLE';
  end if;
  select u.nickname into v_nickname from public.users u where u.id = new.author_id;
  if found then
    new.author_label := coalesce(nullif(btrim(v_nickname), ''), '쌤버십 사용자');
  else
    new.author_label := '쌤버십 사용자';
  end if;
  return new;
end $fn$;
drop trigger if exists trg_community_comments_set_author_label_ins on public.community_comments;
create trigger trg_community_comments_set_author_label_ins
  before insert on public.community_comments
  for each row when (new.post_type = 'board'::text)
  execute function public.community_comments_set_author_label();

-- -----------------------------------------------------------------------------
-- 개별질문 — 테이블·정책·party·answer 원본 (드리프트 2건은 별도 파일로 적용)
-- -----------------------------------------------------------------------------
create table if not exists public.individual_questions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  question_type text,
  designated_mentor_id uuid,
  claimed_mentor_id uuid,
  claimed_at timestamptz,
  subject text, topic text, title text, body text,
  price_cents integer,
  status text not null default 'escrowed',
  expires_at timestamptz,
  answered_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  hold_ledger_id uuid, release_ledger_id uuid, refund_ledger_id uuid,
  create_idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  required_school_tier text,
  required_major_category text
);
create table if not exists public.individual_question_messages (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.individual_questions(id) on delete cascade,
  author_id uuid,
  body text,
  created_at timestamptz not null default now()
);
create table if not exists public.individual_question_attachments (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.individual_questions(id) on delete cascade,
  message_id uuid,
  storage_path text not null,
  file_name text,
  mime_type text,
  created_at timestamptz not null default now(),
  unique (question_id, storage_path)
);
alter table public.individual_questions enable row level security;
alter table public.individual_question_messages enable row level security;
alter table public.individual_question_attachments enable row level security;
grant insert, update, delete, truncate, references, trigger, select on table
  public.individual_questions, public.individual_question_messages, public.individual_question_attachments
to anon, authenticated;

create or replace function public.user_is_individual_question_party(p_question_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.individual_questions q
    where q.id = p_question_id
      and ((select auth.uid()) = q.student_id
           or (select auth.uid()) = coalesce(q.claimed_mentor_id, q.designated_mentor_id))
  )
$$;
grant execute on function public.user_is_individual_question_party(uuid) to authenticated;

drop policy if exists iq_select_party on public.individual_questions;
create policy iq_select_party on public.individual_questions
  for select to authenticated using (public.user_is_individual_question_party(id));
drop policy if exists iqm_select_party on public.individual_question_messages;
create policy iqm_select_party on public.individual_question_messages
  for select to authenticated using (public.user_is_individual_question_party(question_id));
drop policy if exists iqa_select_party on public.individual_question_attachments;
create policy iqa_select_party on public.individual_question_attachments
  for select to authenticated using (public.user_is_individual_question_party(question_id));

create or replace function public.answer_individual_question(p_question_id uuid, p_body text)
returns setof public.individual_questions
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_question public.individual_questions%rowtype;
  v_mentor_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'INVALID_INPUT: body is required' using errcode = '22023';
  end if;
  select * into v_question from public.individual_questions where id = p_question_id for update;
  if not found then
    raise exception 'QUESTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_mentor_id := coalesce(v_question.claimed_mentor_id, v_question.designated_mentor_id);
  if v_mentor_id is null or v_mentor_id <> v_uid then
    raise exception 'NOT_QUESTION_MENTOR' using errcode = '42501';
  end if;
  if v_question.status not in ('claimed', 'assigned') then
    raise exception 'NOT_ANSWERABLE_STATUS:%', v_question.status using errcode = 'P0001';
  end if;
  insert into public.individual_question_messages (question_id, author_id, body)
  values (p_question_id, v_uid, p_body);
  update public.individual_questions
  set status = 'answered', answered_at = coalesce(answered_at, now())
  where id = p_question_id
  returning * into v_question;
  return next v_question;
end;
$function$;
grant execute on function public.answer_individual_question(uuid, text) to authenticated;

-- storage.buckets (실측: IQA 버킷 20MB + MIME allowlist)
create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('individual-question-attachments', 'individual-question-attachments', false, 20971520,
        array['image/png','image/jpeg','image/webp','image/gif','application/pdf','application/zip',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/json'])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- favorites — 영·한 중복 정책 재현
-- -----------------------------------------------------------------------------
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  mentor_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, mentor_id)
);
alter table public.favorites enable row level security;
grant insert, update, delete, truncate, references, trigger, select on table public.favorites to anon, authenticated;
drop policy if exists favorites_select_own on public.favorites;
create policy favorites_select_own on public.favorites for select using (auth.uid() = user_id);
drop policy if exists favorites_insert_own on public.favorites;
create policy favorites_insert_own on public.favorites for insert with check (auth.uid() = user_id);
drop policy if exists favorites_delete_own on public.favorites;
create policy favorites_delete_own on public.favorites for delete using (auth.uid() = user_id);
drop policy if exists "본인 찜만 조회" on public.favorites;
create policy "본인 찜만 조회" on public.favorites for select using (auth.uid() = user_id);
drop policy if exists "본인만 찜 삭제" on public.favorites;
create policy "본인만 찜 삭제" on public.favorites for delete using (auth.uid() = user_id);
drop policy if exists "본인만 찜 추가" on public.favorites;
create policy "본인만 찜 추가" on public.favorites for insert with check (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 금융 테이블 (M2 S7 ACL 대상 — 스테이징 광역 grant 재현)
-- -----------------------------------------------------------------------------
create table if not exists public.cash_wallets (user_id uuid primary key, balance_cents bigint not null default 0);
create table if not exists public.cash_ledger (id uuid primary key default gen_random_uuid(), user_id uuid, delta_cents bigint, reason text, created_at timestamptz default now());
create table if not exists public.cash_topup_packages (id uuid primary key default gen_random_uuid(), label text, amount_cents bigint);
create table if not exists public.subscription_billing_events (id uuid primary key default gen_random_uuid(), subscription_id uuid, event_type text, created_at timestamptz default now());
create table if not exists public.order_payments (id uuid primary key default gen_random_uuid(), order_id uuid, status text, created_at timestamptz default now());
create table if not exists public.payments (id uuid primary key default gen_random_uuid(), user_id uuid, student_id uuid, payer_id uuid, mentor_id uuid, status text, created_at timestamptz default now());
create table if not exists public.withdrawals (id uuid primary key default gen_random_uuid(), mentor_id uuid, status text, created_at timestamptz default now());
create table if not exists public.user_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  issued_by uuid,
  reason text,
  severity text,
  source text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.cash_wallets enable row level security;
alter table public.cash_ledger enable row level security;
alter table public.cash_topup_packages enable row level security;
alter table public.subscription_billing_events enable row level security;
alter table public.order_payments enable row level security;
alter table public.payments enable row level security;
alter table public.withdrawals enable row level security;
alter table public.user_warnings enable row level security;
grant insert, update, delete, truncate, references, trigger, select on table
  public.cash_wallets, public.cash_ledger, public.cash_topup_packages,
  public.subscription_billing_events, public.order_payments, public.payments,
  public.withdrawals, public.user_warnings
to anon, authenticated;
grant insert, update, delete, truncate, references, trigger, select on table
  public.subscriptions, public.refunds to anon, authenticated;

drop policy if exists payments_insert_intent on public.payments;
create policy payments_insert_intent on public.payments
  for insert to authenticated
  with check (((select auth.uid()) = user_id) and (status = any (array['pending','processing'])));
drop policy if exists withdrawals_insert_self_requested on public.withdrawals;
create policy withdrawals_insert_self_requested on public.withdrawals
  for insert to authenticated
  with check (((select auth.uid()) = mentor_id) and (status = 'requested'));
drop policy if exists refund_ins on public.refunds;
create policy refund_ins on public.refunds for insert to authenticated with check (true);

-- -----------------------------------------------------------------------------
-- 알림 — 스테이징 컬럼 형상·정책·CHECK·정본 기록 함수 재현
-- -----------------------------------------------------------------------------
alter table public.notifications
  add column if not exists type text,
  add column if not exists body text,
  add column if not exists is_read boolean not null default false,
  add column if not exists read boolean,
  add column if not exists acknowledged boolean,
  add column if not exists read_at timestamptz,
  add column if not exists read_at_utc timestamptz,
  add column if not exists seen_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists viewed_at timestamptz,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists metadata jsonb,
  add column if not exists data jsonb,
  add column if not exists recipient_id uuid,
  add column if not exists student_id uuid,
  add column if not exists mentor_id uuid,
  add column if not exists target_user_id uuid,
  add column if not exists owner_id uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists recipient_user_id uuid,
  add column if not exists event_key text;

-- 스텁 트리거가 넣는 행도 정본 계약을 지키도록 kind → type 동기화
update public.notifications set type = coalesce(type, kind);

alter table public.notifications enable row level security;
grant insert, update, delete, truncate, references, trigger, select on table public.notifications to anon, authenticated;

create unique index if not exists notifications_recipient_event_key_uidx
  on public.notifications (recipient_user_id, event_key)
  where recipient_user_id is not null and event_key is not null;

alter table public.notifications drop constraint if exists notifications_at_least_one_recipient;
alter table public.notifications
  add constraint notifications_at_least_one_recipient
  check ((user_id is not null) or (recipient_id is not null) or (student_id is not null)
         or (mentor_id is not null) or (target_user_id is not null) or (owner_id is not null));

drop policy if exists notif_select_recipient on public.notifications;
create policy notif_select_recipient on public.notifications
  for select to authenticated
  using (
    ((user_id is not null) and ((select auth.uid()) = user_id))
    or ((recipient_id is not null) and ((select auth.uid()) = recipient_id))
    or ((student_id is not null) and ((select auth.uid()) = student_id))
    or ((mentor_id is not null) and ((select auth.uid()) = mentor_id))
    or ((target_user_id is not null) and ((select auth.uid()) = target_user_id))
    or ((owner_id is not null) and ((select auth.uid()) = owner_id))
  );
drop policy if exists notif_update_recipient_read on public.notifications;
create policy notif_update_recipient_read on public.notifications
  for update to authenticated
  using (
    ((user_id is not null) and ((select auth.uid()) = user_id))
    or ((recipient_id is not null) and ((select auth.uid()) = recipient_id))
    or ((student_id is not null) and ((select auth.uid()) = student_id))
    or ((mentor_id is not null) and ((select auth.uid()) = mentor_id))
    or ((target_user_id is not null) and ((select auth.uid()) = target_user_id))
    or ((owner_id is not null) and ((select auth.uid()) = owner_id))
  )
  with check (
    ((user_id is not null) and ((select auth.uid()) = user_id))
    or ((recipient_id is not null) and ((select auth.uid()) = recipient_id))
    or ((student_id is not null) and ((select auth.uid()) = student_id))
    or ((mentor_id is not null) and ((select auth.uid()) = mentor_id))
    or ((target_user_id is not null) and ((select auth.uid()) = target_user_id))
    or ((owner_id is not null) and ((select auth.uid()) = owner_id))
  );

drop trigger if exists trg_notif_set_updated on public.notifications;
create trigger trg_notif_set_updated before update on public.notifications
  for each row execute function public.set_updated_at();

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null,
  notification_id uuid,
  event_key text not null,
  dedup_key text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    constraint notification_outbox_status_chk
    check (status = any (array['pending','leased','sent','failed','dead'])),
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  lease_owner text,
  leased_until timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipient_user_id, dedup_key)
);
alter table public.notification_outbox enable row level security;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null,
  device_token_id uuid not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.notification_deliveries enable row level security;

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  token text not null,
  platform text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.device_tokens enable row level security;

create or replace function public.record_domain_notification(
  p_recipient_user_id uuid, p_event_key text, p_dedup_key text, p_event_type text,
  p_title text, p_body text, p_link text default null, p_metadata jsonb default '{}'::jsonb, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v_notif_id uuid; v_outbox_id uuid; v_notif_created boolean := false; v_outbox_created boolean := false;
begin
  if p_recipient_user_id is null then raise exception 'RECIPIENT_REQUIRED'; end if;
  if p_event_key is null or p_dedup_key is null or p_event_type is null then raise exception 'EVENT_KEYS_REQUIRED'; end if;
  insert into public.notifications (recipient_user_id, user_id, event_key, type, body, metadata, data, is_read)
  values (p_recipient_user_id, p_recipient_user_id, p_event_key, p_event_type, p_body,
     coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('event_key', p_event_key, 'link', p_link),
     jsonb_build_object('title', p_title, 'link', p_link), false)
  on conflict (recipient_user_id, event_key) where recipient_user_id is not null and event_key is not null
  do nothing returning id into v_notif_id;
  v_notif_created := v_notif_id is not null;
  if v_notif_id is null then
    select id into v_notif_id from public.notifications where recipient_user_id = p_recipient_user_id and event_key = p_event_key limit 1;
  end if;
  insert into public.notification_outbox (recipient_user_id, notification_id, event_key, dedup_key, event_type, payload)
  values (p_recipient_user_id, v_notif_id, p_event_key, p_dedup_key, p_event_type,
     coalesce(p_payload,'{}'::jsonb) || jsonb_build_object('event_key', p_event_key, 'notification_id', v_notif_id))
  on conflict (recipient_user_id, dedup_key) do nothing returning id into v_outbox_id;
  v_outbox_created := v_outbox_id is not null;
  if v_outbox_id is null then
    select id into v_outbox_id from public.notification_outbox where recipient_user_id = p_recipient_user_id and dedup_key = p_dedup_key limit 1;
  end if;
  return jsonb_build_object('ok',true,'notification_id',v_notif_id,'outbox_id',v_outbox_id,
    'notification_created',v_notif_created,'outbox_created',v_outbox_created);
end;
$fn$;

create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path = '' as $fn$
declare v_uid uuid := (select auth.uid()); v_count int;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  update public.notifications
  set is_read = true, read_at = coalesce(read_at, now()), updated_at = now()
  where is_read is distinct from true
    and (user_id = v_uid or recipient_id = v_uid or student_id = v_uid or mentor_id = v_uid
         or target_user_id = v_uid or owner_id = v_uid or recipient_user_id = v_uid);
  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$fn$;
grant execute on function public.mark_all_notifications_read() to authenticated;

create or replace function public.register_device_token(p_token text, p_platform text)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  insert into public.device_tokens (user_id, token, platform) values (v_uid, p_token, p_platform)
  returning id into v_id;
  return v_id;
end;
$fn$;
grant execute on function public.register_device_token(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 계정 삭제 self RPC 체인 스텁 (실측 identity·grant 재현 — 행위는 검증에 필요한 최소)
-- -----------------------------------------------------------------------------
create or replace function public.account_deletion_request_consented(
  p_user_id uuid, p_cancelable_minutes integer, p_dry_run boolean,
  p_forfeit_consent boolean, p_acknowledged_balance_cents bigint)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_job uuid;
begin
  if coalesce(p_dry_run, false) then
    return jsonb_build_object('ok', true, 'dry_run', true, 'cancelable_minutes', p_cancelable_minutes);
  end if;
  select id into v_job from public.account_deletion_jobs
   where user_id = p_user_id and state in ('pending','locked','purging','storage_purged','finalized','auth_soft_deleted');
  if v_job is null then
    insert into public.account_deletion_jobs (user_id, state) values (p_user_id, 'pending') returning id into v_job;
  end if;
  return jsonb_build_object('ok', true, 'dry_run', false, 'job_id', v_job,
                            'cancelable_minutes', p_cancelable_minutes,
                            'forfeit_consent', coalesce(p_forfeit_consent,false),
                            'acknowledged_balance_cents', p_acknowledged_balance_cents);
end $fn$;

create or replace function public.account_deletion_self_response(p_user_id uuid, p_raw jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select p_raw
$$;

create or replace function public.account_deletion_request_self(p_cancelable_minutes integer, p_dry_run boolean)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_uid uuid := (select auth.uid()); v_raw jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account_deletion_self:' || v_uid::text, 0));
  v_raw := public.account_deletion_request_consented(
    v_uid, greatest(0, coalesce(p_cancelable_minutes, 30)), coalesce(p_dry_run, false), false, null);
  return public.account_deletion_self_response(v_uid, v_raw);
end $fn$;
revoke execute on function public.account_deletion_request_self(integer, boolean) from public, anon;
grant execute on function public.account_deletion_request_self(integer, boolean) to authenticated;

create or replace function public.account_deletion_request_self_consented(
  p_cancelable_minutes integer, p_dry_run boolean, p_acknowledged_balance_cents bigint)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_uid uuid := (select auth.uid()); v_raw jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account_deletion_self:' || v_uid::text, 0));
  v_raw := public.account_deletion_request_consented(
    v_uid, greatest(0, coalesce(p_cancelable_minutes, 30)), coalesce(p_dry_run, false),
    true, p_acknowledged_balance_cents);
  return public.account_deletion_self_response(v_uid, v_raw);
end $fn$;
revoke execute on function public.account_deletion_request_self_consented(integer, boolean, bigint) from public, anon;
grant execute on function public.account_deletion_request_self_consented(integer, boolean, bigint) to authenticated;

-- Realtime publication (실측: 질문방 3테이블)
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime for table
      public.question_threads, public.question_messages, public.question_attachments;
  end if;
end $$;

-- =============================================================================
-- 시드 — 검증 시나리오용 격리 데이터 (스테이징 실데이터 아님)
-- =============================================================================
insert into public.users (id, role, status, nickname, full_name, email, grade_level, marketing_agreed) values
  ('11111111-1111-1111-1111-111111111111','student','active','학생일','김학생','s1@test.local','고2', false),
  ('22222222-2222-2222-2222-222222222222','student','active','학생이','이학생','s2@test.local',null, false),
  ('33333333-3333-3333-3333-333333333333','mentor','active','멘토일','박멘토','m1@test.local',null, false),
  ('44444444-4444-4444-4444-444444444444','mentor','active',null,'최멘토','m2@test.local',null, false),
  ('55555555-5555-5555-5555-555555555555','mentor','suspended','정지멘토','정지멘토','m3@test.local',null, false),
  ('66666666-6666-6666-6666-666666666666','student','banned','밴학생','밴학생','b1@test.local',null, false),
  ('77777777-7777-7777-7777-777777777777','admin','active','운영자','운영자','a1@test.local',null, false),
  ('88888888-8888-8888-8888-888888888888','mentor','active','삭제중멘토','삭제중멘토','d1@test.local',null, false)
on conflict (id) do nothing;
update public.users set suspended_until = now() + interval '3 days'
 where id = '55555555-5555-5555-5555-555555555555';

insert into public.mentor_profiles (user_id, verification_status, university_name, department_name, teaching_subjects, intro_line, is_open_for_subscriptions) values
  ('33333333-3333-3333-3333-333333333333','approved','한국대','수학과',array['수학'],'안녕하세요', true),
  ('44444444-4444-4444-4444-444444444444','pending','서울대','물리학과',array['물리'],'대기 중', true),
  ('55555555-5555-5555-5555-555555555555','approved','부산대','화학과',array['화학'],'정지 상태', true),
  ('88888888-8888-8888-8888-888888888888','approved','대구대','국어과',array['국어'],'삭제 진행', true)
on conflict (user_id) do nothing;

insert into public.account_deletion_jobs (user_id, state) values
  ('88888888-8888-8888-8888-888888888888', 'pending');

-- moderation_state NULL 리뷰 1행 — M2 백필 경로 검증용
insert into public.reviews (id, mentor_id, author_id, rating, body, is_hidden, is_blinded, moderation_state) values
  ('aaaa1111-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111',5,'좋아요',false,false,null);

insert into public.shortform_posts (id, author_id, creator_id, title, status, view_count, like_count, author_role, author_label, category) values
  ('bbbb1111-0000-0000-0000-000000000001','33333333-3333-3333-3333-333333333333','33333333-3333-3333-3333-333333333333','숏폼1','published',10,2,'mentor','멘토일','study');

insert into public.community_comments (id, post_type, post_id, author_id, author_label, body, status) values
  ('cccc1111-0000-0000-0000-000000000001','shortform','bbbb1111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','클라조작라벨','숏폼 댓글','visible');

insert into public.individual_questions (id, student_id, claimed_mentor_id, status, title, body, price_cents, question_type) values
  ('dddd1111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','claimed','질문1','본문',5000,'open'),
  ('dddd1111-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','66666666-6666-6666-6666-666666666666','claimed','질문2','본문',5000,'open');

insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('individual-question-attachments','dddd1111-0000-0000-0000-000000000001/file-a.png','33333333-3333-3333-3333-333333333333','{"size": 1024, "mimetype": "image/png"}'::jsonb),
  ('individual-question-attachments','dddd1111-0000-0000-0000-000000000001/file-b.png','22222222-2222-2222-2222-222222222222','{"size": 1024, "mimetype": "image/png"}'::jsonb);

-- 알림·outbox 시드 — M3 backfill·suppress 검증용
insert into public.notifications (id, user_id, recipient_user_id, type, body, is_read, read, read_at, read_at_utc, event_key) values
  ('eeee1111-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','question_answered','읽지 않음',false,null,null,null,'evt-1'),
  ('eeee1111-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','question_answered','legacy read 만 true',false,true,null,'2026-08-01T00:00:00Z','evt-2'),
  ('eeee1111-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','individual_question_message','읽음-시각없음',true,null,null,null,'evt-3'),
  ('eeee1111-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','new_order_message','앱 제외 타입',false,null,null,null,'evt-4'),
  ('eeee1111-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','question_answered','다른 사용자',false,null,null,null,'evt-5');

insert into public.notification_outbox (recipient_user_id, event_key, dedup_key, event_type) values
  ('11111111-1111-1111-1111-111111111111','evt-1','dk-1','question_answered'),
  ('11111111-1111-1111-1111-111111111111','evt-2','dk-2','question_answered'),
  ('22222222-2222-2222-2222-222222222222','evt-5','dk-5','question_answered');
