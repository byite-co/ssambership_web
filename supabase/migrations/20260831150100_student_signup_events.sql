-- =============================================================================
-- 190_student_signup_events.sql  (2026-08-31)
--
-- Purpose: 신규 **학생** 가입을 가입 시점에 포착해 보고 큐에 적재한다.
--   운영자가 "누가 새로 가입했나"를 놓치지 않고 확인하기 위한 경로로,
--   `public.users` AFTER INSERT 트리거가 `role='student'` 행만 잡아
--   `public.student_signup_events` 에 1행을 남긴다.
--
-- 왜 폴링이 아니라 트리거인가:
--   보고 주체(운영 세션·배치)는 상시 떠 있지 않다. `users` 를 시각 워터마크로
--   훑는 방식은 워터마크를 보고 주체 쪽에 두므로, 그쪽이 내려간 사이의 가입은
--   워터마크 유실 시 누락되거나 중복 보고된다. 보고 여부를 DB 컬럼
--   (`reported_at`)으로 옮기면 보고 주체가 얼마나 오래 꺼져 있었든 큐가 남고,
--   재개 시 `reported_at is null` 만 순서대로 소비하면 정확히 1회 보고된다.
--
-- snapshot 이 있는 이유:
--   `users` 행은 가입 후 변경된다(닉네임 수정·상태 변경·탈퇴 익명화 등).
--   "가입 당시 무엇이었나"는 그때 고정해두지 않으면 복원할 수 없으므로
--   INSERT 시점 값을 jsonb 로 동결한다. 보고 시점의 최신값·본인인증 결과는
--   소비 측이 users/identity_verifications 를 조인해 채운다(스냅샷은 그 용도가
--   아니다 — 본인인증은 가입 INSERT 보다 뒤에 일어나므로 여기 담길 수 없다).
--
-- PII 경계: 이 표는 타인의 이름·이메일·생년월일을 교차 보유한다. 소유자 개념이
--   없으므로 RLS 를 켜되 **정책을 만들지 않는다**(authenticated 전면 차단).
--   접근은 service_role 단독 — 관리자 UI 가 필요해지면 requireRole("admin")
--   서버 액션이 service_role 로 읽는다. anon/authenticated 직접 조회 경로 없음.
--   *_enc(CI/DI/휴대폰) 는 담지 않는다 — lib/identity/identityCrypto.ts 의
--   "평문 CI/DI/전화번호는 어떤 컬럼·로그에도 두지 않는다" 계약을 그대로 따른다.
--
-- 가입 무중단 보장 (중요): 트리거는 AFTER INSERT 이므로 여기서 예외가 나가면
--   회원가입 트랜잭션 전체가 롤백된다. 보고용 부가 기능이 가입을 깨뜨리는 것은
--   허용할 수 없으므로 본문 전체를 EXCEPTION WHEN others 로 감싸 삼킨다.
--   적재 실패는 보고 1건 누락이지만, 삼키지 않으면 가입 자체가 실패한다.
--
-- Base: 신규 오브젝트만 생성한다. 기존 테이블·함수·RPC 무접촉.
--   `public.users` 에 붙는 기존 트리거와 독립(AFTER, 별도 이름).
--
-- Apply: 저장소 표준 경로(db-apply-pending) — MCP apply_migration 직접 적용 금지.
--   pack 등재: supabase/baseline/post_ledger_backfills/20260831150100_student_signup_events.sql
--
-- Rollback (실행 금지 — 참고용):
--   -- drop trigger if exists student_signup_event_capture on public.users;
--   -- drop function if exists public.student_signup_event_capture();
--   -- drop table if exists public.student_signup_events;
-- =============================================================================

begin;

-- A. 사전 게이트 — 대상 테이블이 실재하고, 이름 충돌이 없어야 한다
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION '190_GATE: public.users not present';
  END IF;
  IF to_regclass('public.student_signup_events') IS NOT NULL THEN
    RAISE EXCEPTION '190_GATE: public.student_signup_events already exists — nothing to do';
  END IF;
END $$;

