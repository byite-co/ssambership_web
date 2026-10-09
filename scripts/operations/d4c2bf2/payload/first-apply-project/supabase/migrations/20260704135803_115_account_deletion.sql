-- =============================================================================
-- 115_account_deletion.sql (레포 원문 — 적용: 2026-07-04, 선행 102 적용 완료)
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
  select * into v_user from public.users where id = p_user_id;
  if not found then
    raise exception 'anonymize_user_for_deletion: user % not found', p_user_id;
  end if;

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
  '115: 계정 삭제 — users/mentor_profiles PII 익명화 + status=deleted + 감사 로그. 멱등(user_deletion_log unique). service_role 전용. 적용: 2026-07-04.';

revoke all on function public.anonymize_user_for_deletion(uuid, text) from public, anon, authenticated;
grant execute on function public.anonymize_user_for_deletion(uuid, text) to service_role;