-- =============================================================================
-- scripts/verify/s2_2_batch_e_verify.sql
-- S2-2 Batch E (M9 money_rpc — F11 3층 + F12) 반복 검증 스크립트
-- =============================================================================
-- 실행 전제:
--   * 격리 로컬 Supabase 스택(PG17)에 clean-install 186(baseline 177 + B 3 + C 3
--     + D 3) 위에서 사용한다.
--   * 운영·staging 오실행 방지 — 러너가 같은 세션에서 먼저 실행해야 한다:
--       set s2_verify.allow_local = 'on';
--   * phase 스위치:
--       set s2_verify.phase = 'forward'        -- M9 적용 직후 (기본값)
--       set s2_verify.phase = 'post_rollback'  -- M9 rollback 직후
--   * pre-M9 스냅샷(러너가 M9 적용 전에 채워서 전달):
--       set s2_verify.pre_m9_topup_md5   = md5(020 record_cash_topup prosrc)
--       set s2_verify.pre_m9_confirm_md5 = md5(145 confirm_subscription_checkout prosrc)
--   * 동시성(T-CONC-02·03·04·08 + T-TOP-04 병행분)은 단일 세션 스크립트로 검증
--     불가 — 별도 2세션 러너(run_batch_e_concurrency.sh)가 수행하고 결과를 audit
--     문서에 기록한다(§21.10). T-CONC-09 는 단일 세션 등가 검증이 가능하므로 이
--     스크립트가 소유한다(재생은 현재 플랜 가격을 읽지 않는다 — §7 F12).
--   * 모든 fixture DML(s2e-vf-*) 은 단일 트랜잭션에서 수행하고 마지막에 rollback.
--     실사용 규모(auth.users > 50행) 감지 시 중단.
-- 판정: s2_results 에 PASS/FAIL 기록 → FAIL ≥1 이면 S2_BATCH_E_VERIFY_FAILED.
-- 근거 계약: api_web_v1_contract_v1_1.md §7 F11(3층)·F12(Phase 1/2·9단계) · §8 ·
--   §9.6·§9.8(17종 동명) · §10.3 · §12.2/[C3] · §21.4 T-FIN-01~04 · §21.8 T-REP-A~H ·
--   §21.9 T-TOP-01~06 · §21.3 T-CONC-09 · T-PERM-06.
-- =============================================================================

begin;

do $$
declare
  v_allow text := current_setting('s2_verify.allow_local', true);
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_users bigint;
begin
  if v_allow is distinct from 'on' then
    raise exception 'S2_VERIFY_LOCAL_GUARD: s2_verify.allow_local=on 이 설정되지 않았다. 격리 로컬 스택 전용.'
      using errcode = '42501';
  end if;
  if v_phase not in ('forward', 'post_rollback') then
    raise exception 'S2_VERIFY_PHASE: s2_verify.phase 는 forward|post_rollback 이어야 한다 (현재 %)', v_phase;
  end if;
  select count(*) into v_users from auth.users;
  if v_users > 50 then
    raise exception 'S2_VERIFY_LOCAL_GUARD: auth.users % 행 — 실사용 규모 감지, 중단.', v_users
      using errcode = '42501';
  end if;
end $$;

create temporary table s2_results (
  seq serial primary key, grp text not null, test text not null,
  pass boolean not null, detail text
);
create temporary table s2_fx (k text primary key, v uuid not null);

-- 로컬 auto-expose 기본값은 클라이언트 role 에 SELECT 가 없다(Batch A 검증기 선례).
-- 운영·스테이징의 service_role 레거시 SELECT 상태를 재현하는 최소 grant 를 이
-- 트랜잭션 안에서만 부여한다 — 마지막 rollback 으로 파기된다(카탈로그 불변).
grant select on public.cash_wallets, public.cash_ledger, public.payments,
                public.subscriptions, public.mentor_student_rooms,
                public.mentor_plans, public.subscription_checkout_anomalies
  to service_role;

-- =============================================================================
-- 1. [forward] 카탈로그 — M9 객체·속성·GRANT (T-PERM-06 상당)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_cnt int;
  v_pre_confirm text := current_setting('s2_verify.pre_m9_confirm_md5', true);
  v_pre_topup   text := current_setting('s2_verify.pre_m9_topup_md5', true);
  v_md5 text;
  v_ok boolean; v_det text;
  v_res jsonb;
