-- db4_batch_post_fixture.sql — DB-4(199~204) 적용 후 실구동 assertion (오프라인 스크래치 PG 전용).
-- 전체가 단일 트랜잭션이며 마지막 ROLLBACK 으로 검증 쓰기를 전부 지운다(적용 상태는 그대로 남는다).
-- JWT 에뮬레이션: platform_stub 의 auth.uid() 는 request.jwt.claim.sub 를 읽는다. `set local role anon|authenticated` 로 실제 클라이언트 역할을 재현한다.
-- 재실행 안전: 4b(S4)·4c(S5) 의 forward 커밋 데이터가 있어도 통과하도록 카운트는 전부 상대(delta)로 본다.
-- 규칙: 상태를 바꾸는 호출과 그 결과를 읽는 스칼라 서브쿼리를 한 문장에 섞지 않는다(변경은 한 문장, 확인은 다음 문장).
begin;
set local search_path to public;

create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'POST ok   %', p_label;
  else raise exception 'POST FAIL %', p_label; end if;
end $$;
create or replace function pg_temp.as_user(p_uid uuid, p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
end $$;
create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql; return 'OK';
exception when others then return left(sqlerrm, 90);
end $$;
create or replace function pg_temp.snap(p_key text) returns text language sql as $$ select val from db4_check.snapshot where key = p_key $$;
create temp table db4_res (key text primary key, val jsonb) on commit drop;
grant select, insert, update on db4_res to authenticated;
create or replace function pg_temp.res(p_key text) returns jsonb language sql as $$ select val from db4_res where key = p_key $$;
-- envelope 호출 + 기대 코드('OK' = ok:true) 대조. 결과는 db4_res 에 보존.
create or replace function pg_temp.expect(p_key text, p_sql text, p_code text, p_label text) returns void language plpgsql as $$
declare r jsonb;
begin
  execute p_sql into r;
  insert into db4_res values (p_key, r) on conflict (key) do update set val = excluded.val;
  if p_code = 'OK' then
    if coalesce((r ->> 'ok')::boolean, false) then raise notice 'POST ok   %', p_label;
    else raise exception 'POST FAIL % — got %', p_label, r; end if;
  else
    if not coalesce((r ->> 'ok')::boolean, false) and (r ->> 'code') = p_code then raise notice 'POST ok   % [%]', p_label, p_code;
    else raise exception 'POST FAIL % — expected % got %', p_label, p_code, r; end if;
  end if;
end $$;
create temp table db4_num (key text primary key, val numeric) on commit drop;
create or replace function pg_temp.num(p_key text) returns numeric language sql as $$ select val from db4_num where key = p_key $$;

-- 고정 ID
\set admin '''9bf48819-1dd2-40dd-96a3-d64bcca2e60c'''
\set m1 '''00000000-0000-4000-8000-00000000d4a1'''
\set m2 '''00000000-0000-4000-8000-00000000d4a2'''
\set m3 '''00000000-0000-4000-8000-00000000d4a3'''
\set m4 '''00000000-0000-4000-8000-00000000d4a4'''
\set m5 '''00000000-0000-4000-8000-00000000d4a5'''
\set m6 '''00000000-0000-4000-8000-00000000d4a6'''
\set m7 '''00000000-0000-4000-8000-00000000d4a7'''
\set s1 '''00000000-0000-4000-8000-00000000d4b1'''
\set s2 '''00000000-0000-4000-8000-00000000d4b2'''
\set s3 '''00000000-0000-4000-8000-00000000d4b3'''
\set s4 '''00000000-0000-4000-8000-00000000d4b4'''
\set s6 '''00000000-0000-4000-8000-00000000d4b6'''
\set sub2 '''00000000-0000-4000-8000-00000000d4c1'''
\set nope '''00000000-0000-4000-8000-0000000000ff'''

-- ═══ A-0. 적용 상태 · ACL ═══
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1') = 16, 'A-0 api_app_v1 함수 16(기존 6 + DB-4 10)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'core_private') = 8, 'A-0 core_private 함수 8(기존 7 + refund impl)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')::text = pg_temp.snap('fn_public_count'), 'A-0 public 함수 수 불변(전부 api_app_v1/core_private)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_app_v1'
                    and p.proname in ('subscribe_with_cash','subscription_cancel_at_period_end','subscription_cancel_undo','refund_estimate','refund_request_create',
                                      'mentor_activity_set','mentor_plan_active_set','user_profile_update_self_v2','mentor_student_id_document_set_self','create_individual_question_as_student_v2')
                    and p.prosecdef and not has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    and not has_function_privilege('service_role', p.oid, 'EXECUTE')) = 10, 'A-0 래퍼 10종 SECDEF · anon 0 · authenticated 만 · service_role 0');
select pg_temp.ok(not has_schema_privilege('anon', 'api_app_v1', 'USAGE') and has_schema_privilege('authenticated', 'api_app_v1', 'USAGE'), 'A-0 스키마 USAGE: anon 0 · authenticated');
set local role anon;
select pg_temp.as_user(null, null);
select pg_temp.ok(r like 'permission denied for schema api_app_v1%', 'A-0 anon 은 호출 자체 거부: ' || r)
  from (select pg_temp.try(format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'k') $q$, :m1::uuid)) r) t;
reset role;

-- ═══ A. 구독 결제 ═══
insert into db4_num values ('pay0', (select count(*) from public.payments)), ('ledger0', (select count(*) from public.cash_ledger)),
  ('anom0', (select count(*) from public.subscription_checkout_anomalies)), ('notif_s1_0', (select count(*) from public.notifications where recipient_user_id = :s1::uuid)),
  ('cap_m1_0', public.mentor_cap_used(:m1::uuid)), ('sbe0', (select count(*) from public.subscription_billing_events));
