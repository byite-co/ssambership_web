-- =============================================================================
-- 20260903200300_drop_school_tier_mappings_rollback.sql  (DB-2 묶음 C 롤백)
-- =============================================================================
-- forward: supabase/sql/195_drop_school_tier_mappings.sql
-- 되돌리는 것: school_tier_mappings 를 079_b_classification_catalog.sql 원문(운영 실측 정의와 동일)으로 재생성 —
--   컬럼 7 · PK · school_name 비공백 CHECK · school_tier_catalog(code) FK(restrict) · lower(trim(school_name)) UNIQUE 인덱스 ·
--   (is_active, school_tier_code, school_name) 인덱스 · updated_at 트리거 · RLS · 정책 school_tier_mappings_admin_all ·
--   GRANT(운영 적용본 ACL: anon·authenticated·service_role ALL + 079 명시 GRANT). 행은 원래 0 이었으므로 데이터 복원 없음.
-- =============================================================================

begin;

do $$
begin
  if to_regclass('public.school_tier_mappings') is not null then
    raise exception '195_ROLLBACK_GATE: school_tier_mappings 가 이미 있다';
  end if;
  if to_regclass('public.school_tier_catalog') is null then
    raise exception '195_ROLLBACK_GATE: school_tier_catalog 부재(FK 대상)';
  end if;
end $$;

create table public.school_tier_mappings (
  id uuid primary key default gen_random_uuid(),
  school_name text not null,
  school_tier_code text not null references public.school_tier_catalog(code) on update restrict on delete restrict,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_tier_mappings_school_name_nonempty check (char_length(trim(school_name)) > 0)
);

create unique index school_tier_mappings_school_name_unique
  on public.school_tier_mappings (lower(trim(school_name)));

create index school_tier_mappings_active_order_idx
  on public.school_tier_mappings (is_active, school_tier_code, school_name);

create trigger trg_school_tier_mappings_set_updated_at
  before update on public.school_tier_mappings
  for each row execute function public.set_updated_at();

alter table public.school_tier_mappings enable row level security;

create policy school_tier_mappings_admin_all
  on public.school_tier_mappings
  for all
  to authenticated
  using (coalesce((select public.is_admin()), false) = true)
  with check (coalesce((select public.is_admin()), false) = true);

-- 운영 적용본 ACL(2026-09-03 실측): anon · authenticated · service_role 전부 ALL(079 적용 당시 Supabase 기본 권한) + 079 명시 GRANT.
-- 지금은 하드닝 이후라 기본 권한만으로는 같은 ACL 이 만들어지지 않으므로 명시한다(RLS 가 게이트 · anon 정책 없음 = 접근 불가).
grant all on table public.school_tier_mappings to anon, authenticated, service_role;
grant select on public.school_tier_mappings to authenticated;
grant insert, update, delete on public.school_tier_mappings to authenticated;

-- 복원 검증
do $$
begin
  if to_regclass('public.school_tier_mappings') is null
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'school_tier_mappings' and policyname = 'school_tier_mappings_admin_all')
     or not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'school_tier_mappings' and indexname = 'school_tier_mappings_school_name_unique')
     or not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'school_tier_mappings' and indexname = 'school_tier_mappings_active_order_idx')
     or not exists (select 1 from pg_trigger where tgname = 'trg_school_tier_mappings_set_updated_at' and tgrelid = 'public.school_tier_mappings'::regclass)
     or not exists (select 1 from pg_constraint where conrelid = 'public.school_tier_mappings'::regclass and conname = 'school_tier_mappings_school_tier_code_fkey')
     or not (select relrowsecurity from pg_class where oid = 'public.school_tier_mappings'::regclass) then
    raise exception '195_ROLLBACK_SELFCHECK: 복원 불일치';
  end if;
end $$;

commit;