begin
  if v_phase <> 'forward' then return; end if;

  -- E-01: F11i — identity·SECURITY INVOKER·pinned search_path·외부 EXECUTE 전부 0
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'core_private' and p.proname = 'record_cash_topup_impl'
     and pg_get_function_identity_arguments(p.oid)
         = 'p_user_id uuid, p_amount_cents bigint, p_idempotency_key text'
     and not p.prosecdef and p.proconfig::text like '%search_path=%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE')
     and (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%'));
  v_ok := v_cnt = 1
          and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'core_private') = 6;
  insert into s2_results(grp,test,pass,detail) values
    ('M9','01 F11i INVOKER+search_path+외부 EXECUTE 0 + core_private census 6',
     coalesce(v_ok,false), 'matched='||v_cnt);

  -- E-02: F11·F12 — SECDEF·search_path·service_role 전용 + census 14 + 레거시 불변
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api_web_v1'
     and p.prosecdef and p.proconfig::text like '%search_path=%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and has_function_privilege('service_role', p.oid, 'EXECUTE')
     and (p.proacl is null or (p.proacl::text not like '{=%' and p.proacl::text not like '%,=%'))
     and (p.proname, pg_get_function_identity_arguments(p.oid)) in
         (('record_cash_topup_v2', 'p_user_id uuid, p_amount_cents bigint, p_order_ref text'),
          ('subscription_checkout_confirm_v2', 'p_payment_id uuid, p_plan_id uuid, p_expected_amount_cents integer, p_idempotency_key text'));
  v_ok := v_cnt = 2
          and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'api_web_v1') = 14;
  v_det := 'entry='||v_cnt;
  -- 레거시 2층: 시그니처·void·SECDEF·service_role 전용 + impl 위임 + prosrc 교체 확인
  select md5(p.prosrc) into v_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_cash_topup'
     and p.prorettype = 'void'::regtype and p.prosecdef
     and p.prosrc like '%core_private.record_cash_topup_impl%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and has_function_privilege('service_role', p.oid, 'EXECUTE');
  v_ok := v_ok and v_md5 is not null
          and (v_pre_topup is null or v_pre_topup = '' or v_md5 is distinct from v_pre_topup);
  -- 정본 confirm_subscription_checkout 은 M9 가 건드리지 않는다(md5 불변)
  select md5(p.prosrc) into v_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'confirm_subscription_checkout';
  v_ok := v_ok and (v_pre_confirm is null or v_pre_confirm = '' or v_md5 = v_pre_confirm);
  -- 실행 거부 실측: authenticated 로 F11 호출 → 42501
  begin
    execute 'set local role authenticated';
    v_res := api_web_v1.record_cash_topup_v2('00000000-0000-0000-0000-000000000001'::uuid, 1000, 'cash-x-1');
    execute 'reset role';
    v_ok := false; v_det := v_det || ' | authenticated 호출이 거부되지 않음';
  exception when insufficient_privilege then
    execute 'reset role';
    v_det := v_det || ' | auth 42501';
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('M9','02 F11·F12 service_role 전용 + census 14 + 레거시 본문 교체·정본 불변',
     coalesce(v_ok,false), left(v_det,160));
end $$;

-- =============================================================================
-- 2. [forward] T-TOP 01~06 + T-FIN-01·02 — F11 3층 (fixture: s2e-vf-*)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_s1 uuid := gen_random_uuid();
  v_s2 uuid := gen_random_uuid();
  v_m1 uuid := gen_random_uuid();
  v_m2 uuid := gen_random_uuid();
  v_mpend uuid := gen_random_uuid();
  v_key1 text; v_key2 text;
  v_bal bigint; v_cnt int;
  v_res jsonb; v_res2 jsonb;
  v_ok boolean; v_det text;
