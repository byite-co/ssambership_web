-- =============================================================================
-- 108_pay_due_payouts_rpc.sql      ★★★ DRAFT — DB 미적용 / 실행 금지 ★★★
-- =============================================================================
-- 목적(②단계): 매월 23일 "통합 후불 지급" 배치 RPC.
--   due_payouts(107) 후보 중 completion_ts <= cutoff(전월 말 23:59) AND 미지급만
--   골라 채널별 지급 primitive 를 호출하고, payout_run_items(106)에 불변 스냅샷 적재.
--
-- ⚠️ 이 파일은 "검토용 초안"이다. 적용(psql 실행)·함수 교체·git push 금지.
--    실제 송금이 일어나는 RPC 이므로 오너 검토 + 스테이징 검증 후에만 적용.
--
-- 선행(적용 시): 105(게이팅·accruing), 106(payout_runs/items), 107(due_payouts),
--   109(IQ release/지급 분리), 110(CR 즉시지급 perform 제거).
--
-- 핵심 안전 불변식(설계 검증 STEP2 근거):
--   (A) cutoff 게이트: completion_ts <= cutoff 로 "기간 미완료(미래 period_end=accruing)"
--       구독 행을 배제. ← due_payouts 뷰 자체는 cutoff 미적용(107:5)이므로 이 게이트가
--       유일한 미완료 차단막. 빠지면 미래 사이클이 조기 지급되는 치명 버그.
--   (B) 미지급만: 채널 primitive 가 각자 멱등(cr_payout_/iq_payout:/sub_payout:) +
--       payout_run_items UNIQUE(run,source_type,source_id) → 재실행 이중지급 불가.
--   (C) 환불/취소/분쟁/hold 는 due_payouts(107) 단계에서 이미 제외됨.
--   (D) 계좌 미등록(mentor_profiles.payout_account_number 공백) 멘토는 skip(미지급 보류).
-- =============================================================================