-- B. 보고 큐 테이블
create table public.student_signup_events (
  id uuid primary key default gen_random_uuid(),
  -- 학생 1명당 1행. 재가입은 새 users.id 이므로 새 행이 된다.
  user_id uuid not null unique references public.users (id) on delete cascade,
  -- users.created_at 을 그대로 복사한다(트리거의 now() 가 아니라) — 보고 정렬 기준이
  -- 가입 시각과 어긋나지 않게 한다.
  occurred_at timestamptz not null,
  -- 가입 INSERT 시점 동결값. 키 집합은 아래 트리거 함수가 정본.
  snapshot jsonb not null,
  -- null = 미보고. 소비 측이 보고 직후 now() 로 채운다. 이 컬럼이 워터마크다.
  reported_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.student_signup_events is
  '신규 학생 가입 보고 큐. public.users AFTER INSERT(role=student) 트리거가 적재하고, 소비 측이 reported_at is null 을 정확히 1회 보고한 뒤 now() 로 마킹한다. snapshot 은 가입 시점 동결값 — 최신값·본인인증은 소비 측이 조인해 채운다. 타인 PII 교차 보유 표이므로 RLS 정책 없음(service_role 전용).';

comment on column public.student_signup_events.reported_at is
  '보고 완료 시각. null 이면 미보고 — 소비 측의 유일한 워터마크. 보고 주체가 내려가 있어도 이 값이 DB 에 남아 누락·중복이 발생하지 않는다.';

comment on column public.student_signup_events.snapshot is
  '가입 INSERT 시점의 users 행 동결 스냅샷. users 행은 이후 변경되므로 "가입 당시" 는 여기서만 복원된다. CI/DI/휴대폰 등 *_enc 는 담지 않는다.';

-- 소비 경로 전용 부분 인덱스 — 미보고분만 훑는다(보고 완료분이 쌓여도 비용 불변).
create index student_signup_events_unreported_idx
  on public.student_signup_events (occurred_at)
  where reported_at is null;

-- C. 접근 경계 — service_role 단독. 정책을 만들지 않아 authenticated 는 전면 차단된다.
alter table public.student_signup_events enable row level security;
revoke all on public.student_signup_events from public, anon, authenticated;
grant select, insert, update on public.student_signup_events to service_role;

-- D. 적재 트리거 함수
create function public.student_signup_event_capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
BEGIN
  BEGIN
    INSERT INTO public.student_signup_events (user_id, occurred_at, snapshot)
    VALUES (
      NEW.id,
      NEW.created_at,
      jsonb_build_object(
        'user_id',            NEW.id,
        'role',               NEW.role,
        'status',             NEW.status,
        'full_name',          NEW.full_name,
        'nickname',           NEW.nickname,
        'email',              NEW.email,
        'birth_date',         NEW.birth_date,
        'grade_level',        NEW.grade_level,
        'student_status',     NEW.student_status,
        'marketing_agreed',   NEW.marketing_agreed,
        'terms_agreed_at',    NEW.terms_agreed_at,
        'privacy_agreed_at',  NEW.privacy_agreed_at,
        'created_at',         NEW.created_at
      )
    )
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN others THEN
    -- 가입 트랜잭션을 절대 깨뜨리지 않는다(헤더 "가입 무중단 보장" 참조).
    -- 적재 실패 = 보고 1건 누락, 전파 = 회원가입 실패. 후자가 비교 불가하게 나쁘다.
    NULL;
  END;
  RETURN NULL;  -- AFTER 트리거의 반환값은 무시된다.
END;
$$;

comment on function public.student_signup_event_capture() is
  'public.users AFTER INSERT(role=student) → student_signup_events 적재. 예외를 삼켜 가입 트랜잭션을 보호한다.';

revoke all on function public.student_signup_event_capture() from public, anon, authenticated;

-- E. 트리거 부착 — role='student' 행만. WHEN 절로 걸러 멘토·관리자 가입에는 관여하지 않는다.
create trigger student_signup_event_capture
  after insert on public.users
  for each row
  when (NEW.role = 'student')
  execute function public.student_signup_event_capture();

-- F. 기존 학생 백필 — 이미 보고된 상태로 넣어 큐를 빈 상태에서 시작한다.
--    (트리거는 신규 INSERT 만 잡으므로 백필하지 않으면 기존 행은 영영 표에 없다.
--     reported_at 을 채워 넣는 이유: 과거 가입자를 "신규"로 재보고하지 않기 위함.)
insert into public.student_signup_events (user_id, occurred_at, snapshot, reported_at)
select
  u.id,
  u.created_at,
  jsonb_build_object(
    'user_id',            u.id,
    'role',               u.role,
    'status',             u.status,
    'full_name',          u.full_name,
    'nickname',           u.nickname,
    'email',              u.email,
    'birth_date',         u.birth_date,
    'grade_level',        u.grade_level,
    'student_status',     u.student_status,
    'marketing_agreed',   u.marketing_agreed,
    'terms_agreed_at',    u.terms_agreed_at,
    'privacy_agreed_at',  u.privacy_agreed_at,
    'created_at',         u.created_at,
    'backfilled',         true
  ),
  now()
from public.users u
where u.role = 'student'
on conflict (user_id) do nothing;

-- G. 사후 게이트 — 오브젝트가 모두 붙었는지 확인
DO $$
BEGIN
  IF to_regclass('public.student_signup_events') IS NULL THEN
    RAISE EXCEPTION '190_POST: table not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.users'::regclass
       AND t.tgname = 'student_signup_event_capture'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION '190_POST: trigger not attached to public.users';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'student_signup_events'
  ) THEN
    RAISE EXCEPTION '190_POST: unexpected RLS policy — table must stay service_role only';
  END IF;
END $$;

commit;
