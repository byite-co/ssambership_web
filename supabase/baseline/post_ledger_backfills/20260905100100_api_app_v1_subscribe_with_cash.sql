-- =============================================================================
-- 199_api_app_v1_subscribe_with_cash.sql  (2026-09-05 · DB-4 묶음 A — 앱 구독 결제 · 해지 예약 ★)
--
-- 왜: 앱은 service_role 이 없어 구독 결제(F12 `api_web_v1.subscription_checkout_confirm_v2` — service_role 전용)와
--   구독 해지 예약(`subscriptions` UPDATE — authenticated 정책 028 에서 DROP)을 부를 수 없다(A-4a 판정표 #8 · DB-4 지시서 §A).
--   `authenticated` 만 실행하는 SECURITY DEFINER 래퍼를 `api_app_v1` 에 둔다. 핵심 로직은 복제하지 않고 위임한다.
--
-- 0-A 부수 효과 대조(웹 `lib/subscribe/subscribeCheckoutService.ts` 캐시 지갑 경로 전수 — 이 래퍼가 수행하는 것):
--   ① TS 사전 게이트(학생 역할·계정 상태·멘토 승인·활동 상태(paused/terminating)·구독 열림·중복 구독·cap·잔액) → 이 함수 §게이트
--   ② `payments` intent 행(pending · kind subscription · amount KRW · metadata expected_amount_cents) → 이 함수가 INSERT
--   ③ F12 `api_web_v1.subscription_checkout_confirm_v2(payment, plan, expected, 'sub_checkout_<payment>')` → 그대로 호출
--        └ 정본 `confirm_subscription_checkout`(subscriptions upsert · `enforce_mentor_cap` 트리거 · `record_subscription_cash_debit` 원장+지갑 · payments succeeded)
--        └ `core_private.ensure_student_mentor_room`(방 확보 · 참조 보정 · 실패 시 자금 전부 롤백)
--   ④ TS `recordInitialSubscriptionBillingEvent`(subscription_billing_events initial/succeeded upsert `sub_initial:<sub>` +
--        subscriptions.last_billing_event_id/last_payment_id) → 이 함수가 같은 키·같은 필드로 수행(정산 항목 배치 `refresh_subscription_settlement_items` 의 원천)
--   ⑤ 알림: 최초 구독은 웹도 알림 0(157 트리거는 renewal/expired 만) → 동일
--   ⑥ 웹 부가(best-effort) `transferReleasedIndividualQuestionsToRoom` 은 Storage 파일 복제가 필요해 SQL 밖 — 이 래퍼는 수행하지 않는다(보고서 §0-A)
--   ⑦ 웹 라우트의 본인인증 게이트(`requireVerifiedIdentity` · IDENTITY_GATE_ENABLED env 종속)는 S-C 정책상 "DB/RPC 레벨 가드 0" 이라
--        DB 에 두지 않는다(보고서 오너 결정 항목)
--
-- A-1 api_app_v1.subscribe_with_cash(p_mentor_id uuid, p_tier text, p_idempotency_key text) returns jsonb
--   · 게이트 순서: AUTH_REQUIRED → MENTOR_NOT_FOUND(인자) → PLAN_TIER_INVALID → IDEMPOTENCY_KEY_INVALID → (잠금) → 멱등 재생 →
--     ROLE_NOT_STUDENT → ACCOUNT_BANNED / ACCOUNT_SUSPENDED / ACCOUNT_NOT_ACTIVE / ACCOUNT_DELETION_IN_PROGRESS →
--     MENTOR_NOT_FOUND → MENTOR_NOT_APPROVED → MENTOR_TERMINATED / MENTOR_PAUSED → MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS → BLOCKED(상호 차단 · F10 동일) →
--     ALREADY_SUBSCRIBED → PLAN_NOT_FOUND / PLAN_INACTIVE / PLAN_AMOUNT_INVALID → MENTOR_CAP_EXCEEDED → CASH_INSUFFICIENT(shortfall_cents)
--   · 실차감액 = `mentor_plans.amount_cents`(멘토가 정한 값 · 행이 없으면 PLAN_NOT_FOUND — 권장가 시드는 하지 않는다: 승인 시 166 트리거가 3 tier 를 만든다)
--   · 멱등: `payments.external_id = 'sub_app_' || p_idempotency_key` + (학생, 키) advisory xact lock. 같은 키 재호출은 첫 결과(`payments.metadata.app_result`)를
--     `idempotent: true` 로 그대로 돌려준다(차감 0). 같은 키·다른 멘토/tier 는 IDEMPOTENCY_KEY_CONFLICT.
--     실패한 시도는 payments 행을 남기지 않는다(subtransaction rollback) — 재시도는 새로 판정된다.
--   · F12 envelope 실패는 같은 코드로 승격한다. 이상(anomaly) 계열 코드는 롤백 후 `subscription_checkout_anomalies` 에 payment_id NULL 로 다시 기록한다.
--   · 반환: {ok, contract_version:1, idempotent, subscription_id, room_id, payment_id, plan_id, plan_tier, debited_cents, balance_after_cents,
--            reactivated, current_period_start, current_period_end, next_billing_at}
-- A-2 api_app_v1.subscription_cancel_at_period_end(p_subscription_id uuid) · api_app_v1.subscription_cancel_undo(p_subscription_id uuid) returns jsonb
--   · 웹 `lib/subscribe/subscriptionCancelActions.ts` 동일: 본인 구독 · status ∈ {active, past_due} · cancel_at_period_end/cancel_requested_at 만 갱신.
--   · 코드: AUTH_REQUIRED · ROLE_NOT_STUDENT · SUBSCRIPTION_NOT_FOUND · NOT_SUBSCRIPTION_OWNER · SUBSCRIPTION_NOT_CURRENT(status).
--   · 멱등(이미 예약/이미 해제면 그대로 ok). 트리거 대조: enforce_mentor_cap(status·plan_tier 만) · keep_subscription_refunded_status(status 만) ·
--     sub_notify_expired(status→expired 만) · sync_subscription_refunded_from_refund(refunds 표) — 어느 것도 이 두 컬럼 변경에 발화하지 않는다.
-- 권한: 세 함수 모두 REVOKE public·anon · GRANT EXECUTE authenticated 만(M17 앱 계약 §3.3 — service_role 미부여). 웹은 자기 경로(F12) 그대로.
--
-- 적용 전 실측(2026-09-05 운영 read-only): 구독 0 · 환불 0 · 분쟁 0 → 데이터 영향 0. api_app_v1 함수 6(M17 5 + user_profile_update_self).
-- Apply: 저장소 표준 경로(db-apply-pending) — 즉석 실행 금지. 순서 A(199) → B(200) → C(201) → D(202) → E(203) → F(204).
--   pack 등재: supabase/baseline/post_ledger_backfills/20260905100100_api_app_v1_subscribe_with_cash.sql
-- Rollback: supabase/rollback/20260905100100_api_app_v1_subscribe_with_cash_rollback.sql
-- 검증(§6): select p.proname, p.prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') anon,
--                  has_function_privilege('authenticated', p.oid, 'EXECUTE') authenticated
--             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'api_app_v1' and p.proname in ('subscribe_with_cash','subscription_cancel_at_period_end','subscription_cancel_undo');
-- =============================================================================

begin;

-- ── 0. 사전 게이트 — 예상 상태와 다르면 중단(임의 정정 금지) ──────────────────
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'api_app_v1') then
    raise exception '199_GATE: api_app_v1 스키마 부재(M17)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'api_web_v1' and p.proname = 'subscription_checkout_confirm_v2'
                    and pg_get_function_identity_arguments(p.oid) = 'p_payment_id uuid, p_plan_id uuid, p_expected_amount_cents integer, p_idempotency_key text') then
    raise exception '199_GATE: api_web_v1.subscription_checkout_confirm_v2 identity 불일치(M9)';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'confirm_subscription_checkout'
                    and p.prosrc like '%record_subscription_cash_debit%') then
    raise exception '199_GATE: confirm_subscription_checkout 정본 부재';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('mentor_cap_used', 'mentor_cap_limit', 'subscription_cap_weight',
                                                    'individual_question_user_is_approved_mentor', 'account_deletion_write_blocked')) <> 5 then
    raise exception '199_GATE: cap·승인·탈퇴 헬퍼 5종 부재';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'payments'
       and column_name in ('id','user_id','mentor_id','amount','currency','status','kind','plan_id','external_id','metadata')) <> 10 then
    raise exception '199_GATE: payments 컬럼 불일치';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'subscriptions'
       and column_name in ('id','student_id','mentor_id','plan_id','plan_tier','status','payment_id','started_at','current_period_start','current_period_end',
                           'next_billing_at','cancel_at_period_end','cancel_requested_at','last_billing_event_id','last_payment_id','created_at')) <> 16 then
    raise exception '199_GATE: subscriptions 컬럼 불일치';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'subscription_billing_events'
       and column_name in ('subscription_id','student_id','mentor_id','event_type','status','period_start','period_end','billing_at','amount_cents',
                           'plan_tier','plan_id','idempotency_key','ledger_id','payment_id','processed_at')) <> 15
     or not exists (select 1 from pg_constraint where conrelid = 'public.subscription_billing_events'::regclass and contype = 'u'
                     and pg_get_constraintdef(oid) like '%idempotency_key%') then
    raise exception '199_GATE: subscription_billing_events 컬럼/idempotency UNIQUE 불일치';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'mentor_profiles'
       and column_name in ('user_id','activity_status','pause_until','is_open_for_subscriptions')) <> 4 then
    raise exception '199_GATE: mentor_profiles 활동·열림 컬럼 불일치(103·131)';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'mentor_plans' and indexname = 'uq_mentor_plans_mentor_tier') then
    raise exception '199_GATE: uq_mentor_plans_mentor_tier 부재(067)';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'subscription_checkout_anomalies') then
    raise exception '199_GATE: subscription_checkout_anomalies 부재(145)';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'user_blocks' and column_name in ('blocker_id','blocked_id')) <> 2 then
    raise exception '199_GATE: user_blocks(blocker_id, blocked_id) 부재';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'api_app_v1' and p.proname in ('subscribe_with_cash', 'subscription_cancel_at_period_end', 'subscription_cancel_undo')) then
    raise exception '199_GATE: 대상 함수가 이미 있다(이미 적용됐거나 전제 불일치)';
  end if;