begin
  if v_phase <> 'forward' then return; end if;

  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at)
  values
    (v_s1,    's2e-vf-s1@example.invalid', '{"app_role":"student","nickname":"자금학생일"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_s2,    's2e-vf-s2@example.invalid', '{"app_role":"student","nickname":"자금학생이"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_m1,    's2e-vf-m1@example.invalid', '{"app_role":"mentor","nickname":"자금멘토일"}'::jsonb,  '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_m2,    's2e-vf-m2@example.invalid', '{"app_role":"mentor","nickname":"자금멘토이"}'::jsonb,  '{}'::jsonb, 'authenticated', 'authenticated', now(), now()),
    (v_mpend, 's2e-vf-m3@example.invalid', '{"app_role":"mentor","nickname":"자금미승인"}'::jsonb,  '{}'::jsonb, 'authenticated', 'authenticated', now(), now());
  update public.mentor_profiles set verification_status = 'approved' where user_id in (v_m1, v_m2);
  insert into s2_fx values ('s1', v_s1), ('s2', v_s2), ('m1', v_m1), ('m2', v_m2), ('mpend', v_mpend);

  v_key1 := 'cash-' || v_s1 || '-1000000001';
  v_key2 := 'cash-' || v_s1 || '-1000000002';

  -- E-03: T-TOP-01/02/03 — 레거시 3인자 계약 불변(신규 → duplicate 무음 → 충돌 무음)
  begin
    execute 'set local role service_role';
    perform public.record_cash_topup(v_s1, 3000000, v_key1);           -- T-TOP-01 신규
    select balance_cents into v_bal from public.cash_wallets where user_id = v_s1;
    v_ok := v_bal = 3000000
            and (select count(*) from public.cash_ledger where idempotency_key = v_key1) = 1;
    perform public.record_cash_topup(v_s1, 3000000, v_key1);           -- T-TOP-02 동일 duplicate
    select balance_cents into v_bal from public.cash_wallets where user_id = v_s1;
    v_ok := v_ok and v_bal = 3000000;
    perform public.record_cash_topup(v_s1, 999, v_key1);               -- T-TOP-03 충돌 duplicate
    execute 'reset role';
    select balance_cents into v_bal from public.cash_wallets where user_id = v_s1;
    v_ok := v_ok and v_bal = 3000000
            and (select count(*) from public.cash_ledger where idempotency_key = v_key1) = 1
            and (select delta_cents from public.cash_ledger where idempotency_key = v_key1) = 3000000;
    v_det := 'bal='||v_bal;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-TOP','03 레거시 신규+동일 무음+충돌 무음(지갑 1회 가산)', coalesce(v_ok,false), left(v_det,160));

  -- E-04: T-TOP-05/06 + T-FIN-01 — F11 신규/동일 duplicate/충돌 + 혼합 흐름 지갑 1회
  begin
    execute 'set local role service_role';
    v_res := api_web_v1.record_cash_topup_v2(v_s1, 3000000, v_key2);   -- 신규
    v_res2 := api_web_v1.record_cash_topup_v2(v_s1, 3000000, v_key2);  -- 동일 duplicate
    execute 'reset role';
    v_ok := (v_res->>'ok')::boolean and (v_res->>'duplicate')::boolean = false
            and (v_res->>'contract_version')::int = 1
            and (v_res->>'balance_cents')::bigint = 6000000
            and (v_res2->>'ok')::boolean and (v_res2->>'duplicate')::boolean = true
            -- T-FIN-01: idempotency_key = orderId · ref_id NULL · ref_type='topup'
            and (select count(*) from public.cash_ledger
                  where idempotency_key = v_key2 and ref_id is null
                    and ref_type = 'topup' and reason = 'cash_topup' and delta_cents = 3000000) = 1;
    v_det := 'dup='||coalesce(v_res2->>'duplicate','?');
    -- 충돌 duplicate(같은 키·다른 금액) → LEDGER_FIELD_MISMATCH (T-TOP-06)
    execute 'set local role service_role';
    v_res := api_web_v1.record_cash_topup_v2(v_s1, 1234, v_key2);
    -- 혼합 흐름: 레거시가 만든 행(v_key1)을 F11 로 재생 → duplicate:true (T-TOP-05)
    v_res2 := api_web_v1.record_cash_topup_v2(v_s1, 3000000, v_key1);
    execute 'reset role';
    select balance_cents into v_bal from public.cash_wallets where user_id = v_s1;
    v_ok := v_ok and v_res->>'code' = 'LEDGER_FIELD_MISMATCH'
            and (v_res2->>'ok')::boolean and (v_res2->>'duplicate')::boolean = true
            and v_bal = 6000000;
    v_det := v_det || ' | ' || coalesce(v_res->>'code','?') || ' | bal='||v_bal;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-TOP','04 F11 신규·동일 dup·충돌 LEDGER_FIELD_MISMATCH·혼합 지갑 1회', coalesce(v_ok,false), left(v_det,160));

  -- E-05: F11 형식·소유자 — ORDER_REF_INVALID / ORDER_REF_OWNER_MISMATCH (T-FIN-02)
  begin
    execute 'set local role service_role';
    v_res := api_web_v1.record_cash_topup_v2(v_s1, 1000, 'cash_topup_' || v_s1 || '_123_abc'); -- 테스트 충전 형식 기각
    v_ok := v_res->>'code' = 'ORDER_REF_INVALID';
    v_det := coalesce(v_res->>'code','?');
    v_res := api_web_v1.record_cash_topup_v2(v_s1, 1000, 'cash-' || v_s1);                      -- 말미 숫자 없음
    v_ok := v_ok and v_res->>'code' = 'ORDER_REF_INVALID';
    v_det := v_det || '/' || coalesce(v_res->>'code','?');
    v_res := api_web_v1.record_cash_topup_v2(v_s1, 1000, 'cash-' || v_s2 || '-1000000003');     -- 타인 orderId
    v_ok := v_ok and v_res->>'code' = 'ORDER_REF_OWNER_MISMATCH';
    v_res2 := api_web_v1.record_cash_topup_v2(v_s1, 1000, 'cash-notauuid-999');                 -- uuid 아님
    execute 'reset role';
    v_ok := v_ok and v_res2->>'code' = 'ORDER_REF_OWNER_MISMATCH'
            -- T-FIN-02: 원장 0행 + 지갑 불변
            and (select count(*) from public.cash_ledger
                  where idempotency_key = 'cash-' || v_s2 || '-1000000003') = 0
            and (select balance_cents from public.cash_wallets where user_id = v_s1) = 6000000;
    v_det := v_det || '/' || coalesce(v_res->>'code','?') || '/' || coalesce(v_res2->>'code','?');
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-TOP','05 형식 강제(테스트 충전 형식 포함 기각)+소유자 재검증+원장 0행', coalesce(v_ok,false), left(v_det,160));
end $$;

-- =============================================================================
-- 3. [forward] F12 최초 실행 — 성공·3자 일치·잔액·17종 변환 (T-FIN-03·04)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_s1 uuid; v_s2 uuid; v_m1 uuid; v_mpend uuid;
  v_plan1 uuid; v_planp uuid;
  v_p1 uuid; v_p2 uuid; v_ps2 uuid; v_pstale uuid; v_pkind uuid; v_pcur uuid; v_pmp uuid;
  v_sub uuid; v_room uuid;
  v_res jsonb;
  v_bal bigint;
  v_ok boolean; v_det text;
begin
  if v_phase <> 'forward' then return; end if;
  select v into v_s1 from s2_fx where k = 's1';
  select v into v_s2 from s2_fx where k = 's2';
  select v into v_m1 from s2_fx where k = 'm1';
  select v into v_mpend from s2_fx where k = 'mpend';

  -- 멘토 시드 트리거가 기본 플랜 행을 만들 수 있으므로 (mentor_id, plan_tier) upsert
  insert into public.mentor_plans (mentor_id, plan_tier, amount_cents)
  values (v_m1, 'limited', 2990000)
  on conflict (mentor_id, plan_tier) do update set amount_cents = excluded.amount_cents
  returning id into v_plan1;
  insert into public.mentor_plans (mentor_id, plan_tier, amount_cents)
  values (v_mpend, 'limited', 2990000)
  on conflict (mentor_id, plan_tier) do update set amount_cents = excluded.amount_cents
  returning id into v_planp;
  insert into public.payments (user_id, mentor_id, amount, currency, status, kind, plan_id)
  values (v_s1, v_m1, 29900, 'KRW', 'pending', 'subscription', v_plan1) returning id into v_p1;
  insert into s2_fx values ('plan1', v_plan1), ('p1', v_p1);

  -- E-06: 최초 성공 — envelope·방 불변조건·원장·지갑·payments 상태 (§7 F12 순서 1~8)
  begin
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p1, v_plan1, 2990000);
    execute 'reset role';
    v_sub := (v_res->>'subscription_id')::uuid;
    v_room := (v_res->>'room_id')::uuid;
    select balance_cents into v_bal from public.cash_wallets where user_id = v_s1;
    v_ok := (v_res->>'ok')::boolean and (v_res->>'contract_version')::int = 1
            and v_res->>'payment_status' = 'succeeded'
            and (v_res->>'amount_cents')::int = 2990000
            and (v_res->>'reactivated')::boolean = false
            and v_sub is not null and v_room is not null
            and v_bal = 3010000
            and (select count(*) from public.subscriptions
                  where id = v_sub and student_id = v_s1 and mentor_id = v_m1
                    and status = 'active' and last_payment_id = v_p1) = 1
            and (select count(*) from public.cash_ledger
                  where idempotency_key = 'sub_debit_' || v_p1::text
                    and delta_cents = -2990000 and ref_type = 'subscriptions' and ref_id = v_sub) = 1
            and (select count(*) from public.payments
                  where id = v_p1 and status = 'succeeded' and plan_id = v_plan1) = 1
            and (select count(*) from public.mentor_student_rooms
                  where id = v_room and student_id = v_s1 and mentor_id = v_m1
                    and subscription_id = v_sub and payment_id = v_p1) = 1;
    v_det := 'bal='||v_bal;
    insert into s2_fx values ('sub', v_sub), ('room', v_room);
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('F12','06 최초 확정 성공(room_id 포함·원장·지갑·상태 전이)', coalesce(v_ok,false), left(v_det,160));

  -- E-07: T-FIN-03(3자 불일치 → PLAN_AMOUNT_CHANGED 차감 0) + T-FIN-04(잔액 부족)
  begin
    insert into public.payments (user_id, mentor_id, amount, currency, status, kind, plan_id)
    values (v_s2, v_m1, 29900, 'KRW', 'pending', 'subscription', v_plan1) returning id into v_ps2;
    insert into s2_fx values ('ps2', v_ps2);
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_ps2, v_plan1, 9999999);  -- 동의 금액 불일치
    execute 'reset role';
    v_ok := v_res->>'code' = 'PLAN_AMOUNT_CHANGED'
            and (v_res->>'expected_amount_cents')::int = 9999999
            and (v_res->>'actual_amount_cents')::int = 2990000
            and (select status from public.payments where id = v_ps2) = 'pending'
            and (select count(*) from public.cash_ledger
                  where idempotency_key = 'sub_debit_' || v_ps2::text) = 0;
    v_det := coalesce(v_res->>'code','?');
    -- T-FIN-04: s2 지갑 없음 → CASH_INSUFFICIENT, 구독 생성 안 됨
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_ps2, v_plan1, 2990000);
    execute 'reset role';
    v_ok := v_ok and v_res->>'code' = 'CASH_INSUFFICIENT'
            and (select count(*) from public.subscriptions
                  where student_id = v_s2 and mentor_id = v_m1) = 0
            and (select status from public.payments where id = v_ps2) = 'pending';
    v_det := v_det || '/' || coalesce(v_res->>'code','?');
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('F12','07 PLAN_AMOUNT_CHANGED 차감 0 + CASH_INSUFFICIENT 구독 0', coalesce(v_ok,false), left(v_det,160));

  -- E-08: 오류 변환 전수 표본 — F12 자체 검증 코드 + 정본 raise 17종 동명 변환
  begin
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(gen_random_uuid(), v_plan1, 2990000);
    v_ok := v_res->>'code' = 'PAYMENT_NOT_FOUND';
    v_det := coalesce(v_res->>'code','?');
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_ps2, gen_random_uuid(), 2990000);
    v_ok := v_ok and v_res->>'code' = 'PLAN_NOT_FOUND';
    v_det := v_det || '/' || coalesce(v_res->>'code','?');
    execute 'reset role';
    -- kind ≠ subscription → PAYMENT_KIND_INVALID (구현 결정 — 사전 동명)
    insert into public.payments (user_id, mentor_id, amount, currency, status, kind, plan_id)
    values (v_s2, v_m1, 29900, 'KRW', 'pending', 'cash_topup', v_plan1) returning id into v_pkind;
    -- currency ≠ KRW → PAYMENT_STATE_UNEXPECTED (구현 결정 — 사전 동명)
    insert into public.payments (user_id, mentor_id, amount, currency, status, kind, plan_id)
    values (v_s2, v_m1, 29900, 'USD', 'pending', 'subscription', v_plan1) returning id into v_pcur;
    -- 30분 초과 → 정본 raise PAYMENT_STALE 변환
    insert into public.payments (user_id, mentor_id, amount, currency, status, kind, plan_id, created_at)
    values (v_s2, v_m1, 29900, 'KRW', 'pending', 'subscription', v_plan1, now() - interval '1 hour') returning id into v_pstale;
    -- 미승인 멘토 → 정본 raise MENTOR_NOT_APPROVED 변환
    insert into public.payments (user_id, mentor_id, amount, currency, status, kind, plan_id)
    values (v_s1, v_mpend, 29900, 'KRW', 'pending', 'subscription', v_planp) returning id into v_pmp;
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_pkind, v_plan1, 2990000);
    v_ok := v_ok and v_res->>'code' = 'PAYMENT_KIND_INVALID';
    v_det := v_det || '/' || coalesce(v_res->>'code','?');
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_pcur, v_plan1, 2990000);
    v_ok := v_ok and v_res->>'code' = 'PAYMENT_STATE_UNEXPECTED';
    v_det := v_det || '/' || coalesce(v_res->>'code','?');
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_pstale, v_plan1, 2990000);
    v_ok := v_ok and v_res->>'code' = 'PAYMENT_STALE';
    v_det := v_det || '/' || coalesce(v_res->>'code','?');
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_pmp, v_planp, 2990000);
    execute 'reset role';
    v_ok := v_ok and v_res->>'code' = 'MENTOR_NOT_APPROVED'
            and (select balance_cents from public.cash_wallets where user_id = v_s1) = 3010000;
    v_det := v_det || '/' || coalesce(v_res->>'code','?');
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('F12','08 오류 변환(자체 4종 + 정본 raise 2종 표본, 차감 0)', coalesce(v_ok,false), left(v_det,160));

  -- E-09: 재구독 P2 — reactivated·last_payment_id·room.payment_id 최신 참조 갱신
  begin
    insert into public.payments (user_id, mentor_id, amount, currency, status, kind, plan_id)
    values (v_s1, v_m1, 29900, 'KRW', 'pending', 'subscription', v_plan1) returning id into v_p2;
    insert into s2_fx values ('p2', v_p2);
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p2, v_plan1, 2990000);
    execute 'reset role';
    select balance_cents into v_bal from public.cash_wallets where user_id = v_s1;
    v_ok := (v_res->>'ok')::boolean and (v_res->>'reactivated')::boolean = true
            and (v_res->>'room_id')::uuid = v_room
            and v_bal = 20000
            and (select count(*) from public.subscriptions
                  where student_id = v_s1 and mentor_id = v_m1) = 1
            and (select last_payment_id from public.subscriptions where id = v_sub) = v_p2
            and (select payment_id from public.mentor_student_rooms where id = v_room) = v_p2
            and (select count(*) from public.cash_ledger
                  where idempotency_key = 'sub_debit_' || v_p2::text and delta_cents = -2990000) = 1;
    v_det := 'bal='||v_bal;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('F12','09 재구독(reactivated·last=P2·room 최신 참조 갱신)', coalesce(v_ok,false), left(v_det,160));