set local role authenticated;
select pg_temp.as_user(null, 'authenticated');
select pg_temp.expect('A1', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K1') $q$, :m1::uuid), 'AUTH_REQUIRED', 'A-1 JWT 없는 authenticated');
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.expect('A2', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K1') $q$, :m1::uuid), 'ROLE_NOT_STUDENT', 'A-2 멘토 호출');
select pg_temp.as_user(:s3::uuid, 'authenticated');
select pg_temp.expect('A3', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K1') $q$, :m1::uuid), 'ACCOUNT_BANNED', 'A-3 banned 학생');
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('A4a', format($q$ select api_app_v1.subscribe_with_cash(%L, 'gold', 'K1') $q$, :m1::uuid), 'PLAN_TIER_INVALID', 'A-4 tier 밖');
select pg_temp.expect('A4b', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', '  ') $q$, :m1::uuid), 'IDEMPOTENCY_KEY_INVALID', 'A-4 빈 멱등 키');
select pg_temp.expect('A4c', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K1') $q$, :nope::uuid), 'MENTOR_NOT_FOUND', 'A-4 없는 멘토');
select pg_temp.expect('A4d', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K1') $q$, :m6::uuid), 'MENTOR_NOT_APPROVED', 'A-4 미승인 멘토 M6');
select pg_temp.expect('A4e', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K1') $q$, :m2::uuid), 'MENTOR_PAUSED', 'A-4 일시 휴식 멘토 M2(웹 활동 게이트 동일)');
select pg_temp.expect('A4f', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K1') $q$, :m3::uuid), 'MENTOR_TERMINATED', 'A-4 종료 예약 멘토 M3');
select pg_temp.expect('A4g', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K1') $q$, :m5::uuid), 'MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS', 'A-4 구독 닫힘 멘토 M5');
select pg_temp.expect('A4h', format($q$ select api_app_v1.subscribe_with_cash(%L, 'premium', 'K1') $q$, :m4::uuid), 'MENTOR_CAP_EXCEEDED', 'A-4 정원(cap_limit 1 · premium 4.75)');
select pg_temp.ok((pg_temp.res('A4h') ->> 'cap_limit')::numeric = 1 and (pg_temp.res('A4h') ->> 'cap_weight')::numeric = 4.75, 'A-4 cap 응답 필드(cap_limit 1 · cap_weight 4.75 — DB 함수 정본)');
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.expect('A4i', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K1') $q$, :m1::uuid), 'CASH_INSUFFICIENT', 'A-4 잔액 0 학생 S2');
select pg_temp.ok((pg_temp.res('A4i') ->> 'shortfall_cents')::bigint = 8490000 and (pg_temp.res('A4i') ->> 'required_cents')::bigint = 8490000 and (pg_temp.res('A4i') ->> 'balance_cents')::bigint = 0,
                  'A-4 부족액 응답(shortfall 8,490,000 = 84,900캐시 · 충전 유도 문구 없음 — 코드만)');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((select count(*) from public.payments) = pg_temp.num('pay0') and (select count(*) from public.cash_ledger) = pg_temp.num('ledger0')
                  and (select count(*) from public.subscriptions where student_id in (:s1::uuid, :s2::uuid)) = 1, 'A-4 거부 12건은 payments·원장·구독 흔적 0');

-- A-5 ★ 성공 — 0-A 부수 효과 전항
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('A5', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K1') $q$, :m1::uuid), 'OK', 'A-5 ★ S1 → M1 스탠다드 캐시 구독');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('A5') ->> 'idempotent') = 'false' and (pg_temp.res('A5') ->> 'debited_cents')::bigint = 8490000
                  and (pg_temp.res('A5') ->> 'balance_after_cents')::bigint = 21510000 and (pg_temp.res('A5') ->> 'plan_tier') = 'standard'
                  and (pg_temp.res('A5') ->> 'reactivated') = 'false' and (pg_temp.res('A5') ->> 'contract_version') = '1',
                  'A-5 응답: debited 8,490,000(멘토 실제 단가 = mentor_plans) · balance_after 21,510,000 · reactivated false');
select pg_temp.ok((select s.status = 'active' and s.plan_tier = 'standard' and s.plan_id = (pg_temp.res('A5') ->> 'plan_id')::uuid
                          and s.payment_id = (pg_temp.res('A5') ->> 'payment_id')::uuid and s.last_payment_id = s.payment_id
                          and s.current_period_start is not null and s.current_period_end > now() + interval '27 days' and s.next_billing_at = s.current_period_end
                          and s.cancel_at_period_end = false and s.last_billing_event_id is not null
                     from public.subscriptions s where s.id = (pg_temp.res('A5') ->> 'subscription_id')::uuid and s.student_id = :s1::uuid and s.mentor_id = :m1::uuid),
                  'A-5 ① subscriptions: active · standard · plan_id · payment_id/last_payment_id · 기간 +1개월(KST) · last_billing_event_id');
select pg_temp.ok((select p.status = 'succeeded' and p.kind = 'subscription' and p.amount = 84900 and p.currency = 'KRW' and p.external_id = 'sub_app_K1'
                          and p.plan_id = (pg_temp.res('A5') ->> 'plan_id')::uuid and p.user_id = :s1::uuid and p.mentor_id = :m1::uuid
                          and (p.metadata ? 'app_result') and (p.metadata ->> 'expected_amount_cents') = '8490000' and (p.metadata ->> 'subscription_id') = (pg_temp.res('A5') ->> 'subscription_id')
                     from public.payments p where p.id = (pg_temp.res('A5') ->> 'payment_id')::uuid),
                  'A-5 ② payments intent → succeeded · amount 84,900 KRW · external_id sub_app_K1 · metadata(app_result · expected · subscription_id)');
select pg_temp.ok((select l.delta_cents = -8490000 and l.reason = 'subscription_payment' and l.ref_type = 'subscriptions' and l.ref_id = (pg_temp.res('A5') ->> 'subscription_id')::uuid and l.user_id = :s1::uuid
                     from public.cash_ledger l where l.idempotency_key = 'sub_debit_' || (pg_temp.res('A5') ->> 'payment_id')),
                  'A-5 ③ cash_ledger sub_debit_<payment> −8,490,000 · ref subscriptions');
select pg_temp.ok((select balance_cents from public.cash_wallets where user_id = :s1::uuid) = 21510000, 'A-5 ③ 지갑 30,000,000 → 21,510,000');
select pg_temp.ok((select r.student_id = :s1::uuid and r.mentor_id = :m1::uuid and r.subscription_id = (pg_temp.res('A5') ->> 'subscription_id')::uuid and r.payment_id = (pg_temp.res('A5') ->> 'payment_id')::uuid
                     from public.mentor_student_rooms r where r.id = (pg_temp.res('A5') ->> 'room_id')::uuid),
                  'A-5 ③ 방(mentor_student_rooms) 생성 · subscription_id/payment_id 참조(F10/F12)');
select pg_temp.ok((select e.event_type = 'initial' and e.status = 'succeeded' and e.amount_cents = 8490000 and e.plan_tier = 'standard'
                          and e.plan_id = (pg_temp.res('A5') ->> 'plan_id')::uuid and e.payment_id = (pg_temp.res('A5') ->> 'payment_id')::uuid
                          and e.ledger_id = (select l.id from public.cash_ledger l where l.idempotency_key = 'sub_debit_' || (pg_temp.res('A5') ->> 'payment_id'))
                          and e.period_start = s.current_period_start and e.period_end = s.current_period_end and e.student_id = :s1::uuid and e.mentor_id = :m1::uuid
                          and e.id = s.last_billing_event_id and e.processed_at is not null and e.billing_at is not null
                     from public.subscription_billing_events e join public.subscriptions s on s.id = e.subscription_id
                    where e.idempotency_key = 'sub_initial:' || (pg_temp.res('A5') ->> 'subscription_id')),
                  'A-5 ④ initial billing event(sub_initial:<sub> · succeeded · ledger/payment/plan/기간 · 구독 last_billing_event_id 연결 — 정산 배치 원천)');
select pg_temp.ok((select count(*) from public.subscription_billing_events) = pg_temp.num('sbe0') + 1, 'A-5 ④ billing event 정확히 +1');
select pg_temp.ok(public.mentor_cap_used(:m1::uuid) = pg_temp.num('cap_m1_0') + 2.25, 'A-5 ⑤ cap 사용량 +2.25(standard 가중치 · enforce_mentor_cap 통과)');
select pg_temp.ok((select count(*) from public.notifications where recipient_user_id = :s1::uuid) = pg_temp.num('notif_s1_0'), 'A-5 ⑥ 최초 구독 알림 0(웹 동일 — 157 은 initial 무발화)');
select pg_temp.ok((select count(*) from public.subscription_checkout_anomalies) = pg_temp.num('anom0'), 'A-5 ⑦ anomaly 0');
select pg_temp.ok((select count(*) from public.payments) = pg_temp.num('pay0') + 1 and (select count(*) from public.cash_ledger) = pg_temp.num('ledger0') + 1, 'A-5 payments +1 · 원장 +1');

-- A-6 멱등 재생 · 키 충돌 · 중복 구독
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('A6', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K1') $q$, :m1::uuid), 'OK', 'A-6 같은 키 재호출');
select pg_temp.expect('A6b', format($q$ select api_app_v1.subscribe_with_cash(%L, 'limited', 'K1') $q$, :m1::uuid), 'IDEMPOTENCY_KEY_CONFLICT', 'A-6 같은 키 · 다른 tier');
select pg_temp.expect('A6c', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K2') $q$, :m1::uuid), 'ALREADY_SUBSCRIBED', 'A-6 새 키 · 같은 멘토(중복 구독 차단)');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('A6') ->> 'idempotent') = 'true' and (pg_temp.res('A6') ->> 'subscription_id') = (pg_temp.res('A5') ->> 'subscription_id')
                  and (pg_temp.res('A6') ->> 'room_id') = (pg_temp.res('A5') ->> 'room_id') and (pg_temp.res('A6') ->> 'payment_id') = (pg_temp.res('A5') ->> 'payment_id')
                  and (pg_temp.res('A6') ->> 'debited_cents')::bigint = 8490000, 'A-6 재생 = 첫 결과 그대로(idempotent true · 같은 subscription/room/payment)');
select pg_temp.ok((select balance_cents from public.cash_wallets where user_id = :s1::uuid) = 21510000
                  and (select count(*) from public.payments) = pg_temp.num('pay0') + 1 and (select count(*) from public.cash_ledger) = pg_temp.num('ledger0') + 1,
                  'A-6 재생·충돌·중복 거부는 차감 0 · payments/원장 불변');
select pg_temp.ok((pg_temp.res('A6c') ->> 'subscription_id') = (pg_temp.res('A5') ->> 'subscription_id'), 'A-6 ALREADY_SUBSCRIBED 가 기존 subscription_id 동봉');

-- A-7 해지 예약 · 취소
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('A7a', format($q$ select api_app_v1.subscription_cancel_at_period_end(%L) $q$, pg_temp.res('A5') ->> 'subscription_id'), 'OK', 'A-7 해지 예약');
select pg_temp.expect('A7b', format($q$ select api_app_v1.subscription_cancel_at_period_end(%L) $q$, pg_temp.res('A5') ->> 'subscription_id'), 'OK', 'A-7 해지 예약 재호출(멱등)');
select pg_temp.expect('A7c', format($q$ select api_app_v1.subscription_cancel_at_period_end(%L) $q$, :nope::uuid), 'SUBSCRIPTION_NOT_FOUND', 'A-7 없는 구독');
select pg_temp.expect('A7d', format($q$ select api_app_v1.subscription_cancel_at_period_end(%L) $q$, :sub2::uuid), 'NOT_SUBSCRIPTION_OWNER', 'A-7 타인(S2) 구독');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('A7a') ->> 'already_scheduled') = 'false' and (pg_temp.res('A7b') ->> 'already_scheduled') = 'true'
                  and (select cancel_at_period_end and cancel_requested_at is not null and status = 'active' from public.subscriptions where id = (pg_temp.res('A5') ->> 'subscription_id')::uuid),
                  'A-7 cancel_at_period_end=true · cancel_requested_at · status 는 active 유지(기간 말까지)');
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('A7e', format($q$ select api_app_v1.subscription_cancel_undo(%L) $q$, pg_temp.res('A5') ->> 'subscription_id'), 'OK', 'A-7 해지 예약 취소');
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.expect('A7f', format($q$ select api_app_v1.subscription_cancel_undo(%L) $q$, pg_temp.res('A5') ->> 'subscription_id'), 'ROLE_NOT_STUDENT', 'A-7 멘토는 ROLE_NOT_STUDENT');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('A7e') ->> 'was_scheduled') = 'true'
                  and (select not cancel_at_period_end and cancel_requested_at is null from public.subscriptions where id = (pg_temp.res('A5') ->> 'subscription_id')::uuid),
                  'A-7 취소 후 false/null');
update public.subscriptions set status = 'canceled' where id = :sub2::uuid;   -- 서비스 경로: S2 구독을 잠시 종료 상태로
set local role authenticated;
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.expect('A7g', format($q$ select api_app_v1.subscription_cancel_at_period_end(%L) $q$, :sub2::uuid), 'SUBSCRIPTION_NOT_CURRENT', 'A-7 종료된 구독은 SUBSCRIPTION_NOT_CURRENT');
select pg_temp.expect('A7h', format($q$ select api_app_v1.subscription_cancel_undo(%L) $q$, :sub2::uuid), 'SUBSCRIPTION_NOT_CURRENT', 'A-7 종료된 구독 undo 도 SUBSCRIPTION_NOT_CURRENT');
reset role;
select pg_temp.as_user(null, null);
update public.subscriptions set status = 'active' where id = :sub2::uuid;

-- A-9 상호 차단 · A-10 F12 envelope 실패 경로(자금 오류 → intent 롤백 · anomaly 재기록) — S6 → M1
insert into public.user_blocks (blocker_id, blocked_id) values (:s6::uuid, :m1::uuid);
set local role authenticated;
select pg_temp.as_user(:s6::uuid, 'authenticated');
select pg_temp.expect('A9', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K-s6-blocked') $q$, :m1::uuid), 'BLOCKED', 'A-9 상호 차단 pair 는 BLOCKED(F10 판정 선반영 · 차감 0)');
reset role;
select pg_temp.as_user(null, null);
delete from public.user_blocks where blocker_id = :s6::uuid and blocked_id = :m1::uuid;
-- 자금 단계 실패를 결정적으로 재현: 원장 INSERT 를 임시 CHECK 로 막는다(이 트랜잭션 안에서만) → 정본 confirm 이 FINANCIAL_WRITE_ERROR envelope
alter table public.cash_ledger add constraint db4_tmp_block_debit check (reason is distinct from 'subscription_payment') not valid;   -- 기존 행 검증 없이 신규 INSERT 만 막는다
insert into db4_num values ('pay_a10', (select count(*) from public.payments)), ('anom_a10', (select count(*) from public.subscription_checkout_anomalies)),
  ('wallet_s6_a10', (select balance_cents from public.cash_wallets where user_id = :s6::uuid));
set local role authenticated;
select pg_temp.as_user(:s6::uuid, 'authenticated');
select pg_temp.expect('A10', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K-s6-abort') $q$, :m1::uuid), 'FINANCIAL_WRITE_ERROR', 'A-10 정본 자금 오류 → F12 envelope → 래퍼 abort');
reset role;
select pg_temp.as_user(null, null);
alter table public.cash_ledger drop constraint db4_tmp_block_debit;
select pg_temp.ok((select count(*) from public.payments) = pg_temp.num('pay_a10') and (select count(*) from public.payments where external_id = 'sub_app_K-s6-abort') = 0,
                  'A-10 실패 시도는 payments intent 를 남기지 않는다(subtransaction 롤백)');
select pg_temp.ok((select balance_cents from public.cash_wallets where user_id = :s6::uuid) = pg_temp.num('wallet_s6_a10')
                  and not exists (select 1 from public.subscriptions where student_id = :s6::uuid and mentor_id = :m1::uuid)
                  and not exists (select 1 from public.mentor_student_rooms where student_id = :s6::uuid and mentor_id = :m1::uuid), 'A-10 차감 0 · 구독 0 · 방 0');
select pg_temp.ok((select count(*) from public.subscription_checkout_anomalies) = pg_temp.num('anom_a10') + 1
                  and (select payment_id is null and subscription_id is null and code = 'FINANCIAL_WRITE_ERROR' and (expected ->> 'idempotency_key') = 'K-s6-abort'
                         from public.subscription_checkout_anomalies where id = (pg_temp.res('A10') ->> 'anomaly_id')::uuid),
                  'A-10 anomaly 1건 재기록(payment_id NULL · 키·당사자 보존) · 응답 anomaly_id');
set local role authenticated;
select pg_temp.as_user(:s6::uuid, 'authenticated');
select pg_temp.expect('A10b', format($q$ select api_app_v1.subscribe_with_cash(%L, 'standard', 'K-s6-abort') $q$, :m1::uuid), 'OK', 'A-10 같은 키 재시도는 새로 판정돼 성공(실패는 재생되지 않는다)');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('A10b') ->> 'idempotent') = 'false' and (select balance_cents from public.cash_wallets where user_id = :s6::uuid) = pg_temp.num('wallet_s6_a10') - 8490000, 'A-10 재시도 성공 · 차감 1회');
update public.subscriptions set status = 'canceled' where student_id = :s6::uuid and mentor_id = :m1::uuid;   -- D 절(S6 PLAN_INACTIVE 검사)을 위해 서비스 경로로 비활성화

-- ═══ B. 환불 ═══
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('B1a', format($q$ select api_app_v1.refund_estimate(%L) $q$, pg_temp.res('A5') ->> 'subscription_id'), 'OK', 'B-1 예상액(질문 전)');
select pg_temp.expect('B1n', format($q$ select api_app_v1.refund_estimate(%L) $q$, :nope::uuid), 'SUBSCRIPTION_NOT_FOUND', 'B-1 없는 구독');
select pg_temp.expect('B1o', format($q$ select api_app_v1.refund_estimate(%L) $q$, :sub2::uuid), 'NOT_SUBSCRIPTION_OWNER', 'B-1 타인 구독');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('B1a') ->> 'refundable_cents')::bigint = 8490000 and (pg_temp.res('B1a') ->> 'bracket_reason') = 'before_usage' and (pg_temp.res('B1a') ->> 'rule') = '이용 개시 전'
                  and (pg_temp.res('B1a') ->> 'usage_started') = 'false' and (pg_temp.res('B1a') ->> 'amount_cents')::bigint = 8490000,
                  'B-1 이용 개시 전(질문 0) → 전액 8,490,000 · rule 이용 개시 전');
-- 방에서 첫 질문(구독 경로) — 방 있는 구독이라 학생이 질문할 수 있다
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('A8', format($q$ select api_app_v1.qna_create_question_thread(%L, '첫 질문', 'math_calculus', null, '첫 질문 본문입니다') $q$, pg_temp.res('A5') ->> 'room_id'), 'OK', 'A-8 구독방 첫 질문 생성(path subscription)');
select pg_temp.expect('B1b', format($q$ select api_app_v1.refund_estimate(%L) $q$, pg_temp.res('A5') ->> 'subscription_id'), 'OK', 'B-1 예상액(질문 후)');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('A8') ->> 'path') = 'subscription' and (pg_temp.res('A8') ->> 'used_free_quota') = 'false', 'A-8 path=subscription · 무료 자격 소비 0');
select pg_temp.ok((pg_temp.res('B1b') ->> 'refundable_cents')::bigint = 5660000 and (pg_temp.res('B1b') ->> 'bracket_reason') = 'lt_1_3' and (pg_temp.res('B1b') ->> 'rule') = '1/3 전'
                  and (pg_temp.res('B1b') ->> 'usage_started') = 'true', 'B-1 이용 개시 후(경과 0) → 2/3 = 5,660,000 · rule 1/3 전');
insert into db4_num values ('refund0', (select count(*) from public.refunds)), ('notif_s1_b', (select count(*) from public.notifications where recipient_user_id = :s1::uuid));
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('B2a', format($q$ select api_app_v1.refund_request_create(%L, '짧다') $q$, pg_temp.res('A5') ->> 'subscription_id'), 'REASON_TOO_SHORT', 'B-2 사유 5자 미만');
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.expect('B2b', format($q$ select api_app_v1.refund_request_create(%L, '타인 구독 환불 시도') $q$, pg_temp.res('A5') ->> 'subscription_id'), 'NOT_SUBSCRIPTION_OWNER', 'B-2 타인 구독');
select pg_temp.expect('B2s2', format($q$ select api_app_v1.refund_estimate(%L) $q$, :sub2::uuid), 'OK', 'B-2 S2 본인 구독 예상액');
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('B2c', format($q$ select api_app_v1.refund_request_create(%L, '사정이 생겨 환불을 신청합니다') $q$, pg_temp.res('A5') ->> 'subscription_id'), 'OK', 'B-2 ★ 환불 신청');
select pg_temp.expect('B2d', format($q$ select api_app_v1.refund_request_create(%L, '한 번 더 신청') $q$, pg_temp.res('A5') ->> 'subscription_id'), 'ALREADY_REQUESTED', 'B-2 pending 중복');
select pg_temp.expect('B2e', format($q$ select api_app_v1.qna_create_question_thread(%L, '환불 대기 중 질문', null, null, '본문') $q$, pg_temp.res('A5') ->> 'room_id'), 'SUBSCRIPTION_REFUND_PENDING', 'B-2 부수 효과: pending 환불 → 새 질문 142 잠금');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('B2s2') ->> 'refundable_cents')::bigint = 8490000 and (pg_temp.res('B2s2') ->> 'bracket_reason') = 'before_usage',
                  'B-2 S2(방 없음 · 10일 경과) → 이용 개시 전 전액(웹 판정: 방 없으면 개시 아님)');
select pg_temp.ok((select r.user_id = :s1::uuid and r.amount_cents = 5660000 and r.status = 'pending' and r.request_type = 'subscription_prorated'
                          and r.subscription_id = (pg_temp.res('A5') ->> 'subscription_id')::uuid and r.payment_id = (pg_temp.res('A5') ->> 'payment_id')::uuid
                          and r.billing_event_id = (select s.last_billing_event_id from public.subscriptions s where s.id = r.subscription_id)
                          and r.reason = '사정이 생겨 환불을 신청합니다'
                     from public.refunds r where r.id = (pg_temp.res('B2c') ->> 'refund_id')::uuid),
                  'B-2 refunds: pending · 5,660,000 · subscription_prorated · payment/billing_event 연결(150) · 사유');
select pg_temp.ok((select count(*) from public.refunds) = pg_temp.num('refund0') + 1 and (pg_temp.res('B2d') ->> 'refund_id') = (pg_temp.res('B2c') ->> 'refund_id'), 'B-2 환불 행 정확히 +1 · 중복 응답이 기존 refund_id 동봉');
select pg_temp.ok((select count(*) from public.notifications where recipient_user_id = :s1::uuid) = pg_temp.num('notif_s1_b'), 'B-2 학생 자발 환불 신청 알림 0(웹 동일)');
select pg_temp.ok((pg_temp.res('B2c') ->> 'amount_cents')::bigint = 5660000 and (pg_temp.res('B2c') ->> 'status') = 'pending', 'B-2 응답 amount/status');

-- B-3 별표 4 경계값 — 웹 TS(computeProratedRefundEstimate) 기대값과 대조 (기대값: scripts/verify/db4_refund_parity_expected.mjs 실행 결과)
insert into public.subscriptions (id, student_id, mentor_id, plan_id, plan_tier, status, started_at, current_period_start, current_period_end, next_billing_at, billing_cycle)
select '00000000-0000-4000-8000-00000000d4c2', :s4::uuid, :m2::uuid, mp.id, 'standard', 'active',
       '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', 'monthly'
  from public.mentor_plans mp where mp.mentor_id = :m2::uuid and mp.plan_tier = 'standard';
insert into public.subscription_billing_events (subscription_id, student_id, mentor_id, event_type, status, period_start, period_end, billing_at, amount_cents, plan_tier, idempotency_key, processed_at)
values ('00000000-0000-4000-8000-00000000d4c2', :s4::uuid, :m2::uuid, 'initial', 'succeeded', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z', 8490000, 'standard', 'sub_initial:00000000-0000-4000-8000-00000000d4c2', '2026-09-01T00:00:00Z');
insert into public.mentor_student_rooms (id, student_id, mentor_id, subscription_id) values ('00000000-0000-4000-8000-00000000d4d2', :s4::uuid, :m2::uuid, '00000000-0000-4000-8000-00000000d4c2');
do $$
declare c record; r jsonb;
begin
  for c in select * from (values
      ('before_usage',       '2026-09-05T00:00:00Z', false, 8490000, 'before_usage', 26, 30),
      ('lt_1_3_just_under',  '2026-09-10T23:59:59Z', true,  5660000, 'lt_1_3',       21, 30),
      ('exact_1_3',          '2026-09-11T00:00:00Z', true,  4245000, 'lt_1_2',       20, 30),
      ('lt_1_2_just_under',  '2026-09-15T23:59:59Z', true,  4245000, 'lt_1_2',       16, 30),
      ('exact_1_2',          '2026-09-16T00:00:00Z', true,  0,       'ge_1_2',       15, 30),
      ('after_1_2',          '2026-09-20T00:00:00Z', true,  0,       'ge_1_2',       11, 30),
      ('before_start_usage', '2026-08-31T12:00:00Z', true,  5660000, 'lt_1_3',       31, 30),
      ('after_end',          '2026-10-05T00:00:00Z', true,  0,       'ge_1_2',        0, 30)
    ) v(label, now_iso, usage, exp_amount, exp_bracket, exp_rem, exp_total) loop
    delete from public.question_threads where mentor_student_room_id = '00000000-0000-4000-8000-00000000d4d2';
    if c.usage then
      insert into public.question_threads (mentor_student_room_id, title, status, created_at)
      values ('00000000-0000-4000-8000-00000000d4d2', '이용 개시 질문', 'pending', '2026-09-02T00:00:00Z');
    end if;
    r := core_private.subscription_refund_estimate_impl('00000000-0000-4000-8000-00000000d4c2', c.now_iso::timestamptz);
    raise notice 'PARITY_TSV %', c.label || E'\t' || (r ->> 'refundable_cents') || E'\t' || (r ->> 'bracket_reason') || E'\t' || (r ->> 'remaining_days') || E'\t' || (r ->> 'period_days');
    perform pg_temp.ok((r ->> 'refundable_cents')::bigint = c.exp_amount and (r ->> 'bracket_reason') = c.exp_bracket
                       and (r ->> 'remaining_days')::int = c.exp_rem and (r ->> 'period_days')::int = c.exp_total and (r ->> 'usage_started')::boolean = c.usage,
                       'B-3 parity ' || c.label || ' = ' || (r ->> 'refundable_cents') || ' ' || (r ->> 'bracket_reason') || ' rem=' || (r ->> 'remaining_days') || ' total=' || (r ->> 'period_days'));
  end loop;
end $$;
-- 계산 불가(billing event 없음 → 금액 0) · 기간 없음
delete from public.subscription_billing_events where subscription_id = '00000000-0000-4000-8000-00000000d4c2';
select pg_temp.ok((r ->> 'refundable_cents')::bigint = 0 and (r ->> 'bracket_reason') = 'invalid' and (r ->> 'rule') = '계산 불가', 'B-3 billing event 없음 → invalid(0) · 계산 불가')
  from (select core_private.subscription_refund_estimate_impl('00000000-0000-4000-8000-00000000d4c2', now()) r) t;

-- ═══ C. 멘토 활동 상태 (M7 · 구독자 S2) ═══
insert into db4_num values
  ('s2_end0', extract(epoch from (select current_period_end from public.subscriptions where id = :sub2::uuid))),
  ('s2_next0', extract(epoch from (select next_billing_at from public.subscriptions where id = :sub2::uuid))),
  ('notif_s2_pause0', (select count(*) from public.notifications where recipient_user_id = :s2::uuid and event_key like 'mentor_pause_notice:%')),
  ('notif_s2_term0', (select count(*) from public.notifications where recipient_user_id = :s2::uuid and event_key like 'mentor_termination_notice:%')),
  ('ev_m7_0', (select count(*) from public.mentor_activity_events where mentor_id = :m7::uuid));
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('C1a', $q$ select api_app_v1.mentor_activity_set('paused', now() + interval '1 day') $q$, 'ROLE_NOT_MENTOR', 'C-1 학생은 ROLE_NOT_MENTOR');
select pg_temp.as_user(:m7::uuid, 'authenticated');
select pg_temp.expect('C1b', $q$ select api_app_v1.mentor_activity_set('terminated') $q$, 'ACTIVITY_STATUS_INVALID', 'C-1 terminated 는 관리자/배치 전용');
select pg_temp.expect('C1c', $q$ select api_app_v1.mentor_activity_set('paused') $q$, 'PAUSE_UNTIL_REQUIRED', 'C-1 pause_until 필수');
select pg_temp.expect('C1d', $q$ select api_app_v1.mentor_activity_set('paused', now() - interval '1 hour') $q$, 'PAUSE_UNTIL_INVALID', 'C-1 과거 pause_until');
select pg_temp.expect('C1e', $q$ select api_app_v1.mentor_activity_set('paused', now() + interval '8 days') $q$, 'PAUSE_TOO_LONG', 'C-1 8일은 PAUSE_TOO_LONG(최대 7)');
select pg_temp.expect('C1f', $q$ select api_app_v1.mentor_activity_set('paused', now() + interval '3 days', null, 'vacation') $q$, 'PAUSE_REASON_INVALID', 'C-1 사유 밖');
select pg_temp.expect('C2', $q$ select api_app_v1.mentor_activity_set('paused', now() + interval '3 days', null, 'rest') $q$, 'OK', 'C-2 ★ 일시 휴식 3일(rest)');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('C2') ->> 'pause_days')::int = 3 and (pg_temp.res('C2') ->> 'subscriptions_extended')::int = 1 and (pg_temp.res('C2') ->> 'event_status') = 'logged',
                  'C-2 응답: pause_days 3 · 구독 1건 연장 · event logged');
