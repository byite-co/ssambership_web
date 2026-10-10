-- Read-only; run before and after staging rollout. A zero with zero events is not test coverage.
select 'succeeded_payment_without_initial_event' as invariant,count(*) as violations
from public.payments p where p.kind='subscription' and p.status in ('succeeded','paid','success','complete','captured')
and not exists(select 1 from public.subscription_billing_events e where e.payment_id=p.id and e.event_type='initial' and e.status='succeeded')
union all
select 'terminal_event_current_period_without_expired_subscription',count(*)
from public.subscription_billing_events e join public.subscriptions s on s.id=e.subscription_id
where e.event_type in ('canceled','expired') and e.status='succeeded' and s.status<>'expired'
-- Historical terminal events survive reactivation. Only compare the subscription's current period.
and e.period_end=s.current_period_end
union all
select 'renewal_event_ledger_amount_or_binding_mismatch',count(*)
from public.subscription_billing_events e left join public.cash_ledger l on l.id=e.ledger_id
where e.event_type='renewal' and e.status='succeeded'
and (l.id is null or e.amount_cents is distinct from -l.delta_cents or e.student_id is distinct from l.user_id
 or e.subscription_id is distinct from l.ref_id or l.reason is distinct from 'subscription_renewal' or l.ref_type is distinct from 'subscriptions')
union all
select 'duplicate_renewal_debit_key',count(*) from
(select idempotency_key from public.cash_ledger where reason='subscription_renewal' group by idempotency_key having count(*)>1) d
union all
select 'succeeded_renewal_invalid_plan_binding',count(*)
from public.subscription_billing_events e left join public.mentor_plans p on p.id=e.plan_id
where e.event_type='renewal' and e.status='succeeded'
and (p.id is null or e.mentor_id is distinct from p.mentor_id or e.plan_tier is distinct from p.plan_tier);
select event_type,status,count(*) from public.subscription_billing_events group by event_type,status order by event_type,status;
