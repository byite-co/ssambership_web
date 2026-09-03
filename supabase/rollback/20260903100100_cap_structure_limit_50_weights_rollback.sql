-- =============================================================================
-- 20260903100100_cap_structure_limit_50_weights_rollback.sql  (DB-1 묶음 A 롤백)
-- =============================================================================
-- forward: supabase/sql/190_cap_structure_limit_50_weights.sql
-- 되돌리는 것(역순): mentor_plans.cap_weight 백필 → F8 v_caps 리터럴(M8 본문) → 시드 함수 리터럴(166 본문) →
--   M0 가드 INSERT 판정 28 · 트리거 WHEN 28 → cap_limit 기본값 28 + 행 50 → 28 → mentor_cap_limit 폴백 28 →
--   subscription_cap_weight 1.0/2.5/4.5. updated_at 트리거는 forward 와 같은 방식으로 UPDATE 동안만 끈다.
-- 주의: forward 이후 관리자가 개별 조정한 cap_limit(50 이 아닌 값)은 건드리지 않는다. forward 기간에 활성화된
--   구독은 가중치 복원으로 사용량 합이 달라질 수 있다(데이터 롤백 없음 — 오너 판단).
-- =============================================================================

begin;

-- 1. mentor_plans.cap_weight → 1.0/2.5/4.5 (updated_at 불변)
alter table public.mentor_plans disable trigger trg_mp_set_updated;
update public.mentor_plans
   set cap_weight = case lower(coalesce(plan_tier, ''))
                      when 'limited' then 1.0
                      when 'standard' then 2.5
                      when 'premium' then 4.5
                    end
 where lower(coalesce(plan_tier, '')) in ('limited', 'standard', 'premium')
   and cap_weight is distinct from case lower(coalesce(plan_tier, ''))
                      when 'limited' then 1.0
                      when 'standard' then 2.5
                      when 'premium' then 4.5
                    end;
alter table public.mentor_plans enable trigger trg_mp_set_updated;

