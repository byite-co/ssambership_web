-- 178_p1_10_account_deletion_legacy_claim_revoke.sql
-- ⚠️ 기능 플래그 OFF 기본 · worker kill switch OFF 고정. 실제 사용자·객체 삭제 없음.
--
-- W5 §3-6: 레거시 claim RPC 권한 회수.
--
-- ── 대상 ──────────────────────────────────────────────────────────────────────
--   151 `account_deletion_worker_claim(p_limit integer)` 은 lease 를 **읽지도 쓰지도 않는다**.
--   동시 러너가 같은 job 을 중복 처리할 수 있어, lease 기반
--   `account_deletion_claim(p_owner, p_limit, p_lease_seconds)`(154) 로 대체됐다.
--   그런데 레거시 함수의 `service_role` EXECUTE 가 **여전히 남아 있다**(실측:
--   acl = postgres=X/postgres | service_role=X/postgres). 정본 경로 단일화 관점에서 회수 대상이다.
--
-- ── 회수 전 호출부 실측(저장소 전체) ─────────────────────────────────────────
--   `account_deletion_worker_claim` 문자열 검색 결과 — 정의·ACL 문(151행 194/208/213)과
--   "쓰지 않는다"는 주석 2곳(app/api/cron/account-deletion/route.ts:29,
--   lib/account/accountDeletionAdapters.ts:281)뿐. **실제 호출부 0건.**
--   러너는 154 `account_deletion_claim` 만 쓴다(accountDeletionAdapters.claimDeletionJobs).
--
-- ── 선택: DROP 이 아니라 REVOKE ──────────────────────────────────────────────
--   함수를 폐기하면 151 파일이 기술하는 객체와 DB 실태가 어긋나 롤백 대조가 어려워진다.
--   (151 은 불변 대상은 아니지만 이번 회차에서 수정하지 않기로 한 파일이다.)
--   EXECUTE 를 0 으로 만들면 우회 호출 가능성은 동일하게 사라지면서 정의는 감사 가능하게 남는다.
--   → REVOKE 를 택한다. lease 기반 154 claim 은 그대로 둔다.
--
-- 선행: 151, 154.

begin;
set local lock_timeout='5s';

-- 호출부가 생겼는지 마지막으로 한 번 더 방어 — 이 파일 적용 시점의 계약을 명시한다.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'account_deletion_worker_claim'
  ) then
    raise notice '178: account_deletion_worker_claim 이 이미 없음 — 회수 대상 없음(무해).';
  end if;
end $$;

revoke all on function public.account_deletion_worker_claim(integer) from public, anon, authenticated;
revoke execute on function public.account_deletion_worker_claim(integer) from service_role;

comment on function public.account_deletion_worker_claim(integer) is
  '151(레거시): lease 미사용 claim. 178 에서 EXECUTE 전면 회수 — 정본은 154 account_deletion_claim.';

commit;

-- ── §V 검증(적용 후 실행) ────────────────────────────────────────────────────
--   select p.oid::regprocedure::text, coalesce(array_to_string(p.proacl,' | '),'(default)') as acl
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname in ('account_deletion_worker_claim','account_deletion_claim');
--   기대: worker_claim → postgres=X/postgres 만(service_role 없음)
--         claim(text,integer,integer) → postgres=X/postgres | service_role=X/postgres (불변)
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--   grant execute on function public.account_deletion_worker_claim(integer) to service_role;
