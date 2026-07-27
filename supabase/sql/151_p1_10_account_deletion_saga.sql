-- 151_p1_10_account_deletion_saga.sql
-- ⚠️ 라이브 미적용 대비 — 기능 플래그 OFF 기본. 실제 사용자·객체 삭제 없음. 신규 객체만 추가.
-- P1-10 회원탈퇴 saga 기반 + write gate + P2-22 effective status helper.
--
-- 상태기계: pending → locked → purging → storage_purged → finalized → auth_soft_deleted → completed
--   (+ canceled / failed). pending 만 취소 가능(cancelable_until 이내). purging 이후 취소 금지.
--   locked→purging 은 조건부 원자 전이. attempts·last_error·next_attempt_at(backoff).
-- write gate: state 가 locked 이상(취소 불가 시점)이면 해당 유저의 핵심 write 를 차단.
--   0 job 이면 항상 false → 무영향(기능 OFF 안전). 최종 삭제는 worker(dry-run 기본)가 수행.
-- 선행: 001(users), 115(anonymize). 037/038/149 storage 정책 재정의(deletion conjunct 추가).

begin;
set local lock_timeout='5s';

-- ── 1) saga 작업 테이블 (service_role 전용) ──────────────────────────────────
create table if not exists public.account_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id),
  state text not null default 'pending'
    check (state in ('pending','locked','purging','storage_purged','finalized','auth_soft_deleted','completed','canceled','failed')),
  attempts int not null default 0,
  last_error text,
  next_attempt_at timestamptz,
  cancelable_until timestamptz,
  dry_run boolean not null default true,
  requested_at timestamptz not null default now(),
  locked_at timestamptz, purging_at timestamptz, storage_purged_at timestamptz,
  finalized_at timestamptz, auth_soft_deleted_at timestamptz, completed_at timestamptz,
  canceled_at timestamptz, failed_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.account_deletion_jobs is
  '151: 회원탈퇴 saga 상태기계. service_role 전용. 기능 플래그 OFF 기본 — 0행이면 write gate 무영향.';
alter table public.account_deletion_jobs enable row level security;
revoke all on public.account_deletion_jobs from public, anon, authenticated;
grant select, insert, update on public.account_deletion_jobs to service_role;

create index if not exists idx_adj_state_next on public.account_deletion_jobs (state, next_attempt_at);

-- ── 2) write gate helper + 트리거 ───────────────────────────────────────────
-- locked 이상(취소 불가) & 미완료 상태면 차단. pending(취소 가능)·completed/canceled/failed 는 허용.
create or replace function public.account_deletion_write_blocked(p_user_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.account_deletion_jobs j
    where j.user_id = p_user_id
      and j.state in ('locked','purging','storage_purged','finalized','auth_soft_deleted')
  );
$$;
revoke all on function public.account_deletion_write_blocked(uuid) from public, anon;
grant execute on function public.account_deletion_write_blocked(uuid) to authenticated, service_role;

-- 범용 BEFORE INSERT/UPDATE 가드: TG_ARGV[0]=유저 컬럼명. 값이 차단 대상이면 거부.
create or replace function public.account_deletion_write_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_col text := TG_ARGV[0]; v_uid uuid;
begin
  v_uid := (to_jsonb(NEW) ->> v_col)::uuid;
  if v_uid is not null and public.account_deletion_write_blocked(v_uid) then
    raise exception 'ACCOUNT_DELETION_IN_PROGRESS';
  end if;
  return NEW;
end $$;

-- 핵심 테이블(지갑·결제·질문·커뮤니티)에 가드 부착. 0 job 이면 무영향.
drop trigger if exists adg_cash_wallets on public.cash_wallets;
create trigger adg_cash_wallets before insert or update on public.cash_wallets
  for each row execute function public.account_deletion_write_guard('user_id');
drop trigger if exists adg_cash_ledger on public.cash_ledger;
create trigger adg_cash_ledger before insert on public.cash_ledger
  for each row execute function public.account_deletion_write_guard('user_id');
drop trigger if exists adg_payments on public.payments;
create trigger adg_payments before insert on public.payments
  for each row execute function public.account_deletion_write_guard('user_id');
drop trigger if exists adg_question_messages on public.question_messages;
create trigger adg_question_messages before insert on public.question_messages
  for each row execute function public.account_deletion_write_guard('author_id');
drop trigger if exists adg_community_posts on public.community_posts;
create trigger adg_community_posts before insert on public.community_posts
  for each row execute function public.account_deletion_write_guard('author_id');
drop trigger if exists adg_shortform_posts on public.shortform_posts;
create trigger adg_shortform_posts before insert on public.shortform_posts
  for each row execute function public.account_deletion_write_guard('author_id');

-- Storage INSERT gate(내가 관리하는 버킷 정책에 deletion conjunct 추가 — 0 job 무영향).
drop policy if exists qra_storage_insert_party on storage.objects;
create policy qra_storage_insert_party on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'question-room-attachments'
    and public.user_is_room_party_for_qra_path(name)
    and public.qra_thread_writable_for_path(name)
    and public.qra_uploader_allowed_for_path(name)
    and public.qra_path_upload_eligible(name)
    and not public.account_deletion_write_blocked(auth.uid())
  );

drop policy if exists "cpi_auth_insert_own" on storage.objects;
create policy "cpi_auth_insert_own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'community-post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.account_deletion_write_blocked(auth.uid())
  );