end $$;

-- ── A-1. subscribe_with_cash ─────────────────────────────────────────────────
create function api_app_v1.subscribe_with_cash(
  p_mentor_id uuid,
  p_tier text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_tier text := lower(btrim(coalesce(p_tier, '')));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_ext text;
  v_succeeded constant text[] := array['succeeded','paid','success','complete','captured'];
  -- 롤백 후에도 운영 진단을 위해 anomaly 를 다시 기록할 코드(정본·F12 anomaly 계열)
  v_anomaly_codes constant text[] := array['FINANCIAL_WRITE_ERROR','LEDGER_FIELD_MISMATCH','ROOM_ENSURE_FAILED','ROOM_REF_MISMATCH',
    'PLAN_AMOUNT_CHANGED','SUCCEEDED_NO_SUBSCRIPTION','SUCCEEDED_NO_LEDGER','PLAN_BINDING_MISMATCH','PARTY_BINDING_MISMATCH',
    'LEDGER_BINDING_MISMATCH','SUBSCRIPTION_REF_INVALID','LEDGER_AMOUNT_MISMATCH'];
  v_role text; v_status text; v_susp timestamptz; v_norm text;
  v_mrole text;
  v_act text; v_pause_until timestamptz; v_open boolean;
  v_dup uuid;
  v_plan_id uuid; v_plan_active boolean; v_amount integer;
  v_cap_used numeric; v_cap_limit numeric; v_cap_weight numeric;
  v_balance bigint;
  v_pay record;
  v_payment_id uuid;
  v_res jsonb;
  v_abort_code text;
  v_abort_detail jsonb;
  v_sub_id uuid; v_room_id uuid; v_reactivated boolean;
  v_sub record; v_ledger record;
  v_period_start timestamptz; v_period_end timestamptz;
  v_event_id uuid;
  v_balance_after bigint;
  v_result jsonb;
  v_anom uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;
  if p_mentor_id is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_FOUND');
  end if;
  if v_tier not in ('limited', 'standard', 'premium') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_TIER_INVALID');
  end if;
  if v_key = '' or char_length(v_key) > 128 then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'IDEMPOTENCY_KEY_INVALID');
  end if;
  v_ext := 'sub_app_' || v_key;

  -- 직렬화: (학생, 키) — 같은 키 동시 재시도는 첫 호출 커밋 뒤 재생으로 수렴 · (학생, 멘토) — 정본과 같은 pair 잠금(재진입)
  perform pg_advisory_xact_lock(hashtext('app_sub_key:' || v_uid::text), hashtext(v_key));
  perform pg_advisory_xact_lock(hashtext(v_uid::text), hashtext(p_mentor_id::text));

  -- 멱등 재생 — 성공한 첫 결과를 그대로(차감 0). 실패 시도는 행을 남기지 않으므로 여기 오면 성공 행뿐이다.
  select p.id, p.status, p.mentor_id, p.metadata into v_pay
    from public.payments p
   where p.user_id = v_uid and p.external_id = v_ext
   order by p.created_at desc
   limit 1
   for update;
  if found then
    if v_pay.status = any(v_succeeded) and (v_pay.metadata ? 'app_result') then
      if v_pay.mentor_id is distinct from p_mentor_id or (v_pay.metadata ->> 'planTier') is distinct from v_tier then
        return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'IDEMPOTENCY_KEY_CONFLICT',
                                  'payment_id', v_pay.id);
      end if;
      return (v_pay.metadata -> 'app_result') || jsonb_build_object('idempotent', true);
    end if;
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'IDEMPOTENCY_KEY_CONFLICT',
                              'payment_id', v_pay.id, 'payment_status', v_pay.status);
  end if;

  -- 학생 · 계정 상태 (F10·정본과 동일 판정식)
  select u.role, u.status, u.suspended_until into v_role, v_status, v_susp from public.users u where u.id = v_uid;
  if not found or v_role is distinct from 'student' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_NOT_STUDENT');
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

  -- 멘토: 역할 · 승인 · 활동 상태(웹 mentorActivityState 동일) · 구독 열림
  select u.role into v_mrole from public.users u where u.id = p_mentor_id;
  if not found or v_mrole is distinct from 'mentor' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_FOUND');
  end if;
  if not public.individual_question_user_is_approved_mentor(p_mentor_id) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_APPROVED');
  end if;
  select mp.activity_status, mp.pause_until, mp.is_open_for_subscriptions into v_act, v_pause_until, v_open
    from public.mentor_profiles mp where mp.user_id = p_mentor_id;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_FOUND');
  end if;
  v_act := lower(btrim(coalesce(v_act, 'active')));
  if v_act in ('terminating', 'terminated') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_TERMINATED');
  end if;
  if v_act = 'paused' and (v_pause_until is null or v_pause_until > now()) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_PAUSED', 'pause_until', v_pause_until);
  end if;
  if not coalesce(v_open, true) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS');
  end if;
  -- 상호 차단(F10 ③ 과 같은 판정) — 웹은 이 경우 F12 의 방 확보 단계에서 ROOM_ENSURE_FAILED 로 실패한다(차감 0). 앱에는 코드로 먼저 알린다.
  if exists (select 1 from public.user_blocks b
              where (b.blocker_id = v_uid and b.blocked_id = p_mentor_id) or (b.blocker_id = p_mentor_id and b.blocked_id = v_uid)) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'BLOCKED');
  end if;

  -- 중복 구독 (활성 pair 1행 모델)
  select s.id into v_dup from public.subscriptions s
   where s.student_id = v_uid and s.mentor_id = p_mentor_id and lower(coalesce(s.status, '')) = 'active';
  if v_dup is not null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ALREADY_SUBSCRIBED', 'subscription_id', v_dup);
  end if;

  -- 요금제 행 = 실차감액 (멘토가 정한 값 · 잠금은 F12 가 다시 건다)
  select mp.id, mp.is_active, mp.amount_cents into v_plan_id, v_plan_active, v_amount
    from public.mentor_plans mp where mp.mentor_id = p_mentor_id and mp.plan_tier = v_tier;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_NOT_FOUND', 'plan_tier', v_tier);
  end if;
  if not coalesce(v_plan_active, true) then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_INACTIVE', 'plan_tier', v_tier);
  end if;
  if v_amount is null or v_amount <= 0 or v_amount % 100 <> 0 then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'PLAN_AMOUNT_INVALID', 'plan_tier', v_tier);
  end if;

  -- 정원 (정본 판정식 그대로 — DB 함수 3종 · 최종 방어는 enforce_mentor_cap 트리거)
  v_cap_used := public.mentor_cap_used(p_mentor_id);
  v_cap_weight := public.subscription_cap_weight(v_tier);
  v_cap_limit := public.mentor_cap_limit(p_mentor_id);
  if v_cap_used + v_cap_weight > v_cap_limit then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'MENTOR_CAP_EXCEEDED',
                              'cap_used', v_cap_used, 'cap_weight', v_cap_weight, 'cap_limit', v_cap_limit);
  end if;

  -- 잔액 (사전 판정 — 실제 차감의 원자 판정은 record_subscription_cash_debit)
  select w.balance_cents into v_balance from public.cash_wallets w where w.user_id = v_uid;
  v_balance := coalesce(v_balance, 0);
  if v_balance < v_amount then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'CASH_INSUFFICIENT',
                              'required_cents', v_amount, 'balance_cents', v_balance, 'shortfall_cents', v_amount - v_balance);
  end if;

  -- 자금 단계 — 한 subtransaction: intent → F12(정본 confirm + 방) → initial billing event. 실패 시 전부 롤백.
  begin
    insert into public.payments (user_id, mentor_id, status, amount, currency, kind, plan_id, external_id, metadata)
    values (v_uid, p_mentor_id, 'pending', (v_amount::numeric / 100), 'KRW', 'subscription', v_plan_id, v_ext,
            jsonb_build_object('planTier', v_tier, 'planId', v_plan_id::text, 'source', 'app_subscribe_with_cash',
                               'expected_amount_cents', v_amount, 'idempotency_key', v_key))
    returning id into v_payment_id;

    v_res := api_web_v1.subscription_checkout_confirm_v2(v_payment_id, v_plan_id, v_amount, 'sub_checkout_' || v_payment_id::text);
    if not coalesce((v_res ->> 'ok')::boolean, false) then
      v_abort_code := coalesce(v_res ->> 'code', 'FINANCIAL_WRITE_ERROR');
      v_abort_detail := v_res - 'ok' - 'contract_version' - 'code';
      raise exception 'APP_SUB_ABORT';
    end if;
    v_sub_id := (v_res ->> 'subscription_id')::uuid;
    v_room_id := (v_res ->> 'room_id')::uuid;
    v_reactivated := coalesce((v_res ->> 'reactivated')::boolean, false);

    -- ④ initial billing event — 웹 recordInitialSubscriptionBillingEvent 와 같은 키·필드(upsert)
    select s.student_id, s.mentor_id, s.plan_tier, s.plan_id, s.created_at, s.started_at,
           s.current_period_start, s.current_period_end, s.next_billing_at, s.payment_id
      into v_sub
      from public.subscriptions s where s.id = v_sub_id;
    select l.id, l.created_at into v_ledger
      from public.cash_ledger l where l.idempotency_key = 'sub_debit_' || v_payment_id::text;
    v_period_start := coalesce(v_sub.current_period_start, v_sub.started_at, v_sub.created_at, now());
    v_period_end := coalesce(v_sub.current_period_end,
                             ((v_period_start at time zone 'Asia/Seoul' + interval '1 month') at time zone 'Asia/Seoul'));
    insert into public.subscription_billing_events
      (subscription_id, student_id, mentor_id, event_type, status, period_start, period_end, billing_at, amount_cents,
       plan_tier, plan_id, idempotency_key, ledger_id, payment_id, processed_at)
    values
      (v_sub_id, coalesce(v_sub.student_id, v_uid), coalesce(v_sub.mentor_id, p_mentor_id), 'initial', 'succeeded',
       v_period_start, v_period_end, coalesce(v_ledger.created_at, v_sub.created_at, now()), v_amount,
       coalesce(v_sub.plan_tier, v_tier), v_sub.plan_id, 'sub_initial:' || v_sub_id::text, v_ledger.id,
       coalesce(v_sub.payment_id, v_payment_id), coalesce(v_ledger.created_at, now()))
    on conflict (idempotency_key) do update
      set subscription_id = excluded.subscription_id, student_id = excluded.student_id, mentor_id = excluded.mentor_id,
          event_type = excluded.event_type, status = excluded.status, period_start = excluded.period_start,
          period_end = excluded.period_end, billing_at = excluded.billing_at, amount_cents = excluded.amount_cents,
          plan_tier = excluded.plan_tier, plan_id = excluded.plan_id, ledger_id = excluded.ledger_id,
          payment_id = excluded.payment_id, processed_at = excluded.processed_at
    returning id into v_event_id;
    update public.subscriptions s
       set last_billing_event_id = v_event_id, last_payment_id = v_payment_id
     where s.id = v_sub_id;

    select w.balance_cents into v_balance_after from public.cash_wallets w where w.user_id = v_uid;
    v_result := jsonb_build_object(
      'ok', true, 'contract_version', 1, 'idempotent', false,
      'subscription_id', v_sub_id, 'room_id', v_room_id, 'payment_id', v_payment_id,
      'plan_id', v_plan_id, 'plan_tier', v_tier,
      'debited_cents', v_amount, 'balance_after_cents', coalesce(v_balance_after, 0),
      'reactivated', v_reactivated,
      'current_period_start', v_sub.current_period_start, 'current_period_end', v_sub.current_period_end,
      'next_billing_at', v_sub.next_billing_at);
    -- 재생용 첫 결과 보존 (정본이 넣은 planId/subscription_id 는 그대로 두고 app_result 만 덧붙인다)
    update public.payments p
       set metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object('app_result', v_result)
     where p.id = v_payment_id;
  exception when others then
    if sqlerrm <> 'APP_SUB_ABORT' then
      raise;   -- 사전 밖 예외는 그대로 전파(§8.2)
    end if;
  end;

  if v_abort_code is not null then
    -- 이 시도의 payments·anomaly 행은 위 블록과 함께 롤백됐다. 이상 계열은 운영 진단용으로 다시 기록한다(payment_id 없음).
    if v_abort_code = any(v_anomaly_codes) then
      insert into public.subscription_checkout_anomalies (payment_id, subscription_id, code, detail, expected, found)
      values (null, null, v_abort_code, 'api_app_v1.subscribe_with_cash aborted (intent rolled back)',
              jsonb_build_object('student_id', v_uid, 'mentor_id', p_mentor_id, 'plan_id', v_plan_id, 'plan_tier', v_tier,
                                 'amount_cents', v_amount, 'idempotency_key', v_key),
              v_abort_detail)
      returning id into v_anom;
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', v_abort_code, 'anomaly_id', v_anom);
    end if;
    if v_abort_code = 'CASH_INSUFFICIENT' then
      select w.balance_cents into v_balance from public.cash_wallets w where w.user_id = v_uid;
      v_balance := coalesce(v_balance, 0);
      return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'CASH_INSUFFICIENT',
                                'required_cents', v_amount, 'balance_cents', v_balance,
                                'shortfall_cents', greatest(0, v_amount - v_balance));
    end if;
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', v_abort_code) || coalesce(v_abort_detail, '{}'::jsonb);
  end if;

  return v_result;
