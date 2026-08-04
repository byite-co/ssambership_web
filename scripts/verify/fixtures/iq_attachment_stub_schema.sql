-- iq_attachment_stub_schema.sql — 오프라인 스크래치 Postgres 전용 최소 스텁.
-- 목적: 20260804113000(메시지 작성자 가드) forward/rollback 과 계약 fixture 를
--   로컬 PG16 에서 그대로 구동하기 위한 선행 객체(role/auth/storage 스텁 +
--   IQ 도메인 골격 + helper)를 만든다.
-- ⚠️ staging/production 에 절대 적용 금지 — 실 DB 에는 정본 마이그레이션으로 존재.
-- 골격은 저장소 정본(070/167/20260803142559/20260803162808)에서 RPC 가 참조하는
--   컬럼만 발췌했다(FK·RLS 일부 생략 — RLS 공존 검증은 staging fixture 대체).

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

-- auth 스텁 — uid() 는 GUC(request.jwt.claim.sub)로 세션마다 주입한다.
create schema if not exists auth;
create or replace function auth.uid()
returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- storage 스텁(버킷 allowlist + 객체 소유/메타 — M2 §12.6 fail-closed 경로용).
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  bucket_id text not null,
  name text not null,
  owner_id text,
  metadata jsonb default '{}'::jsonb,
  primary key (bucket_id, name)
);
insert into storage.buckets (id, allowed_mime_types)
values ('individual-question-attachments',
        array['image/png','image/jpeg','image/webp','image/gif','application/pdf',
              'application/zip',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/json'])
on conflict (id) do nothing;

-- users (001 발췌 — 계정 상태 게이트용)
create table if not exists public.users (
  id uuid primary key,
  role text not null default 'student',
  status text not null default 'active',
  suspended_until timestamptz,
  created_at timestamptz not null default now()
);

-- IQ 골격 (070 발췌)
create table if not exists public.individual_questions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users(id),
  designated_mentor_id uuid references public.users(id),
  claimed_mentor_id uuid references public.users(id),
  status text not null default 'claimed',
  title text,
  body text,
  created_at timestamptz not null default now()
);

create table if not exists public.individual_question_messages (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.individual_questions(id) on delete cascade,
  author_id uuid not null references public.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

-- attachments (070 + 167 유니크 + 20260803142559 author_id)
create table if not exists public.individual_question_attachments (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.individual_questions(id) on delete cascade,
  message_id uuid references public.individual_question_messages(id) on delete set null,
  storage_path text not null,
  file_name text,
  mime_type text,
  author_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists iqa_question_storage_path_uk
  on public.individual_question_attachments (question_id, storage_path);

-- helpers (실정의 동형 — 당사자 판정·삭제 진행 차단)
create or replace function public.user_is_individual_question_party(p_question_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as
$$
  select exists (
    select 1 from public.individual_questions q
    where q.id = p_question_id
      and (select auth.uid()) in (q.student_id, q.designated_mentor_id, q.claimed_mentor_id)
  )
$$;

create or replace function public.account_deletion_write_blocked(p_user_id uuid)
returns boolean language sql stable as $$ select false $$;
