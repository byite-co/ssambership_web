-- =============================================================================
-- 190_cap_structure_limit_50_weights.sql  (2026-09-03 · DB-1 묶음 A — 캡 구조)
--
-- Purpose: 멘토 정원(cap) 구조를 오너 확정값으로 갱신한다.
--   · 한도   mentor_cap_limit() 폴백 28 → 50 · mentor_profiles.cap_limit 기본값 28 → 50 ·
--            기존 행 28 → 50 (관리자가 개별 조정해 28 이 아닌 행은 건드리지 않는다)
--   · 가중치 subscription_cap_weight(): limited 1.0 (유지) · standard 2.5 → 2.25 · premium 4.5 → 4.75
--
-- A-2 확인 결과 — 두 함수를 호출하는 곳(자동 반영): enforce_mentor_cap(트리거) · mentor_cap_used ·
--   confirm_subscription_checkout. cap_limit CHECK 제약 없음(50 허용). 활성 구독 0건 → 사용량 영향 0.
--
-- A-2 확인 결과 — 함수를 호출하지 않고 리터럴 사본을 가진 곳(이 파일이 함께 갱신한다):
--   1) enforce_mentor_profile_privileged_guard() INSERT 분기 `IS DISTINCT FROM 28` +
--      trg_mentor_profile_privileged_guard_ins WHEN 절의 28. M0(20260729211929) 자체 주석이
--      "기본값을 바꾸는 마이그레이션은 이 조건을 함께 갱신해야 한다"고 못박았다. 갱신하지 않으면
--      기본값 50 으로 들어오는 모든 mentor_profiles INSERT 가 '특권 변경'으로 판정돼 authenticated
--      가입 경로가 42501(MENTOR_PROFILE_PRIVILEGED_COLUMN_FORBIDDEN)로 막힌다.
--   2) mp_seed_default_plans_on_approval() — 승인 시 mentor_plans.cap_weight 를 1.0/2.5/4.5 리터럴로 시드.
--   3) api_web_v1.mentor_plan_prices_set_self (S2 M8 F8) — v_caps ARRAY[1.0, 2.5, 4.5] 로 cap_weight 강제.
--   4) mentor_plans.cap_weight 참조 컬럼(73 멘토 × 3 tier) — 2)·3) 이 쓰는 값. 실차감·cap 판정은
--      subscription_cap_weight() 만 쓰므로 계산에는 영향 없지만 두 정본이 어긋난 채 두지 않는다.
--   → 2)·3) 은 리터럴을 버리고 public.subscription_cap_weight(tier) 를 호출한다(단일 정본).
--      4) 는 함수값으로 백필한다(146 행 = standard·premium × 73).
--
-- 부수효과 억제: mentor_profiles·mentor_plans 의 updated_at 트리거를 해당 UPDATE 동안만 끈다
--   (시스템 설정 변경이 '최근 수정' 으로 관리자 활동 로그에 잡히지 않게). 같은 트랜잭션 안에서 복원·자가 검증.
--   mentor_plans 가격 알림 트리거는 amount_cents 변경에만 반응하므로 알림 fan-out 0.
--
-- Apply: 저장소 표준 경로(db-apply-pending) — MCP apply_migration·SQL Editor 즉석 실행 금지.
--   pack 등재: supabase/baseline/post_ledger_backfills/20260903100100_cap_structure_limit_50_weights.sql
-- Rollback: supabase/rollback/20260903100100_cap_structure_limit_50_weights_rollback.sql
-- 검증(§5): select distinct cap_limit from mentor_profiles;
--           select subscription_cap_weight('limited'), subscription_cap_weight('standard'), subscription_cap_weight('premium');
-- =============================================================================

begin;

-- ── 0. 사전 게이트 — 예상 상태와 다르면 중단(임의 정정 금지) ──────────────────
do $$
declare
  v_guard_src text;
  v_f8_src    text;
  v_seed_src  text;
  v_default   text;
