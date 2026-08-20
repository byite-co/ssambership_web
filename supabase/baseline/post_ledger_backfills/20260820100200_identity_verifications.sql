-- [S-B 2026-08-20] m2 — 본인인증 결과 `identity_verifications` + `users.identity_verified_at`.
--
-- 용도: NICE 표준창 본인인증(S-C 구현 예정) 요청·결과 저장. 최소수집 원칙 —
--       raw 응답 jsonb 컬럼은 만들지 않는다.
--
-- 암호화 계약(앱 계층 — S-C 에서 구현, DB 는 컬럼만 제공):
--   *_enc  = 'v1:' + base64(iv || ciphertext || tag), AES-256-GCM (ci_enc/di_enc/mobile_no_enc)
--   di_hash = HMAC-SHA256 hex (결정적) — 중복계정 차단 키.
--   평문 CI/DI/전화번호 컬럼 금지(이 파일에 존재하지 않음이 계약이다).
--
-- 중복계정 차단: 부분 유니크 `identity_verifications_di_hash_verified_uniq`
--   ON (di_hash) WHERE status='verified' AND di_hash IS NOT NULL —
--   같은 실명인(동일 DI)의 verified 행은 시스템 전체에 1개만 허용.
--
-- users.identity_verified_at (nullable·무DEFAULT — B5: 부분-컬럼 INSERT 4지점 보존):
--   users ACL 은 테이블 단위 GRANT(컬럼 attacl 전무 — C2 실측)이므로 신규 컬럼은
--   authenticated SELECT 범위에 자동 포함된다(클라이언트에게 보인다 — 민감도 낮음, 허용 결정).
--   UPDATE 는 여전히 불가(users 에 authenticated UPDATE GRANT 자체가 없음 — 갱신은
--   service_role 경로 전용, IMPACT 수정 제안 #7).
--
-- 접근 경계: service_role 전용(RLS on·정책 0·anon/authenticated GRANT 0 — 151 선례).
-- 탈퇴 파기: m7 `account_deletion_purge_identity_payment_artifacts` 가 전행 DELETE.
-- adg 가드: 151 의 `account_deletion_write_guard` 패턴 그대로 — 탈퇴 진행(locked 이상)
--   유저 앞으로 신규 인증 행 삽입을 차단한다.
--
-- 롤백 노트 (실행 금지 — 참고용):
--   -- drop trigger if exists adg_identity_verifications on public.identity_verifications;
--   -- drop trigger if exists trg_iv_set_updated on public.identity_verifications;
--   -- drop table if exists public.identity_verifications;
--   -- alter table public.users drop column if exists identity_verified_at;

create table if not exists public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  request_no text not null unique,
  transaction_id text,
  token_id uuid references public.nice_auth_tokens (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','verified','failed','expired')),
  verified_name text,
  birthdate date,
  gender text,
  national_info text,
  mobile_co text,
  ci_enc text,
  di_enc text,
  mobile_no_enc text,
  di_hash text,
  failure_code text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.identity_verifications is
  'S-B m2: NICE 본인인증 요청·결과. service_role 전용. ci/di/mobile_no 는 앱 계층 AES-256-GCM(v1: 접두) 암호문만, di_hash 는 HMAC-SHA256 hex. verified 행은 di_hash 부분 유니크로 중복계정 차단. 탈퇴 시 m7 RPC 가 전행 파기.';

create unique index if not exists identity_verifications_di_hash_verified_uniq
  on public.identity_verifications (di_hash)
  where status = 'verified' and di_hash is not null;

create index if not exists identity_verifications_user_id_idx
  on public.identity_verifications (user_id);

alter table public.identity_verifications enable row level security;
revoke all on public.identity_verifications from public, anon, authenticated;
grant select, insert, update, delete on public.identity_verifications to service_role;

-- updated_at 유지 — 정본 set_updated_at() (001) · trg_<약어>_set_updated 관례.
drop trigger if exists trg_iv_set_updated on public.identity_verifications;
create trigger trg_iv_set_updated before update on public.identity_verifications
  for each row execute function public.set_updated_at();

-- 탈퇴 진행 유저 write 차단 — 151 adg_* 부착 패턴 그대로(TG_ARGV[0]=유저 컬럼명).
drop trigger if exists adg_identity_verifications on public.identity_verifications;
create trigger adg_identity_verifications before insert on public.identity_verifications
  for each row execute function public.account_deletion_write_guard('user_id');

-- 게이트 판독 컬럼 — nullable·무DEFAULT (기존 부분-컬럼 INSERT·트리거와 무충돌).
alter table public.users add column if not exists identity_verified_at timestamptz;

comment on column public.users.identity_verified_at is
  'S-B m2: 본인인증(NICE) 완료 시각. NULL = 미인증. 기록은 service_role 경로 전용(S-C).';