end
$fn$;

comment on function api_app_v1.subscribe_with_cash(uuid, text, text) is
  '199(DB-4 A-1): 앱 캐시 구독 결제 — 게이트(학생·계정·멘토 승인/활동/열림·중복·요금제·cap·잔액) 후 payments intent → F12 subscription_checkout_confirm_v2(정본 confirm+방) → initial billing event. (학생,키) 멱등 재생 · 실패 시 intent 롤백. authenticated 만.';

-- ── A-2. 해지 예약 · 취소 ──────────────────────────────────────────────────────
create function api_app_v1.subscription_cancel_at_period_end(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_sub record;
  v_already boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;
  select u.role into v_role from public.users u where u.id = v_uid;
  if not found or v_role is distinct from 'student' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_NOT_STUDENT');
  end if;
  if p_subscription_id is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_NOT_FOUND');
  end if;
  select s.id, s.student_id, s.status, s.cancel_at_period_end, s.cancel_requested_at, s.current_period_end
    into v_sub from public.subscriptions s where s.id = p_subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_NOT_FOUND');
  end if;
  if v_sub.student_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'NOT_SUBSCRIPTION_OWNER');
  end if;
  if lower(btrim(coalesce(v_sub.status, ''))) not in ('active', 'past_due') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_NOT_CURRENT', 'status', v_sub.status);
  end if;
  if coalesce(v_sub.cancel_at_period_end, false) then
    v_already := true;
  else
    update public.subscriptions s
       set cancel_at_period_end = true, cancel_requested_at = now(), updated_at = now()
     where s.id = p_subscription_id and s.student_id = v_uid;
    select s.cancel_requested_at into v_sub.cancel_requested_at from public.subscriptions s where s.id = p_subscription_id;
  end if;
  return jsonb_build_object('ok', true, 'contract_version', 1, 'subscription_id', p_subscription_id,
                            'cancel_at_period_end', true, 'already_scheduled', v_already,
                            'cancel_requested_at', v_sub.cancel_requested_at, 'current_period_end', v_sub.current_period_end);
