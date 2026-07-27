-- 166_mentor_plans_default_seed_on_first_approval.sql
-- 멘토 최초 승인 시 기본 요금제 자동 시드 — 승인 전이와 같은 트랜잭션에서 누락 tier 만 보충.
--
-- 배경(2026-07-24 staging 실조회):
--   - 승인 흐름: 관리자 액션이 mentor_profiles.verification_status 를 'approved' 로 UPDATE.
--   - mentor_plans 행이 없으면 실차감액이 권장가 폴백으로만 동작 — 승인 시점에 기본
--     요금제 3종을 시드해 카탈로그·차감 정본을 DB 행으로 확정한다.
--   - UNIQUE 상태 정정: (mentor_id, plan_tier) UNIQUE **constraint 는 없음**.
--     SQL 067 유래 UNIQUE **index** `uq_mentor_plans_mentor_tier`(비partial, (mentor_id,
--     plan_tier))가 실존하며, PostgreSQL 의 ON CONFLICT (mentor_id, plan_tier) 추론은
--     UNIQUE index 로도 정상 작동한다. → 이 스크립트는 인덱스를 **검증만** 하고
--     재생성하지 않는다(부재 환경에서만 방어 생성).
--
-- 시드 정본(캐시 권장가 × 100 = cents · CLAUDE.md 잠금값):
--   limited  2,990,000 / cap 1.0   ·  standard 8,490,000 / cap 2.5   ·  premium 17,490,000 / cap 4.5
--   label NULL · is_active true · created_at/updated_at/price_updated_at = now()
--
-- 규칙:
--   - ON CONFLICT (mentor_id, plan_tier) DO NOTHING — 기존 plan 의 가격·cap·label·활성
--     상태를 절대 UPDATE 하지 않는다(커스텀 가격 보존). 누락 tier 만 보충. 반복 승인 멱등.
--   - 트리거는 '비승인 → approved' 전이(UPDATE)에서만 발화. 그 외 전이 미생성.
--   - SECURITY DEFINER + search_path 고정. EXECUTE 는 트리거 발화에 불필요 — 전부 revoke.
--   - AFTER ROW 트리거 실패는 승인 UPDATE 와 함께 rollback 된다(원자성).
--   - 주의: mentor_plans 에는 SQL 158 의 AFTER INSERT 알림 트리거
--     (trg_mplan_notify_price_insert → mplan_notify_price_changed)가 있어, 시드 INSERT 는
--     '활성(active/cancel_scheduled/past_due) 구독자'에게 가격 변경 알림을 fan-out 한다
--     (tx·구독별 dedup — 동일 tx 다중 tier 는 구독자당 1건). 최초 승인은 구독자 0 이므로
--     알림 0. 158 은 이 스크립트에서 수정하지 않는다.
--   - 현재 staging 승인 멘토 2명은 이미 tier 3종을 보유 — backfill 없음(조회 보고만).
-- 선행: 067(mentor_plans·unique index), 121(밴드 클램프 — 시드값은 밴드 min 과 동일), 158.

-- ── 0. 사전 검증: 중복 0건 + 기존 유니크 인덱스 정의 확인(오정의·중복이면 중단, DROP 금지) ──
do $$
declare
  v_dup integer;
  v_idx record;
begin
  select count(*) into v_dup from (
    select mentor_id, plan_tier from public.mentor_plans group by 1, 2 having count(*) > 1
  ) d;
  if v_dup > 0 then
    raise exception 'SQL166_ABORT: mentor_plans 에 (mentor_id, plan_tier) 중복 % 그룹 존재 — 정리 없이 중단(임의 삭제 금지)', v_dup;
  end if;

  select i.indisunique as is_unique,
         (i.indpred is not null) as is_partial,
         pg_get_indexdef(i.indexrelid) as def
    into v_idx
  from pg_index i
  join pg_class c on c.oid = i.indexrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'uq_mentor_plans_mentor_tier';

  if found then
    -- 동명 인덱스가 있으면 정의가 정확해야 한다: unique · 비partial · (mentor_id, plan_tier).
    if (not v_idx.is_unique) or v_idx.is_partial
       or v_idx.def not like '%(mentor_id, plan_tier)%' then
      raise exception 'SQL166_ABORT: uq_mentor_plans_mentor_tier 정의 불일치(%) — 임의 DROP 하지 않고 중단', v_idx.def;
    end if;
  else
    -- 인덱스 부재 환경(클린 설치 등)에서만 SQL 067 과 같은 이름·정의로 방어 생성.
    create unique index if not exists uq_mentor_plans_mentor_tier
      on public.mentor_plans (mentor_id, plan_tier);
  end if;
end $$;

-- ── 1. 시드 함수 ──────────────────────────────────────────────────────────────
create or replace function public.mp_seed_default_plans_on_approval()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.mentor_plans
    (mentor_id, plan_tier, amount_cents, cap_weight, label, is_active,
     created_at, updated_at, price_updated_at)
  values
    (new.user_id, 'limited',   2990000, 1.0, null, true, now(), now(), now()),
    (new.user_id, 'standard',  8490000, 2.5, null, true, now(), now(), now()),
    (new.user_id, 'premium',  17490000, 4.5, null, true, now(), now(), now())
  on conflict (mentor_id, plan_tier) do nothing;
  return new;
end;
$$;

revoke execute on function public.mp_seed_default_plans_on_approval() from public;
revoke execute on function public.mp_seed_default_plans_on_approval() from anon;
revoke execute on function public.mp_seed_default_plans_on_approval() from authenticated;

-- ── 2. 승인 전이 트리거(비승인 → approved 에서만) ─────────────────────────────
drop trigger if exists trg_mp_seed_default_plans on public.mentor_profiles;
create trigger trg_mp_seed_default_plans
  after update on public.mentor_profiles
  for each row
  when (new.verification_status = 'approved'
        and old.verification_status is distinct from 'approved')
  execute function public.mp_seed_default_plans_on_approval();

-- 검증 쿼리(참고):
--   select tgname from pg_trigger where tgrelid = 'public.mentor_profiles'::regclass
--     and tgname = 'trg_mp_seed_default_plans';
--   select mentor_id, plan_tier, amount_cents, cap_weight, label, is_active
--     from mentor_plans order by mentor_id, plan_tier;
