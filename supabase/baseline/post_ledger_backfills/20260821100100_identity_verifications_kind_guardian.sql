-- [S-C 2026-08-21] m8 — identity_verifications 보호자 체인·CAS 락 지원 (S-C 부록 A).
--
-- 라이브 실측(2026-08-21) 기준 현행 스키마(S-B m2)가 S-C 지시서를 지원하지 못하는 3점 보정:
--   ① kind 컬럼 부재 — self(본인)/guardian(보호자) 인증 행 구분 불가.
--      현재 0행이므로 NOT NULL DEFAULT 'self' 추가가 안전하다.
--   ② status CHECK 에 'processing' 없음 — return 핸들러의 CAS 락
--      (pending→processing 원자 전환, NICE result 1회성·3033 재호출 방지)이
--      첫 실행부터 23514 로 깨진다. CHECK 를 재정의한다.
--   ③ di_hash 부분 유니크가 kind 무구분 — 보호자(guardian)는 자녀 복수 인증이
--      가능해야 하고, 본인 가입 학부모의 self 행과도 충돌하면 안 된다.
--      중복계정 차단은 kind='self' 한정으로 재정의한다.
--
-- user_consent_records 는 무변경 — consent_type CHECK 'minor_guardian_consent',
-- consent_actor CHECK 'guardian', guardian_ref·idempotency_key UNIQUE 실재를
-- 실측 확인(087). S-C §3 스펙이 그대로 사용한다.
--
-- 구조 카운트 축(테이블·함수·정책·버킷) 불변 — CI 기대치 수정 불요.
-- columns.json +1행(kind), contracts 스냅샷 $.migrations +1 (적용 회차 후속 절차).
--
-- 롤백 노트 (실행 금지 — 참고용):
--   -- drop index if exists public.identity_verifications_di_hash_verified_uniq;
--   -- create unique index if not exists identity_verifications_di_hash_verified_uniq
--   --   on public.identity_verifications (di_hash)
--   --   where status = 'verified' and di_hash is not null;
--   -- alter table public.identity_verifications
--   --   drop constraint if exists identity_verifications_status_check;
--   -- alter table public.identity_verifications
--   --   add constraint identity_verifications_status_check
--   --   check (status in ('pending','verified','failed','expired'));
--   -- alter table public.identity_verifications drop column if exists kind;

-- ① kind — self(본인) / guardian(보호자). 현재 0행 실측이라 NOT NULL 즉시 부여 안전.
alter table public.identity_verifications
  add column if not exists kind text not null default 'self'
  check (kind in ('self', 'guardian'));

comment on column public.identity_verifications.kind is
  'S-C m8: self=가입자 본인 인증, guardian=만 14세 미만 가입자의 법정대리인 인증. 중복계정 차단(di_hash 유니크)은 self 한정.';

-- ② status CHECK 재정의 — CAS 락 상태 'processing' 추가.
--    (m2 인라인 CHECK 의 자동 이름 identity_verifications_status_check 를 교체)
alter table public.identity_verifications
  drop constraint if exists identity_verifications_status_check;
alter table public.identity_verifications
  add constraint identity_verifications_status_check
  check (status in ('pending', 'processing', 'verified', 'failed', 'expired'));

-- ③ di_hash 부분 유니크 재정의 — kind='self' 한정.
--    guardian 행은 (자녀 2명 이상 → 동일 보호자 DI verified 복수 행) 허용해야 하고,
--    본인 명의로 가입한 학부모의 self verified 행과도 충돌하면 안 된다.
drop index if exists public.identity_verifications_di_hash_verified_uniq;
create unique index if not exists identity_verifications_di_hash_verified_uniq
  on public.identity_verifications (di_hash)
  where status = 'verified' and di_hash is not null and kind = 'self';
