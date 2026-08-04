-- platform_stub.sql — 오프라인 scratch PG 전용 Supabase 플랫폼 대역 (v1 초안)
-- ⚠️ 운영·branch 적용 금지. branch 에는 실제 플랫폼 객체가 있으므로 이 스텁은
--    로컬 replay 검증에서만 쓴다. 인벤토리 확정 후 확장/조정한다.

-- 기본 역할
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_storage_admin') then create role supabase_storage_admin nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase 고전(permissive) 기본 권한 재현 — 테이블·시퀀스만.
-- 함수는 defacl 미설정(= proacl NULL, PUBLIC implicit EXECUTE)이 고전 동작:
-- 원장 파일들의 자체 REVOKE 가 부모와 같은 효과를 만든다(실측: 20260731100540 self-check).
-- 부모의 '현재' defacl 은 hardened 상태 — 시점 전환은 비교기 diff 로 도출해 interleave 로 모델링.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- auth 스텁
create schema if not exists auth;
create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  phone text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_sign_in_at timestamptz,
  confirmed_at timestamptz,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  deleted_at timestamptz,
  is_anonymous boolean not null default false
);
create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create or replace function auth.role() returns text language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''), 'anon') $$;
create or replace function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;

-- storage 스텁 (정책 정의 가능 수준)
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name,'/')) stored,
  version text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[]
language sql immutable as
$$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
create or replace function storage.filename(name text) returns text
language sql immutable as
$$ select (string_to_array(name,'/'))[array_length(string_to_array(name,'/'),1)] $$;
create or replace function storage.extension(name text) returns text
language sql immutable as
$$ select reverse(split_part(reverse(storage.filename(name)),'.',1)) $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to service_role;
-- 부모 실측: storage 테이블은 anon/authenticated 에도 전체 부여(RLS 가 게이트)
grant all on storage.buckets, storage.objects to anon, authenticated;

-- realtime 대역(발행만)
do $$ begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- pg_cron 대역 (payout scheduler 등이 cron.schedule 호출 시)
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, schedule text, command text, jobname text);
create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint language plpgsql as $$
declare v bigint; begin
  insert into cron.job(schedule, command, jobname) values (schedule, command, job_name) returning jobid into v;
  return v;
end $$;
create or replace function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin delete from cron.job where jobname = job_name; return found; end $$;

-- pg_net 대역 (notification delivery worker 등이 net.http_post 호출 시)
create schema if not exists net;
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
returns bigint language sql as $$ select 1::bigint $$;

-- vault 대역 (secret 조회 참조 시)
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (id uuid, name text, decrypted_secret text);

-- 확장(스크래치에서 실제 존재하는 것만) — 부모와 같이 extensions 스키마에 설치
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
-- 번호 SQL 이 unqualified gen_random_uuid() 등을 쓰므로 검색 경로에 extensions 를 포함해야 한다
-- (Supabase 기본 DB search_path 도 "$user", public, extensions)
alter database postgres set search_path to "$user", public, extensions;

-- PG17 MAINTAIN privilege 대역 (scratch PG16 전용 — branch/부모는 PG17 원생).
-- 원장 4개 파일이 has_table_privilege(...,'MAINTAIN') 프로브를 사용한다.
-- MAINTAIN 은 이 파일들의 의미상 GRANT ALL/REVOKE ALL 묶음으로만 오가므로
-- 같은 묶음의 TRUNCATE 상태로 대변한다. 세션 search_path 에 pg17shim 을
-- pg_catalog 앞에 두어야 동작한다(run_roundtrip.sh 의 PGOPTIONS).
create schema if not exists pg17shim;
create or replace function pg17shim.has_table_privilege(u name, t text, priv text)
returns boolean language sql stable as
$$ select pg_catalog.has_table_privilege(u, t,
     case when upper(btrim(priv))='MAINTAIN' then 'TRUNCATE' else priv end) $$;
create or replace function pg17shim.has_table_privilege(u name, t oid, priv text)
returns boolean language sql stable as
$$ select pg_catalog.has_table_privilege(u, t,
     case when upper(btrim(priv))='MAINTAIN' then 'TRUNCATE' else priv end) $$;
grant usage on schema pg17shim to public;