select pg_temp.ok((select activity_status = 'paused' and pause_until > now() + interval '2 days' and last_pause_at is not null and pause_reason = 'rest' and pause_started_at is not null
                     from public.mentor_profiles where user_id = :m7::uuid), 'C-2 mentor_profiles paused · pause_until · last_pause_at(rest)');
select pg_temp.ok(extract(epoch from (select current_period_end from public.subscriptions where id = :sub2::uuid)) = pg_temp.num('s2_end0') + 3 * 86400
                  and extract(epoch from (select next_billing_at from public.subscriptions where id = :sub2::uuid)) = pg_temp.num('s2_next0') + 3 * 86400,
                  'C-2 S2 구독 current_period_end·next_billing_at +3일(과금 보호)');
select pg_temp.ok((select count(*) from public.mentor_activity_events where mentor_id = :m7::uuid and event_type = 'pause_started' and reason = 'rest' and status = 'logged' and (detail ->> 'days') = '3') = 1,
                  'C-2 mentor_activity_events pause_started(rest · logged · days 3)');
select pg_temp.ok((select count(*) from public.notifications where recipient_user_id = :s2::uuid and event_key like 'mentor_pause_notice:%') = pg_temp.num('notif_s2_pause0') + 1,
                  'C-2 158 트리거: 구독 학생 S2 에 mentor_pause_notice +1');