begin
  if public.subscription_cap_weight('standard') <> 2.5 or public.subscription_cap_weight('premium') <> 4.5 then
    raise exception '190_GATE: subscription_cap_weight 가 2.5/4.5 가 아니다(%/%) — 이미 적용됐거나 전제 불일치',
      public.subscription_cap_weight('standard'), public.subscription_cap_weight('premium');
  end if;

  select column_default into v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'mentor_profiles' and column_name = 'cap_limit';
  if v_default is distinct from '28' then
    raise exception '190_GATE: mentor_profiles.cap_limit 기본값이 28 이 아니다(%)', v_default;
  end if;

  select p.prosrc into v_guard_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_mentor_profile_privileged_guard';
  if v_guard_src is null or v_guard_src not like '%IS DISTINCT FROM 28%' then
    raise exception '190_GATE: enforce_mentor_profile_privileged_guard 본문에 `IS DISTINCT FROM 28` 이 없다 — M0 전제 불일치';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_mentor_profile_privileged_guard_ins'
                   and tgrelid = 'public.mentor_profiles'::regclass) then
    raise exception '190_GATE: trg_mentor_profile_privileged_guard_ins 부재';
  end if;

  select p.prosrc into v_f8_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_web_v1' and p.proname = 'mentor_plan_prices_set_self'
     and pg_get_function_identity_arguments(p.oid) = 'p_limited_cash_krw integer, p_standard_cash_krw integer, p_premium_cash_krw integer';
  if v_f8_src is null or v_f8_src not like '%ARRAY[1.0, 2.5, 4.5]%' then
    raise exception '190_GATE: api_web_v1.mentor_plan_prices_set_self 의 v_caps 리터럴(ARRAY[1.0, 2.5, 4.5]) 을 찾지 못했다';
  end if;

  select p.prosrc into v_seed_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mp_seed_default_plans_on_approval';
  if v_seed_src is null or v_seed_src not like '%8490000, 2.5,%' or v_seed_src not like '%17490000, 4.5,%' then
    raise exception '190_GATE: mp_seed_default_plans_on_approval 의 cap_weight 리터럴(2.5/4.5) 을 찾지 못했다';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_mentor_profiles_set_updated'
                   and tgrelid = 'public.mentor_profiles'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'trg_mp_set_updated'
                   and tgrelid = 'public.mentor_plans'::regclass) then
    raise exception '190_GATE: updated_at 트리거(trg_mentor_profiles_set_updated / trg_mp_set_updated) 부재';
  end if;
end $$;

-- ── 1. 가중치 정본 — 1.0 / 2.25 / 4.75 (050 본문 · search_path 고정 072 그대로) ──
create or replace function public.subscription_cap_weight(p_tier text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_tier, ''))
    when 'limited' then 1.0
    when 'standard' then 2.25
    when 'premium' then 4.75
    else 0
  end::numeric;
$$;

comment on function public.subscription_cap_weight(text) is
  '190: 플랜 tier → cap 가중치 정본 (limited 1.0 · standard 2.25 · premium 4.75). 다른 곳에 리터럴 사본을 두지 않는다.';

-- ── 2. 한도 폴백 28 → 50 (050 본문 그대로, 상수만) ─────────────────────────────
create or replace function public.mentor_cap_limit(p_mentor_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select mp.cap_limit from public.mentor_profiles mp where mp.user_id = p_mentor_id),
    50
  )::numeric;
$$;

comment on function public.mentor_cap_limit(uuid) is
  '190: 멘토 cap 상한 — mentor_profiles.cap_limit, 행이 없으면 50.';

-- ── 3. 컬럼 기본값 28 → 50 + 기존 행 백필(28 인 행만 · updated_at 불변) ───────
alter table public.mentor_profiles
  alter column cap_limit set default 50;

