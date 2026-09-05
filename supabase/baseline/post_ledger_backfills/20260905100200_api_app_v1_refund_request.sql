-- =============================================================================
-- 200_api_app_v1_refund_request.sql  (2026-09-05 · DB-4 묶음 B — 앱 환불 예상액 · 환불 신청)
--
-- 왜: `refunds` INSERT 는 `refund_ins` 정책(021)이 관리자만 허용해 앱이 환불을 신청할 수 없다(A-4a 판정표 #9).
--   웹은 `lib/subscribe/subscriptionCancelActions.ts` `requestSubscriptionProratedRefundAction`(service_role)이
--   학원법 시행령 별표 4 계산(`lib/subscribe/subscriptionRefundProration.ts` computeProratedRefundEstimate · student_voluntary)과
--   이용 개시 판정(`lib/subscribe/subscriptionUsageStarted.ts` — 기간 시작 이후 질문 스레드 1건 이상)을 TS 로 수행한다.
--   같은 계산을 SQL 로 옮기고(경계값 픽스처로 웹 TS 와 일치 검증 — scripts/verify/fixtures/db4_batch_post_fixture.sql · db4_refund_parity_expected.mjs)
--   앱이 부를 래퍼 2종을 `api_app_v1` 에 둔다. 웹 액션은 바꾸지 않는다(지시서 원칙 7).
--
-- B-0 core_private.subscription_refund_estimate_impl(p_subscription_id uuid, p_now timestamptz) returns jsonb  (외부 EXECUTE 0)
--   · 입력: subscriptions.current_period_start/end(없으면 최신 succeeded initial/renewal billing event 의 period) · 금액 = 그 billing event 의 amount_cents
--   · 이용 개시: mentor_id 없음 → true(보수) · 기간 시작 없음 → false · 방 없음 → false · 방의 question_threads.created_at >= 기간 시작 1건 이상 → true
--   · 분기(별표 4 · TS 와 동일): 금액 0 / 기간 없음 / end<=start → invalid(0) · 이용 개시 전 → 전액 · 경과 < 1/3 → floor(×2/3) · 경과 < 1/2 → floor(×1/2) · 그 외 0
--     경과율 비교는 ms 정수 교차곱(elapsed×3 < total · elapsed×2 < total)으로 JS 부동소수 결과와 정확히 같다. period_days = max(1, ceil(total/1일)) · remaining_days = ceil(remaining/1일).
--   · rule: '이용 개시 전' | '1/3 전' | '1/2 전' | '1/2 후' | '계산 불가' · bracket_reason: before_usage | lt_1_3 | lt_1_2 | ge_1_2 | invalid (TS 이름)
-- B-1 api_app_v1.refund_estimate(p_subscription_id uuid) returns jsonb — 본인 구독만(NOT_SUBSCRIPTION_OWNER) · impl(now())
-- B-2 api_app_v1.refund_request_create(p_subscription_id uuid, p_reason text) returns jsonb
--   · AUTH_REQUIRED → ROLE_NOT_STUDENT → ACCOUNT_BANNED / ACCOUNT_SUSPENDED / ACCOUNT_NOT_ACTIVE / ACCOUNT_DELETION_IN_PROGRESS →
--     REASON_TOO_SHORT(5자 미만 · 웹 동일) / REASON_TOO_LONG(2000자 초과 — 서버 위생 상한) → SUBSCRIPTION_NOT_FOUND / NOT_SUBSCRIPTION_OWNER →
--     SUBSCRIPTION_NOT_CURRENT(active/past_due 아님) → ALREADY_REQUESTED(pending 환불 존재 · refund_id) → REFUND_NOT_AVAILABLE(예상액 0 · rule 동봉)
--   · INSERT refunds {user_id, amount_cents=예상액, status 'pending', payment_id=billing event→구독, subscription_id, billing_event_id=billing event→last_billing_event_id,
--     request_type 'subscription_prorated', reason} — 웹 INSERT 와 동일 필드. 승인은 관리자(approve_refund_request_admin) 그대로.
--   · 부수 효과(웹과 동일): pending 환불이 생기면 142 게이트가 그 구독의 새 질문·후속 메시지·첨부를 SUBSCRIPTION_REFUND_PENDING 으로 잠근다. 알림 0(158 은 mentor_suspended 만).
--   · 반환 {ok, contract_version:1, refund_id, subscription_id, amount_cents, rule, bracket_reason, status:'pending'} — 지시서의 `returns uuid` 대신
--     api_app_v1 envelope 규약(§8)을 따른다(앱 오류 처리 통일 — 보고서에 명시).
-- 권한: 래퍼 2종 REVOKE public·anon · GRANT authenticated 만. impl 은 외부 EXECUTE 0(SECDEF 래퍼 소유자 문맥 전용).
--
-- 적용 전 실측(2026-09-05 운영 read-only): 환불 0 · 구독 0 → 데이터 영향 0.
-- Apply: 저장소 표준 경로(db-apply-pending). 순서 A(199) → B(200). pack 등재: supabase/baseline/post_ledger_backfills/20260905100200_api_app_v1_refund_request.sql
-- Rollback: supabase/rollback/20260905100200_api_app_v1_refund_request_rollback.sql
-- =============================================================================

begin;

-- ── 0. 사전 게이트 ─────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from pg_namespace where nspname in ('api_app_v1', 'core_private')) <> 2 then
    raise exception '200_GATE: api_app_v1/core_private 스키마 부재';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'refunds'
       and column_name in ('user_id','amount_cents','status','payment_id','subscription_id','billing_event_id','request_type','reason')) <> 8 then
    raise exception '200_GATE: refunds 컬럼 불일치(004·069·150)';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'subscriptions'
       and column_name in ('id','student_id','mentor_id','status','current_period_start','current_period_end','payment_id','last_billing_event_id')) <> 8 then
    raise exception '200_GATE: subscriptions 컬럼 불일치';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'subscription_billing_events'
       and column_name in ('id','subscription_id','amount_cents','payment_id','period_start','period_end','billing_at','event_type','status')) <> 9 then
    raise exception '200_GATE: subscription_billing_events 컬럼 불일치(064)';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'question_threads' and column_name = 'mentor_student_room_id') then
    raise exception '200_GATE: question_threads.mentor_student_room_id 부재';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'account_deletion_write_blocked') then
    raise exception '200_GATE: account_deletion_write_blocked 부재(151)';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where (n.nspname = 'api_app_v1' and p.proname in ('refund_estimate', 'refund_request_create'))
                 or (n.nspname = 'core_private' and p.proname = 'subscription_refund_estimate_impl')) then
    raise exception '200_GATE: 대상 함수가 이미 있다';
  end if;