-- 2. F8 — S2 M8(20260730112528) 본문 그대로
CREATE OR REPLACE FUNCTION api_web_v1.mentor_plan_prices_set_self(
  p_limited_cash_krw  integer,
  p_standard_cash_krw integer,
  p_premium_cash_krw  integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  v_uid    uuid := (SELECT auth.uid());
  v_role   text;
  v_status text;
  v_susp   timestamptz;
  -- 밴드 상수 — 정본 lib/subscribe/mentorPlanPricing.ts:13 와 동일 (T-REG-02).
  -- 잠금값 개정 시 두 정본을 같은 PR 에서 함께 변경한다(계약 §7 F8).
  v_tiers  text[]  := ARRAY['limited', 'standard', 'premium'];
  v_mins   int[]   := ARRAY[29900, 84900, 174900];
  v_maxs   int[]   := ARRAY[69900, 149900, 329900];
  v_caps   numeric[] := ARRAY[1.0, 2.5, 4.5];
  v_given  int[];
  v_i      int;
  v_amount int;
  v_old    int;
  v_updated   jsonb := '[]'::jsonb;
  v_unchanged jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  END IF;
  SELECT u.role, u.status, u.suspended_until INTO v_role, v_status, v_susp
    FROM public.users u WHERE u.id = v_uid;
  IF NOT FOUND OR v_role IS DISTINCT FROM 'mentor' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_NOT_MENTOR');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'banned' THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_BANNED');
  END IF;
  IF lower(coalesce(v_status, 'active')) = 'suspended' AND (v_susp IS NULL OR v_susp > now()) THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_SUSPENDED');
  END IF;
  IF public.account_deletion_write_blocked(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  END IF;

  v_given := ARRAY[p_limited_cash_krw, p_standard_cash_krw, p_premium_cash_krw];

  -- 전건 검증 선행 → 전건 반영 또는 전건 실패 (3 tier 단일 트랜잭션 — T-CONC-07 상당)
  FOR v_i IN 1..3 LOOP
    IF v_given[v_i] IS NULL OR v_given[v_i] < 1 THEN
      RETURN jsonb_build_object('ok', false, 'contract_version', 1,
                                'code', 'PLAN_PRICE_INVALID', 'tier', v_tiers[v_i]);
    END IF;
    IF v_given[v_i] < v_mins[v_i] OR v_given[v_i] > v_maxs[v_i] THEN
      RETURN jsonb_build_object('ok', false, 'contract_version', 1,
                                'code', 'PLAN_PRICE_OUT_OF_BAND', 'tier', v_tiers[v_i],
                                'min_cash_krw', v_mins[v_i], 'max_cash_krw', v_maxs[v_i],
                                'given_cash_krw', v_given[v_i]);
    END IF;
  END LOOP;

  FOR v_i IN 1..3 LOOP
    v_amount := v_given[v_i] * 100;   -- amountCentsFromCashKrw 동일 (1캐시 = 1원 = 100 cents)
    SELECT mp.amount_cents INTO v_old FROM public.mentor_plans mp
     WHERE mp.mentor_id = v_uid AND mp.plan_tier = v_tiers[v_i];
    IF FOUND AND v_old = v_amount
       AND EXISTS (SELECT 1 FROM public.mentor_plans mp
                    WHERE mp.mentor_id = v_uid AND mp.plan_tier = v_tiers[v_i]
                      AND mp.cap_weight = v_caps[v_i]) THEN
      v_unchanged := v_unchanged || jsonb_build_object('plan_tier', v_tiers[v_i], 'amount_cents', v_amount);
    ELSE
      INSERT INTO public.mentor_plans (mentor_id, plan_tier, amount_cents, cap_weight, is_active, price_updated_at)
      VALUES (v_uid, v_tiers[v_i], v_amount, v_caps[v_i], true, now())
      ON CONFLICT (mentor_id, plan_tier) DO UPDATE
        SET amount_cents = excluded.amount_cents,
            cap_weight = excluded.cap_weight,       -- tier 고정값 강제(클라이언트 불가)
            price_updated_at = now();
      v_updated := v_updated || jsonb_build_object('plan_tier', v_tiers[v_i], 'amount_cents', v_amount);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'contract_version', 1,
                            'updated', v_updated, 'unchanged', v_unchanged);
END $fn$;

COMMENT ON FUNCTION api_web_v1.mentor_plan_prices_set_self(integer, integer, integer) IS
  'S2 M8 F8(계약 §7 — XW-03 해소): 멘토 플랜 가격 설정 — 밴드 DB 강제(클램프 없이 거부)·cap_weight tier 고정·3 tier 단일 트랜잭션.';

-- 3. 시드 함수 — 166 본문 그대로
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

comment on function public.mp_seed_default_plans_on_approval() is null;

-- 4. M0 가드 — 20260729211929 본문 그대로(INSERT 판정 28) + INSERT 트리거 WHEN 28
CREATE OR REPLACE FUNCTION public.enforce_mentor_profile_privileged_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_jwt_role  text;
  v_sensitive boolean;
