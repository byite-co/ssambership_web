-- =============================================================================
-- 205_plan_price_stats.sql  (2026-09-06 · DB-5 묶음 A — 요금제 평균가 함수)
--
-- 왜: 웹 메인·요금제 페이지가 "실제 멘토들이 정한 요금제의 평균가"를 표시한다. 정본 데이터는 `mentor_plans`(멘토별 tier 행 · F8 저장값)이며
--   웹이 표를 직접 집계하면 anon 에게 멘토별 단가 전체가 열린다. 집계만 돌려주는 SECURITY DEFINER 함수를 두고, 갱신 주기(매일)는 웹 캐시가 맡는다.
--
-- 확정 사양(오너 2026-09-06):
--   · 평균(중앙값 아님) · 원 단위 100원 반올림 · 표본 5명 미만이면 평균 대신 **최소값**을 돌려주고 fallback = true
--   · 대상: `mentor_profiles.verification_status = 'approved'` AND `mentor_plans.is_active = true` (+ amount_cents 양수 · tier 3종)
--   · `amount_cents` 는 원×100 저장(29,900원 = 2,990,000) → avg_won = round(avg(amount_cents) / 10000) × 100
--     (검산 2026-09-06 운영 read-only 실측: limited 30,000 · standard 85,300 · premium 175,600 · 각 표본 75 — 세 값 일치)
--
-- A-1 public.plan_price_stats() returns table(plan_tier text, sample_count int, avg_won int, min_won int, max_won int, fallback boolean)
--   · SECURITY DEFINER · STABLE · search_path '' · 항상 3행(limited · standard · premium 순) — 표본 0이면 sample_count 0 · 금액 NULL · fallback true
--     (웹은 NULL 이면 카탈로그 표시가 `lib/subscribe/subscribePlanCatalog.ts` 로 폴백)
--   · GRANT EXECUTE anon · authenticated(메인은 비로그인) · service_role(서버 캐시 갱신 경로). 개별 멘토 단가는 노출하지 않는다(집계 6열만).
--
-- Apply: 저장소 표준 경로(db-apply-pending). pack 등재: supabase/baseline/post_ledger_backfills/20260906100100_plan_price_stats.sql
-- Rollback: supabase/rollback/20260906100100_plan_price_stats_rollback.sql
-- =============================================================================

begin;

do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'mentor_plans'
       and column_name in ('mentor_id', 'plan_tier', 'amount_cents', 'is_active')) <> 4 then
    raise exception '205_GATE: mentor_plans 컬럼(mentor_id·plan_tier·amount_cents·is_active) 불일치(004·103)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'mentor_profiles' and column_name = 'verification_status') then
    raise exception '205_GATE: mentor_profiles.verification_status 부재(001)';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'plan_price_stats') then
    raise exception '205_GATE: public.plan_price_stats 가 이미 있다';
  end if;
end $$;

create function public.plan_price_stats()
returns table (
  plan_tier    text,
  sample_count int,
  avg_won      int,
  min_won      int,
  max_won      int,
  fallback     boolean
)
language sql
stable
security definer
set search_path to ''
as $fn$
  with base as (
    select mp.plan_tier, mp.amount_cents
      from public.mentor_plans mp
      join public.mentor_profiles p on p.user_id = mp.mentor_id
     where p.verification_status = 'approved'
       and mp.is_active = true
       and mp.plan_tier in ('limited', 'standard', 'premium')
       and mp.amount_cents is not null
       and mp.amount_cents > 0
  ),
  agg as (
    select b.plan_tier,
           count(*)::int                                   as sample_count,
           (round(avg(b.amount_cents) / 10000.0) * 100)::int as avg_won_r100,   -- cents → 원(÷100) → 100원 단위 반올림
           (min(b.amount_cents) / 100)::int                as min_won,
           (max(b.amount_cents) / 100)::int                as max_won
      from base b
     group by b.plan_tier
  )
  select t.tier                                     as plan_tier,
         coalesce(a.sample_count, 0)                 as sample_count,
         case when coalesce(a.sample_count, 0) >= 5 then a.avg_won_r100 else a.min_won end as avg_won,
         a.min_won,
         a.max_won,
         (coalesce(a.sample_count, 0) < 5)           as fallback
    from (values ('limited', 1), ('standard', 2), ('premium', 3)) as t(tier, ord)
    left join agg a on a.plan_tier = t.tier
   order by t.ord;
$fn$;

comment on function public.plan_price_stats() is
  '205(DB-5 A-1): 승인 멘토 · 활성 요금제의 tier 별 평균가(100원 반올림 · cents÷100) · 최소 · 최대 · 표본 수. 표본 5명 미만이면 avg_won = 최소값 + fallback true. 항상 3행. anon/authenticated/service_role 읽기 — 개별 단가 비노출.';

revoke all on function public.plan_price_stats() from public;
grant execute on function public.plan_price_stats() to anon, authenticated, service_role;

do $$
declare v_oid oid; v_rows int; v_bad int;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'plan_price_stats' and pg_get_function_identity_arguments(p.oid) = ''
     and p.prosecdef and p.provolatile = 's' and coalesce(p.proconfig::text, '') like '%search_path=%' and p.proretset;
  if v_oid is null then
    raise exception '205_SELFCHECK: identity/attributes 불일치(SECDEF · STABLE · search_path · setof)';
  end if;
  if not has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '205_SELFCHECK: ACL 불일치(anon·authenticated·service_role EXECUTE)';
  end if;
  -- 형태: 항상 3행 · tier 순서 고정 · fallback 은 표본 수와 정합
  select count(*) into v_rows from public.plan_price_stats();
  if v_rows <> 3 then
    raise exception '205_SELFCHECK: 3행이 아니다(%)', v_rows;
  end if;
  select count(*) into v_bad from public.plan_price_stats() s
   where s.fallback is distinct from (s.sample_count < 5)
      or (s.sample_count >= 5 and s.avg_won is null)
      or (s.avg_won is not null and s.avg_won % 100 <> 0)
      or (s.sample_count = 0 and (s.avg_won is not null or s.min_won is not null or s.max_won is not null));
  if v_bad <> 0 then
    raise exception '205_SELFCHECK: 결과 정합성 위반 % 행', v_bad;
  end if;
  if (select string_agg(s.plan_tier, ',' order by s.plan_tier) from public.plan_price_stats() s) <> 'limited,premium,standard' then
    raise exception '205_SELFCHECK: tier 집합 불일치';
  end if;
end $$;

commit;
