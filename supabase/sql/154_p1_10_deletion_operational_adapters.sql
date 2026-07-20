-- 154_p1_10_deletion_operational_adapters.sql
-- ⚠️ 기능 플래그 OFF 기본. 실제 사용자·객체 삭제 없음. 신규 객체만 추가(151/115 무수정).
-- P1-10 운영 어댑터 완결: (1) Storage write gate 전면화(INSERT/UPDATE/upsert/overwrite/move/copy),
--   (2) job lease/claim(동시 worker 중복 처리 차단), (3) 지갑 forfeit+익명화 원자 RPC.
-- 선행: 151(account_deletion_jobs·write_blocked)·115(anonymize_user_for_deletion).

begin;
set local lock_timeout='5s';

-- ── 1) Storage write gate 전면화 (RESTRICTIVE — 모든 버킷·모든 write 에 AND) ──────────────
-- 개별 버킷 정책을 재작성하지 않고, deletion locked 유저의 모든 Storage write 를 한 번에 차단한다.
-- RESTRICTIVE 는 기존 permissive 정책과 AND 로 결합 → upsert(=INSERT), overwrite/move(=UPDATE),
-- copy(=INSERT) 모두 포함. service_role(worker 삭제)은 RLS 우회라 무영향. 0 job 이면 항상 true.
drop policy if exists adg_storage_block_insert_when_deleting on storage.objects;
create policy adg_storage_block_insert_when_deleting on storage.objects
  as restrictive for insert to authenticated
  with check (not public.account_deletion_write_blocked(auth.uid()));

drop policy if exists adg_storage_block_update_when_deleting on storage.objects;
create policy adg_storage_block_update_when_deleting on storage.objects
  as restrictive for update to authenticated
  using (not public.account_deletion_write_blocked(auth.uid()))
  with check (not public.account_deletion_write_blocked(auth.uid()));

-- ── 2) job lease/claim (동시 worker 중복 처리 방지) ──────────────────────────────────────
alter table public.account_deletion_jobs add column if not exists lease_owner text;
alter table public.account_deletion_jobs add column if not exists leased_until timestamptz;

-- 처리 대상(취소불가·미완료·backoff 도래·미lease/만료lease)을 원자적으로 lease 한다(SKIP LOCKED).
create or replace function public.account_deletion_claim(p_owner text, p_limit int default 5, p_lease_seconds int default 300)
returns setof public.account_deletion_jobs language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  with cte as (
    select j.id from public.account_deletion_jobs j
    where j.state in ('pending','locked','purging','storage_purged','finalized','auth_soft_deleted')
      and (j.next_attempt_at is null or j.next_attempt_at <= now())
      and (j.leased_until is null or j.leased_until < now())
    order by j.requested_at asc
    limit greatest(1, p_limit)
    for update skip locked
  )
  update public.account_deletion_jobs j
    set lease_owner = p_owner, leased_until = now() + make_interval(secs => greatest(1, p_lease_seconds)), updated_at = now()
    from cte where j.id = cte.id
    returning j.*;
end $$;

create or replace function public.account_deletion_reclaim_expired()
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  update public.account_deletion_jobs set lease_owner=null, leased_until=null, updated_at=now()
    where leased_until is not null and leased_until < now()
      and state not in ('completed','canceled','failed');
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── 3) write gate 보정: deletion worker 의 forfeit write 는 허용 ──────────────────────────
-- 151 write_guard 는 locked 유저의 지갑/원장 write 를 막지만, forfeit(정당한 삭제 단계)는 지갑을 0 으로
-- 만들어야 한다. 트랜잭션 스코프 GUC(ssambership.deletion_worker='on')일 때만 우회한다(그 외 전부 차단 유지).
create or replace function public.account_deletion_write_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
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
end $$;

-- ── 4) 지갑 forfeit + 익명화 원자 RPC (storage 성공 후 단일 트랜잭션) ──────────────────────
-- 잔액을 0원 원장 라인으로 몰수(append-only)하고 PII 익명화(115)를 같은 트랜잭션에서 수행한다.
-- job.state 가 storage_purged 일 때만 허용(Storage 성공 전 금융/익명화 금지).
create or replace function public.account_deletion_forfeit_and_anonymize(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_state text; v_balance bigint; v_ledger_id uuid;
begin
  -- 이 트랜잭션 동안 write gate 우회(자기 forfeit write 만 허용). local=true → 함수 종료 시 자동 해제.
  perform set_config('ssambership.deletion_worker', 'on', true);
  select state into v_state from public.account_deletion_jobs where user_id = p_user_id for update;
  if v_state is null then return jsonb_build_object('ok',false,'code','JOB_NOT_FOUND'); end if;
  if v_state <> 'storage_purged' then return jsonb_build_object('ok',false,'code','WRONG_STATE','state',v_state); end if;

  -- 잔액 forfeit: 남은 balance 를 0 으로 만드는 음수 라인(멱등). append-only(기존 라인 무수정).
  select balance_cents into v_balance from public.cash_wallets where user_id = p_user_id for update;
  if v_balance is not null and v_balance > 0 then
    insert into public.cash_ledger (user_id, delta_cents, reason, ref_type, ref_id, idempotency_key)
    values (p_user_id, -v_balance, 'account_deletion_forfeit', 'account_deletion', p_user_id, 'acct_del_forfeit:'||p_user_id::text)
    on conflict (idempotency_key) do nothing
    returning id into v_ledger_id;
    if v_ledger_id is not null then
      update public.cash_wallets set balance_cents = 0 where user_id = p_user_id;
    end if;
  end if;

  -- PII 익명화(115, 멱등).
  perform public.anonymize_user_for_deletion(p_user_id, 'account_deletion');
  return jsonb_build_object('ok',true,'forfeited_cents',coalesce(v_balance,0),'ledger_id',v_ledger_id);
end $$;

revoke all on function public.account_deletion_claim(text,int,int) from public, anon, authenticated;
revoke all on function public.account_deletion_reclaim_expired() from public, anon, authenticated;
revoke all on function public.account_deletion_forfeit_and_anonymize(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_claim(text,int,int) to service_role;
grant execute on function public.account_deletion_reclaim_expired() to service_role;
grant execute on function public.account_deletion_forfeit_and_anonymize(uuid) to service_role;

commit;

-- §V(rollback-only): locked 유저 Storage INSERT·UPDATE(overwrite/move/upsert) 전면 거부(RESTRICTIVE) ·
--   정상/0job 유저 무영향 · claim 은 미lease/만료lease 만 원자 lease(동시 worker 중복 0) · 만료 lease 회수 ·
--   forfeit_and_anonymize 는 storage_purged 에서만 · 잔액 0원 몰수 라인 append-only 멱등 · 익명화 동일 tx.