BEGIN
  -- TG_OP 선분기: INSERT 에서 OLD 는 NULL 이므로 OLD 비교 전에 반드시 분기한다.
  IF tg_op = 'INSERT' THEN
    -- 기본값 대비 판정. 28 하드코딩은 컬럼 기본값 변경 시 드리프트하는 취약점이다 —
    -- 기본값을 바꾸는 마이그레이션은 이 조건을 함께 갱신해야 한다(주석 의무).
    v_sensitive := (new.verification_status IS DISTINCT FROM 'pending'
                    OR new.cap_limit IS DISTINCT FROM 28);
  ELSE  -- 'UPDATE'
    v_sensitive := (new.verification_status IS DISTINCT FROM old.verification_status
                    OR new.cap_limit IS DISTINCT FROM old.cap_limit);
  END IF;

  IF v_sensitive THEN
    v_jwt_role := auth.jwt() ->> 'role';
    IF v_jwt_role = 'service_role' THEN RETURN new; END IF;   -- 서버 경유
    IF v_jwt_role IS NULL THEN RETURN new; END IF;            -- SQL Editor·migration
    IF EXISTS (SELECT 1 FROM public.users u
               WHERE u.id = (SELECT auth.uid()) AND u.role = 'admin') THEN
      RETURN new;                                             -- 기존 관리자
    END IF;
    RAISE EXCEPTION 'MENTOR_PROFILE_PRIVILEGED_COLUMN_FORBIDDEN'
      USING errcode = '42501';
  END IF;
  RETURN new;
END $$;

COMMENT ON FUNCTION public.enforce_mentor_profile_privileged_guard() IS
  'S2 M0(계약 §20.5): mentor_profiles.verification_status·cap_limit 변경을 service_role/JWT 없는 세션/admin 으로 제한하는 BEFORE INSERT OR UPDATE 가드.';

REVOKE ALL ON FUNCTION public.enforce_mentor_profile_privileged_guard() FROM PUBLIC;

drop trigger if exists trg_mentor_profile_privileged_guard_ins on public.mentor_profiles;
CREATE TRIGGER trg_mentor_profile_privileged_guard_ins
  BEFORE INSERT ON public.mentor_profiles
  FOR EACH ROW
  WHEN (new.verification_status IS DISTINCT FROM 'pending'
        OR new.cap_limit IS DISTINCT FROM 28)
  EXECUTE FUNCTION public.enforce_mentor_profile_privileged_guard();

-- 5. cap_limit 기본값 28 + 행 50 → 28 (updated_at 불변)
alter table public.mentor_profiles
  alter column cap_limit set default 28;

alter table public.mentor_profiles disable trigger trg_mentor_profiles_set_updated;
update public.mentor_profiles
   set cap_limit = 28
 where cap_limit = 50;
alter table public.mentor_profiles enable trigger trg_mentor_profiles_set_updated;

-- 6. mentor_cap_limit 폴백 28 — 050 본문 그대로
create or replace function public.mentor_cap_limit(p_mentor_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select mp.cap_limit from public.mentor_profiles mp where mp.user_id = p_mentor_id),
    28
  )::numeric;
$$;

comment on function public.mentor_cap_limit(uuid) is null;

-- 7. 가중치 1.0/2.5/4.5 — 050 본문 그대로
create or replace function public.subscription_cap_weight(p_tier text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_tier, ''))
    when 'limited' then 1.0
    when 'standard' then 2.5
    when 'premium' then 4.5
    else 0
  end::numeric;
$$;

comment on function public.subscription_cap_weight(text) is null;

-- 8. 복원 검증
do $$
begin
  if public.subscription_cap_weight('standard') <> 2.5 or public.subscription_cap_weight('premium') <> 4.5
     or public.mentor_cap_limit('00000000-0000-0000-0000-000000000000'::uuid) <> 28
     or exists (select 1 from public.mentor_profiles where cap_limit = 50)
     or exists (select 1 from pg_proc where proname = 'enforce_mentor_profile_privileged_guard' and prosrc not like '%IS DISTINCT FROM 28%')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'api_web_v1' and p.proname = 'mentor_plan_prices_set_self' and p.prosrc not like '%ARRAY[1.0, 2.5, 4.5]%')
     or exists (select 1 from public.mentor_plans where lower(coalesce(plan_tier, '')) = 'standard' and cap_weight is distinct from 2.5)
     or exists (select 1 from pg_trigger where tgname in ('trg_mentor_profiles_set_updated', 'trg_mp_set_updated') and tgenabled <> 'O') then
    raise exception '190_ROLLBACK_SELFCHECK: 복원 불일치';
  end if;
end $$;

commit;
