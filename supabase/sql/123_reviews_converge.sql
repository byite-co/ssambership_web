-- --------------------------------------------------------------------------
-- 123_reviews_converge.sql   (P0-2 · 리뷰 스키마/데이터 수렴 — 멱등, 단일 트랜잭션)
-- 목적: 하이브리드(042형 student_id/content NOT NULL + 004형 author_id/body) 상태를
--   정본(author_id/body, subscription_count nullable, unique(mentor_id,author_id))으로 수렴.
--   현재 웹 write(author_id/body만 INSERT)가 레거시 NOT NULL(student_id/content) 위반으로
--   실패하는 결함을 해소한다.
-- 선행: 004(reviews base)·042(reviews). 정책 수렴은 126_reviews_rls_hardening.sql에서 별도.
-- 정본 컬럼: id, mentor_id, author_id, rating, body(NOT NULL),
--   subscription_count(nullable), mentor_reply, mentor_replied_at,
--   is_hidden, is_blinded, moderation_state, moderated_at, moderated_by, created_at.
-- 주의: 격리/중복 정리는 반드시 SET NOT NULL/UNIQUE 앞. 전 과정 단일 트랜잭션+테이블 잠금.
--   (staging 실적용 시 reviews 0행이라 데이터 단계는 no-op이나, 실데이터 환경 대비 멱등 유지.)
-- --------------------------------------------------------------------------

begin;

lock table public.reviews in share row exclusive mode;

-- (2-1) 컬럼 조건부 정합 (042형/004형 모두 대응) --------------------------------
alter table public.reviews add column if not exists author_id uuid;
alter table public.reviews add column if not exists body text;
alter table public.reviews add column if not exists subscription_count integer;
alter table public.reviews add column if not exists mentor_reply text;
alter table public.reviews add column if not exists mentor_replied_at timestamptz;
alter table public.reviews add column if not exists is_hidden boolean not null default false;
alter table public.reviews add column if not exists is_blinded boolean not null default false;
alter table public.reviews add column if not exists moderation_state text not null default 'visible';
alter table public.reviews add column if not exists moderated_at timestamptz;
alter table public.reviews add column if not exists moderated_by uuid;

-- (2-2) 백필 (042형 잔존 컬럼이 있으면 author_id<-student_id, body<-content) --------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='reviews' and column_name='student_id') then
    update public.reviews set author_id = student_id where author_id is null;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='reviews' and column_name='content') then
    update public.reviews set body = content where body is null;
  end if;
end $$;

-- (2-3) NULL/고아/불완전 행 격리 — SET NOT NULL 앞 (service_role 전용 아카이브) -------
create table if not exists public.reviews_quarantine_archive (
  id uuid primary key default gen_random_uuid(),
  original_id uuid,
  reason text not null,
  payload jsonb not null,
  archived_at timestamptz not null default now()
);
alter table public.reviews_quarantine_archive enable row level security;
revoke all on public.reviews_quarantine_archive from anon, authenticated;
drop policy if exists reviews_quarantine_archive_service on public.reviews_quarantine_archive;
create policy reviews_quarantine_archive_service on public.reviews_quarantine_archive
  for all to service_role using (true) with check (true);

create temporary table _rev_quarantine on commit drop as
  select r.id from public.reviews r
  where r.body is null
     or r.author_id is null
     or not exists (select 1 from public.users u where u.id = r.author_id)
     or not exists (select 1 from public.users u where u.id = r.mentor_id);

insert into public.reviews_quarantine_archive (original_id, reason, payload)
  select r.id, 'null_or_orphan_pre_converge', to_jsonb(r)
  from public.reviews r join _rev_quarantine q on q.id = r.id;

delete from public.reviews r using _rev_quarantine q where q.id = r.id;

-- (2-4) 레거시 NOT NULL/DEFAULT 해소 -------------------------------------------
alter table public.reviews alter column subscription_count drop default;
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='reviews'
               and column_name='subscription_count' and is_nullable='NO') then
    alter table public.reviews alter column subscription_count drop not null;
  end if;
end $$;

-- 격리로 NULL 0건 보장 후 정본 필수 컬럼 확정
alter table public.reviews alter column author_id set not null;
alter table public.reviews alter column body set not null;

-- (2-4a) 레거시 student_id/content 및 참조 객체 제거 (택a·권장 — 컬럼 제거) ---------
--   student_id 를 참조하는 구 정책/FK/유니크/인덱스를 먼저 제거해야 컬럼 drop 가능.
drop policy if exists "reviews_select_public" on public.reviews;   -- student_id 참조(033/126 정본으로 대체)
alter table public.reviews drop constraint if exists reviews_student_id_fkey;
alter table public.reviews drop constraint if exists reviews_one_per_pair;   -- 구 (mentor_id, student_id) 유니크
drop index if exists public.idx_reviews_one_per_pair_compat;
drop index if exists public.idx_reviews_student;
alter table public.reviews drop column if exists student_id;
alter table public.reviews drop column if exists content;

-- (2-6) FK/인덱스 정본 수렴 ----------------------------------------------------
create index if not exists idx_reviews_author on public.reviews (author_id);
create index if not exists idx_reviews_mentor_created on public.reviews (mentor_id, created_at desc);

-- (3) 중복 정리 (UNIQUE 앞 필수) — (mentor_id, author_id) 최신 1건 보존, 나머지 아카이브 --
create table if not exists public.reviews_duplicates_archive (
  id uuid primary key default gen_random_uuid(),
  original_id uuid,
  reason text not null,
  payload jsonb not null,
  archived_at timestamptz not null default now()
);
alter table public.reviews_duplicates_archive enable row level security;
revoke all on public.reviews_duplicates_archive from anon, authenticated;
drop policy if exists reviews_duplicates_archive_service on public.reviews_duplicates_archive;
create policy reviews_duplicates_archive_service on public.reviews_duplicates_archive
  for all to service_role using (true) with check (true);

create temporary table _rev_dups on commit drop as
  select id from (
    select id, row_number() over (partition by mentor_id, author_id
                                   order by created_at desc, id) as rn
    from public.reviews
  ) k where k.rn > 1;

insert into public.reviews_duplicates_archive (original_id, reason, payload)
  select r.id, 'dup_mentor_author_pre_unique', to_jsonb(r)
  from public.reviews r join _rev_dups d on d.id = r.id;

delete from public.reviews r using _rev_dups d where d.id = r.id;

create unique index if not exists uq_reviews_mentor_author on public.reviews (mentor_id, author_id);

alter table public.reviews enable row level security;

commit;