select pg_temp.ok((select count(*) from public.mentor_plans where mentor_id = :m7::uuid and is_active) = 3, 'C-2 일시 휴식은 플랜을 끄지 않는다(웹 동일)');
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('C3a', format($q$ select api_app_v1.subscribe_with_cash(%L, 'limited', 'K-m7') $q$, :m7::uuid), 'MENTOR_PAUSED', 'C-3 휴식 중 멘토 신규 구독 차단');
select pg_temp.as_user(:s2::uuid, 'authenticated');
select pg_temp.expect('C3b', format($q$ select api_app_v1.ensure_free_question_room(%L) $q$, :m7::uuid), 'OK', 'C-3 기존 구독자 S2 방 확보(entitlement subscription)');
select pg_temp.expect('C3c', format($q$ select api_app_v1.qna_create_question_thread(%L, '휴식 중 질문', null, null, '기존 학생 질문은 계속 받는다') $q$, pg_temp.res('C3b') ->> 'room_id'), 'OK', 'C-3 ★ 휴식 중에도 기존 학생 질문은 계속 받는다(웹 동일 — qna 는 activity_status 를 보지 않음)');
select pg_temp.as_user(:m7::uuid, 'authenticated');
select pg_temp.expect('C4a', $q$ select api_app_v1.mentor_activity_set('paused', now() + interval '2 days') $q$, 'ACTIVITY_STATE_INVALID', 'C-4 휴식 중 재휴식');
select pg_temp.expect('C4b', $q$ select api_app_v1.mentor_activity_set('active') $q$, 'OK', 'C-4 조기 복귀');
select pg_temp.expect('C4c', $q$ select api_app_v1.mentor_activity_set('paused', now() + interval '2 days', null, 'rest') $q$, 'REST_FREQUENCY_LIMIT', 'C-4 일반 휴식 6개월 1회');
select pg_temp.expect('C4d', $q$ select api_app_v1.mentor_activity_set('paused', now() + interval '2 days', null, 'illness') $q$, 'OK', 'C-4 질병 사유는 예외(관리자 확인)');
select pg_temp.expect('C4e', $q$ select api_app_v1.mentor_activity_set('active') $q$, 'OK', 'C-4 복귀');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('C4a') ->> 'current_state') = 'paused' and (pg_temp.res('C4d') ->> 'event_status') = 'pending_review'
                  and (select activity_status = 'active' and pause_until is null from public.mentor_profiles where user_id = :m7::uuid)
                  and (select count(*) from public.mentor_activity_events where mentor_id = :m7::uuid and event_type = 'pause_resumed') = 2
                  and (select count(*) from public.mentor_activity_events where mentor_id = :m7::uuid and event_type = 'pause_started' and reason = 'illness' and status = 'pending_review') = 1,
                  'C-4 상태·이벤트(pause_resumed 2 · illness pending_review 1)');