end $$;

-- ── B-0. 별표 4 계산 정본(SQL) — 웹 computeProratedRefundEstimate(student_voluntary) + hasSubscriptionUsageStartedForPair 이식 ──
create function core_private.subscription_refund_estimate_impl(p_subscription_id uuid, p_now timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $fn$
declare
  v_sub record;
  v_ev record;
  v_room uuid;
  v_now timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_amount bigint;
  v_usage boolean;
  v_total_ms numeric;
  v_elapsed_ms numeric;
  v_remaining_ms numeric;
  v_refund bigint;
  v_bracket text;
  v_rule text;
begin
  if p_subscription_id is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_NOT_FOUND');
  end if;
  select s.id, s.student_id, s.mentor_id, s.status, s.current_period_start, s.current_period_end, s.payment_id, s.last_billing_event_id
    into v_sub from public.subscriptions s where s.id = p_subscription_id;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_NOT_FOUND');
  end if;

  -- 최신 succeeded initial/renewal (웹 latestSucceededBillingEvent: billing_at desc limit 1)
  select e.id, e.amount_cents, e.payment_id, e.period_start, e.period_end
    into v_ev
    from public.subscription_billing_events e
   where e.subscription_id = v_sub.id and e.status = 'succeeded' and e.event_type in ('initial', 'renewal')
   order by e.billing_at desc
   limit 1;

  v_start := coalesce(v_sub.current_period_start, v_ev.period_start);
  v_end := coalesce(v_sub.current_period_end, v_ev.period_end);
  v_amount := greatest(0, coalesce(v_ev.amount_cents, 0));

  -- 이용 개시(첫 질문 작성) — 웹 hasSubscriptionUsageStartedForPair 동일 순서
  if v_sub.mentor_id is null then
    v_usage := true;   -- 멘토 미상(이상 데이터)은 보수적으로 개시로 본다(웹 동일)
  elsif v_start is null then
    v_usage := false;
  else
    select r.id into v_room from public.mentor_student_rooms r
     where r.student_id = v_sub.student_id and r.mentor_id = v_sub.mentor_id limit 1;
    if v_room is null then
      v_usage := false;
    else
      v_usage := exists (select 1 from public.question_threads t
                          where t.mentor_student_room_id = v_room and t.created_at >= v_start);
    end if;
  end if;

  -- JS Date 는 ms 정밀도 — 동일하게 ms 로 절단한다
  v_now := date_trunc('milliseconds', coalesce(p_now, now()));
  v_start := date_trunc('milliseconds', v_start);
  v_end := date_trunc('milliseconds', v_end);

  if v_amount = 0 or v_start is null or v_end is null or v_end <= v_start then
    return jsonb_build_object('ok', true, 'contract_version', 1, 'subscription_id', v_sub.id,
      'refundable_cents', 0, 'amount_cents', v_amount, 'rule', '계산 불가', 'bracket_reason', 'invalid',
      'usage_started', v_usage, 'elapsed_days', 0, 'period_days', 0, 'remaining_days', 0,
      'remaining_ratio', 0, 'elapsed_ratio', 0, 'period_start', v_start, 'period_end', v_end,
      'billing_event_id', v_ev.id, 'billing_payment_id', v_ev.payment_id, 'as_of', v_now);
  end if;

  v_total_ms := (extract(epoch from v_end) - extract(epoch from v_start)) * 1000;
  v_elapsed_ms := greatest(0, (extract(epoch from v_now) - extract(epoch from v_start)) * 1000);
  v_remaining_ms := greatest(0, (extract(epoch from v_end) - extract(epoch from v_now)) * 1000);

  if v_usage = false then
    v_refund := v_amount; v_bracket := 'before_usage'; v_rule := '이용 개시 전';
  elsif v_elapsed_ms * 3 < v_total_ms then
    v_refund := (v_amount * 2) / 3; v_bracket := 'lt_1_3'; v_rule := '1/3 전';
  elsif v_elapsed_ms * 2 < v_total_ms then
    v_refund := v_amount / 2; v_bracket := 'lt_1_2'; v_rule := '1/2 전';
  else
    v_refund := 0; v_bracket := 'ge_1_2'; v_rule := '1/2 후';
  end if;

  return jsonb_build_object('ok', true, 'contract_version', 1, 'subscription_id', v_sub.id,
    'refundable_cents', v_refund, 'amount_cents', v_amount, 'rule', v_rule, 'bracket_reason', v_bracket,
    'usage_started', v_usage,
    'elapsed_days', floor(v_elapsed_ms / 86400000)::int,
    'period_days', greatest(1, ceil(v_total_ms / 86400000)::int),
    'remaining_days', ceil(v_remaining_ms / 86400000)::int,
    'remaining_ratio', round(least(1, v_remaining_ms / v_total_ms), 6),
    'elapsed_ratio', round(least(1, v_elapsed_ms / v_total_ms), 6),
    'period_start', v_start, 'period_end', v_end,
    'billing_event_id', v_ev.id, 'billing_payment_id', v_ev.payment_id, 'as_of', v_now);
end
$fn$;

comment on function core_private.subscription_refund_estimate_impl(uuid, timestamptz) is
  '200(DB-4 B-0): 학원법 별표 4 구독 환불 예상액 — 웹 computeProratedRefundEstimate(student_voluntary)·hasSubscriptionUsageStartedForPair 의 SQL 이식(경계 교차곱 비교). 외부 EXECUTE 0.';

revoke all on function core_private.subscription_refund_estimate_impl(uuid, timestamptz) from public, anon, authenticated, service_role;

-- ── B-1. refund_estimate ──────────────────────────────────────────────────────
create function api_app_v1.refund_estimate(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;
  if p_subscription_id is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_NOT_FOUND');
  end if;
  select s.student_id into v_owner from public.subscriptions s where s.id = p_subscription_id;
  if not found then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_NOT_FOUND');
  end if;
  if v_owner is distinct from v_uid then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'NOT_SUBSCRIPTION_OWNER');
  end if;
  return core_private.subscription_refund_estimate_impl(p_subscription_id, now());
end
$fn$;

comment on function api_app_v1.refund_estimate(uuid) is
  '200(DB-4 B-1): 본인 구독 환불 예상액(별표 4) — {refundable_cents, rule, bracket_reason, elapsed_days, period_days, remaining_days, usage_started …}. 캐시 충전 유도 없음.';

-- ── B-2. refund_request_create ────────────────────────────────────────────────
create function api_app_v1.refund_request_create(p_subscription_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_uid uuid := (select auth.uid());
  v_role text; v_status text; v_susp timestamptz; v_norm text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_sub record;
  v_pending uuid;
  v_est jsonb;
  v_amount bigint;
  v_refund_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'AUTH_REQUIRED');
  end if;
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
  if char_length(v_reason) < 5 then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'REASON_TOO_SHORT', 'min_length', 5);
  end if;
  if char_length(v_reason) > 2000 then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'REASON_TOO_LONG', 'max_length', 2000);
  end if;
  if p_subscription_id is null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'SUBSCRIPTION_NOT_FOUND');
  end if;

  -- 본인 구독 잠금(동시 중복 신청 직렬화) · 현재 구독만
  select s.id, s.student_id, s.status, s.payment_id, s.last_billing_event_id
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
  select r.id into v_pending from public.refunds r
   where r.user_id = v_uid and r.subscription_id = p_subscription_id and r.status = 'pending'
   order by r.created_at desc limit 1;
  if v_pending is not null then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'ALREADY_REQUESTED', 'refund_id', v_pending);
  end if;

  v_est := core_private.subscription_refund_estimate_impl(p_subscription_id, now());
  if not coalesce((v_est ->> 'ok')::boolean, false) then
    return v_est;
  end if;
  v_amount := coalesce((v_est ->> 'refundable_cents')::bigint, 0);
  if v_amount <= 0 then
    return jsonb_build_object('ok', false, 'contract_version', 1, 'code', 'REFUND_NOT_AVAILABLE',
                              'rule', v_est ->> 'rule', 'bracket_reason', v_est ->> 'bracket_reason');
  end if;

  insert into public.refunds (user_id, amount_cents, status, payment_id, subscription_id, billing_event_id, request_type, reason)
  values (v_uid, v_amount, 'pending',
          coalesce((v_est ->> 'billing_payment_id')::uuid, v_sub.payment_id),
          p_subscription_id,
          coalesce((v_est ->> 'billing_event_id')::uuid, v_sub.last_billing_event_id),
          'subscription_prorated', v_reason)
  returning id into v_refund_id;

  return jsonb_build_object('ok', true, 'contract_version', 1, 'refund_id', v_refund_id,
                            'subscription_id', p_subscription_id, 'amount_cents', v_amount,
                            'rule', v_est ->> 'rule', 'bracket_reason', v_est ->> 'bracket_reason', 'status', 'pending');
