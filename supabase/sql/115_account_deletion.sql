-- =============================================================================
-- 115_account_deletion.sql
-- ⚠️ 라이브 미적용 — 기능 플래그(NEXT_PUBLIC_FEATURE_ACCOUNT_DELETION) ON 배포 시점에 적용 (114 패턴)
-- =============================================================================
-- 목적(스펙 docs/plans/account-deletion-spec.md): 계정 삭제 = PII 익명화 + 원장 보존.
--   물리 삭제 금지 근거(스펙 §0): public.users FK 84개(CASCADE 41) + users→auth.users
--   ON DELETE CASCADE → auth 하드삭제 시 원장·거래 연쇄 파괴. 따라서 soft-delete만.
--
-- 신규 객체만 추가한다 — 기존 RLS/트리거/함수 무수정.
--   ① user_deletion_log  : 감사 로그 (service_role 전용 — RLS enable + 정책 없음 = 기본 거부, payout_runs 패턴)
--   ② anonymize_user_for_deletion(uuid, text) : SECURITY DEFINER RPC, service_role 전용
--
-- 실스키마 확정(2026-07-04 staging 실측 — 스펙 §1 "임의 추정 금지" 이행):
--   users PII: full_name·nickname·email(nullable)·grade_level·student_status·birth_date
--   users.status: CHECK 제약 없음(users_role_check만 존재) → 'deleted' 마킹에 CHECK 확장 불필요
--   mentor_profiles PII: university_name·department_name·high_school_name(NOT NULL 3종),
--     teaching_subjects(NOT NULL array), intro_line·answer_style·student_id_image_url·
--     profile_image_url·payout_bank_name·payout_account_number(nullable)
--
-- 금지(스펙 §1-2): cash_ledger·payments·settlement·payout·orders·subscriptions·reviews·
--   community 콘텐츠의 UPDATE/DELETE 일절 없음 — 이 파일은 users/mentor_profiles의
--   PII 컬럼 UPDATE + 신규 로그 INSERT만 수행한다. 작성자 표기는 표시 계층 조인이
--   익명화된 nickname('탈퇴회원_…')을 읽어 자동 반영된다.
--
-- 선행(적용 시): 001(users/mentor_profiles), 102(status 부가 컬럼).
-- =============================================================================

-- ① 감사 로그 — service_role 전용
create table if not exists public.user_deletion_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users (id),
  requested_at timestamptz not null default now(),
  reason text null,
  snapshot jsonb not null default '{}'::jsonb
);

comment on table public.user_deletion_log is
  '115: 계정 삭제(익명화) 감사 로그. user_id unique = RPC 멱등 기준. snapshot은 비-PII 메타만.';

alter table public.user_deletion_log enable row level security;
-- 정책 없음 = anon/authenticated 기본 거부(service_role은 RLS 우회) — payout_runs(106) 패턴.
revoke all on public.user_deletion_log from public, anon, authenticated;

-- ② 익명화 RPC — service_role 전용
create or replace function public.anonymize_user_for_deletion(
  p_user_id uuid,
  p_reason text default null
)
returns table (already_deleted boolean, anonymized boolean)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user public.users%rowtype;
  v_has_mentor_profile boolean;
begin
  -- 가드: 대상 존재
  select * into v_user from public.users where id = p_user_id;
  if not found then
    raise exception 'anonymize_user_for_deletion: user % not found', p_user_id;
  end if;

  -- 멱등: 이미 삭제 처리된 계정이면 no-op 반환
  if exists (select 1 from public.user_deletion_log l where l.user_id = p_user_id)
     or lower(coalesce(v_user.status, '')) = 'deleted' then
    return query select true, false;
    return;
  end if;

  select exists (select 1 from public.mentor_profiles mp where mp.user_id = p_user_id)
    into v_has_mentor_profile;

  -- users PII 익명화 (스펙 §1-2; email은 nullable 실측 → null)
  update public.users
  set full_name = '탈퇴회원',
      nickname = '탈퇴회원_' || left(p_user_id::text, 8),
      email = null,
      grade_level = null,
      student_status = null,
      birth_date = null,
      status = 'deleted',
      status_reason = coalesce(p_reason, 'user_requested_deletion'),
      status_changed_at = now(),
      updated_at = now()
  where id = p_user_id;

  -- mentor_profiles PII 익명화 (존재 시; NOT NULL 컬럼은 익명 문구, nullable은 null)
  if v_has_mentor_profile then
    update public.mentor_profiles
    set university_name = '(삭제됨)',
        department_name = '(삭제됨)',
        high_school_name = '(삭제됨)',
        teaching_subjects = '{}'::text[],
        intro_line = null,
        answer_style = null,
        student_id_image_url = null,
        profile_image_url = null,
        payout_bank_name = null,
        payout_account_number = null,
        updated_at = now()
    where user_id = p_user_id;
  end if;

  -- 감사 로그 (snapshot은 비-PII 메타만 — PII 보관 시 익명화 취지 훼손)
  insert into public.user_deletion_log (user_id, reason, snapshot)
  values (
    p_user_id,
    p_reason,
    jsonb_build_object('role', v_user.role, 'had_mentor_profile', v_has_mentor_profile)
  )
  on conflict (user_id) do nothing;

  return query select false, true;
end;
$function$;

comment on function public.anonymize_user_for_deletion(uuid, text) is
  '115: 계정 삭제 — users/mentor_profiles PII 익명화 + status=deleted + 감사 로그. 멱등(user_deletion_log unique). service_role 전용. ★라이브 미적용(플래그 ON 배포 시 적용).';

revoke all on function public.anonymize_user_for_deletion(uuid, text) from public, anon, authenticated;
grant execute on function public.anonymize_user_for_deletion(uuid, text) to service_role;
