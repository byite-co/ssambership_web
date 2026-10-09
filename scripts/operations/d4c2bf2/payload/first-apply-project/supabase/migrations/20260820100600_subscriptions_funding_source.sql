-- [S-B 2026-08-20] m6 — `subscriptions.funding_source` (cash | pg) + 기존 행 'cash' 백필.
--
-- 용도: 구독별 결제수단 관할 분리(IMPACT 차단 이슈 B2 — 갱신 이중화 방지)의 스키마 기반.
--   기존 캐시 갱신 크론(process_subscription_renewal)과 신규 빌링키 크론(S-E)이
--   같은 구독을 경쟁 갱신하지 않도록, 구독마다 결제수단을 하나로 못박는다.
--   소비 분기(갱신 배치 필터·RPC 가드)는 S-C~E 후속 — 이번 회차는 컬럼만.
--
-- **NULL 은 'cash' 로 해석한다(방어적).** 백필 이후 신규 행이 funding_source 없이
--   생기더라도(기존 INSERT 경로는 이 컬럼을 모른다) 기존 동작 = 캐시 차감 갱신이
--   그대로 유지되어야 한다. 'pg' 는 S-D~E 의 빌링키 경로가 명시적으로 기록할 때만.
--
-- 컬럼은 nullable·무DEFAULT (B5 확정치 — 부분-컬럼 INSERT 무영향).
-- 백필 UPDATE: 기존 행 전부 'cash' (적용 시점 실측 2행 — 현행 구독은 전부 캐시 차감).
--   subscriptions 의 BEFORE UPDATE 트리거 중 발화하는 것은 trg_subs_set_updated
--   (updated_at 갱신)뿐 — trg_enforce_mentor_cap 은 UPDATE OF status·plan_tier,
--   trg_sub_notify_expired 는 status 전이 시에만 발화한다(DB 트리거 실측).
--   웹 정렬 컬럼은 created_at(SUBSCRIPTIONS_ORDER_COLUMN)이라 updated_at 변경 무영향.
--
-- 롤백 노트 (실행 금지 — 참고용):
--   -- alter table public.subscriptions drop constraint if exists subscriptions_funding_source_check;
--   -- alter table public.subscriptions drop column if exists funding_source;

alter table public.subscriptions
  add column if not exists funding_source text;

comment on column public.subscriptions.funding_source is
  'S-B m6: 구독 결제수단 관할(cash=캐시 지갑 차감, pg=포트원 빌링키). NULL 은 cash 로 해석(방어적). 갱신 크론 관할 분리(B2)의 기반 — 소비 분기는 S-C~E.';

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_funding_source_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_funding_source_check
      check (funding_source in ('cash','pg'));
  end if;
end
$do$;

-- 기존 행 전부 'cash' 백필 — 현행 구독은 전부 캐시 차감 경로다(W5 실측).
update public.subscriptions
   set funding_source = 'cash'
 where funding_source is null;