end
$fn$;

comment on function api_app_v1.refund_request_create(uuid, text) is
  '200(DB-4 B-2): 본인 구독(active/past_due) 환불 신청 — 사유 5자 이상 · pending 중복 ALREADY_REQUESTED · 예상액 0 REFUND_NOT_AVAILABLE · refunds pending INSERT(subscription_prorated). 승인은 관리자. 웹 requestSubscriptionProratedRefundAction 동일.';

-- ── 권한 ───────────────────────────────────────────────────────────────────────
revoke all on function api_app_v1.refund_estimate(uuid) from public, anon;
revoke all on function api_app_v1.refund_request_create(uuid, text) from public, anon;
grant execute on function api_app_v1.refund_estimate(uuid) to authenticated;
grant execute on function api_app_v1.refund_request_create(uuid, text) to authenticated;

-- ── 적용 직후 자가 검증 ───────────────────────────────────────────────────────
do $$
declare v_n integer; v_oid oid;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_app_v1'
     and p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE')
     and (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%'))
     and (p.proname, pg_get_function_identity_arguments(p.oid)) in
         (('refund_estimate', 'p_subscription_id uuid'),
          ('refund_request_create', 'p_subscription_id uuid, p_reason text'));
  if v_n <> 2 then
    raise exception '200_SELFCHECK: 래퍼 2종 identity/SECDEF/ACL 불일치(matched %)', v_n;
  end if;
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'core_private' and p.proname = 'subscription_refund_estimate_impl'
     and pg_get_function_identity_arguments(p.oid) = 'p_subscription_id uuid, p_now timestamp with time zone'
     and not p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%';
  if v_oid is null then
    raise exception '200_SELFCHECK: impl identity/attributes 불일치';
  end if;
  if has_function_privilege('anon', v_oid, 'EXECUTE') or has_function_privilege('authenticated', v_oid, 'EXECUTE')
     or has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception '200_SELFCHECK: impl 외부 EXECUTE 는 0 이어야 한다';
  end if;
  -- refund_ins 정책(관리자만) 불변 — 앱 직접 INSERT 는 여전히 거부된다
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'refunds' and policyname = 'refund_ins'
                   and with_check like '%is_admin()%' and with_check not like '%auth.uid()%') then
    raise exception '200_SELFCHECK: refund_ins 정책이 바뀌었다';
  end if;
end $$;

commit;