select pg_temp.ok((pg_temp.res('C4c') ->> 'next_available_at') is not null, 'C-4 REST_FREQUENCY_LIMIT 응답에 next_available_at');
set local role authenticated;
select pg_temp.as_user(:m7::uuid, 'authenticated');
select pg_temp.expect('C5', $q$ select api_app_v1.mentor_activity_set('terminating', null, now() + interval '20 days') $q$, 'OK', 'C-5 ★ 활동 종료 예약(효력일 +20일 지정)');
select pg_temp.expect('C5b', $q$ select api_app_v1.mentor_activity_set('terminating') $q$, 'ACTIVITY_STATE_INVALID', 'C-5 종료 예약 중 재신청');
select pg_temp.expect('C5c', $q$ select api_app_v1.mentor_activity_set('active') $q$, 'ACTIVITY_STATE_INVALID', 'C-5 종료 예약 중 복귀 불가(raw ≠ paused)');
select pg_temp.expect('C5d', $q$ select api_app_v1.mentor_plan_active_set('limited', true) $q$, 'MENTOR_TERMINATED', 'C-5 종료 절차 중 플랜 토글 불가');
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('C5e', format($q$ select api_app_v1.subscribe_with_cash(%L, 'limited', 'K-m7b') $q$, :m7::uuid), 'MENTOR_TERMINATED', 'C-5 종료 예약 멘토 신규 구독 차단');
select pg_temp.as_user(:m4::uuid, 'authenticated');
select pg_temp.expect('C6a', $q$ select api_app_v1.mentor_activity_set('terminating', null, now() + interval '100 days') $q$, 'TERMINATION_DATE_TOO_FAR', 'C-6 효력일 90일 초과');
select pg_temp.expect('C6b', $q$ select api_app_v1.mentor_activity_set('terminating', null, now() + interval '1 day') $q$, 'OK', 'C-6 효력일이 14일 미만이면 +14일로 올림');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((select activity_status = 'terminating' and termination_requested_at is not null
                          and termination_effective_at > now() + interval '19 days' and termination_effective_at < now() + interval '21 days'
                     from public.mentor_profiles where user_id = :m7::uuid)
                  and (pg_temp.res('C5') ->> 'plans_deactivated')::int = 3 and (pg_temp.res('C5') ->> 'notified_subscribers')::int = 1,
                  'C-5 terminating · 효력일 +20일 · 플랜 3 비활성 · 구독자 1');
