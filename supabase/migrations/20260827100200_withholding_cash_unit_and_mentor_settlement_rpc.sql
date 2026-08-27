-- 원천징수 계산 단일화(캐시 단위 절사) + 지급 cutoff KST 고정 + 멘토 정산 RPC
-- 검증된 전제: payout_runs 0건, payout_settings.scheduler_enabled=false (첫 지급 실행 전)

------------------------------------------------------------------
-- 1) 원천징수 단일 계산 함수 — 규칙 A: 3.3% 를 캐시(원) 단위에서 절사, 결과는 항상 100 cents 배수
------------------------------------------------------------------
create or replace function public.calc_withholding_cents(p_mentor_amount_cents bigint)
returns bigint
language sql
immutable
parallel safe
set search_path = public
as $$
  select (floor(floor(coalesce(p_mentor_amount_cents, 0) / 100.0) * 0.033))::bigint * 100;
$$;

comment on function public.calc_withholding_cents(bigint) is
  '원천징수 3.3% — 캐시(원) 단위 절사. 지급 함수/리포트/멘토 화면이 모두 이 함수를 사용한다.';

revoke all on function public.calc_withholding_cents(bigint) from public;
grant execute on function public.calc_withholding_cents(bigint) to authenticated, service_role;

------------------------------------------------------------------
-- 2) pay_due_payouts_for_run: 원천징수 식 치환 + cutoff KST 월말 고정 (본문 나머지 그대로, 기대 문자열 없으면 중단)
------------------------------------------------------------------
do $$
declare
  v_def text;
  v_needle_wh  text := 'floor(rec.mentor_amount_cents::numeric * 0.033)::bigint';
  v_needle_cut text := 'date_trunc(''month'', p_run_date::timestamp) - interval ''1 second''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pay_due_payouts_for_run';
  if v_def is null or position(v_needle_wh in v_def) = 0 then
    raise exception 'pay_due_payouts_for_run: withholding line not found - abort';
  end if;
  if position(v_needle_cut in v_def) = 0 then
    raise exception 'pay_due_payouts_for_run: cutoff expr not found - abort';
  end if;
  v_def := replace(v_def, v_needle_wh,  'public.calc_withholding_cents(rec.mentor_amount_cents)');
  v_def := replace(v_def, v_needle_cut, '(date_trunc(''month'', p_run_date::timestamp) at time zone ''Asia/Seoul'') - interval ''1 second''');
  execute v_def;
end $$;

------------------------------------------------------------------
-- 3) payout_reconciliation_report: 동일 치환
------------------------------------------------------------------
do $$
declare
  v_def text;
  v_needle_wh  text := 'floor(d.mentor_amount_cents::numeric * 0.033)::bigint';
  v_needle_cut text := 'date_trunc(''month'', p_run_date::timestamp) - interval ''1 second''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'payout_reconciliation_report';
  if v_def is null or position(v_needle_wh in v_def) = 0 then
    raise exception 'payout_reconciliation_report: withholding expr not found - abort';
  end if;
  if position(v_needle_cut in v_def) = 0 then
    raise exception 'payout_reconciliation_report: cutoff expr not found - abort';
  end if;
  v_def := replace(v_def, v_needle_wh,  'public.calc_withholding_cents(d.mentor_amount_cents)');
  v_def := replace(v_def, v_needle_cut, '(date_trunc(''month'', p_run_date::timestamp) at time zone ''Asia/Seoul'') - interval ''1 second''');
  execute v_def;
end $$;

