-- =============================================================================
-- 202_api_app_v1_mentor_plan_active_set.sql  (2026-09-05 · DB-4 묶음 D — 요금제 활성 여부)
--
-- 왜: `api_web_v1.mentor_plan_prices_set_self`(F8)는 가격 3종만 받고 항상 is_active=true 로 upsert 한다. 활성 토글은 웹에서도
--   활동 중단/종료의 부수 효과(service_role)뿐이라 멘토가 tier 하나만 닫을 길이 없다(A-4a 판정표 #2 · DB-4 지시서 §D).
--   웹 규칙: 활성 구독이 있는 요금제를 끄는 규칙은 없다(`mentor_plans.is_active` 는 정본 confirm 의 신규 결제 게이트 PLAN_INACTIVE 에만 쓰이고,
--   갱신 `process_subscription_renewal` 은 is_active 를 보지 않는다) → 지시서 정의대로 **기존 구독은 유지하고 신규만 막는다**.
--
-- D-1 api_app_v1.mentor_plan_active_set(p_tier text, p_is_active boolean) returns jsonb
--   · AUTH_REQUIRED → ROLE_NOT_MENTOR → ACCOUNT_BANNED / ACCOUNT_SUSPENDED / ACCOUNT_NOT_ACTIVE / ACCOUNT_DELETION_IN_PROGRESS →
--     PLAN_TIER_INVALID → PLAN_ACTIVE_VALUE_REQUIRED → MENTOR_PROFILE_NOT_FOUND → MENTOR_TERMINATED(terminating/terminated 는 종료 절차가 플랜을 소유) →
--     PLAN_NOT_FOUND(행은 승인 시 166 트리거·F8 이 만든다 — 시드하지 않음) → LAST_ACTIVE_PLAN(마지막 활성 tier 는 끌 수 없음)
--   · 멱등(값 동일이면 changed:false) · 반환 {ok, contract_version:1, plan_tier, is_active, changed, active_tiers[]}
--   · 트리거 대조: trg_mplan_notify_price_update 는 amount_cents 변경만(158 주석 "is_active 토글 무발화") · trg_mp_set_updated 로 updated_at 만.
--   · 201 과의 상호작용: terminating 이 전 tier 를 끄고, active 복귀가 전 tier 를 켠다(웹 동일). 이 토글은 그 사이(active/paused)에서만 동작한다.
-- 권한: REVOKE public·anon · GRANT authenticated 만. F8 은 그대로(가격 upsert 가 is_active 를 건드리지 않는 ON CONFLICT 동작 불변).
--
-- Apply: 저장소 표준 경로(db-apply-pending). pack 등재: supabase/baseline/post_ledger_backfills/20260905100400_api_app_v1_mentor_plan_active_set.sql
-- Rollback: supabase/rollback/20260905100400_api_app_v1_mentor_plan_active_set_rollback.sql
-- =============================================================================

begin;

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'api_app_v1') then
    raise exception '202_GATE: api_app_v1 스키마 부재';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'mentor_plans'
       and column_name in ('id','mentor_id','plan_tier','is_active','amount_cents')) <> 5 then
    raise exception '202_GATE: mentor_plans 컬럼 불일치(103)';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'mentor_plans' and indexname = 'uq_mentor_plans_mentor_tier') then
    raise exception '202_GATE: uq_mentor_plans_mentor_tier 부재(067)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'confirm_subscription_checkout' and p.prosrc like '%PLAN_INACTIVE%') then
    raise exception '202_GATE: 정본 confirm 의 PLAN_INACTIVE 게이트 부재 — 신규 차단 전제';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1' and p.proname = 'mentor_plan_active_set') then
    raise exception '202_GATE: 대상 함수가 이미 있다';
  end if;
end $$;