end $$;

-- =============================================================================
-- 4. [forward] T-REP-A~H + T-CONC-09 등가 — F12 재생 계약 (fixture 기반 회귀 계약:
--    현재 라이브 DB 는 pair 당 succeeded 결제가 최대 1건이므로 P1→P2 시나리오는
--    실데이터 검증 주장이 아니라 재구독·늦은 재생 회귀 계약이다 — §21.8)
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_s1 uuid; v_s2 uuid; v_m1 uuid; v_m2 uuid;
  v_plan1 uuid; v_p1 uuid; v_p2 uuid; v_ps2 uuid; v_sub uuid; v_room uuid;
  v_pg uuid;
  v_res jsonb;
  v_bal0 bigint; v_bal1 bigint; v_led0 bigint; v_led1 bigint; v_anom0 bigint; v_anom1 bigint;
  v_detail text;
  v_ok boolean; v_det text;
begin
  if v_phase <> 'forward' then return; end if;
  select v into v_s1 from s2_fx where k = 's1';
  select v into v_s2 from s2_fx where k = 's2';
  select v into v_m1 from s2_fx where k = 'm1';
  select v into v_m2 from s2_fx where k = 'm2';
  select v into v_plan1 from s2_fx where k = 'plan1';
  select v into v_p1 from s2_fx where k = 'p1';
  select v into v_p2 from s2_fx where k = 'p2';
  select v into v_ps2 from s2_fx where k = 'ps2';
  select v into v_sub from s2_fx where k = 'sub';
  select v into v_room from s2_fx where k = 'room';

  select balance_cents into v_bal0 from public.cash_wallets where user_id = v_s1;
  select count(*) into v_led0 from public.cash_ledger where user_id = v_s1;
  select count(*) into v_anom0 from public.subscription_checkout_anomalies;

  -- E-10: T-REP-A — 늦은 재생(P1, room=C=P2) → idempotent·room 변경 0·자금 0·anomaly 0
  begin
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p1, v_plan1, 2990000);
    execute 'reset role';
    select balance_cents into v_bal1 from public.cash_wallets where user_id = v_s1;
    select count(*) into v_led1 from public.cash_ledger where user_id = v_s1;
    select count(*) into v_anom1 from public.subscription_checkout_anomalies;
    v_ok := (v_res->>'ok')::boolean and (v_res->>'idempotent')::boolean = true
            and (v_res->>'contract_version')::int = 1
            and v_res->>'payment_status' = 'succeeded'
            and (v_res->>'subscription_id')::uuid = v_sub
            and (v_res->>'room_id')::uuid = v_room
            and (select payment_id from public.mentor_student_rooms where id = v_room) = v_p2
            and v_bal1 = v_bal0 and v_led1 = v_led0 and v_anom1 = v_anom0;
    v_det := coalesce(v_res->>'idempotent','?');
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-REP','10 A: 늦은 재생 무부작용 멱등 성공', coalesce(v_ok,false), left(v_det,160));

  -- E-11: T-REP-B — stale room(P1) → 검증 통과 후 C=P2 로 복구
  begin
    update public.mentor_student_rooms set payment_id = v_p1 where id = v_room;
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p1, v_plan1, 2990000);
    execute 'reset role';
    select balance_cents into v_bal1 from public.cash_wallets where user_id = v_s1;
    select count(*) into v_anom1 from public.subscription_checkout_anomalies;
    v_ok := (v_res->>'ok')::boolean and (v_res->>'idempotent')::boolean = true
            and (select payment_id from public.mentor_student_rooms where id = v_room) = v_p2
            and v_bal1 = v_bal0 and v_anom1 = v_anom0;
    v_det := 'room→C 복구';
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-REP','11 B: stale room 참조를 C 로 복구', coalesce(v_ok,false), left(v_det,160));

  -- E-12: T-REP-C — room 참조 NULL → 검증 통과 후 C·현재 구독으로 복구
  begin
    update public.mentor_student_rooms set payment_id = null, subscription_id = null where id = v_room;
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p1, v_plan1, 2990000);
    execute 'reset role';
    select count(*) into v_anom1 from public.subscription_checkout_anomalies;
    v_ok := (v_res->>'ok')::boolean and (v_res->>'idempotent')::boolean = true
            and (select payment_id from public.mentor_student_rooms where id = v_room) = v_p2
            and (select subscription_id from public.mentor_student_rooms where id = v_room) = v_sub
            and v_anom1 = v_anom0;
    v_det := 'NULL→C/sub 복구';
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-REP','12 C: NULL 참조 복구(payment→C·subscription→현재)', coalesce(v_ok,false), left(v_det,160));

  -- E-13: T-REP-D — room 이 제3 결제 참조 → ROOM_REF_MISMATCH·business-state 쓰기 0
  begin
    update public.mentor_student_rooms set payment_id = v_ps2 where id = v_room;
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p1, v_plan1, 2990000);
    execute 'reset role';
    select balance_cents into v_bal1 from public.cash_wallets where user_id = v_s1;
    v_ok := v_res->>'code' = 'ROOM_REF_MISMATCH' and (v_res->>'anomaly_id') is not null
            and (select payment_id from public.mentor_student_rooms where id = v_room) = v_ps2
            and v_bal1 = v_bal0;
    v_det := coalesce(v_res->>'code','?');
    update public.mentor_student_rooms set payment_id = v_p2 where id = v_room;  -- 원복
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-REP','13 D: 제3 결제 참조 → ROOM_REF_MISMATCH + anomaly', coalesce(v_ok,false), left(v_det,160));

  -- E-14: T-REP-E/F — C 전제 실패 3종(detail 로 구분·코드는 1종 고정)·room 변경 0
  begin
    update public.subscriptions set last_payment_id = null where id = v_sub;
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p1, v_plan1, 2990000);
    execute 'reset role';
    select detail into v_detail from public.subscription_checkout_anomalies
     where id = (v_res->>'anomaly_id')::uuid;
    v_ok := v_res->>'code' = 'SUBSCRIPTION_REF_INVALID' and v_detail = 'LAST_PAYMENT_ID_NULL';
    v_det := coalesce(v_detail,'?');
    -- C 행 부재 — 064 FK(ON DELETE SET NULL) 아래에서는 라이브 재현이 불가능한
    -- 방어 분기이므로, fixture 한정으로 FK 를 트랜잭션 안에서 잠시 내리고 재현한다
    -- (아래에서 원상 재추가·전체 트랜잭션은 말미 rollback — 카탈로그 불변)
    alter table public.subscriptions drop constraint subscriptions_last_payment_id_fkey;
    update public.subscriptions set last_payment_id = gen_random_uuid() where id = v_sub;
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p1, v_plan1, 2990000);
    execute 'reset role';
    select detail into v_detail from public.subscription_checkout_anomalies
     where id = (v_res->>'anomaly_id')::uuid;
    v_ok := v_ok and v_res->>'code' = 'SUBSCRIPTION_REF_INVALID' and v_detail = 'LAST_PAYMENT_NOT_FOUND';
    v_det := v_det || '/' || coalesce(v_detail,'?');
    -- C 가 succeeded 아님(pending 결제 참조) + FK 원상 재추가
    update public.subscriptions set last_payment_id = v_ps2 where id = v_sub;
    alter table public.subscriptions add constraint subscriptions_last_payment_id_fkey
      foreign key (last_payment_id) references public.payments(id) on delete set null;
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p1, v_plan1, 2990000);
    execute 'reset role';
    select detail into v_detail from public.subscription_checkout_anomalies
     where id = (v_res->>'anomaly_id')::uuid;
    v_ok := v_ok and v_res->>'code' = 'SUBSCRIPTION_REF_INVALID' and v_detail = 'LAST_PAYMENT_NOT_SUCCEEDED'
            and (select payment_id from public.mentor_student_rooms where id = v_room) = v_p2;
    v_det := v_det || '/' || coalesce(v_detail,'?');
    update public.subscriptions set last_payment_id = v_p2 where id = v_sub;  -- 원복
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-REP','14 E/F: SUBSCRIPTION_REF_INVALID detail 3종·room 변경 0', coalesce(v_ok,false), left(v_det,160));

  -- E-15: T-REP-G — C succeeded 나 당사자 불일치 → PARTY_BINDING_MISMATCH(8단계)
  begin
    insert into public.payments (user_id, mentor_id, amount, currency, status, kind)
    values (v_s2, v_m2, 29900, 'KRW', 'succeeded', 'subscription') returning id into v_pg;
    update public.subscriptions set last_payment_id = v_pg where id = v_sub;
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p1, v_plan1, 2990000);
    execute 'reset role';
    v_ok := v_res->>'code' = 'PARTY_BINDING_MISMATCH' and (v_res->>'anomaly_id') is not null
            and (select payment_id from public.mentor_student_rooms where id = v_room) = v_p2;
    v_det := coalesce(v_res->>'code','?');
    update public.subscriptions set last_payment_id = v_p2 where id = v_sub;  -- 원복
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-REP','15 G: C 당사자 불일치 → PARTY_BINDING_MISMATCH', coalesce(v_ok,false), left(v_det,160));

  -- E-16: T-REP-H — 후보(room NULL)가 있어도 상위 검증 실패 시 보정 미실행
  begin
    update public.mentor_student_rooms set payment_id = null where id = v_room;
    update public.payments set plan_id = gen_random_uuid() where id = v_p1;  -- 4단계 강제 실패
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p1, v_plan1, 2990000);
    execute 'reset role';
    v_ok := v_res->>'code' = 'PLAN_BINDING_MISMATCH' and (v_res->>'anomaly_id') is not null
            and (select payment_id from public.mentor_student_rooms where id = v_room) is null;
    v_det := coalesce(v_res->>'code','?') || ' | room 보정 미실행';
    update public.payments set plan_id = v_plan1 where id = v_p1;                 -- 원복
    update public.mentor_student_rooms set payment_id = v_p2 where id = v_room;   -- 원복
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-REP','16 H: 상위 오류 시 room 후보 보정 미실행', coalesce(v_ok,false), left(v_det,160));

  -- E-17: T-CONC-09 등가 — 가격 변경 후 재생(기존 expected) = 멱등 성공·anomaly 0
  begin
    select count(*) into v_anom0 from public.subscription_checkout_anomalies;
    update public.mentor_plans set amount_cents = 3490000 where id = v_plan1;
    execute 'set local role service_role';
    v_res := api_web_v1.subscription_checkout_confirm_v2(v_p2, v_plan1, 2990000);
    execute 'reset role';
    select count(*) into v_anom1 from public.subscription_checkout_anomalies;
    select balance_cents into v_bal1 from public.cash_wallets where user_id = v_s1;
    v_ok := (v_res->>'ok')::boolean and (v_res->>'idempotent')::boolean = true
            and coalesce(v_res->>'code','') not in ('PLAN_AMOUNT_CHANGED','LEDGER_FIELD_MISMATCH')
            and v_anom1 = v_anom0 and v_bal1 = v_bal0;
    v_det := coalesce(v_res->>'idempotent','?') || ' anomaly+' || (v_anom1 - v_anom0);
    update public.mentor_plans set amount_cents = 2990000 where id = v_plan1;  -- 원복
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('T-REP','17 T-CONC-09 등가: 가격 변경 후 재생 멱등 성공(현재 플랜 미독)', coalesce(v_ok,false), left(v_det,160));
end $$;

