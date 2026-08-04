-- postledger_as_applied_function_bodies.sql — 부모 as-applied 함수 본문 32건 (pg_get_functiondef 원문). 저장소 파일과 CR 제거 후에도 불일치하는 실측 정본.

-- public.accept_custom_order_deliverable_atomic(p_order_id uuid, p_student_id uuid, p_require_payment boolean)
CREATE OR REPLACE FUNCTION public.accept_custom_order_deliverable_atomic(p_order_id uuid, p_student_id uuid, p_require_payment boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.custom_request_orders%rowtype;
  app public.custom_request_applications%rowtype;
  v_norm text;
  v_pay text;
  v_dispute_cnt integer;
  v_deliverable_cnt integer;
  v_existing_settlement uuid;
  v_gross integer;
  v_platform_fee integer;
  v_mentor_amount integer;
  v_settlement_id uuid;
  v_settlement_created boolean := false;
  v_payout_done boolean := false;
  v_now timestamptz := now();
  v_fee_rate numeric := 0.05;  -- 252: 맞춤의뢰 수수료 5%
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'message', 'orderId가 필요합니다.');
  end if;
  if p_student_id is null then
    return jsonb_build_object('ok', false, 'message', '학생 ID가 필요합니다.');
  end if;

  select * into o
  from public.custom_request_orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', '주문을 찾을 수 없어요.');
  end if;

  if o.student_id is distinct from p_student_id then
    return jsonb_build_object('ok', false, 'message', '의뢰자(학생) 본인만 납품을 수락할 수 있습니다.');
  end if;

  v_pay := lower(trim(coalesce(nullif(trim(o.payment_status), ''), '')));
  -- escrowed(예치 완료) 또는 paid(멱등·수리) 만 허용. unpaid 등 레거시 무예치 차단.
  if p_require_payment and v_pay not in ('paid', 'escrowed') then
    return jsonb_build_object('ok', false, 'message', '결제(예치)가 완료되지 않은 주문은 수락할 수 없습니다.');
  end if;

  if o.completed_at is not null
     or o.closed_at is not null
     or o.finished_at is not null
     or lower(trim(coalesce(o.status, ''))) in (
       'completed','accepted','closed','finished','cancelled','canceled',
       'refunded','rejected','done','resolved','dispute_resolved'
     )
     or lower(trim(coalesce(o.state, ''))) in (
       'completed','accepted','closed','finished','cancelled','canceled',
       'refunded','rejected','done','resolved','dispute_resolved'
     )
     or lower(trim(coalesce(o.order_status, ''))) in (
       'completed','accepted','closed','finished','cancelled','canceled',
       'refunded','rejected','done','resolved','dispute_resolved'
     )
  then
    return jsonb_build_object('ok', false, 'message', '이미 완료된 주문입니다.');
  end if;

  v_norm := public._order_primary_status_norm(o);
  if v_norm = '' then
    return jsonb_build_object('ok', false, 'message', '주문 상태를 확인할 수 없어 수락할 수 없습니다.');
  end if;

  if v_norm not in (
    'delivered','delivered_pending_review','waiting_review','pending_review',
    'redelivered','delivery_submitted','in_review'
  ) then
    return jsonb_build_object(
      'ok', false,
      'message', format('현재 상태(%s)에서는 납품 수락을 할 수 없습니다.', v_norm)
    );
  end if;

  select count(*)::integer into v_dispute_cnt
  from public.disputes d
  where d.custom_request_order_id = p_order_id
    and d.status in ('open', 'under_review', 'escalated');

  if v_dispute_cnt > 0 then
    return jsonb_build_object('ok', false, 'message', '진행 중인 분쟁이 있어 납품 수락을 할 수 없습니다.');
  end if;

  select count(*)::integer into v_deliverable_cnt
  from public.custom_order_deliverables d
  where d.custom_request_order_id = p_order_id;

  if v_deliverable_cnt < 1 then
    return jsonb_build_object('ok', false, 'message', '등록된 납품이 없어 수락할 수 없습니다.');
  end if;

  select id into v_existing_settlement
  from public.custom_order_settlement_items s
  where s.custom_request_order_id = p_order_id;

  select a.* into app
  from public.custom_request_applications a
  where a.id = coalesce(o.application_id, o.custom_request_application_id, o.selected_application_id)
  limit 1;

  if v_existing_settlement is null then
    v_gross := public._pick_custom_order_gross_won(o, app);
    if v_gross is not null and v_gross > 0 then
      v_platform_fee := floor(v_gross * v_fee_rate)::integer;
      v_mentor_amount := v_gross - v_platform_fee;

      insert into public.custom_order_settlement_items (
        custom_request_order_id,
        mentor_id,
        student_id,
        gross_amount,
        platform_fee_amount,
        mentor_amount,
        fee_rate,
        status
      ) values (
        p_order_id,
        o.mentor_id,
        o.student_id,
        v_gross,
        v_platform_fee,
        v_mentor_amount,
        v_fee_rate,
        'pending'
      )
      returning id into v_settlement_id;

      v_settlement_created := true;
    end if;
  else
    v_settlement_id := v_existing_settlement;
  end if;

  update public.custom_request_orders
  set
    status = 'completed',
    state = 'completed',
    order_status = 'completed',
    accepted_at = coalesce(accepted_at, v_now),
    completed_at = coalesce(completed_at, v_now),
    updated_at = v_now
  where id = p_order_id;

  if v_settlement_id is not null then
    perform public.record_custom_order_escrow_payout(p_order_id);
    v_payout_done := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'settlement_created', v_settlement_created,
    'settlement_id', v_settlement_id,
    'gross', v_gross,
    'fee_rate', v_fee_rate,
    'payout_done', v_payout_done
  );
exception
  when others then
    if sqlstate = '23505' then
      select id into v_existing_settlement
      from public.custom_order_settlement_items s
      where s.custom_request_order_id = p_order_id;

      update public.custom_request_orders
      set
        status = 'completed',
        state = 'completed',
        order_status = 'completed',
        accepted_at = coalesce(accepted_at, v_now),
        completed_at = coalesce(completed_at, v_now),
        updated_at = v_now
      where id = p_order_id;

      if v_existing_settlement is not null then
        perform public.record_custom_order_escrow_payout(p_order_id);
        v_payout_done := true;
      end if;

      return jsonb_build_object(
        'ok', true,
        'settlement_created', false,
        'settlement_id', v_existing_settlement,
        'payout_done', v_payout_done,
        'reason', 'already_exists'
      );
    end if;
    raise;
end;
$function$
;