select pg_temp.ok((select count(*) from public.mentor_plans where mentor_id = :m7::uuid and is_active) = 0
                  and (select count(*) from public.mentor_activity_events where mentor_id = :m7::uuid and event_type = 'termination_requested') = 1
                  and (select count(*) from public.notifications where recipient_user_id = :s2::uuid and event_key like 'mentor_termination_notice:%') = pg_temp.num('notif_s2_term0') + 1,
                  'C-5 플랜 전부 비활성 · 이벤트 · 158 mentor_termination_notice +1');
select pg_temp.ok((select termination_effective_at >= now() + interval '14 days' - interval '1 second' and termination_effective_at < now() + interval '14 days' + interval '1 minute'
                     from public.mentor_profiles where user_id = :m4::uuid), 'C-6 M4 효력일 = now + 14일(올림)');
select pg_temp.ok((select count(*) from public.mentor_activity_events where mentor_id = :m7::uuid) = pg_temp.num('ev_m7_0') + 5, 'C 이벤트 정확히 +5(pause·resume·pause·resume·terminate)');

-- ═══ D. 요금제 활성 여부 (M1 · S1 스탠다드 구독 중) ═══
insert into db4_num values ('notif_s1_d', (select count(*) from public.notifications where recipient_user_id = :s1::uuid));
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('D1a', $q$ select api_app_v1.mentor_plan_active_set('limited', false) $q$, 'ROLE_NOT_MENTOR', 'D-1 학생은 ROLE_NOT_MENTOR');
select pg_temp.as_user(:m6::uuid, 'authenticated');
select pg_temp.expect('D1b', $q$ select api_app_v1.mentor_plan_active_set('limited', false) $q$, 'PLAN_NOT_FOUND', 'D-1 미승인 멘토(플랜 없음) PLAN_NOT_FOUND');
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.expect('D1c', $q$ select api_app_v1.mentor_plan_active_set('gold', false) $q$, 'PLAN_TIER_INVALID', 'D-1 tier 밖');
select pg_temp.expect('D1d', $q$ select api_app_v1.mentor_plan_active_set('limited', null) $q$, 'PLAN_ACTIVE_VALUE_REQUIRED', 'D-1 값 없음');
select pg_temp.expect('D2a', $q$ select api_app_v1.mentor_plan_active_set('limited', false) $q$, 'OK', 'D-2 limited 끄기');
select pg_temp.expect('D2b', $q$ select api_app_v1.mentor_plan_active_set('standard', false) $q$, 'OK', 'D-2 standard 끄기(활성 구독 있어도 허용 — 기존 유지·신규만 차단)');
select pg_temp.expect('D2c', $q$ select api_app_v1.mentor_plan_active_set('premium', false) $q$, 'LAST_ACTIVE_PLAN', 'D-2 마지막 하나 끄기 거부');
select pg_temp.as_user(:s6::uuid, 'authenticated');
select pg_temp.expect('D2d', format($q$ select api_app_v1.subscribe_with_cash(%L, 'limited', 'K-s6') $q$, :m1::uuid), 'PLAN_INACTIVE', 'D-2 꺼진 tier 신규 구독 PLAN_INACTIVE');
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.expect('D2e', $q$ select api_app_v1.mentor_plan_active_set('limited', true) $q$, 'OK', 'D-2 limited 다시 켜기');
select pg_temp.expect('D2f', $q$ select api_app_v1.mentor_plan_active_set('limited', true) $q$, 'OK', 'D-2 같은 값 재호출(멱등)');
select pg_temp.expect('D2g', $q$ select api_app_v1.mentor_plan_active_set('standard', true) $q$, 'OK', 'D-2 standard 켜기');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('D2a') ->> 'changed') = 'true' and (pg_temp.res('D2a') -> 'active_tiers') = '["standard","premium"]'::jsonb
                  and (pg_temp.res('D2b') -> 'active_tiers') = '["premium"]'::jsonb and (pg_temp.res('D2f') ->> 'changed') = 'false'
                  and (pg_temp.res('D2g') -> 'active_tiers') = '["limited","standard","premium"]'::jsonb, 'D-2 응답 changed/active_tiers');