end
$fn$;

comment on function api_app_v1.subscription_cancel_at_period_end(uuid) is
  '199(DB-4 A-2): 본인 구독(active/past_due) 해지 예약 — cancel_at_period_end=true · cancel_requested_at=now(). 기간 말까지 유지, 다음 결제 중단. 멱등. 웹 requestSubscriptionCancelAtPeriodEndAction 동일.';

create function api_app_v1.subscription_cancel_undo(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_sub record;
  v_was boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;
  select u.role into v_role from public.users u where u.id = v_uid;
  if not found or v_role is distinct from 'student' then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ROLE_NOT_STUDENT');
  end if;
  if p_subscription_id is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_NOT_FOUND');
  end if;
  select s.id, s.student_id, s.status, s.cancel_at_period_end, s.current_period_end, s.next_billing_at
    into v_sub from public.subscriptions s where s.id = p_subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_NOT_FOUND');
  end if;
  if v_sub.student_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'NOT_SUBSCRIPTION_OWNER');
  end if;
  if lower(btrim(coalesce(v_sub.status, ''))) not in ('active', 'past_due') then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_NOT_CURRENT', 'status', v_sub.status);
  end if;
  v_was := coalesce(v_sub.cancel_at_period_end, false);
  update public.subscriptions s
     set cancel_at_period_end = false, cancel_requested_at = null, updated_at = now()
   where s.id = p_subscription_id and s.student_id = v_uid;
  return jsonb_build_object('ok', true, 'contract_version', 1, 'subscription_id', p_subscription_id,
                            'cancel_at_period_end', false, 'was_scheduled', v_was,
                            'current_period_end', v_sub.current_period_end, 'next_billing_at', v_sub.next_billing_at);
