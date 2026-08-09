create or replace function public.account_deletion_request_consented(
  p_user_id uuid,
  p_cancelable_minutes integer default 30,
  p_dry_run boolean default true,
  p_forfeit_consent boolean default false,
  p_acknowledged_balance_cents bigint default null::bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_state text; v_latest uuid; v_latest_state text;
  v_balance bigint; v_consent_at timestamptz; v_consented bigint;
begin
  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is not null then
    select j.state into v_state from public.account_deletion_jobs j where j.id = v_id;
    return jsonb_build_object('ok',true,'existing',true,'job_id',v_id,'state',v_state);
  end if;

  select j.id, j.state into v_latest, v_latest_state
    from public.account_deletion_jobs j
    where j.user_id = p_user_id
    order by j.requested_at desc, j.id desc
    limit 1;
  if v_latest_state = 'completed' then
    return jsonb_build_object('ok',false,'code','ALREADY_COMPLETED','job_id',v_latest,'state','completed');
  end if;

  select coalesce(w.balance_cents, 0) into v_balance
    from public.cash_wallets w where w.user_id = p_user_id for update;
  v_balance := coalesce(v_balance, 0);

  if v_balance > 0 then
    if not coalesce(p_forfeit_consent, false) then
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_REQUIRED','balance_cents',v_balance);
    end if;
    if p_acknowledged_balance_cents is not null and p_acknowledged_balance_cents <> v_balance then
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_STALE',
        'acknowledged_balance_cents', p_acknowledged_balance_cents, 'current_balance_cents', v_balance);
    end if;
    v_consent_at := now();
    v_consented := v_balance;
  else
    v_consent_at := null;
    v_consented := 0;
  end if;

  insert into public.account_deletion_jobs
      (user_id, state, cancelable_until, dry_run, forfeit_consent_at, consented_balance_cents)
    values (
      p_user_id,
      'pending',
      now() + interval '30 days',
      coalesce(p_dry_run,true),
      v_consent_at,
      v_consented
    )
    returning id into v_id;

  return jsonb_build_object('ok',true,'existing',false,'job_id',v_id,'state','pending',
                            'forfeit_consent_at', v_consent_at,
                            'consented_balance_cents', v_consented);
end
$function$;

comment on function public.account_deletion_request_consented(uuid, integer, boolean, boolean, bigint)
is 'Account deletion request. p_cancelable_minutes is retained for backward compatibility but ignored; server policy fixes the cancellation/deletion grace window at 30 days.';

update public.account_deletion_jobs
   set cancelable_until = requested_at + interval '30 days',
       updated_at = now()
 where state = 'pending'
   and (cancelable_until is null or cancelable_until < requested_at + interval '30 days');