create or replace function public.pay_due_payouts_for_run(
  p_run_date date,
  p_idempotency_key text default null
)
returns table (
  run_id uuid,
  paid_count integer,
  skipped_no_account integer,
  total_mentor_cents bigint
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_idem text := coalesce(p_idempotency_key, 'payout:' || to_char(p_run_date, 'YYYY-MM'));
  -- 전월 말 23:59:59 — 이 시점까지 '완료된' 건만 지급 대상(미래 accruing 배제).
  v_cutoff timestamptz := date_trunc('month', p_run_date::timestamp) - interval '1 second';
  v_run public.payout_runs%rowtype;
  v_run_id uuid;
  rec record;
  v_ledger_id uuid;
  v_has_account boolean;
  v_paid integer := 0;
  v_skipped integer := 0;
  v_total bigint := 0;
begin
  -- 1) 멱등 run 헤더 확보(같은 달 재실행 방지). 이미 completed 면 그 결과만 반환.
  select * into v_run from public.payout_runs where idempotency_key = v_idem;
  if found then
    v_run_id := v_run.id;
    if v_run.status = 'completed' then
      return query
        select v_run.id, v_run.mentor_count, 0, v_run.total_mentor_cents;
      return;
    end if;
  else
    insert into public.payout_runs (run_date, cutoff_end, status, idempotency_key)
    values (p_run_date, v_cutoff, 'executing', v_idem)
    returning id into v_run_id;
  end if;

  -- 2) 지급 대상 루프 — due_payouts 에서 cutoff 통과분만.
  --    (이미 payout_run_items 에 적재된 건은 UNIQUE 로 자동 스킵되지만, 명시적으로도 제외)
  for rec in
    select d.*
    from public.due_payouts d
    where d.completion_ts <= v_cutoff
      and not exists (
        select 1 from public.payout_run_items i
        where i.source_type = d.source_type and i.source_id = d.source_id
      )
    order by d.mentor_id, d.source_type, d.completion_ts
  loop
    -- (D) 계좌 미등록 멘토는 skip(보류). 다음 회차에 계좌 등록되면 재포착.
    select coalesce(nullif(trim(mp.payout_account_number), ''), '') <> ''
      into v_has_account
    from public.mentor_profiles mp
    where mp.user_id = rec.mentor_id;

    if coalesce(v_has_account, false) = false then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_ledger_id := null;

    -- 3) 채널별 지급 primitive 호출(각자 멱등). 그 후 ledger_id 역조회해 스냅샷.
    if rec.source_type = 'custom_request' then
      perform public.record_custom_order_escrow_payout(rec.source_id);
      select id into v_ledger_id from public.cash_ledger
      where idempotency_key = 'cr_payout_' || rec.source_id::text
        and reason = 'custom_order_escrow_payout' limit 1;

    elsif rec.source_type = 'individual_question' then
      -- 109 분리본: status='released' & release_ledger_id is null 인 건을 지급.
      perform public.release_individual_question_payout(rec.source_id);
      select id into v_ledger_id from public.cash_ledger
      where idempotency_key = 'iq_payout:' || rec.source_id::text
        and reason = 'individual_question_payout' limit 1;

    elsif rec.source_type = 'subscription' then
      -- 구독은 별도 primitive 없음 → 여기서 멘토 float 크레딧 + ssi status=paid.
      -- ★ 금액은 due_payouts(=ssi) 에 적재된 값 verbatim 사용.
      --   (오너 결정 ②: 기존 30%-수수료 적립 행은 재계산 없이 적재값 그대로 지급.)
      insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
      values (rec.mentor_id, rec.mentor_amount_cents, 'subscription_settlement_payout',
              'subscription_settlement_items', rec.source_id, 'sub_payout:' || rec.source_id::text)
      on conflict (idempotency_key) do nothing
      returning id into v_ledger_id;

      if v_ledger_id is not null then
        insert into public.cash_wallets (user_id, balance_cents)
        values (rec.mentor_id, 0) on conflict (user_id) do nothing;
        update public.cash_wallets w
        set balance_cents = w.balance_cents + rec.mentor_amount_cents
        where w.user_id = rec.mentor_id;
      else
        -- 멱등 재실행 — 기존 지급 ledger 역조회
        select id into v_ledger_id from public.cash_ledger
        where idempotency_key = 'sub_payout:' || rec.source_id::text limit 1;
      end if;

      update public.subscription_settlement_items
      set status = 'paid', paid_at = coalesce(paid_at, now()), updated_at = now()
      where id = rec.source_id and status <> 'paid';
    else
      -- 알 수 없는 채널 — 안전하게 skip(이론상 도달 불가, due_payouts CHECK 3채널).
      continue;
    end if;

    -- 4) 불변 스냅샷 적재(106). 금액은 지급 시점 고정.
    insert into public.payout_run_items (
      payout_run_id, mentor_id, source_type, source_id,
      gross_cents, platform_fee_cents, mentor_amount_cents, fee_rate, ledger_id
    ) values (
      v_run_id, rec.mentor_id, rec.source_type, rec.source_id,
      rec.gross_cents, rec.platform_fee_cents, rec.mentor_amount_cents, rec.fee_rate, v_ledger_id
    )
    on conflict (payout_run_id, source_type, source_id) do nothing;

    v_paid := v_paid + 1;
    v_total := v_total + rec.mentor_amount_cents;
  end loop;

  -- 5) run 헤더 마감(합계·상태).
  update public.payout_runs
  set status = 'completed',
      mentor_count = (select count(distinct mentor_id) from public.payout_run_items where payout_run_id = v_run_id),
      total_mentor_cents = (select coalesce(sum(mentor_amount_cents), 0) from public.payout_run_items where payout_run_id = v_run_id),
      executed_at = now(),
      updated_at = now()
  where id = v_run_id;

  return query select v_run_id, v_paid, v_skipped, v_total;
end;
$function$;

comment on function public.pay_due_payouts_for_run(date, text) is
  '108[DRAFT]: 23일 통합 후불 지급. due_payouts 중 completion_ts<=전월말 & 미지급만 채널별 지급+불변 스냅샷. 멱등(payout:YYYY-MM). service_role only. ★미적용 초안.';

revoke all on function public.pay_due_payouts_for_run(date, text) from public, anon, authenticated;
grant execute on function public.pay_due_payouts_for_run(date, text) to service_role;

-- =============================================================================
-- 적용 전 검토 포인트(오너):
--   1) cutoff 정의: date_trunc('month', run_date) - 1s = 전월 말 23:59:59. (23일 실행 가정)
--   2) 구독 미래 accruing 행은 (A) cutoff 게이트로만 배제 — due_payouts 뷰에 미래행이
--      보이는 건 정상(STEP2 발견). 이 RPC 없이 뷰를 직접 지급하면 조기지급 위험.
--   3) 계좌 미등록 skip 은 '영구 누락'이 아니라 '이번 회차 보류'(다음 달 재포착).
--   4) 구독 30%-적립 레거시 행: 적재값 그대로 지급(오너 결정 ②). 재계산 안 함.
--   5) 실제 적용 순서: 105→106→107→109→110→108. 108 단독 적용 금지.
-- =============================================================================
