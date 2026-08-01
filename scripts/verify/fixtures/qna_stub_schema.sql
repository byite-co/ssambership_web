-- qna_stub_schema.sql — 오프라인 스크래치 Postgres 전용 최소 스텁 (F2/D-12 질문방 알림 검증용).
-- 목적: 실제 132/136/139/141/142/144 + 20260801040844(F2 forward) SQL 과 qna 알림 fixture 를
--   로컬 PG16 에서 그대로 구동하기 위한 선행 객체(role/auth/storage 스키마·도메인 테이블 골격·
--   선행 함수 스텁)를 만든다.
-- ⚠️ staging/production 에 절대 적용 금지 — 실 DB 에는 이 객체들이 이미 정본 마이그레이션으로 존재한다.
-- 스키마 골격은 저장소 정본(001/002/032/033/044/049/052 등)에서 대상 RPC·트리거·fixture 가
--   참조하는 컬럼만 발췌했다(FK 일부 생략). auth.uid() 는 GUC(request.fixture_uid) 스텁이다.

-- Supabase 기본 role 스텁
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

-- auth 스키마 스텁: users(FK 용) + uid()(세션 GUC 로 위장 — 실 Supabase 의 JWT sub 대응)
create schema if not exists auth;
create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  created_at timestamptz,
  updated_at timestamptz
);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.fixture_uid', true), '')::uuid
$$;

-- storage 스키마 스텁: objects (139/141 의 정책·owner 대조용 최소 골격)
create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null,
  owner_id text,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);

-- 공용 updated_at 트리거 함수(001 동형)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- users (001 발췌 + suspended_until)
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('student', 'mentor', 'admin')),
  status text not null default 'active',
  suspended_until timestamptz,
  full_name text,
  nickname text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- mentor_profiles (001 발췌)
create table if not exists public.mentor_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  university_name text not null,
  department_name text not null,
  verification_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- mentor_student_rooms (002 발췌)
create table if not exists public.mentor_student_rooms (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id) on delete cascade,
  mentor_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (student_id, mentor_id)
);

-- question_threads (002 + 033 topic + P1-8 workflow 발췌)
create table if not exists public.question_threads (
  id uuid primary key default gen_random_uuid(),
  mentor_student_room_id uuid not null references public.mentor_student_rooms (id) on delete cascade,
  title text not null,
  status text not null default 'pending'
    check (status in ('pending','answered','confirmed','open','closed','archived')),
  subject text,
  topic text,
  first_answered_at timestamptz,
  confirmed_at timestamptz,
  is_wrong_answer boolean not null default false,
  mastery_status text not null default 'unknown'
    check (mastery_status in ('unknown','wrong','review','mastered')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- question_messages (002 발췌)
create table if not exists public.question_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.question_threads (id) on delete cascade,
  author_id uuid not null references public.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

-- question_attachments (049 발췌)
create table if not exists public.question_attachments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.question_threads (id) on delete cascade,
  message_id uuid references public.question_messages (id) on delete set null,
  author_id uuid not null references public.users (id) on delete cascade,
  storage_path text not null,
  file_name text,
  mime_type text,
  created_at timestamptz not null default now()
);

-- free_question_usage (044/052 발췌 — thread_id 는 136 이 추가)
create table if not exists public.free_question_usage (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id) on delete cascade,
  mentor_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- subscriptions (002 발췌)
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id) on delete cascade,
  mentor_id uuid not null references public.users (id) on delete cascade,
  plan_tier text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- refunds (004/069 발췌 — 142 refund 게이트용)
create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  amount_cents bigint,
  status text not null default 'pending',
  subscription_id uuid references public.subscriptions (id) on delete set null,
  request_type text,
  created_at timestamptz not null default now()
);

-- user_blocks (상호 차단)
create table if not exists public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users (id) on delete cascade,
  blocked_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

-- subjects (과목 코드)
create table if not exists public.subjects (
  code text primary key,
  label text
);

-- notifications 레거시 골격(132 이전 상태 — 132 가 recipient_user_id/event_key 를 추가한다)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  type text,
  body text,
  metadata jsonb default '{}'::jsonb,
  data jsonb default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── 선행 함수 스텁(실 정의는 032/iq/049 계열 — 검증 대상 아님) ──
-- 주간 한도: 스텁은 항상 can_ask=true (한도 자체는 본 검증 범위 밖).
create or replace function public.get_weekly_question_usage(p_student uuid, p_mentor uuid)
returns json language sql stable as $$
  select json_build_object('can_ask', true)
$$;

-- 승인 멘토 판정(실 계약 동형: role=mentor + verification_status=approved).
create or replace function public.individual_question_user_is_approved_mentor(p_user uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.users u
    join public.mentor_profiles mp on mp.user_id = u.id
    where u.id = p_user and u.role = 'mentor' and mp.verification_status = 'approved'
  )
$$;

-- 경로 room 세그먼트 파서(049 동형: {room}/{thread}/{file}).
create or replace function public.qra_room_uuid_from_path(p_name text)
returns uuid language sql immutable as $$
  select nullif(split_part(p_name, '/', 1), '')::uuid
$$;

-- 경로 당사자 판정(049 동형 스텁).
create or replace function public.user_is_room_party_for_qra_path(p_name text)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.mentor_student_rooms r
    where r.id = public.qra_room_uuid_from_path(p_name)
      and auth.uid() in (r.student_id, r.mentor_id)
  )
$$;

-- ── 권한: 직접쓰기 경로(role authenticated) 실측용 GRANT — 로컬 스텁 전용(RLS 미사용) ──
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant select, insert on storage.objects to authenticated, service_role;
