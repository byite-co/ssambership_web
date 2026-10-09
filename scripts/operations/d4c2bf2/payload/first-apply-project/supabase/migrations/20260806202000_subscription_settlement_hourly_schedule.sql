-- [S1-6 2026-08-06] QA-A2 — 구독 정산 항목이 생성되지 않는다.
--
-- 증상: 결제가 succeeded 인데 subscription_settlement_items 가 0건이고 멘토
--       정산 화면이 0원으로 보인다.
--       DB 실측: active 구독 1건 · subscription_billing_events 1건(94,900원,
--       initial/succeeded) · settlement_items **0건** · cron.job **0건**.
--
-- 원인: 계산 함수 public.refresh_subscription_settlement_items(p_from, p_to) 는
--       완성돼 있으나 **호출자가 없다**. subscription_billing_events 의 트리거
--       2개는 이름 그대로 알림 발송용(trg_sbe_notify_*)이고, pg_cron 확장은
--       설치돼 있는데 등록된 스케줄이 0건이다.
--
-- 결정(오너 판단 2026-08-06): **매시간 실행**.
--
-- 선행 조건: S1-1(탈퇴 가드 분리, 20260806200000)이 먼저 적용돼야 한다.
--   정산 항목이 생겨 실제 지급 단계로 넘어가면 멘토 앞 cash_ledger INSERT 가
--   같은 가드에 다시 막힌다.
--
-- 재계산 창(window): 최근 45일. 구독 주기(월 단위)와 적립중(accruing) 기간을
--   덮으면서, 전 기간을 매시간 훑지 않도록 제한한다. 함수는 멱등이라 같은 구간을
--   반복 계산해도 결과가 누적되지 않는다.
--
-- ★ 로컬 재생 안전: 스크래치 PG 에는 pg_cron 이 없다. 확장 존재를 확인하고
--   없으면 조용히 건너뛴다 — migration pack 의 fresh replay 가 깨지지 않는다.

do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'S1-6: pg_cron 미설치 — 스케줄 등록을 건너뛴다(로컬 재생 환경).';
    return;
  end if;

  -- 같은 이름의 기존 잡이 있으면 제거(멱등 — 재적용 시 중복 등록 방지)
  perform cron.unschedule(jobid) from cron.job
   where jobname = 'subscription_settlement_refresh_hourly';

  perform cron.schedule(
    'subscription_settlement_refresh_hourly',
    '0 * * * *',
    $job$select public.refresh_subscription_settlement_items(now() - interval '45 days', now());$job$
  );

  raise notice 'S1-6: subscription_settlement_refresh_hourly 등록 완료(매시 정각).';
end
$do$;
