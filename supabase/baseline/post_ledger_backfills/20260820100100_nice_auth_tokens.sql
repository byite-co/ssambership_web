-- [S-B 2026-08-20] m1 — NICE 본인인증 기관토큰 캐시 `nice_auth_tokens` + 일일 스윕.
--
-- 용도: NICE 표준창 연동(S-C 구현 예정)이 기관토큰(access_token/ticket/iterators)을
--       서버에서 캐시하는 저장소. 유저 귀속 데이터가 아니므로(user FK 없음) 탈퇴 사가
--       비대상 — 수명 관리는 아래 pg_cron 스윕이 대신한다.
--
-- 접근 경계: `account_deletion_jobs` 선례(151) — RLS enable + 정책 0 +
--       anon/authenticated GRANT 0 = service_role 전용. 클라이언트 노출 금지.
--
-- pg_cron 스윕 `nice_auth_token_sweep_daily` (일 1회, 16:20 UTC = 01:20 KST):
--   ① expires_at < now() - interval '1 day' 인 토큰 행 DELETE
--   ② identity_verifications 의 stale pending(생성 24h 초과)을 status='expired' 로 UPDATE
--   ②의 대상 테이블은 m2(20260820100200)가 만든다 — cron 잡 본문은 실행 시점에만
--   해석되는 텍스트이고 스케줄(일 1회)상 첫 실행 전에 m2 적용이 선행되므로 안전하다.
--   로컬 재생 스크래치 PG 에는 pg_cron 이 없으므로 확장 존재를 확인하고 없으면 건너뛴다
--   (20260806202000 settlement 스케줄 선례와 동일 — fresh replay 가 깨지지 않는다).
--
-- 롤백 노트 (실행 금지 — 참고용):
--   -- select cron.unschedule('nice_auth_token_sweep_daily');
--   -- drop table if exists public.nice_auth_tokens;

create table if not exists public.nice_auth_tokens (
  id uuid primary key default gen_random_uuid(),
  access_token text not null,
  ticket text not null,
  iterators int not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.nice_auth_tokens is
  'S-B m1: NICE 본인인증 기관토큰 캐시. service_role 전용(RLS on·정책 0·클라이언트 GRANT 0). 수명은 nice_auth_token_sweep_daily 크론이 관리(탈퇴 사가 비대상 — 유저 귀속 아님).';

alter table public.nice_auth_tokens enable row level security;
revoke all on public.nice_auth_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.nice_auth_tokens to service_role;

-- 일일 스윕 등록 — pg_cron 이 있는 환경(라이브)에서만. 멱등(동명 잡 제거 후 재등록).
do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'S-B m1: pg_cron 미설치 — 스윕 등록을 건너뛴다(로컬 재생 환경).';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job
   where jobname = 'nice_auth_token_sweep_daily';

  perform cron.schedule(
    'nice_auth_token_sweep_daily',
    '20 16 * * *',
    $job$
      delete from public.nice_auth_tokens
       where expires_at < now() - interval '1 day';
      update public.identity_verifications
         set status = 'expired', updated_at = now()
       where status = 'pending'
         and created_at < now() - interval '24 hours';
    $job$
  );

  raise notice 'S-B m1: nice_auth_token_sweep_daily 등록 완료(매일 16:20 UTC).';
end
$do$;