-- =============================================================================
-- 5. [post_rollback] rollback 후 상태 — 객체 소거·레거시 구 본문 복원·기능 회귀
-- =============================================================================
do $$
declare
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
  v_pre_confirm text := current_setting('s2_verify.pre_m9_confirm_md5', true);
  v_pre_topup   text := current_setting('s2_verify.pre_m9_topup_md5', true);
  v_md5 text; v_md5c text;
  v_s uuid := gen_random_uuid();
  v_key text;
  v_bal bigint;
  v_ok boolean; v_det text;
begin
  if v_phase <> 'post_rollback' then return; end if;

  -- R-01: M9 객체 3종 소거 + census 복원(api_web_v1 12 · core_private 5)
  v_ok := not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where (n.nspname = 'api_web_v1' and p.proname in ('record_cash_topup_v2','subscription_checkout_confirm_v2'))
                          or (n.nspname = 'core_private' and p.proname = 'record_cash_topup_impl'))
          and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'api_web_v1') = 12
          and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'core_private') = 5;
  insert into s2_results(grp,test,pass,detail) values
    ('RB','01 M9 객체 소거 + census 12/5 복원', coalesce(v_ok,false), '');

  -- R-02: 레거시 record_cash_topup 020 구 본문 복원(md5 = pre-M9) + 정본 confirm 불변 + ACL
  select md5(p.prosrc) into v_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_cash_topup'
     and p.prorettype = 'void'::regtype and p.prosecdef
     and p.prosrc not like '%core_private%'
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and has_function_privilege('service_role', p.oid, 'EXECUTE');
  select md5(p.prosrc) into v_md5c
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'confirm_subscription_checkout';
  v_ok := v_md5 is not null
          and (v_pre_topup is null or v_pre_topup = '' or v_md5 = v_pre_topup)
          and (v_pre_confirm is null or v_pre_confirm = '' or v_md5c = v_pre_confirm);
  insert into s2_results(grp,test,pass,detail) values
    ('RB','02 레거시 구 본문 문자 그대로 복원(§22 #3) + 정본 불변 + ACL 유지',
     coalesce(v_ok,false), 'md5='||coalesce(left(v_md5,8),'?'));

  -- R-03: 레거시 기능 회귀 — 신규 충전 + duplicate 무음 (기존 계약 그대로)
  begin
    insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at)
    values (v_s, 's2e-vf-rb@example.invalid', '{"app_role":"student","nickname":"롤백검증"}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated', now(), now());
    v_key := 'cash-' || v_s || '-1000000009';
    execute 'set local role service_role';
    perform public.record_cash_topup(v_s, 500000, v_key);
    perform public.record_cash_topup(v_s, 500000, v_key);
    execute 'reset role';
    select balance_cents into v_bal from public.cash_wallets where user_id = v_s;
    v_ok := v_bal = 500000
            and (select count(*) from public.cash_ledger where idempotency_key = v_key) = 1;
    v_det := 'bal='||v_bal;
  exception when others then
    v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
  end;
  insert into s2_results(grp,test,pass,detail) values
    ('RB','03 레거시 topup 기능 회귀(신규+duplicate 무음)', coalesce(v_ok,false), left(v_det,160));