create function api_app_v1.mentor_plan_active_set(p_tier text, p_is_active boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_role text; v_status text; v_susp timestamptz; v_norm text;
  v_tier text := lower(btrim(coalesce(p_tier, '')));
  v_act text;
  v_plan record;
  v_others integer;
  v_changed boolean := false;
  v_active_tiers text[];
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;
  select u.role, u.status, u.suspended_until into v_role, v_status, v_susp from public.users u where u.id = v_uid;
  if not found or v_role is distinct from 'mentor' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_NOT_MENTOR');
  end if;
  v_norm := lower(btrim(coalesce(v_status, '')));
  if v_norm = 'banned' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_BANNED');
  end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_SUSPENDED');
  end if;
  if v_norm not in ('active', 'suspended') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_NOT_ACTIVE');
  end if;
  if public.account_deletion_write_blocked(v_uid) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ACCOUNT_DELETION_IN_PROGRESS');
  end if;
  if v_tier not in ('limited', 'standard', 'premium') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_TIER_INVALID');
  end if;
  if p_is_active is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_ACTIVE_VALUE_REQUIRED');
  end if;

  select mp.activity_status into v_act from public.mentor_profiles mp where mp.user_id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_PROFILE_NOT_FOUND');
  end if;
  if lower(btrim(coalesce(v_act, 'active'))) in ('terminating', 'terminated') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_TERMINATED');
  end if;

  select mp.id, mp.is_active into v_plan from public.mentor_plans mp
   where mp.mentor_id = v_uid and mp.plan_tier = v_tier for update;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_NOT_FOUND', 'plan_tier', v_tier);
  end if;

  if p_is_active = false then
    select count(*) into v_others from public.mentor_plans mp
     where mp.mentor_id = v_uid and mp.plan_tier in ('limited', 'standard', 'premium')
       and mp.plan_tier <> v_tier and coalesce(mp.is_active, true);
    if v_others = 0 then
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'LAST_ACTIVE_PLAN', 'plan_tier', v_tier);
    end if;
  end if;

  if coalesce(v_plan.is_active, true) is distinct from p_is_active then
    update public.mentor_plans mp set is_active = p_is_active where mp.id = v_plan.id;
    v_changed := true;
  end if;

  select coalesce(array_agg(mp.plan_tier order by case mp.plan_tier when 'limited' then 1 when 'standard' then 2 else 3 end), '{}'::text[])
    into v_active_tiers
    from public.mentor_plans mp
   where mp.mentor_id = v_uid and mp.plan_tier in ('limited', 'standard', 'premium') and coalesce(mp.is_active, true);

  return jsonb_build_object('ok', true, 'contract_version', 1, 'plan_tier', v_tier, 'is_active', p_is_active,
                            'changed', v_changed, 'active_tiers', to_jsonb(v_active_tiers));
end
$fn$;

comment on function api_app_v1.mentor_plan_active_set(text, boolean) is
  '202(DB-4 D-1): 본인 요금제 tier 활성 토글 — 마지막 활성 tier 는 끌 수 없음(LAST_ACTIVE_PLAN) · terminating/terminated 는 MENTOR_TERMINATED · 기존 구독 유지, 신규 결제만 PLAN_INACTIVE 로 차단. 가격은 F8 그대로.';

revoke all on function api_app_v1.mentor_plan_active_set(text, boolean) from public, anon;
grant execute on function api_app_v1.mentor_plan_active_set(text, boolean) to authenticated;

do $$
declare v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1' and p.proname = 'mentor_plan_active_set'
     and pg_get_function_identity_arguments(p.oid) = 'p_tier text, p_is_active boolean'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%';
  if v_oid is null then
    raise exception '202_SELFCHECK: identity/attributes 불일치';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or not has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '202_SELFCHECK: ACL 불일치(authenticated 만)';
  end if;
  -- F8 불변(가격 함수의 identity·ACL)
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'api_web_v1' and p.proname = 'mentor_plan_prices_set_self'
                    and pg_get_function_identity_arguments(p.oid) = 'p_limited_cash_krw integer, p_standard_cash_krw integer, p_premium_cash_krw integer'
                    and has_function_privilege('authenticated', p.oid, 'EXECUTE')) then
    raise exception '202_SELFCHECK: F8 변경됨';
  end if;
end $$;

commit;