alter table public.mentor_profiles disable trigger trg_mentor_profiles_set_updated;
update public.mentor_profiles
   set cap_limit = 50
 where cap_limit = 28;
alter table public.mentor_profiles enable trigger trg_mentor_profiles_set_updated;

-- ── 4. M0 특권 컬럼 가드 — INSERT 기본값 판정 28 → 50 (본문·ACL 그 외 불변) ─────
CREATE OR REPLACE FUNCTION public.enforce_mentor_profile_privileged_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_jwt_role  text;
  v_sensitive boolean;
BEGIN
  -- TG_OP 선분기: INSERT 에서 OLD 는 NULL 이므로 OLD 비교 전에 반드시 분기한다.
  IF tg_op = 'INSERT' THEN
    -- 기본값 대비 판정. 50 하드코딩은 컬럼 기본값 변경 시 드리프트하는 취약점이다 —
    -- 기본값을 바꾸는 마이그레이션은 이 조건을 함께 갱신해야 한다(주석 의무). 190: 28 → 50.
    v_sensitive := (new.verification_status IS DISTINCT FROM 'pending'
                    OR new.cap_limit IS DISTINCT FROM 50);
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
  'S2 M0(계약 §20.5): mentor_profiles.verification_status·cap_limit 변경을 service_role/JWT 없는 세션/admin 으로 제한하는 BEFORE INSERT OR UPDATE 가드. 190: INSERT 기본값 판정 28 → 50.';

REVOKE ALL ON FUNCTION public.enforce_mentor_profile_privileged_guard() FROM PUBLIC;

drop trigger if exists trg_mentor_profile_privileged_guard_ins on public.mentor_profiles;
CREATE TRIGGER trg_mentor_profile_privileged_guard_ins
  BEFORE INSERT ON public.mentor_profiles
  FOR EACH ROW
  WHEN (new.verification_status IS DISTINCT FROM 'pending'
        OR new.cap_limit IS DISTINCT FROM 50)
  EXECUTE FUNCTION public.enforce_mentor_profile_privileged_guard();

-- ── 5. 승인 시 기본 플랜 시드 — cap_weight 리터럴 → subscription_cap_weight() (166 본문 그 외 동일) ──
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
    (new.user_id, 'limited',   2990000, public.subscription_cap_weight('limited'),  null, true, now(), now(), now()),
    (new.user_id, 'standard',  8490000, public.subscription_cap_weight('standard'), null, true, now(), now(), now()),
    (new.user_id, 'premium',  17490000, public.subscription_cap_weight('premium'),  null, true, now(), now(), now())
  on conflict (mentor_id, plan_tier) do nothing;
  return new;
end;
$$;

comment on function public.mp_seed_default_plans_on_approval() is
  'SQL166: 멘토 승인 전이 시 기본 플랜 3종 시드(ON CONFLICT DO NOTHING). 190: cap_weight 는 subscription_cap_weight() 정본.';

-- ── 6. F8 mentor_plan_prices_set_self — v_caps 리터럴 → subscription_cap_weight() (M8 본문 그 외 동일) ──
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
  -- 190: cap 가중치는 public.subscription_cap_weight() 단일 정본 — 리터럴 사본을 두지 않는다.
  v_caps   numeric[] := ARRAY[public.subscription_cap_weight('limited'),
                              public.subscription_cap_weight('standard'),
                              public.subscription_cap_weight('premium')];
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
  'S2 M8 F8(계약 §7 — XW-03 해소): 멘토 플랜 가격 설정 — 밴드 DB 강제(클램프 없이 거부)·cap_weight tier 고정·3 tier 단일 트랜잭션. 190: cap_weight 는 subscription_cap_weight() 정본.';