drop policy if exists "sfv_mentor_insert" on storage.objects;
create policy "sfv_mentor_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id in ('shortform-videos', 'shortform-thumbnails')
    and public.is_mentor()
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not public.account_deletion_write_blocked(auth.uid())
  );

-- ── 3) 상태기계 RPC (service_role 전용) ─────────────────────────────────────
create or replace function public.account_deletion_request(p_user_id uuid, p_cancelable_minutes int default 30, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_state text;
begin
  select id, state into v_id, v_state from public.account_deletion_jobs where user_id = p_user_id;
  if v_id is not null then
    return jsonb_build_object('ok',true,'existing',true,'job_id',v_id,'state',v_state);
  end if;
  insert into public.account_deletion_jobs (user_id, state, cancelable_until, dry_run)
    values (p_user_id, 'pending', now() + make_interval(mins => greatest(0,p_cancelable_minutes)), coalesce(p_dry_run,true))
    returning id into v_id;
  return jsonb_build_object('ok',true,'existing',false,'job_id',v_id,'state','pending');
end $$;

create or replace function public.account_deletion_cancel(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_state text; v_cancelable timestamptz;
begin
  select state, cancelable_until into v_state, v_cancelable
    from public.account_deletion_jobs where user_id = p_user_id for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  -- purging 이후(=pending 아님) 취소 금지.
  if v_state <> 'pending' then return jsonb_build_object('ok',false,'code','NOT_CANCELABLE','state',v_state); end if;
  if v_cancelable is not null and now() > v_cancelable then return jsonb_build_object('ok',false,'code','CANCEL_WINDOW_PASSED'); end if;
  update public.account_deletion_jobs set state='canceled', canceled_at=now(), updated_at=now() where user_id=p_user_id;
  return jsonb_build_object('ok',true,'state','canceled');
end $$;

-- 조건부 원자 전이(from→to). 유효 전이만 허용. locked→purging 등.
create or replace function public.account_deletion_advance(p_user_id uuid, p_from text, p_to text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_rows int := 0; v_col text;
begin
  -- pending→locked 은 cancelable_until 경과 후에만(취소 기회 보장).
  if p_from='pending' and p_to='locked' then
    update public.account_deletion_jobs
      set state='locked', locked_at=now(), updated_at=now()
      where user_id=p_user_id and state='pending' and (cancelable_until is null or now() >= cancelable_until);
    get diagnostics v_rows = row_count;
    return v_rows > 0;
  end if;
  -- 유효 전이표.
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
    'update public.account_deletion_jobs set state=$2, %I=now(), updated_at=now() where user_id=$1 and state=$3',
    v_col
  ) using p_user_id, p_to, p_from;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

create or replace function public.account_deletion_record_error(p_user_id uuid, p_error text, p_backoff_seconds int default 60, p_max_attempts int default 8)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_attempts int;
begin
  update public.account_deletion_jobs
    set attempts = attempts + 1, last_error = left(coalesce(p_error,''),1000),
        next_attempt_at = now() + make_interval(secs => greatest(1,p_backoff_seconds)), updated_at = now()
    where user_id = p_user_id
    returning attempts into v_attempts;
  if v_attempts is null then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  if v_attempts >= p_max_attempts then
    update public.account_deletion_jobs set state='failed', failed_at=now(), updated_at=now() where user_id=p_user_id;
    return jsonb_build_object('ok',true,'state','failed','attempts',v_attempts);
  end if;
  return jsonb_build_object('ok',true,'attempts',v_attempts);
end $$;

-- worker claim: 처리 대상(취소불가·미완료·backoff 경과) 을 SKIP LOCKED 로 집는다.
create or replace function public.account_deletion_worker_claim(p_limit int default 10)
returns setof public.account_deletion_jobs language sql security definer set search_path to 'public' as $$
  select * from public.account_deletion_jobs
  where state in ('pending','locked','purging','storage_purged','finalized','auth_soft_deleted')
    and (next_attempt_at is null or next_attempt_at <= now())
  order by requested_at asc
  limit greatest(1, p_limit)
  for update skip locked;
$$;

revoke all on function public.account_deletion_request(uuid,int,boolean) from public, anon, authenticated;
revoke all on function public.account_deletion_cancel(uuid) from public, anon, authenticated;
revoke all on function public.account_deletion_advance(uuid,text,text) from public, anon, authenticated;
revoke all on function public.account_deletion_record_error(uuid,text,int,int) from public, anon, authenticated;
revoke all on function public.account_deletion_worker_claim(int) from public, anon, authenticated;
grant execute on function public.account_deletion_request(uuid,int,boolean) to service_role;
grant execute on function public.account_deletion_cancel(uuid) to service_role;
grant execute on function public.account_deletion_advance(uuid,text,text) to service_role;
grant execute on function public.account_deletion_record_error(uuid,text,int,int) to service_role;
grant execute on function public.account_deletion_worker_claim(int) to service_role;

commit;

-- §V(rollback-only): request→pending(취소가능) · cancel(pending·window내) 성공 · locked 이후 cancel 거부 ·
--   pending→locked 은 cancelable_until 경과 후만 · locked→purging 원자 · write gate: locked 유저 지갑/결제/
--   질문/커뮤니티 INSERT 거부, 정상 유저·0job 허용 · storage_purged 전 finalized 금지(전이표) · advance 멱등(중복 no-op).
