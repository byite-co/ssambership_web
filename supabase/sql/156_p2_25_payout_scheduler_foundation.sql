-- 156_p2_25_payout_scheduler_foundation.sql
-- P2-25 지급 운영 scheduler 기반 — 기본 비활성(OFF). 153 지급 엔진 무수정.
-- 실송금이 아니라 내부지갑 적립 모델. cron 은 staging 에서도 기본 disabled(명시 enable 없으면 실지급 금지).
--
-- 신규:
--   * payout_settings(싱글턴): scheduler_enabled(기본 false) — 명시 활성 없으면 실지급 금지.
--   * payout_reconciliation_report(run_date): READ-ONLY — 지급 대상/제외/오류 사유 산출(돈 이동 0).
--   * run_scheduled_payout(run_date): 래퍼 — enabled 아니면 dry-run(보고서만), enabled 면 실지급(153).
--     한 배치 중복 실행은 153 멱등(payout:YYYY-MM)으로 봉쇄.
-- 선행: 153(pay_due_payouts_for_run·payout_run_items·전역 UNIQUE)·107(due_payouts).

begin;
set local lock_timeout='5s';

create table if not exists public.payout_settings (
  id int primary key default 1 check (id = 1),
  scheduler_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.payout_settings (id, scheduler_enabled) values (1, false) on conflict (id) do nothing;
alter table public.payout_settings enable row level security;
revoke all on public.payout_settings from anon, authenticated;
grant select, insert, update on public.payout_settings to service_role;

-- 지급 예정일(23일)·회차 산정 READ-ONLY 보고서: 대상/제외/오류 사유.
create or replace function public.payout_reconciliation_report(p_run_date date)
returns table (
  source_type text, source_id uuid, mentor_id uuid,
  mentor_amount_cents bigint, withholding_cents bigint, net_paid_cents bigint,
  eligible boolean, reason text
) language sql stable security definer set search_path to 'public' as $$
  with cutoff as (select (date_trunc('month', p_run_date::timestamp) - interval '1 second') as ts)
  select
    d.source_type, d.source_id, d.mentor_id,
    d.mentor_amount_cents,
    floor(d.mentor_amount_cents::numeric * 0.033)::bigint as withholding_cents,
    d.mentor_amount_cents - floor(d.mentor_amount_cents::numeric * 0.033)::bigint as net_paid_cents,
    (case when exists (select 1 from public.payout_run_items i where i.source_type=d.source_type and i.source_id=d.source_id) then false
          when d.completion_ts > (select ts from cutoff) then false
          when coalesce(nullif(trim(mp.payout_account_number),''),'') = '' then false
          else true end) as eligible,
    (case when exists (select 1 from public.payout_run_items i where i.source_type=d.source_type and i.source_id=d.source_id) then 'already_paid'
          when d.completion_ts > (select ts from cutoff) then 'not_due'
          when coalesce(nullif(trim(mp.payout_account_number),''),'') = '' then 'no_payout_account'
          else 'eligible' end) as reason
  from public.due_payouts d
  left join public.mentor_profiles mp on mp.user_id = d.mentor_id
  order by d.mentor_id, d.source_type;
$$;
revoke all on function public.payout_reconciliation_report(date) from public, anon, authenticated;
grant execute on function public.payout_reconciliation_report(date) to service_role;

-- scheduler 래퍼: enabled 없으면 dry-run(보고서만·돈 이동 0), enabled 면 실지급(153, 멱등).
create or replace function public.run_scheduled_payout(p_run_date date, p_force_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_enabled boolean; v_dry boolean; v_res record;
begin
  select scheduler_enabled into v_enabled from public.payout_settings where id = 1;
  v_enabled := coalesce(v_enabled, false);
  -- 명시 활성 없거나 강제 dry-run 이면 dry-run(실지급 금지).
  v_dry := (not v_enabled) or coalesce(p_force_dry_run, false);
  select * into v_res from public.pay_due_payouts_for_run(p_run_date, null, v_dry);
  return jsonb_build_object(
    'ok', true, 'scheduler_enabled', v_enabled, 'dry_run', v_res.dry_run,
    'run_id', v_res.run_id, 'paid_count', v_res.paid_count, 'skipped_no_account', v_res.skipped_no_account,
    'total_mentor_cents', v_res.total_mentor_cents, 'total_withholding_cents', v_res.total_withholding_cents,
    'total_net_cents', v_res.total_net_cents);
end $$;
revoke all on function public.run_scheduled_payout(date, boolean) from public, anon, authenticated;
grant execute on function public.run_scheduled_payout(date, boolean) to service_role;

commit;

-- §V(rollback-only): payout_settings 기본 scheduler_enabled=false · run_scheduled_payout 은 enabled=false 면
--   무조건 dry_run(payout_run_items/원장/지갑 변화 0) · enabled=true 라야 실지급 · 보고서는 대상/already_paid/
--   not_due/no_payout_account 분류(READ-ONLY) · cron 미설정(명시 호출만).
