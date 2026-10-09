-- [S-B 2026-08-20] m3 — 포트원 빌링키 `billing_keys` (구독 정기결제 전용).
--
-- 스코프: 포트원 = **구독 전용**(빌링키). Toss 캐시 생태계(충전·IQ 에스크로)와
--   `cash-` orderId 규약은 이 테이블과 무관하다 — 건드리지 않는다.
--
-- 평문 저장 결정: **빌링키는 포트원 V2 API Secret 없이는 단독 사용 불가**(빌링키만으로는
--   청구를 일으킬 수 없고, 청구 API 호출에 서버 보관 Secret 이 반드시 필요하다) →
--   service_role 전용 테이블(RLS on·정책 0·anon/authenticated GRANT 0 — 151 선례)에
--   평문 저장한다. 카드 정보는 마스킹값(card_masked_no)만 보관한다.
--
-- 활성 1키 계약: 부분 유니크 `billing_keys_user_id_active_uniq` ON (user_id)
--   WHERE status='active' — 유저당 active 빌링키는 1개. 교체는 기존 키를
--   status='deleted'(+deleted_at) 로 내린 뒤 새 행 삽입(S-D 구현 예정).
--
-- 탈퇴 파기: m7 `account_deletion_purge_identity_payment_artifacts` 가 전행 DELETE
--   (삭제 전 active 키 개수를 반환값에 포함 — S-D 에서 포트원 빌링키 해지 API 를
--   DB 삭제 **앞에** 삽입할 것).
-- adg 가드: 탈퇴 진행(locked 이상) 유저 앞 빌링키 발급 삽입 차단(151 패턴).
--
-- 롤백 노트 (실행 금지 — 참고용):
--   -- drop trigger if exists adg_billing_keys on public.billing_keys;
--   -- drop table if exists public.billing_keys;  -- (m4 payments.billing_key_id FK 선삭제 필요)

create table if not exists public.billing_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  billing_key text not null,
  card_brand text,
  card_masked_no text,
  channel_key text,
  status text not null default 'active'
    check (status in ('active','deleted')),
  issued_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.billing_keys is
  'S-B m3: 포트원 V2 빌링키(구독 정기결제 전용). service_role 전용 — V2 API Secret 없이는 단독 사용 불가하여 평문 저장 결정. 유저당 active 1키(부분 유니크). 탈퇴 시 m7 RPC 가 전행 파기(S-D: 해지 API 선행 예정).';

create unique index if not exists billing_keys_user_id_active_uniq
  on public.billing_keys (user_id)
  where status = 'active';

create index if not exists billing_keys_user_id_idx
  on public.billing_keys (user_id);

alter table public.billing_keys enable row level security;
revoke all on public.billing_keys from public, anon, authenticated;
grant select, insert, update, delete on public.billing_keys to service_role;

-- 탈퇴 진행 유저 write 차단 — 151 adg_* 부착 패턴 그대로.
drop trigger if exists adg_billing_keys on public.billing_keys;
create trigger adg_billing_keys before insert on public.billing_keys
  for each row execute function public.account_deletion_write_guard('user_id');