------------------------------------------------------------------
-- 4) 멘토용 RPC — 프론트 계산 제거. security definer + auth.uid() 고정
------------------------------------------------------------------
create or replace function public.mentor_settlement_lines(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (
  source_type         text,
  source_id           uuid,
  occurred_at         timestamptz,
  period_start        timestamptz,
  period_end          timestamptz,
  gross_cents         bigint,
  platform_fee_cents  bigint,
  mentor_amount_cents bigint,
  fee_rate            numeric,
  withholding_cents   bigint,
  net_cents           bigint,
  status              text,
  hold_reason         text,
  completion_ts       timestamptz,
  expected_run_date   date,
  paid_run_date       date,
  paid_at             timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select 'subscription'::text as source_type, i.id as source_id, i.mentor_id,
           i.billing_at as occurred_at, i.period_start, i.period_end,
           i.gross_cents, i.platform_fee_cents, i.mentor_amount_cents, i.fee_rate,
           i.status, i.hold_reason, i.period_end as completion_ts, i.paid_at
      from public.subscription_settlement_items i
    union all
    select 'custom_request', c.id, c.mentor_id,
           c.created_at, null::timestamptz, null::timestamptz,
           c.gross_amount::bigint * 100, c.platform_fee_amount::bigint * 100, c.mentor_amount::bigint * 100, c.fee_rate,
           c.status, c.reason, o.accepted_at, c.paid_at
      from public.custom_order_settlement_items c
      join public.custom_request_orders o on o.id = c.custom_request_order_id
    union all
    select 'individual_question', q.id, coalesce(q.claimed_mentor_id, q.designated_mentor_id),
           q.released_at, null::timestamptz, null::timestamptz,
           q.price_cents::bigint,
           q.price_cents::bigint - floor(q.price_cents::numeric * 0.85)::bigint,
           floor(q.price_cents::numeric * 0.85)::bigint, 0.15::numeric,
           case when q.release_ledger_id is not null then 'paid'
                when q.refund_ledger_id is not null or q.status in ('refunded','expired','canceled') then 'canceled'
                else 'pending' end,
           null::text, q.released_at, null::timestamptz
      from public.individual_questions q
     where q.released_at is not null
       and coalesce(q.claimed_mentor_id, q.designated_mentor_id) is not null
  )
  select b.source_type, b.source_id, b.occurred_at, b.period_start, b.period_end,
         b.gross_cents, b.platform_fee_cents, b.mentor_amount_cents, b.fee_rate,
         coalesce(pri.withholding_cents, public.calc_withholding_cents(b.mentor_amount_cents))                        as withholding_cents,
         coalesce(pri.net_paid_cents,   b.mentor_amount_cents - public.calc_withholding_cents(b.mentor_amount_cents)) as net_cents,
         case when pri.id is not null then 'paid' else b.status end                                                   as status,
         b.hold_reason,
         b.completion_ts,
         case when pri.id is not null or b.completion_ts is null then null
              else (date_trunc('month', b.completion_ts at time zone 'Asia/Seoul') + interval '1 month' + interval '22 days')::date
         end                                                                                                          as expected_run_date,
         pr.run_date                                                                                                  as paid_run_date,
         coalesce(pri.created_at, b.paid_at)                                                                          as paid_at
    from base b
    left join public.payout_run_items pri
           on pri.source_type = b.source_type and pri.source_id = b.source_id
    left join public.payout_runs pr on pr.id = pri.payout_run_id
   where b.mentor_id = auth.uid()
     and (p_from is null or b.occurred_at >= p_from)
     and (p_to   is null or b.occurred_at <  p_to)
   order by b.occurred_at desc;
$$;

create or replace function public.mentor_settlement_summary(p_month date default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with m as (
    select date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Seoul')::date))::date                        as m_start,
           (date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Seoul')::date)) + interval '1 month')::date as m_next
  ),
  l as (select * from public.mentor_settlement_lines(null, null)),
  confirmed as (  -- 이번 달 확정분 = 완료시점이 이번 달 말(KST) 이전 & 미지급 & 보류/취소 아님 → 다음 달 23일 지급 대상
    select coalesce(sum(gross_cents),0) g, coalesce(sum(platform_fee_cents),0) f,
           coalesce(sum(mentor_amount_cents),0) a, coalesce(sum(withholding_cents),0) w,
           coalesce(sum(net_cents),0) n, count(*) c
      from l, m
     where l.status not in ('paid','hold','on_hold','canceled')
       and l.completion_ts is not null
       and l.completion_ts < (m.m_next::timestamp at time zone 'Asia/Seoul')
  ),
  accruing as (
    select coalesce(sum(mentor_amount_cents),0) a, coalesce(sum(withholding_cents),0) w,
           coalesce(sum(net_cents),0) n, count(*) c,
           max(completion_ts) as last_period_end, max(expected_run_date) as expected_run_date
      from l where l.status = 'accruing'
  ),
  held as (
    select coalesce(sum(mentor_amount_cents),0) a, count(*) c
      from l where l.status in ('hold','on_hold')
  ),
  paid as (
    select coalesce(sum(net_cents),0) n, coalesce(sum(mentor_amount_cents),0) a, count(*) c
      from l where l.status = 'paid'
  ),
  by_source_month as (  -- 카드 하단 소스별 수익: 이번 달 발생 기준
    select l.source_type, coalesce(sum(mentor_amount_cents),0) a, count(*) c
      from l, m
     where l.occurred_at >= (m.m_start::timestamp at time zone 'Asia/Seoul')
       and l.occurred_at <  (m.m_next::timestamp  at time zone 'Asia/Seoul')
       and l.status <> 'canceled'
     group by l.source_type
  )
  select jsonb_build_object(
    'month',      to_char(m.m_start, 'YYYY-MM'),
    'run_date',   (m.m_next + interval '22 days')::date,
    'confirmed',  (select jsonb_build_object('count',c,'gross_cents',g,'platform_fee_cents',f,
                                             'mentor_amount_cents',a,'withholding_cents',w,'net_cents',n) from confirmed),
    'accruing',   (select jsonb_build_object('count',c,'mentor_amount_cents',a,'withholding_cents',w,'net_cents',n,
                                             'last_period_end',last_period_end,'expected_run_date',expected_run_date) from accruing),
    'held',       (select jsonb_build_object('count',c,'mentor_amount_cents',a) from held),
    'paid_total', (select jsonb_build_object('count',c,'mentor_amount_cents',a,'net_cents',n) from paid),
    'by_source_this_month',
                  (select coalesce(jsonb_object_agg(source_type, jsonb_build_object('mentor_amount_cents',a,'count',c)), '{}'::jsonb)
                     from by_source_month),
    'withholding_rule', 'calc_withholding_cents'
  )
  from m;
$$;

revoke all on function public.mentor_settlement_lines(timestamptz, timestamptz) from public;
revoke all on function public.mentor_settlement_summary(date)                   from public;
grant execute on function public.mentor_settlement_lines(timestamptz, timestamptz) to authenticated;
grant execute on function public.mentor_settlement_summary(date)                   to authenticated;

------------------------------------------------------------------
-- 5) 검증 (실패 시 전체 롤백)
------------------------------------------------------------------
do $$
declare v_cnt int;
begin
  if public.calc_withholding_cents(14866500) <> 490500 then
    raise exception 'calc_withholding_cents check failed: %', public.calc_withholding_cents(14866500);
  end if;
  if public.calc_withholding_cents(0) <> 0 or public.calc_withholding_cents(null) <> 0 then
    raise exception 'calc_withholding_cents zero/null check failed';
  end if;
  select count(*) into v_cnt
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('pay_due_payouts_for_run','payout_reconciliation_report')
     and p.prosrc like '%calc_withholding_cents%'
     and p.prosrc like '%at time zone ''Asia/Seoul''%'
     and p.prosrc not like '%0.033%';
  if v_cnt <> 2 then
    raise exception 'withholding/cutoff patch verification failed (matched % of 2)', v_cnt;
  end if;
end $$;
