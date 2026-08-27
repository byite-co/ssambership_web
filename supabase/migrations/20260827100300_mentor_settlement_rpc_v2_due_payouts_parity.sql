-- 멘토 정산 RPC v2 — 지급 함수 모집단(due_payouts)과 동기화. 지급 함수/원천징수 함수 변경 없음.
--  · 맞춤의뢰: on_hold 는 지급 대상(=pending), 활성 분쟁은 hold(active_dispute), 미수락(accepted_at null)은 accruing,
--    cancelled/canceled 철자 및 주문 환불·취소는 canceled 로 통일
--  · 구독: period_end 경과 후 cron 반영 전(accruing 잔존)도 due_payouts 기준으로 pending 처리
--  · summary.confirmed 는 due_payouts ∩ completion_ts ≤ cutoff ∩ 미지급 + 해당 월 run 에서 지급된 건
--  · summary 에 payout_account_registered / cutoff 추가 (계좌 미등록 시 run 이 skip → 이월 안내용)

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
           i.status as raw_status, i.hold_reason as raw_hold_reason,
           i.period_end as completion_ts, i.paid_at,
           false as active_dispute, false as order_dead
      from public.subscription_settlement_items i
    union all
    select 'custom_request', c.id, c.mentor_id,
           c.created_at, null::timestamptz, null::timestamptz,
           c.gross_amount::bigint * 100, c.platform_fee_amount::bigint * 100, c.mentor_amount::bigint * 100, c.fee_rate,
           c.status, c.reason,
           o.accepted_at, c.paid_at,
           exists (select 1 from public.disputes d
                    where d.custom_request_order_id = o.id
                      and d.status in ('open','under_review','escalated')),
           (coalesce(lower(trim(o.payment_status)), '') = 'refunded'
            or coalesce(lower(trim(o.status)), '') in ('cancelled','canceled','refunded'))
      from public.custom_order_settlement_items c
      join public.custom_request_orders o on o.id = c.custom_request_order_id
    union all
    select 'individual_question', q.id, coalesce(q.claimed_mentor_id, q.designated_mentor_id),
           q.released_at, null::timestamptz, null::timestamptz,
           q.price_cents::bigint,
           q.price_cents::bigint - floor(q.price_cents::numeric * 0.85)::bigint,
           floor(q.price_cents::numeric * 0.85)::bigint, 0.15::numeric,
           case when q.release_ledger_id is not null then 'paid' else coalesce(q.status, '') end, null::text,
           q.released_at, null::timestamptz,
           false, false
      from public.individual_questions q
     where q.released_at is not null
       and coalesce(q.claimed_mentor_id, q.designated_mentor_id) is not null
  ),
  norm as (
    select b.*,
           pri.id as pri_id, pri.withholding_cents as pri_wh, pri.net_paid_cents as pri_net,
           pri.created_at as pri_created_at, pr.run_date as pri_run_date,
           case
             when pri.id is not null or b.raw_status = 'paid' then 'paid'
             when exists (select 1 from public.due_payouts d
                           where d.source_type = b.source_type and d.source_id = b.source_id) then 'pending'
             when b.source_type = 'subscription' then
               case when b.raw_status = 'accruing' then 'accruing'
                    when b.raw_status = 'hold'     then 'hold'
                    when b.raw_status = 'pending'  then 'pending'
                    else 'canceled' end
             when b.source_type = 'custom_request' then
               case when b.raw_status not in ('pending','on_hold','payable') then 'canceled'
                    when b.order_dead then 'canceled'
                    when b.active_dispute then 'hold'
                    when b.completion_ts is null then 'accruing'
                    else 'pending' end
             else 'canceled'
           end as status,
           case when b.source_type = 'custom_request' and b.active_dispute then 'active_dispute'
                else b.raw_hold_reason end as hold_reason
      from base b
      left join public.payout_run_items pri
             on pri.source_type = b.source_type and pri.source_id = b.source_id
      left join public.payout_runs pr on pr.id = pri.payout_run_id
     where b.mentor_id = auth.uid()
  )
  select n.source_type, n.source_id, n.occurred_at, n.period_start, n.period_end,
         n.gross_cents, n.platform_fee_cents, n.mentor_amount_cents, n.fee_rate,
         coalesce(n.pri_wh,  public.calc_withholding_cents(n.mentor_amount_cents))                        as withholding_cents,
         coalesce(n.pri_net, n.mentor_amount_cents - public.calc_withholding_cents(n.mentor_amount_cents)) as net_cents,
         n.status,
         n.hold_reason,
         n.completion_ts,
         case when n.status in ('paid','canceled','hold') or n.completion_ts is null then null
              else (date_trunc('month', n.completion_ts at time zone 'Asia/Seoul') + interval '1 month' + interval '22 days')::date
         end as expected_run_date,
         n.pri_run_date as paid_run_date,
         coalesce(n.pri_created_at, n.paid_at) as paid_at
    from norm n
   where (p_from is null or n.occurred_at >= p_from)
     and (p_to   is null or n.occurred_at <  p_to)
   order by n.occurred_at desc;
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
  cut as (  -- pay_due_payouts_for_run 과 동일한 cutoff: 다음 달 1일 00:00 KST − 1초, run_date = 다음 달 23일
    select ((m.m_next::timestamp) at time zone 'Asia/Seoul') - interval '1 second' as ts,
           (m.m_next + interval '22 days')::date as run_date
      from m
  ),
  l as (select * from public.mentor_settlement_lines(null, null)),
  confirmed_rows as (
    -- (a) 지급 함수 모집단 그대로: due_payouts ∩ completion_ts ≤ cutoff ∩ 미지급
    select d.gross_cents, d.platform_fee_cents, d.mentor_amount_cents,
           public.calc_withholding_cents(d.mentor_amount_cents) as withholding_cents,
           d.mentor_amount_cents - public.calc_withholding_cents(d.mentor_amount_cents) as net_cents
      from public.due_payouts d, cut
     where d.mentor_id = auth.uid()
       and d.completion_ts <= cut.ts
       and not exists (select 1 from public.payout_run_items i
                        where i.source_type = d.source_type and i.source_id = d.source_id)
    union all
    -- (b) 해당 월 run 에서 이미 지급된 건 (과거 월 조회 시 카드가 비지 않도록)
    select i.gross_cents, i.platform_fee_cents, i.mentor_amount_cents, i.withholding_cents, i.net_paid_cents
      from public.payout_run_items i
      join public.payout_runs r on r.id = i.payout_run_id, cut
     where i.mentor_id = auth.uid()
       and r.run_date = cut.run_date
  ),
  confirmed as (
    select coalesce(sum(gross_cents),0) g, coalesce(sum(platform_fee_cents),0) f,
           coalesce(sum(mentor_amount_cents),0) a, coalesce(sum(withholding_cents),0) w,
           coalesce(sum(net_cents),0) n, count(*) c
      from confirmed_rows
  ),
  accruing as (
    select coalesce(sum(mentor_amount_cents),0) a, coalesce(sum(withholding_cents),0) w,
           coalesce(sum(net_cents),0) n, count(*) c,
           max(completion_ts) as last_period_end, max(expected_run_date) as expected_run_date
      from l where l.status = 'accruing'
  ),
  held as (
    select coalesce(sum(mentor_amount_cents),0) a, count(*) c
      from l where l.status = 'hold'
  ),
  paid as (
    select coalesce(sum(net_cents),0) n, coalesce(sum(mentor_amount_cents),0) a, count(*) c
      from l where l.status = 'paid'
  ),
  by_source_month as (  -- 카드 하단 소스별 수익: 이번 달 발생 기준, 취소 제외
    select l.source_type, coalesce(sum(mentor_amount_cents),0) a, count(*) c
      from l, m
     where l.occurred_at >= (m.m_start::timestamp at time zone 'Asia/Seoul')
       and l.occurred_at <  (m.m_next::timestamp  at time zone 'Asia/Seoul')
       and l.status <> 'canceled'
     group by l.source_type
  ),
  acct as (
    select coalesce(nullif(trim(mp.payout_account_number), ''), '') <> '' as registered
      from public.mentor_profiles mp
     where mp.user_id = auth.uid()
  )
  select jsonb_build_object(
    'month',      to_char(m.m_start, 'YYYY-MM'),
    'run_date',   cut.run_date,
    'cutoff',     cut.ts,
    'payout_account_registered', coalesce((select registered from acct), false),
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
  from m, cut;
$$;

revoke all on function public.mentor_settlement_lines(timestamptz, timestamptz) from public;
revoke all on function public.mentor_settlement_summary(date)                   from public;
grant execute on function public.mentor_settlement_lines(timestamptz, timestamptz) to authenticated;
grant execute on function public.mentor_settlement_summary(date)                   to authenticated;

-- 검증 (구조만, 데이터 무의존 — CI 재생에서도 통과해야 함)
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'mentor_settlement_lines'
         and p.prosrc like '%due_payouts%' and p.prosrc like '%active_dispute%') <> 1 then
    raise exception 'mentor_settlement_lines v2 verification failed';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'mentor_settlement_summary'
         and p.prosrc like '%payout_account_registered%' and p.prosrc like '%confirmed_rows%') <> 1 then
    raise exception 'mentor_settlement_summary v2 verification failed';
  end if;
  if has_function_privilege('anon', 'public.mentor_settlement_summary(date)', 'execute')
     or not has_function_privilege('authenticated', 'public.mentor_settlement_summary(date)', 'execute') then
    raise exception 'grant verification failed';
  end if;
end $$;