select pg_temp.ok((select status = 'active' from public.subscriptions where id = (pg_temp.res('A5') ->> 'subscription_id')::uuid), 'D-2 standard 를 껐다 켜도 S1 기존 구독 active 유지');
select pg_temp.ok((select count(*) from public.notifications where recipient_user_id = :s1::uuid) = pg_temp.num('notif_s1_d'), 'D-3 is_active 토글은 가격 변경 알림(158) 무발화');
select pg_temp.ok((select count(*) from public.mentor_plans where mentor_id = :m1::uuid and is_active) = 3, 'D-2 M1 플랜 3 tier 전부 활성 복원');

-- ═══ E. 재학 상태 · 학생증 사후 제출 ═══
set local role authenticated;
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.ok(r = 'OK', 'E-1 S1 재학 상태 = 휴학: ' || r) from (select pg_temp.try($q$ select api_app_v1.user_profile_update_self_v2(null, null, '휴학') $q$) r) t;
select pg_temp.ok(r like 'STUDENT_STATUS_TOO_LONG%', 'E-1 21자 거부: ' || r) from (select pg_temp.try($q$ select api_app_v1.user_profile_update_self_v2(null, null, repeat('가', 21)) $q$) r) t;
select pg_temp.ok(r = 'OK', 'E-1 닉네임·학년 동시 갱신(impl 위임) + 재학 상태 제거(''): ' || r) from (select pg_temp.try($q$ select api_app_v1.user_profile_update_self_v2('학생일v2', '고3', '') $q$) r) t;
select pg_temp.ok(r = 'OK', 'E-1 v1 그대로 동작: ' || r) from (select pg_temp.try($q$ select api_app_v1.user_profile_update_self('학생일v1', null) $q$) r) t;
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.ok(r like 'STUDENT_STATUS_NOT_ALLOWED%', 'E-1 멘토는 STUDENT_STATUS_NOT_ALLOWED: ' || r) from (select pg_temp.try($q$ select api_app_v1.user_profile_update_self_v2(null, null, '재학') $q$) r) t;
select pg_temp.as_user(:s3::uuid, 'authenticated');
select pg_temp.ok(r like 'ACCOUNT_BANNED%', 'E-1 banned 는 impl 게이트 ACCOUNT_BANNED: ' || r) from (select pg_temp.try($q$ select api_app_v1.user_profile_update_self_v2(null, null, '재학') $q$) r) t;
select pg_temp.as_user(null, 'authenticated');
select pg_temp.ok(r like 'AUTH_REQUIRED%', 'E-1 JWT 없음 AUTH_REQUIRED: ' || r) from (select pg_temp.try($q$ select api_app_v1.user_profile_update_self_v2(null, null, '재학') $q$) r) t;
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((select student_status is null and nickname = '학생일v1' and grade_level = '고3' from public.users where id = :s1::uuid), 'E-1 결과: student_status NULL(제거) · nickname v1 · grade 고3');
-- 학생증: 스토리지 객체(앱이 user JWT 로 올린 형태 — owner_id = uid) 재현
insert into storage.objects (bucket_id, name, owner_id) values
  ('student-id-images', '00000000-0000-4000-8000-00000000d4a1/1757000000-aaaa.jpg', '00000000-0000-4000-8000-00000000d4a1'),
  ('student-id-images', '00000000-0000-4000-8000-00000000d4a1/1757000001-bbbb.png', '00000000-0000-4000-8000-00000000d4a2'),
  ('student-id-images', '00000000-0000-4000-8000-00000000d4a2/1757000002-cccc.pdf', '00000000-0000-4000-8000-00000000d4a2');
set local role authenticated;
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.expect('E2a', $q$ select api_app_v1.mentor_student_id_document_set_self('00000000-0000-4000-8000-00000000d4a1/1757000000-aaaa.jpg') $q$, 'OK', 'E-2 ★ 본인 객체 반영');
select pg_temp.expect('E2b', $q$ select api_app_v1.mentor_student_id_document_set_self('student-id-images/00000000-0000-4000-8000-00000000d4a1/1757000000-aaaa.jpg') $q$, 'OK', 'E-2 저장값 형식(버킷 접두)도 허용');
select pg_temp.expect('E2c', $q$ select api_app_v1.mentor_student_id_document_set_self('00000000-0000-4000-8000-00000000d4a1/1757000001-bbbb.png') $q$, 'STORAGE_OBJECT_NOT_OWNED', 'E-2 내 폴더지만 owner_id 가 남(M2)');
select pg_temp.expect('E2d', $q$ select api_app_v1.mentor_student_id_document_set_self('00000000-0000-4000-8000-00000000d4a2/1757000002-cccc.pdf') $q$, 'STORAGE_PATH_INVALID', 'E-2 남의 폴더');
select pg_temp.expect('E2e', $q$ select api_app_v1.mentor_student_id_document_set_self('00000000-0000-4000-8000-00000000d4a1/../x.jpg') $q$, 'STORAGE_PATH_INVALID', 'E-2 경로 탈출');
select pg_temp.expect('E2f', $q$ select api_app_v1.mentor_student_id_document_set_self('00000000-0000-4000-8000-00000000d4a1/evil.exe') $q$, 'STORAGE_FILE_TYPE_INVALID', 'E-2 확장자 밖');
select pg_temp.expect('E2g', $q$ select api_app_v1.mentor_student_id_document_set_self('00000000-0000-4000-8000-00000000d4a1/missing.jpg') $q$, 'STORAGE_OBJECT_NOT_OWNED', 'E-2 객체 없음');
select pg_temp.expect('E2h', $q$ select api_app_v1.mentor_student_id_document_set_self('') $q$, 'STORAGE_PATH_REQUIRED', 'E-2 빈 경로');
select pg_temp.as_user(:s1::uuid, 'authenticated');
select pg_temp.expect('E2i', $q$ select api_app_v1.mentor_student_id_document_set_self('00000000-0000-4000-8000-00000000d4b1/x.jpg') $q$, 'ROLE_NOT_MENTOR', 'E-2 학생은 ROLE_NOT_MENTOR');
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('E2a') ->> 'stored_ref') = 'student-id-images/00000000-0000-4000-8000-00000000d4a1/1757000000-aaaa.jpg'
                  and (select student_id_image_url from public.mentor_profiles where user_id = :m1::uuid) = 'student-id-images/00000000-0000-4000-8000-00000000d4a1/1757000000-aaaa.jpg'
                  and (select verification_status = 'approved' and cap_limit = 50 from public.mentor_profiles where user_id = :m1::uuid),
                  'E-2 mentor_profiles.student_id_image_url = 웹 저장값 형식 · 특권 컬럼 불변');