-- ── 7. mentor_plans.cap_weight 참조 컬럼 백필 — 함수값과 다른 행만 · updated_at 불변 ──
alter table public.mentor_plans disable trigger trg_mp_set_updated;
update public.mentor_plans mp
   set cap_weight = public.subscription_cap_weight(mp.plan_tier)
 where lower(coalesce(mp.plan_tier, '')) in ('limited', 'standard', 'premium')
   and mp.cap_weight is distinct from public.subscription_cap_weight(mp.plan_tier);
alter table public.mentor_plans enable trigger trg_mp_set_updated;

-- ── 8. 적용 직후 자가 검증 ─────────────────────────────────────────────────────
do $$
declare
  v_n integer;
  v_def text;
begin
  if public.subscription_cap_weight('limited') <> 1.0
     or public.subscription_cap_weight('standard') <> 2.25
     or public.subscription_cap_weight('premium') <> 4.75 then
    raise exception '190_SELFCHECK: 가중치 불일치';
  end if;
  if public.mentor_cap_limit('00000000-0000-0000-0000-000000000000'::uuid) <> 50 then
    raise exception '190_SELFCHECK: mentor_cap_limit 폴백이 50 이 아니다';
  end if;
  select count(*) into v_n from public.mentor_profiles where cap_limit = 28;
  if v_n > 0 then
    raise exception '190_SELFCHECK: cap_limit = 28 인 행이 % 건 남아 있다', v_n;
  end if;
  select column_default into v_def from information_schema.columns
   where table_schema = 'public' and table_name = 'mentor_profiles' and column_name = 'cap_limit';
  if v_def is distinct from '50' then
    raise exception '190_SELFCHECK: cap_limit 기본값이 50 이 아니다(%)', v_def;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'enforce_mentor_profile_privileged_guard'
                    and p.prosrc like '%IS DISTINCT FROM 50%' and p.prosrc not like '%IS DISTINCT FROM 28%'
                    and p.prosecdef
                    and (p.proacl IS NULL OR (p.proacl::text NOT LIKE '{=%' AND p.proacl::text NOT LIKE '%,=%'))) then
    raise exception '190_SELFCHECK: 특권 가드 본문/ACL 불일치';
  end if;
  select pg_get_triggerdef(t.oid) into v_def from pg_trigger t
   where t.tgname = 'trg_mentor_profile_privileged_guard_ins' and t.tgrelid = 'public.mentor_profiles'::regclass;
  if v_def is null or v_def not like '%IS DISTINCT FROM (50)::numeric%' then
    raise exception '190_SELFCHECK: INSERT 가드 트리거 WHEN 절이 50 이 아니다(%)', v_def;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'api_web_v1' and p.proname = 'mentor_plan_prices_set_self'
                    and p.prosrc like '%public.subscription_cap_weight(''premium'')%'
                    and p.prosrc not like '%ARRAY[1.0, 2.5, 4.5]%'
                    and p.prosecdef
                    and NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and has_function_privilege('service_role', p.oid, 'EXECUTE')) then
    raise exception '190_SELFCHECK: F8 본문/ACL 불일치';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'mp_seed_default_plans_on_approval'
                    and p.prosrc like '%public.subscription_cap_weight(''standard'')%'
                    and NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    and NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) then
    raise exception '190_SELFCHECK: 시드 함수 본문/ACL 불일치';
  end if;
  select count(*) into v_n from public.mentor_plans mp
   where lower(coalesce(mp.plan_tier, '')) in ('limited', 'standard', 'premium')
     and mp.cap_weight is distinct from public.subscription_cap_weight(mp.plan_tier);
  if v_n > 0 then
    raise exception '190_SELFCHECK: mentor_plans.cap_weight 가 함수값과 다른 행 % 건', v_n;
  end if;
  if exists (select 1 from pg_trigger where tgname in ('trg_mentor_profiles_set_updated', 'trg_mp_set_updated')
               and tgenabled <> 'O') then
    raise exception '190_SELFCHECK: updated_at 트리거가 다시 켜지지 않았다';
  end if;
end $$;

commit;