end
$fn$;

comment on function api_app_v1.subscription_cancel_undo(uuid) is
  '199(DB-4 A-2): 본인 구독(active/past_due) 해지 예약 취소 — cancel_at_period_end=false · cancel_requested_at=null. 멱등. 웹 undoSubscriptionCancelAtPeriodEndAction 동일.';

-- ── 권한 — authenticated 만(anon·PUBLIC·service_role 0 — M17 앱 계약) ────────────
revoke all on function api_app_v1.subscribe_with_cash(uuid, text, text) from public, anon;
revoke all on function api_app_v1.subscription_cancel_at_period_end(uuid) from public, anon;
revoke all on function api_app_v1.subscription_cancel_undo(uuid) from public, anon;
grant execute on function api_app_v1.subscribe_with_cash(uuid, text, text) to authenticated;
grant execute on function api_app_v1.subscription_cancel_at_period_end(uuid) to authenticated;
grant execute on function api_app_v1.subscription_cancel_undo(uuid) to authenticated;

-- ── 적용 직후 자가 검증 ───────────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%'
     and p.prorettype = 'jsonb'::regtype
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE')
     and (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%'))
     and (p.proname, pg_get_function_identity_arguments(p.oid)) in
         (('subscribe_with_cash', 'p_mentor_id uuid, p_tier text, p_idempotency_key text'),
          ('subscription_cancel_at_period_end', 'p_subscription_id uuid'),
          ('subscription_cancel_undo', 'p_subscription_id uuid'));
  if v_n <> 3 then
    raise exception '199_SELFCHECK: 함수 3종 identity/SECDEF/ACL 불일치(matched %)', v_n;
  end if;
  -- 위임 확인 — 정본 재구현 금지(F12·정본 confirm 호출이 본문에 있어야 한다)
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'api_app_v1' and p.proname = 'subscribe_with_cash'
                    and p.prosrc like '%api_web_v1.subscription_checkout_confirm_v2(%'
                    and p.prosrc not like '%record_subscription_cash_debit(%'
                    and p.prosrc not like '%insert into public.cash_ledger%') then
    raise exception '199_SELFCHECK: subscribe_with_cash 가 F12 에 위임하지 않거나 자금 로직을 복제했다';
  end if;
  -- 웹 표면 불변: F12 ACL(service_role 전용) 그대로
  if has_function_privilege('authenticated', 'api_web_v1.subscription_checkout_confirm_v2(uuid, uuid, integer, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'api_web_v1.subscription_checkout_confirm_v2(uuid, uuid, integer, text)', 'EXECUTE') then
    raise exception '199_SELFCHECK: F12 ACL 변경됨';
  end if;
end $$;

commit;