end $$;

-- =============================================================================
-- 6. 결과 출력·판정
-- =============================================================================
select grp, test, case when pass then 'PASS' else 'FAIL' end as result, detail
  from s2_results order by seq;

select count(*) filter (where pass) || '/' || count(*) as passed from s2_results;

do $$
declare
  v_fail int;
  v_phase text := coalesce(nullif(current_setting('s2_verify.phase', true), ''), 'forward');
begin
  select count(*) into v_fail from s2_results where not pass;
  if v_fail > 0 then
    raise exception 'S2_BATCH_E_VERIFY_FAILED: % 건 실패 (phase=%)', v_fail, v_phase;
  end if;
  raise notice 'S2_BATCH_E_VERIFY: ALL PASS (phase=%)', v_phase;
end $$;

-- 모든 fixture DML(s2e-vf-*) 은 여기서 파기된다(잔여 0 보증).
rollback;

-- 잔여 검사 — fixture 가 커밋되지 않았음을 별도 트랜잭션에서 확인
do $$
declare
  v_cnt bigint;
begin
  select count(*) into v_cnt from auth.users where email like 's2e-vf-%';
  if v_cnt > 0 then
    raise exception 'S2_BATCH_E_VERIFY_RESIDUE: fixture 잔여 % 건', v_cnt;
  end if;
  raise notice 'S2_BATCH_E_VERIFY: fixture 잔여 0';
end $$;