-- public.account_deletion_advance(p_user_id uuid, p_from text, p_to text)
CREATE OR REPLACE FUNCTION public.account_deletion_advance(p_user_id uuid, p_from text, p_to text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rows int := 0; v_col text; v_id uuid;
begin
  if p_from='pending' and p_to='locked' then
    raise exception 'USE_BEGIN_LOCKED: pending->locked must go through account_deletion_begin_locked'
      using errcode = '42501';
  end if;

  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return false; end if;

  if not (
    (p_from='locked' and p_to='purging') or
    (p_from='purging' and p_to='storage_purged') or
    (p_from='storage_purged' and p_to='finalized') or
    (p_from='finalized' and p_to='auth_soft_deleted') or
    (p_from='auth_soft_deleted' and p_to='completed')
  ) then
    raise exception 'INVALID_TRANSITION % -> %', p_from, p_to;
  end if;

  v_col := p_to || '_at';
  execute format(
    'update public.account_deletion_jobs set state=$2, %I=now(), updated_at=now() where id=$1 and state=$3',
    v_col
  ) using v_id, p_to, p_from;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $function$
;

-- public.account_deletion_begin_locked(p_user_id uuid)
CREATE OR REPLACE FUNCTION public.account_deletion_begin_locked(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_state text; v_cancelable timestamptz;
  v_consent_at timestamptz; v_consented bigint; v_balance bigint; v_rows int;
begin
  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;

  select j.state, j.cancelable_until, j.forfeit_consent_at, j.consented_balance_cents
    into v_state, v_cancelable, v_consent_at, v_consented
    from public.account_deletion_jobs j where j.id = v_id for update;
  if not found then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;
  if v_state <> 'pending' then
    return jsonb_build_object('ok',false,'code','NOT_PENDING','state',v_state);
  end if;
  if v_cancelable is not null and now() < v_cancelable then
    return jsonb_build_object('ok',false,'code','CANCEL_WINDOW_OPEN','cancelable_until',v_cancelable);
  end if;

  select coalesce(w.balance_cents, 0) into v_balance
    from public.cash_wallets w where w.user_id = p_user_id for update;
  v_balance := coalesce(v_balance, 0);

  if v_balance > 0 then
    if v_consent_at is null then
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_REQUIRED','current_balance_cents',v_balance);
    end if;
    if v_balance > coalesce(v_consented, 0) then
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_STALE',
        'consented_balance_cents', v_consented, 'current_balance_cents', v_balance);
    end if;
  end if;

  update public.account_deletion_jobs
    set state='locked', locked_at=now(), updated_at=now()
    where id = v_id and state='pending';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok',false,'code','NOT_PENDING'); end if;

  return jsonb_build_object('ok',true,'state','locked','job_id',v_id,'balance_cents',v_balance);
end $function$
;

-- public.account_deletion_cancel(p_user_id uuid)
CREATE OR REPLACE FUNCTION public.account_deletion_cancel(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_state text; v_cancelable timestamptz; v_rows int;
begin
  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;

  select j.state, j.cancelable_until into v_state, v_cancelable
    from public.account_deletion_jobs j where j.id = v_id for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  if v_state <> 'pending' then return jsonb_build_object('ok',false,'code','NOT_CANCELABLE','state',v_state); end if;
  if v_cancelable is not null and now() > v_cancelable then
    return jsonb_build_object('ok',false,'code','CANCEL_WINDOW_PASSED');
  end if;

  update public.account_deletion_jobs
    set state='canceled', canceled_at=now(), updated_at=now()
    where id = v_id and state = 'pending';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok',false,'code','NOT_CANCELABLE'); end if;
  return jsonb_build_object('ok',true,'state','canceled','job_id',v_id);
end $function$
;

-- public.account_deletion_cancel_self()
CREATE OR REPLACE FUNCTION public.account_deletion_cancel_self()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('account_deletion_self:' || v_uid::text, 0));
  return public.account_deletion_cancel(v_uid);
end;
$function$
;

-- public.account_deletion_forfeit_and_anonymize(p_user_id uuid)
CREATE OR REPLACE FUNCTION public.account_deletion_forfeit_and_anonymize(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_state text; v_balance bigint; v_ledger_id uuid;
  v_consent_at timestamptz; v_consented bigint; v_legacy_key text;
begin
  perform set_config('ssambership.deletion_worker', 'on', true);

  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;
  select j.state, j.forfeit_consent_at, j.consented_balance_cents
    into v_state, v_consent_at, v_consented
    from public.account_deletion_jobs j where j.id = v_id for update;
  if v_state is null then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;
  if v_state <> 'storage_purged' then
    return jsonb_build_object('ok',false,'code','WRONG_STATE','state',v_state);
  end if;

  select w.balance_cents into v_balance from public.cash_wallets w
    where w.user_id = p_user_id for update;

  if v_balance is not null and v_balance > 0 then
    if v_consent_at is null then
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_REQUIRED','current_balance_cents',v_balance);
    end if;
    if v_balance > coalesce(v_consented, 0) then
      return jsonb_build_object('ok',false,'code','FORFEIT_CONSENT_STALE',
        'consented_balance_cents', v_consented, 'current_balance_cents', v_balance);
    end if;

    v_legacy_key := 'forfeit_on_deletion:' || p_user_id::text;
    if exists (select 1 from public.cash_ledger l where l.idempotency_key = v_legacy_key) then
      perform public.account_deletion_record_error(
        p_user_id, 'LEGACY_FORFEIT_LEDGER_PRESENT: 운영자 검토 필요 — 레거시 몰수 원장 존재, 재몰수 차단');
      return jsonb_build_object('ok',false,'code','LEGACY_FORFEIT_LEDGER_PRESENT',
        'current_balance_cents', v_balance,
        'legacy_idempotency_key', v_legacy_key);
    end if;

    insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
    values (p_user_id, -v_balance, 'account_deletion_forfeit', 'account_deletion', p_user_id,
            'acct_del_forfeit:'||p_user_id::text)
    on conflict (idempotency_key) do nothing
    returning id into v_ledger_id;
    if v_ledger_id is not null then
      update public.cash_wallets set balance_cents = 0 where user_id = p_user_id;
    end if;
  end if;

  perform public.anonymize_user_for_deletion(p_user_id, 'account_deletion');
  return jsonb_build_object('ok',true,'forfeited_cents',coalesce(v_balance,0),'ledger_id',v_ledger_id,'job_id',v_id);
end $function$
;

-- public.account_deletion_record_error(p_user_id uuid, p_error text, p_backoff_seconds integer, p_max_attempts integer)
CREATE OR REPLACE FUNCTION public.account_deletion_record_error(p_user_id uuid, p_error text, p_backoff_seconds integer DEFAULT 60, p_max_attempts integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_attempts int; v_id uuid;
begin
  v_id := public.account_deletion_active_job_id(p_user_id);
  if v_id is null then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;

  update public.account_deletion_jobs
    set attempts = attempts + 1, last_error = left(coalesce(p_error,''),1000),
        next_attempt_at = now() + make_interval(secs => greatest(1, coalesce(p_backoff_seconds,60))),
        updated_at = now()
    where id = v_id
    returning attempts into v_attempts;
  if v_attempts is null then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;

  if v_attempts >= p_max_attempts then
    update public.account_deletion_jobs
      set state='failed', failed_at=now(), updated_at=now()
      where id = v_id;
    return jsonb_build_object('ok',true,'state','failed','attempts',v_attempts,'job_id',v_id);
  end if;
  return jsonb_build_object('ok',true,'attempts',v_attempts,'job_id',v_id);
end $function$
;

-- public.account_deletion_request(p_user_id uuid, p_cancelable_minutes integer, p_dry_run boolean)
CREATE OR REPLACE FUNCTION public.account_deletion_request(p_user_id uuid, p_cancelable_minutes integer DEFAULT 30, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return public.account_deletion_request_consented(
    p_user_id, p_cancelable_minutes, p_dry_run, false, null);
end $function$
;

-- public.account_deletion_revoke_sessions(p_user_id uuid)
CREATE OR REPLACE FUNCTION public.account_deletion_revoke_sessions(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sessions int := 0; v_tokens int := 0;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'USER_REQUIRED');
  end if;

  delete from auth.refresh_tokens rt
   where rt.session_id in (select s.id from auth.sessions s where s.user_id = p_user_id)
      or rt.user_id = p_user_id::text;
  get diagnostics v_tokens = row_count;

  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  return jsonb_build_object(
    'ok', true,
    'sessions_deleted', v_sessions,
    'refresh_tokens_deleted', v_tokens
  );
end $function$
;

-- public.account_deletion_status_self()
CREATE OR REPLACE FUNCTION public.account_deletion_status_self()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
  v_job record;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;

  v_id := coalesce(public.account_deletion_active_job_id(v_uid), public.account_deletion_latest_job_id(v_uid));
  if v_id is null then
    return jsonb_build_object(
      'ok', true, 'exists', false, 'state', null,
      'cancelable_until', null, 'write_blocked', false, 'can_cancel', false);
  end if;

  select j.state, j.cancelable_until into v_job
    from public.account_deletion_jobs j where j.id = v_id;

  return jsonb_build_object(
    'ok', true,
    'exists', true,
    'state', v_job.state,
    'cancelable_until', v_job.cancelable_until,
    'write_blocked', v_job.state in
      ('locked','purging','storage_purged','finalized','auth_soft_deleted'),
    'can_cancel', v_job.state = 'pending'
      and (v_job.cancelable_until is null or now() <= v_job.cancelable_until)
  );
end $function$
;

-- public.account_deletion_write_guard()
CREATE OR REPLACE FUNCTION public.account_deletion_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_col text := TG_ARGV[0]; v_uid uuid;
begin
  if current_setting('ssambership.deletion_worker', true) = 'on' then
    return NEW;
  end if;
  v_uid := (to_jsonb(NEW) ->> v_col)::uuid;
  if v_uid is not null and public.account_deletion_write_blocked(v_uid) then
    raise exception 'ACCOUNT_DELETION_IN_PROGRESS';
  end if;
  return NEW;
end $function$
;

-- public.approve_mentor_school_verification_admin(p_verification_id uuid, p_university_name text, p_university_id text, p_department_name text, p_major_category text, p_school_tier text)
CREATE OR REPLACE FUNCTION public.approve_mentor_school_verification_admin(p_verification_id uuid, p_university_name text, p_university_id text, p_department_name text, p_major_category text, p_school_tier text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_admin uuid := (select auth.uid());
  v_row public.mentor_school_verifications;
  v_path text;
  v_owner_segment text;
  v_superseded integer := 0;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  if p_verification_id is null then
    raise exception 'INVALID_INPUT: verification_id is required' using errcode = '22023';
  end if;
  if btrim(coalesce(p_university_name, '')) = ''
     or btrim(coalesce(p_university_id, '')) = ''
     or btrim(coalesce(p_department_name, '')) = ''
     or btrim(coalesce(p_major_category, '')) = ''
     or btrim(coalesce(p_school_tier, '')) = '' then
    raise exception 'INVALID_INPUT: university/department/major/tier are required' using errcode = '22023';
  end if;

  select * into v_row from public.mentor_school_verifications where id = p_verification_id;
  if not found then
    raise exception 'VERIFICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('msv_approve:' || v_row.mentor_id::text, 0));

  select * into v_row from public.mentor_school_verifications
   where id = p_verification_id for update;
  if v_row.status not in ('pending', 'resubmit_required') then
    raise exception 'NOT_REVIEWABLE: %', v_row.status using errcode = '22023';
  end if;

  if btrim(coalesce(v_row.document_storage_ref, '')) = '' then
    raise exception 'DOCUMENT_REF_MISSING' using errcode = '22023';
  end if;
  v_path := public.mentor_school_verification_storage_path(v_row.document_storage_ref);
  if v_path is null then
    raise exception 'DOCUMENT_REF_UNPARSEABLE' using errcode = '22023';
  end if;

  v_owner_segment := split_part(v_path, '/', 1);
  if v_owner_segment is distinct from v_row.mentor_id::text then
    raise exception 'DOCUMENT_REF_OWNER_MISMATCH' using errcode = '42501';
  end if;

  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'student-id-images'
       and o.name = v_path
  ) then
    raise exception 'DOCUMENT_OBJECT_NOT_FOUND' using errcode = '22023';
  end if;

  update public.mentor_school_verifications
     set status = 'superseded',
         updated_at = now()
   where mentor_id = v_row.mentor_id
     and status = 'approved'
     and id <> v_row.id;
  get diagnostics v_superseded = row_count;

  update public.mentor_school_verifications
     set status = 'approved',
         verified_university_name = btrim(p_university_name),
         verified_university_id = btrim(p_university_id),
         verified_department_name = btrim(p_department_name),
         verified_major_category = btrim(p_major_category),
         school_tier = btrim(p_school_tier),
         reviewed_by = v_admin,
         reviewed_at = now(),
         reject_reason = null
   where id = v_row.id;

  return jsonb_build_object(
    'verification_id', v_row.id,
    'mentor_id', v_row.mentor_id,
    'status', 'approved',
    'superseded_count', v_superseded,
    'reviewed_by', v_admin
  );
end;
$function$
;

-- public.approve_refund_request_admin(p_refund_id uuid, p_admin_id uuid, p_admin_note text)
CREATE OR REPLACE FUNCTION public.approve_refund_request_admin(p_refund_id uuid, p_admin_id uuid, p_admin_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.refunds%rowtype; v_amount bigint; v_settlement_status text;
  v_idem text := 'refund_credit:' || p_refund_id::text; v_ledger_id uuid; v_existing_delta bigint; v_wu int; v_admin_ok boolean;
begin
  if p_refund_id is null then return jsonb_build_object('ok', false, 'message', '환불 ID가 필요합니다.'); end if;
  if p_admin_id is null then return jsonb_build_object('ok', false, 'message', '관리자 ID가 필요합니다.'); end if;
  select exists(select 1 from public.users u where u.id = p_admin_id and u.role = 'admin') into v_admin_ok;
  if not coalesce(v_admin_ok, false) then raise exception 'ADMIN_REQUIRED'; end if;
  select * into r from public.refunds where id = p_refund_id for update;
  if not found then return jsonb_build_object('ok', false, 'message', '환불 요청을 찾을 수 없습니다.'); end if;
  if r.status is distinct from 'pending' then
    return jsonb_build_object('ok', true, 'noop', true, 'refund_id', p_refund_id, 'message', '이미 처리되었거나 대기 상태가 아닙니다.', 'status', r.status);
  end if;
  if r.custom_request_order_id is not null then
    select s.status into v_settlement_status from public.custom_order_settlement_items s where s.custom_request_order_id = r.custom_request_order_id limit 1;
    if found and v_settlement_status = 'paid' then
      return jsonb_build_object('ok', false, 'message', '이미 정산 지급이 완료된 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.');
    end if;
  end if;
  if r.payment_id is not null and (r.subscription_id is not null or coalesce(r.request_type, '') = 'subscription_prorated') then
    select s.status into v_settlement_status from public.subscription_settlement_items s where s.payment_id = r.payment_id and s.status = 'paid' limit 1;
    if found then return jsonb_build_object('ok', false, 'message', '이미 멘토 정산 지급이 완료된 구독 건은 자동 환불할 수 없습니다. 수동 조정이 필요합니다.'); end if;
  end if;
  if r.custom_request_order_id is not null then
    perform public.record_custom_order_escrow_refund(r.custom_request_order_id);
    update public.refunds set status='succeeded', processed_at=now(), processed_by=p_admin_id, admin_note=p_admin_note, updated_at=now() where id=r.id;
    return jsonb_build_object('ok', true, 'noop', false, 'refund_id', r.id, 'kind', 'custom_order_escrow', 'message', '맞춤의뢰 환불이 승인되었습니다.');
  end if;
  if r.amount_cents is null or r.amount_cents <= 0 then raise exception '환불 금액이 설정되지 않아 자동 승인할 수 없습니다.'; end if;
  v_amount := r.amount_cents;
  if v_amount > 1000000000 then return jsonb_build_object('ok', false, 'message', '환불 금액이 허용 한도를 초과합니다.'); end if;
  insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
  values (r.user_id, v_amount, 'refund_approved', 'refunds', r.id, v_idem) on conflict (idempotency_key) do nothing returning id into v_ledger_id;
  if v_ledger_id is null then
    select cl.delta_cents into v_existing_delta from public.cash_ledger cl where cl.idempotency_key = v_idem limit 1;
    if not found then raise exception 'REFUND_LEDGER_IDEMPOTENT_MISS' using errcode = 'P0001'; end if;
    if v_existing_delta is distinct from v_amount then raise exception 'REFUND_LEDGER_AMOUNT_MISMATCH' using errcode = 'P0001'; end if;
  end if;
  if v_ledger_id is not null then
    insert into public.cash_wallets (user_id, balance_cents) values (r.user_id, 0) on conflict (user_id) do nothing;
    update public.cash_wallets w set balance_cents = w.balance_cents + v_amount where w.user_id = r.user_id;
    get diagnostics v_wu = row_count;
    if coalesce(v_wu, 0) = 0 then raise exception 'CASH_WALLET_UPDATE_FAILED' using errcode = 'P0001'; end if;
  end if;
  update public.refunds set status='succeeded', processed_at=now(), processed_by=p_admin_id, admin_note=p_admin_note, updated_at=now() where id=r.id;
  if r.payment_id is not null then update public.payments p set status='refunded', updated_at=now() where p.id = r.payment_id; end if;
  if r.payment_id is not null then update public.subscriptions s set status='canceled', updated_at=now() where s.payment_id = r.payment_id and s.status is distinct from 'canceled'; end if;
  return jsonb_build_object('ok', true, 'noop', false, 'refund_id', r.id, 'ledger_inserted', (v_ledger_id is not null), 'amount_cents', v_amount, 'message', '환불이 승인되었습니다.');
end; $function$
;

-- public.cc_sync_board_delete_to_canonical()
CREATE OR REPLACE FUNCTION public.cc_sync_board_delete_to_canonical()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rows int;
begin
  if public.comment_sync_in_progress() then return old; end if;
  perform set_config('app.comment_sync', '1', true);

  if old.canonical_comment_id is not null then
    update public.comments set is_deleted = true where id = old.canonical_comment_id;
  else
    update public.comments set is_deleted = true where legacy_comment_id = old.id;
  end if;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'COMMENT_BRIDGE_TARGET_MISSING';
  end if;

  perform set_config('app.comment_sync', '0', true);
  return old;
end;
$function$
;

-- public.cc_sync_board_to_canonical()
CREATE OR REPLACE FUNCTION public.cc_sync_board_to_canonical()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_canonical uuid;
  v_target public.comments;
begin
  if public.comment_sync_in_progress() then return new; end if;
  perform set_config('app.comment_sync', '1', true);

  if new.canonical_comment_id is not null then
    select * into v_target from public.comments
    where id = new.canonical_comment_id for update;
    if not found then
      raise exception 'COMMENT_BRIDGE_TARGET_MISSING';
    end if;
    if v_target.post_id is distinct from new.post_id then
      raise exception 'COMMENT_BRIDGE_POST_MISMATCH';
    end if;
    if v_target.author_id is distinct from new.author_id then
      raise exception 'COMMENT_BRIDGE_AUTHOR_MISMATCH';
    end if;
    update public.comments
      set content = new.body, is_deleted = (new.status <> 'visible')
    where id = new.canonical_comment_id;
  else
    insert into public.comments (post_id, author_id, content, is_deleted, created_at, legacy_comment_id)
    values (new.post_id, new.author_id, new.body, new.status <> 'visible', new.created_at, new.id)
    on conflict (legacy_comment_id) where legacy_comment_id is not null
    do update set content = excluded.content, is_deleted = excluded.is_deleted
    returning id into v_canonical;
    if v_canonical is null then
      select id into v_canonical from public.comments where legacy_comment_id = new.id;
    end if;
    update public.community_comments set canonical_comment_id = v_canonical where id = new.id;
  end if;

  perform set_config('app.comment_sync', '0', true);
  return new;
end;
$function$
;

-- public.cc_write_guard()
CREATE OR REPLACE FUNCTION public.cc_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if public.comment_sync_in_progress() then return new; end if;
  if current_user not in ('authenticated', 'anon') then return new; end if;

  if tg_op = 'INSERT' then
    if new.canonical_comment_id is not null then
      raise exception 'CC_CANONICAL_ID_FORBIDDEN';
    end if;
    return new;
  end if;

  if new.canonical_comment_id is distinct from old.canonical_comment_id
     or new.id is distinct from old.id
     or new.post_id is distinct from old.post_id
     or new.post_type is distinct from old.post_type
     or new.author_id is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'CC_PROTECTED_FIELDS_IMMUTABLE';
  end if;
  return new;
end;
$function$
;

-- public.check_review_eligibility(p_mentor_id uuid, p_student_id uuid)
CREATE OR REPLACE FUNCTION public.check_review_eligibility(p_mentor_id uuid, p_student_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_mentor_id is null or p_student_id is null then
    return false;
  end if;

  -- (B) 구독 관계
  if exists (
    select 1
    from public.subscriptions s
    where s.student_id = p_student_id
      and s.mentor_id = p_mentor_id
      and s.status in ('active', 'expired', 'cancel_scheduled')
  ) then
    return true;
  end if;

  -- (C) 완료된 개별질문
  if exists (
    select 1
    from public.individual_questions q
    where q.student_id = p_student_id
      and coalesce(q.claimed_mentor_id, q.designated_mentor_id) = p_mentor_id
      and q.status in ('answered', 'released')
  ) then
    return true;
  end if;

  return false;
end;
$function$
;

-- public.comments_mirror_to_legacy()
CREATE OR REPLACE FUNCTION public.comments_mirror_to_legacy()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_body text;
  v_rows int;
begin
  if public.comment_sync_in_progress() then return new; end if;
  perform set_config('app.comment_sync', '1', true);

  v_body := left(coalesce(new.content, ''), 1000);

  if new.legacy_comment_id is not null then
    if char_length(btrim(v_body)) >= 1 then
      update public.community_comments
        set body = v_body,
            status = case when coalesce(new.is_deleted, false) then 'hidden' else 'visible' end,
            canonical_comment_id = new.id
      where id = new.legacy_comment_id
        and (canonical_comment_id = new.id or canonical_comment_id is null);
    else
      update public.community_comments
        set status = case when coalesce(new.is_deleted, false) then 'hidden' else 'visible' end,
            canonical_comment_id = new.id
      where id = new.legacy_comment_id
        and (canonical_comment_id = new.id or canonical_comment_id is null);
    end if;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'COMMENT_BRIDGE_LEGACY_MISSING';
    end if;
  else
    if char_length(btrim(v_body)) >= 1 then
      insert into public.community_comments (post_id, post_type, author_id, body, status, created_at, canonical_comment_id)
      values (new.post_id, 'board', new.author_id, v_body,
              case when coalesce(new.is_deleted, false) then 'hidden' else 'visible' end,
              coalesce(new.created_at, now()), new.id)
      on conflict (canonical_comment_id) where canonical_comment_id is not null
      do update set body = excluded.body, status = excluded.status;
    end if;
  end if;

  perform set_config('app.comment_sync', '0', true);
  return new;
end;
$function$
;

-- public.comments_write_guard()
CREATE OR REPLACE FUNCTION public.comments_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_parent public.comments;
begin
  if public.comment_sync_in_progress() then
    return coalesce(new, old);
  end if;
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if coalesce((select public.is_admin()), false) then return old; end if;
    raise exception 'COMMENT_HARD_DELETE_FORBIDDEN';
  end if;

  if tg_op = 'INSERT' then
    if new.legacy_comment_id is not null then
      raise exception 'COMMENT_LEGACY_ID_FORBIDDEN';
    end if;
    if new.parent_id is not null then
      select * into v_parent from public.comments where id = new.parent_id;
      if not found then raise exception 'COMMENT_PARENT_NOT_FOUND'; end if;
      if v_parent.post_id is distinct from new.post_id then
        raise exception 'COMMENT_PARENT_POST_MISMATCH';
      end if;
      if v_parent.parent_id is not null then
        raise exception 'COMMENT_DEPTH_EXCEEDED';
      end if;
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.post_id is distinct from old.post_id
     or new.author_id is distinct from old.author_id
     or new.parent_id is distinct from old.parent_id
     or new.created_at is distinct from old.created_at
     or new.legacy_comment_id is distinct from old.legacy_comment_id
     or new.like_count is distinct from old.like_count then
    raise exception 'COMMENT_PROTECTED_FIELDS_IMMUTABLE';
  end if;
  return new;
end;
$function$
;

-- public.confirm_subscription_checkout(p_payment_id uuid, p_plan_id uuid, p_idempotency_key text)
CREATE OR REPLACE FUNCTION public.confirm_subscription_checkout(p_payment_id uuid, p_plan_id uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_student uuid; v_mentor uuid; v_pay_status text; v_created_at timestamptz; v_kind text;
  v_plan_mentor uuid; v_plan_tier text; v_plan_active boolean; v_amount_cents int;
  v_is_open boolean; v_sub_id uuid; v_reactivated boolean := false;
  v_status text; v_suspended_until timestamptz;
  v_l_user uuid; v_l_delta bigint; v_l_reason text; v_l_reftype text; v_l_refid uuid;
  v_succeeded_aliases text[] := array['succeeded','paid','success','complete','captured'];
  v_anom uuid; v_err text; v_errcode text;
begin
  select user_id, mentor_id, status, created_at, kind into v_student, v_mentor, v_pay_status, v_created_at, v_kind
    from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_student is null then raise exception 'PAYMENT_NO_USER'; end if;
  if v_mentor is null then raise exception 'PAYMENT_NO_MENTOR'; end if;
  if lower(coalesce(v_kind,'')) in ('cash_topup','topup','cash','individual_question','iq','custom_order','custom_request','deliverable') then raise exception 'PAYMENT_KIND_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtext(v_student::text), hashtext(v_mentor::text));
  select mentor_id, plan_tier, is_active, amount_cents into v_plan_mentor, v_plan_tier, v_plan_active, v_amount_cents
    from public.mentor_plans where id = p_plan_id for update;
  if not found then raise exception 'PLAN_NOT_FOUND'; end if;
  if v_plan_mentor <> v_mentor then raise exception 'PLAN_MENTOR_MISMATCH'; end if;
  if v_amount_cents is null or v_amount_cents <= 0 then raise exception 'PLAN_AMOUNT_INVALID'; end if;
  if v_pay_status = any(v_succeeded_aliases) then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor;
    if v_sub_id is null then
      insert into public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
        values (p_payment_id, null, 'SUCCEEDED_NO_SUBSCRIPTION', 'succeeded payment without subscription') returning id into v_anom;
      return jsonb_build_object('ok',false,'code','SUCCEEDED_NO_SUBSCRIPTION','anomaly_id',v_anom);
    end if;
    select user_id, delta_cents, reason, ref_type, ref_id into v_l_user, v_l_delta, v_l_reason, v_l_reftype, v_l_refid
      from public.cash_ledger where idempotency_key = 'sub_debit_' || p_payment_id::text;
    if v_l_user is null then
      insert into public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
        values (p_payment_id, v_sub_id, 'SUCCEEDED_NO_LEDGER', 'succeeded payment without ledger debit') returning id into v_anom;
      return jsonb_build_object('ok',false,'code','SUCCEEDED_NO_LEDGER','anomaly_id',v_anom);
    end if;
    if v_l_user <> v_student or v_l_refid is distinct from v_sub_id or coalesce(v_l_reftype,'') <> 'subscriptions'
       or coalesce(v_l_reason,'') <> 'subscription_payment' or v_l_delta <> -v_amount_cents then
      insert into public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail, expected, found)
        values (p_payment_id, v_sub_id, 'LEDGER_FIELD_MISMATCH', 'idempotent re-check field mismatch',
          jsonb_build_object('user_id',v_student,'ref_id',v_sub_id,'ref_type','subscriptions','reason','subscription_payment','delta_cents',-v_amount_cents),
          jsonb_build_object('user_id',v_l_user,'ref_id',v_l_refid,'ref_type',v_l_reftype,'reason',v_l_reason,'delta_cents',v_l_delta))
        returning id into v_anom;
      return jsonb_build_object('ok',false,'code','LEDGER_FIELD_MISMATCH','anomaly_id',v_anom);
    end if;
    return jsonb_build_object('ok',true,'idempotent',true,'subscription_id',v_sub_id,'payment_status','succeeded');
  end if;
  if v_pay_status = 'processing' then raise exception 'PAYMENT_PROCESSING'; end if;
  if v_pay_status in ('failed','canceled','refunded') then raise exception 'PAYMENT_NOT_PENDING'; end if;
  if v_pay_status <> 'pending' then raise exception 'PAYMENT_STATE_UNEXPECTED'; end if;
  if v_created_at is null or now() > v_created_at + interval '30 minutes' then raise exception 'PAYMENT_STALE'; end if;
  select status, suspended_until into v_status, v_suspended_until from public.users where id = v_student for update;
  if lower(coalesce(v_status,'active')) = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if lower(coalesce(v_status,'active')) = 'suspended' and (v_suspended_until is null or v_suspended_until > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  perform 1 from public.mentor_profiles where user_id = v_mentor for update;
  select is_open_for_subscriptions into v_is_open from public.mentor_profiles where user_id = v_mentor;
  if not coalesce(v_is_open, true) then raise exception 'MENTOR_NOT_OPEN_FOR_SUBSCRIPTIONS'; end if;
  if not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;
  if not coalesce(v_plan_active, true) then raise exception 'PLAN_INACTIVE'; end if;
  if not exists (select 1 from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active') then
    if public.mentor_cap_used(v_mentor) + public.subscription_cap_weight(v_plan_tier) > public.mentor_cap_limit(v_mentor) then raise exception 'MENTOR_CAP_EXCEEDED'; end if;
  end if;
  v_reactivated := exists (select 1 from public.subscriptions where student_id=v_student and mentor_id=v_mentor);
  begin
    insert into public.subscriptions (student_id, mentor_id, plan_id, plan_tier, status, payment_id,
      started_at, current_period_start, current_period_end, next_billing_at, billing_cycle, cancel_at_period_end, last_payment_id)
    values (v_student, v_mentor, p_plan_id, v_plan_tier, 'active', p_payment_id,
      now(), now(), now()+interval '1 month', now()+interval '1 month', 'monthly', false, p_payment_id)
    on conflict (student_id, mentor_id) do update set
      plan_id=excluded.plan_id, plan_tier=excluded.plan_tier, status='active', payment_id=excluded.payment_id,
      last_payment_id=excluded.last_payment_id, started_at=coalesce(public.subscriptions.started_at, now()),
      current_period_start=now(), current_period_end=now()+interval '1 month', next_billing_at=now()+interval '1 month',
      cancel_at_period_end=false, cancel_requested_at=null, canceled_at=null, expired_at=null, grace_until=null,
      last_renewed_at=now(), updated_at=now()
    returning id into v_sub_id;
    select user_id, delta_cents, reason, ref_type, ref_id into v_l_user, v_l_delta, v_l_reason, v_l_reftype, v_l_refid
      from public.cash_ledger where idempotency_key = 'sub_debit_' || p_payment_id::text;
    if v_l_user is not null and (v_l_user <> v_student or v_l_refid is distinct from v_sub_id
       or coalesce(v_l_reftype,'') <> 'subscriptions' or coalesce(v_l_reason,'') <> 'subscription_payment' or v_l_delta <> -v_amount_cents) then
      raise exception 'LEDGER_FIELD_MISMATCH';
    end if;
    perform public.record_subscription_cash_debit(v_student, v_sub_id, p_payment_id, v_amount_cents::bigint);
    update public.payments set status='succeeded', plan_id=p_plan_id,
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('planId',p_plan_id::text,'subscription_id',v_sub_id::text),
      updated_at=now() where id=p_payment_id;
  exception when others then
    get stacked diagnostics v_errcode = returned_sqlstate;
    v_err := sqlerrm;
  end;
  if v_err is not null then
    if v_err like '%CASH_INSUFFICIENT%' then return jsonb_build_object('ok',false,'code','CASH_INSUFFICIENT'); end if;
    insert into public.subscription_checkout_anomalies(payment_id, subscription_id, code, detail)
      values (p_payment_id, v_sub_id, case when v_err like '%LEDGER_FIELD_MISMATCH%' then 'LEDGER_FIELD_MISMATCH' else 'FINANCIAL_WRITE_ERROR' end, left(v_err,500)) returning id into v_anom;
    return jsonb_build_object('ok',false,'code', case when v_err like '%LEDGER_FIELD_MISMATCH%' then 'LEDGER_FIELD_MISMATCH' else 'FINANCIAL_WRITE_ERROR' end, 'sqlstate',v_errcode,'anomaly_id',v_anom);
  end if;
  return jsonb_build_object('ok',true,'subscription_id',v_sub_id,'payment_status','succeeded','amount_cents',v_amount_cents,'reactivated',v_reactivated);
end; $function$
;

-- public.get_mentor_student_nicknames(p_student_ids uuid[])
CREATE OR REPLACE FUNCTION public.get_mentor_student_nicknames(p_student_ids uuid[])
 RETURNS TABLE(id uuid, nickname text, full_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u.id, u.nickname, u.full_name
  from public.users u
  where p_student_ids is not null and array_length(p_student_ids, 1) is not null
    and u.id = any (p_student_ids) and (select auth.uid()) is not null
    and (
      exists (select 1 from public.subscriptions s where s.mentor_id=(select auth.uid()) and s.student_id=u.id and lower(coalesce(s.status,''))='active')
      or exists (select 1 from public.mentor_student_rooms r where r.mentor_id=(select auth.uid()) and r.student_id=u.id)
    );
$function$
;

-- public.get_mobile_app_version_policy(p_platform text)
CREATE OR REPLACE FUNCTION public.get_mobile_app_version_policy(p_platform text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.mobile_app_version_policies;
begin
  if p_platform is null or lower(btrim(p_platform)) not in ('android','ios') then
    raise exception 'INVALID_PLATFORM' using errcode = '22023';
  end if;
  select * into v_row from public.mobile_app_version_policies
  where platform = lower(btrim(p_platform));
  if not found then
    return jsonb_build_object(
      'platform', lower(btrim(p_platform)),
      'min_supported_build', 1,
      'latest_build', 1,
      'minimum_version_name', null,
      'store_url', null,
      'message', null);
  end if;
  return jsonb_build_object(
    'platform', v_row.platform,
    'min_supported_build', v_row.min_supported_build,
    'latest_build', v_row.latest_build,
    'minimum_version_name', v_row.minimum_version_name,
    'store_url', v_row.store_url,
    'message', v_row.message);
end;
$function$
;

-- public.mark_all_notifications_read()
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := (select auth.uid()); v_count int;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  update public.notifications
  set is_read = true, read_at = coalesce(read_at, now()), updated_at = now()
  where is_read is distinct from true
    and (user_id = v_uid or recipient_id = v_uid or student_id = v_uid or mentor_id = v_uid or target_user_id = v_uid or owner_id = v_uid or recipient_user_id = v_uid);
  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end; $function$
;

-- public.process_subscription_renewal(p_subscription_id uuid, p_period_end timestamp with time zone, p_amount_cents bigint, p_idempotency_key text, p_processed_at timestamp with time zone)
CREATE OR REPLACE FUNCTION public.process_subscription_renewal(p_subscription_id uuid, p_period_end timestamp with time zone, p_amount_cents bigint, p_idempotency_key text, p_processed_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(ok boolean, code text, message text, billing_event_id uuid, ledger_id uuid, next_period_start timestamp with time zone, next_period_end timestamp with time zone, wallet_balance_cents bigint, attempt_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sub public.subscriptions%rowtype;
  v_event public.subscription_billing_events%rowtype;
  v_event_id uuid;
  v_ledger_id uuid;
  v_wallet_balance bigint;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_attempt_count int;
begin
  if p_subscription_id is null then
    return query select false, 'invalid_subscription'::text, 'subscription_id is required'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz, null::bigint, 0::int;
    return;
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    return query select false, 'invalid_amount'::text, 'p_amount_cents must be positive'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz, null::bigint, 0::int;
    return;
  end if;

  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    return query select false, 'invalid_idempotency_key'::text, 'idempotency_key is required'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz, null::bigint, 0::int;
    return;
  end if;

  select *
    into v_sub
  from public.subscriptions
  where id = p_subscription_id
  for update;

  if not found then
    return query select false, 'not_found'::text, 'subscription not found'::text, null::uuid, null::uuid, null::timestamptz, null::timestamptz, null::bigint, 0::int;
    return;
  end if;

  if coalesce(v_sub.status, '') not in ('active', 'past_due') then
    return query select false, 'not_renewable_status'::text, 'subscription status is not renewable'::text, null::uuid, null::uuid, v_sub.current_period_start, v_sub.current_period_end, null::bigint, 0::int;
    return;
  end if;

  select *
    into v_event
  from public.subscription_billing_events
  where idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_event.status = 'succeeded' then
      return query select true, 'already_succeeded'::text, 'renewal already processed'::text, v_event.id, v_event.ledger_id, v_event.period_start, v_event.period_end, null::bigint, coalesce(v_event.attempt_count, 0);
      return;
    end if;

    if v_event.status in ('pending', 'processing') then
      return query select false, 'already_processing'::text, 'renewal is already processing'::text, v_event.id, v_event.ledger_id, v_event.period_start, v_event.period_end, null::bigint, coalesce(v_event.attempt_count, 0);
      return;
    end if;

    update public.subscription_billing_events as e
    set
      event_type = 'renewal',
      status = 'processing',
      failure_code = null,
      failure_message = null,
      amount_cents = p_amount_cents::int,
      billing_at = p_processed_at,
      attempt_count = coalesce(attempt_count, 0) + 1,
      processed_at = null
    where e.id = v_event.id
    returning e.* into v_event;

    v_event_id := v_event.id;
    v_attempt_count := coalesce(v_event.attempt_count, 1);
  else
    v_period_start := coalesce(v_sub.current_period_end, p_period_end, p_processed_at);
    v_period_end := v_period_start + interval '1 month';

    insert into public.subscription_billing_events (
      subscription_id,
      student_id,
      mentor_id,
      event_type,
      status,
      period_start,
      period_end,
      billing_at,
      amount_cents,
      plan_tier,
      plan_id,
      idempotency_key,
      attempt_count,
      created_at
    )
    values (
      v_sub.id,
      v_sub.student_id,
      v_sub.mentor_id,
      'renewal',
      'processing',
      v_period_start,
      v_period_end,
      p_processed_at,
      p_amount_cents::int,
      v_sub.plan_tier,
      v_sub.plan_id,
      p_idempotency_key,
      1,
      p_processed_at
    )
    returning * into v_event;

    v_event_id := v_event.id;
    v_attempt_count := 1;
  end if;

  insert into public.cash_wallets (user_id, balance_cents)
  values (v_sub.student_id, 0)
  on conflict (user_id) do nothing;

  update public.cash_wallets
  set balance_cents = balance_cents - p_amount_cents
  where user_id = v_sub.student_id
    and balance_cents >= p_amount_cents
  returning balance_cents into v_wallet_balance;

  if not found then
    update public.subscription_billing_events as e
    set
      event_type = 'renewal_failed',
      status = 'failed',
      failure_code = 'insufficient_cash',
      failure_message = 'CASH_INSUFFICIENT',
      processed_at = p_processed_at
    where e.id = v_event_id
    returning e.attempt_count into v_attempt_count;

    update public.subscriptions
    set
      status = 'past_due',
      grace_until = coalesce(grace_until, p_processed_at + interval '2 days'),
      updated_at = p_processed_at,
      last_billing_event_id = v_event_id
    where id = v_sub.id;

    return query select false, 'insufficient_cash'::text, 'CASH_INSUFFICIENT'::text, v_event_id, null::uuid, v_event.period_start, v_event.period_end, null::bigint, coalesce(v_attempt_count, 1);
    return;
  end if;

  insert into public.cash_ledger (
    user_id,
    delta_cents,
    reason,
    ref_type,
    ref_id,
    idempotency_key,
    created_at
  )
  values (
    v_sub.student_id,
    -p_amount_cents,
    'subscription_renewal',
    'subscriptions',
    v_sub.id,
    p_idempotency_key,
    p_processed_at
  )
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is null then
    select id
      into v_ledger_id
    from public.cash_ledger
    where idempotency_key = p_idempotency_key;
  end if;

  v_period_start := coalesce(v_event.period_start, v_sub.current_period_end, p_period_end, p_processed_at);
  v_period_end := coalesce(v_event.period_end, v_period_start + interval '1 month');

  update public.subscription_billing_events as e
  set
    event_type = 'renewal',
    status = 'succeeded',
    ledger_id = v_ledger_id,
    processed_at = p_processed_at,
    failure_code = null,
    failure_message = null,
    period_start = v_period_start,
    period_end = v_period_end,
    amount_cents = p_amount_cents::int
  where e.id = v_event_id
  returning e.attempt_count into v_attempt_count;

  update public.subscriptions
  set
    status = 'active',
    current_period_start = v_period_start,
    current_period_end = v_period_end,
    next_billing_at = v_period_end,
    last_renewed_at = p_processed_at,
    last_billing_event_id = v_event_id,
    grace_until = null,
    updated_at = p_processed_at
  where id = v_sub.id;

  return query select true, 'succeeded'::text, 'renewal processed'::text, v_event_id, v_ledger_id, v_period_start, v_period_end, v_wallet_balance, coalesce(v_attempt_count, 1);
end;
$function$
;

-- public.qna_confirm_thread(p_thread_id uuid)
CREATE OR REPLACE FUNCTION public.qna_confirm_thread(p_thread_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_status text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select t.mentor_student_room_id, t.status into v_room, v_status from public.question_threads t where t.id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id into v_student from public.mentor_student_rooms where id=v_room;
  if v_uid <> v_student then raise exception 'STUDENT_ONLY'; end if;
  if v_status='confirmed' then return jsonb_build_object('ok',true,'thread_id',p_thread_id); end if;
  if v_status <> 'answered' then raise exception 'NOT_ANSWERED'; end if;
  update public.question_threads set status='confirmed', confirmed_at=coalesce(confirmed_at,now()), updated_at=now() where id=p_thread_id;
  return jsonb_build_object('ok',true,'thread_id',p_thread_id);
end; $function$
;

-- public.qna_create_free_question_thread(p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text)
CREATE OR REPLACE FUNCTION public.qna_create_free_question_thread(p_room_id uuid, p_title text, p_subject text DEFAULT NULL::text, p_topic text DEFAULT NULL::text, p_first_message_body text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin return public.qna_create_question_thread(p_room_id, p_title, p_subject, p_topic, p_first_message_body); end; $function$
;

-- public.qna_create_question_thread(p_room_id uuid, p_title text, p_subject text, p_topic text, p_first_message_body text)
CREATE OR REPLACE FUNCTION public.qna_create_question_thread(p_room_id uuid, p_title text, p_subject text DEFAULT NULL::text, p_topic text DEFAULT NULL::text, p_first_message_body text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_student uuid; v_mentor uuid; v_status text; v_suspended_until timestamptz;
  v_created_at timestamptz; v_total int; v_per int; v_subject text; v_thread_id uuid; v_message_id uuid;
  v_has_active_sub boolean; v_usage json; v_path text; v_sub_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_title is null or btrim(p_title)='' then raise exception 'TITLE_REQUIRED'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=p_room_id;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_uid <> v_student then
    if v_uid = v_mentor then raise exception 'MENTOR_CANNOT_CREATE_THREAD'; else raise exception 'NOT_ROOM_PARTY'; end if;
  end if;
  perform 1 from public.users where id=v_student for update;
  select status, suspended_until, created_at into v_status, v_suspended_until, v_created_at from public.users where id=v_student;
  if lower(coalesce(v_status,'active'))='banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if lower(coalesce(v_status,'active'))='suspended' and (v_suspended_until is null or v_suspended_until > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if exists (select 1 from public.user_blocks where (blocker_id=v_student and blocked_id=v_mentor) or (blocker_id=v_mentor and blocked_id=v_student)) then raise exception 'BLOCKED'; end if;
  if not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;
  v_has_active_sub := exists (select 1 from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active');
  if v_has_active_sub then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
    v_usage := public.get_weekly_question_usage(v_student, v_mentor);
    if not coalesce((v_usage->>'can_ask')::boolean, false) then raise exception 'WEEKLY_LIMIT_EXHAUSTED'; end if;
    v_path := 'subscription';
  else
    if v_created_at is not null and now() >= v_created_at + interval '7 days' then raise exception 'FREE_QUOTA_EXPIRED'; end if;
    select count(*) into v_total from public.free_question_usage where student_id=v_student;
    if v_total >= 7 then raise exception 'FREE_QUOTA_TOTAL_EXHAUSTED'; end if;
    select count(*) into v_per from public.free_question_usage where student_id=v_student and mentor_id=v_mentor;
    if v_per >= 3 then raise exception 'FREE_QUOTA_MENTOR_EXHAUSTED'; end if;
    v_path := 'free';
  end if;
  v_subject := nullif(btrim(coalesce(p_subject,'')),'');
  if v_subject is not null and not exists (select 1 from public.subjects where code=v_subject) then v_subject := null; end if;
  insert into public.question_threads (mentor_student_room_id, title, status, subject, topic)
  values (p_room_id, btrim(p_title), 'pending', v_subject, nullif(btrim(coalesce(p_topic,'')),'')) returning id into v_thread_id;
  if p_first_message_body is not null and btrim(p_first_message_body) <> '' then
    insert into public.question_messages (thread_id, author_id, body) values (v_thread_id, v_student, btrim(p_first_message_body)) returning id into v_message_id;
  end if;
  if v_path='free' then insert into public.free_question_usage (student_id, mentor_id, thread_id) values (v_student, v_mentor, v_thread_id); end if;
  return jsonb_build_object('ok',true,'thread_id',v_thread_id,'message_id',v_message_id,'path',v_path,'used_free_quota',(v_path='free'));
end; $function$
;

-- public.qna_flag_wrong_answer(p_thread_id uuid, p_is_wrong boolean)
CREATE OR REPLACE FUNCTION public.qna_flag_wrong_answer(p_thread_id uuid, p_is_wrong boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_room uuid;
  v_student uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select t.mentor_student_room_id into v_room
  from public.question_threads t where t.id = p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;

  select student_id into v_student from public.mentor_student_rooms where id = v_room;
  if v_uid <> v_student then raise exception 'STUDENT_ONLY'; end if;

  update public.question_threads
    set is_wrong_answer = coalesce(p_is_wrong, true),
        mastery_status = case when coalesce(p_is_wrong, true) then 'wrong' else 'unknown' end,
        updated_at = now()
  where id = p_thread_id;

  return jsonb_build_object('ok', true, 'thread_id', p_thread_id, 'is_wrong_answer', coalesce(p_is_wrong, true));
end;
$function$
;

-- public.qna_is_direct_untrusted_writer()
CREATE OR REPLACE FUNCTION public.qna_is_direct_untrusted_writer()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$ select current_user in ('authenticated','anon'); $function$
;

-- public.qra_thread_writable_for_path(p_name text)
CREATE OR REPLACE FUNCTION public.qra_thread_writable_for_path(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.question_threads t
    where t.id = nullif(split_part(p_name, '/', 2), '')::uuid
      and t.mentor_student_room_id = public.qra_room_uuid_from_path(p_name)
      and coalesce(t.status, '') in ('pending','open','answered')
  );
$function$
;

-- public.refund_individual_question(p_question_id uuid)
CREATE OR REPLACE FUNCTION public.refund_individual_question(p_question_id uuid)
 RETURNS individual_question_escrow_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_status text;
  v_refund_ledger uuid;
  v_res public.individual_question_escrow_result;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_question_id is null then
    raise exception 'INVALID_INPUT: question_id is required' using errcode = '22023';
  end if;

  select q.student_id, q.status, q.refund_ledger_id
    into v_owner, v_status, v_refund_ledger
  from public.individual_questions q
  where q.id = p_question_id
  for update;

  if not found or v_owner is distinct from v_uid then
    raise exception 'NOT_QUESTION_OWNER' using errcode = '42501';
  end if;

  if v_status = 'refunded' or v_refund_ledger is not null then
    return public.refund_individual_question_hold(p_question_id);
  end if;

  if v_status not in ('escrowed', 'open', 'assigned', 'claimed') then
    raise exception 'REFUND_NOT_ALLOWED: status=%', v_status using errcode = 'P0001';
  end if;

  v_res := public.refund_individual_question_hold(p_question_id);
  if not v_res.ok then
    raise exception 'INDIVIDUAL_QUESTION_REFUND_FAILED:%:%', v_res.code, v_res.message
      using errcode = 'P0001';
  end if;
  return v_res;
end;
$function$
;

-- public.release_individual_question_payout(p_question_id uuid)
CREATE OR REPLACE FUNCTION public.release_individual_question_payout(p_question_id uuid)
 RETURNS individual_question_escrow_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_question public.individual_questions%rowtype;
  v_mentor_id uuid;
  v_ledger_id uuid;
  v_wallet_balance bigint;
  v_new_ledger boolean := false;
  v_mentor_cents bigint;  -- 255: 멘토 지급 = floor(price_cents * 0.85), 플랫폼 15% 차액 implicit
begin
  if p_question_id is null then
    return (false, 'invalid_question', 'question_id is required', null, null, null, null)::public.individual_question_escrow_result;
  end if;

  select *
    into v_question
  from public.individual_questions
  where id = p_question_id
  for update;

  if not found then
    return (false, 'not_found', 'individual question not found', p_question_id, null, null, null)::public.individual_question_escrow_result;
  end if;

  if v_question.release_ledger_id is not null or v_question.status = 'released' then
    return (true, 'already_released', 'individual question already released', v_question.id, v_question.status, v_question.release_ledger_id, null)::public.individual_question_escrow_result;
  end if;

  if v_question.refund_ledger_id is not null or v_question.status = 'refunded' then
    return (false, 'already_refunded', 'individual question already refunded', v_question.id, v_question.status, v_question.refund_ledger_id, null)::public.individual_question_escrow_result;
  end if;

  if v_question.status <> 'answered' then
    return (false, 'not_answered', 'question must be answered before payout', v_question.id, v_question.status, null, null)::public.individual_question_escrow_result;
  end if;

  if v_question.hold_ledger_id is null then
    return (false, 'hold_missing', 'escrow hold ledger is missing', v_question.id, v_question.status, null, null)::public.individual_question_escrow_result;
  end if;

  v_mentor_id := coalesce(v_question.claimed_mentor_id, v_question.designated_mentor_id);
  if v_mentor_id is null then
    return (false, 'mentor_missing', 'mentor is missing', v_question.id, v_question.status, null, null)::public.individual_question_escrow_result;
  end if;

  if exists (
    select 1
    from public.cash_ledger l
    where l.idempotency_key = 'iq_refund:' || v_question.id::text
      and l.reason = 'individual_question_refund'
  ) then
    return (false, 'already_refunded', 'refund ledger already exists', v_question.id, v_question.status, null, null)::public.individual_question_escrow_result;
  end if;

  -- 멘토 몫 85% (플랫폼 15%는 price_cents - v_mentor_cents = hold 차액으로 남김)
  v_mentor_cents := floor(v_question.price_cents::numeric * 0.85)::bigint;
  if v_mentor_cents <= 0 then
    return (false, 'invalid_payout', 'mentor payout amount must be positive', v_question.id, v_question.status, null, null)::public.individual_question_escrow_result;
  end if;

  insert into public.cash_ledger (
    user_id,
    delta_cents,
    reason,
    ref_type,
    ref_id,
    idempotency_key
  )
  values (
    v_mentor_id,
    v_mentor_cents,
    'individual_question_payout',
    'individual_questions',
    v_question.id,
    'iq_payout:' || v_question.id::text
  )
  on conflict (idempotency_key) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is not null then
    v_new_ledger := true;
  else
    select id
      into v_ledger_id
    from public.cash_ledger
    where idempotency_key = 'iq_payout:' || v_question.id::text
      and reason = 'individual_question_payout';
  end if;

  if v_ledger_id is null then
    raise exception 'INDIVIDUAL_QUESTION_PAYOUT_LEDGER_MISSING';
  end if;

  if v_new_ledger then
    insert into public.cash_wallets (user_id, balance_cents)
    values (v_mentor_id, 0)
    on conflict (user_id) do nothing;

    update public.cash_wallets
    set balance_cents = balance_cents + v_mentor_cents
    where user_id = v_mentor_id
    returning balance_cents into v_wallet_balance;

    if not found then
      raise exception 'INDIVIDUAL_QUESTION_MENTOR_WALLET_CREDIT_FAILED';
    end if;
  end if;

  update public.individual_questions
  set
    status = 'released',
    released_at = coalesce(released_at, now()),
    release_ledger_id = v_ledger_id
  where id = v_question.id
  returning * into v_question;

  return (true, 'released', 'individual question payout released', v_question.id, v_question.status, v_ledger_id, v_wallet_balance)::public.individual_question_escrow_result;
end;
$function$
;