-- ═══ F. 개별질문 v2 (과목) — S1 지갑 21,510,000 ═══
insert into db4_num values ('wallet_s1_f', (select balance_cents from public.cash_wallets where user_id = :s1::uuid)), ('iq0', (select count(*) from public.individual_questions));
set local role authenticated;
select pg_temp.as_user(:m1::uuid, 'authenticated');
select pg_temp.ok((select count(*) from public.set_individual_question_price(300000)) = 1, 'F-0 M1 지정 질문 단가 3,000캐시(기존 RPC)');
select pg_temp.as_user(:s1::uuid, 'authenticated');
insert into db4_res select 'F1', to_jsonb(q) from api_app_v1.create_individual_question_as_student_v2('open', '공개 질문', '미적분 질문 본문', 500000, null, 'iq-k1', 'math_calculus') q;
select pg_temp.ok(r like 'SUBJECT_REQUIRED%', 'F-1 공개형 과목 없음 → SUBJECT_REQUIRED: ' || r) from (select pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v2('open', 't', 'b', 500000, null, 'iq-k2', null) $q$) r) t;
select pg_temp.ok(r like 'INVALID_SUBJECT%', 'F-1 코드 정본 밖 과목 → INVALID_SUBJECT: ' || r) from (select pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v2('open', 't', 'b', 500000, null, 'iq-k3', '미적분') $q$) r) t;
insert into db4_res select 'F2', to_jsonb(q) from api_app_v1.create_individual_question_as_student_v2('direct', '지정 질문', '본문', null, :m1::uuid, 'iq-k4', null) q;
insert into db4_res select 'F3', to_jsonb(q) from api_app_v1.create_individual_question_as_student_v2('direct', '지정 질문 2', '본문', null, :m1::uuid, 'iq-k5', 'english') q;
select pg_temp.ok(r like 'MENTOR_PRICE_NOT_SET%', 'F-1 단가 없는 멘토 지정 → MENTOR_PRICE_NOT_SET(v1 동일): ' || r) from (select pg_temp.try(format($q$ select * from api_app_v1.create_individual_question_as_student_v2('direct', 't', 'b', null, %L, 'iq-k6', null) $q$, :m6::uuid)) r) t;
insert into db4_res select 'F1r', to_jsonb(q) from api_app_v1.create_individual_question_as_student_v2('open', '공개 질문', '미적분 질문 본문', 500000, null, 'iq-k1', 'math_calculus') q;
select pg_temp.ok((select count(*) from public.create_individual_question_as_student('open', 'v1 질문', '본문', 100000, null, 'iq-v1')) = 1, 'F-2 v1 그대로 동작(과목 없이)');
select pg_temp.as_user(null, 'authenticated');
select pg_temp.ok(r like 'AUTH_REQUIRED%', 'F-1 JWT 없음: ' || r) from (select pg_temp.try($q$ select * from api_app_v1.create_individual_question_as_student_v2('open', 't', 'b', 500000, null, 'iq-k7', 'math') $q$) r) t;
reset role;
select pg_temp.as_user(null, null);
select pg_temp.ok((pg_temp.res('F1') ->> 'subject') = 'math_calculus' and (pg_temp.res('F1') ->> 'status') = 'open' and (pg_temp.res('F1') ->> 'price_cents')::int = 500000
                  and (pg_temp.res('F1') ->> 'question_type') = 'open' and (pg_temp.res('F1') ->> 'student_id') = :s1
                  and (pg_temp.res('F1') ->> 'create_idempotency_key') = 'iq-k1', 'F-1 ★ 공개형 v2: subject math_calculus · open · 500,000');
select pg_temp.ok((pg_temp.res('F1r') ->> 'id') = (pg_temp.res('F1') ->> 'id'), 'F-1 같은 키 재호출 = 같은 행(코어 already_exists)');
select pg_temp.ok((pg_temp.res('F2') ->> 'subject') is null and (pg_temp.res('F2') ->> 'status') = 'assigned' and (pg_temp.res('F2') ->> 'price_cents')::int = 300000
                  and (pg_temp.res('F2') ->> 'designated_mentor_id') = :m1, 'F-1 지정형 v2: 과목 선택(NULL) · assigned · 멘토 단가 300,000');
select pg_temp.ok((pg_temp.res('F3') ->> 'subject') = 'english', 'F-1 지정형 v2 + 과목 english');
select pg_temp.ok((select balance_cents from public.cash_wallets where user_id = :s1::uuid) = pg_temp.num('wallet_s1_f') - 500000 - 300000 - 300000 - 100000,
                  'F-1 지갑: 홀드 4건(500,000 + 300,000 + 300,000 + v1 100,000) · 재호출 이중 홀드 0');
select pg_temp.ok((select count(*) from public.individual_questions) = pg_temp.num('iq0') + 4
                  and (select count(*) from public.cash_ledger where idempotency_key = 'iq_hold:' || (pg_temp.res('F1') ->> 'id')) = 1, 'F-1 개별질문 +4 · 홀드 원장 iq_hold');
select pg_temp.ok(md5(pg_get_functiondef('public.create_individual_question_as_student(text,text,text,int,uuid,text)'::regprocedure)) = pg_temp.snap('fn_iq_v1'), 'F-2 v1 md5 불변');

-- ═══ G. 정본 불변 · census ═══
select pg_temp.ok(md5(pg_get_functiondef('api_web_v1.subscription_checkout_confirm_v2(uuid,uuid,integer,text)'::regprocedure)) = pg_temp.snap('fn_f12')
                  and md5(pg_get_functiondef('public.confirm_subscription_checkout(uuid,uuid,text)'::regprocedure)) = pg_temp.snap('fn_confirm')
                  and md5(pg_get_functiondef('api_app_v1.user_profile_update_self(text,text)'::regprocedure)) = pg_temp.snap('fn_profile_v1')
                  and md5(pg_get_functiondef('api_web_v1.mentor_plan_prices_set_self(integer,integer,integer)'::regprocedure)) = pg_temp.snap('fn_f8'),
                  'G F12 · 정본 confirm · v1 profile · F8 md5 불변(웹 표면 무변경)');
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'public')::text = pg_temp.snap('policies_count')
                  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api_web_v1')::text = pg_temp.snap('fn_web_count')
                  and (select coalesce(with_check, '') from pg_policies where tablename = 'refunds' and policyname = 'refund_ins') = pg_temp.snap('pol_refund_ins'),
                  'G 정책 수 · api_web_v1 함수 수 · refund_ins 불변');

\echo DB4 POST FIXTURE PASS
rollback;
