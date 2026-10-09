-- B안: 공개 멘토 프로필 RPC에 안전 컬럼 2개(프로필 사진, 출신 고교)만 추가.
-- PII(student_id_image_url)·정산 계좌(payout_*)는 계속 제외. 학번/태그는 원본 컬럼 없음.
drop function if exists public.mentor_profiles_for_directory_v2(uuid[]);

create or replace function public.mentor_profiles_for_directory_v2(p_ids uuid[])
returns table (
  user_id uuid,
  university_name text,
  department_name text,
  teaching_subjects text[],
  intro_line text,
  verification_status text,
  created_at timestamptz,
  verified_university_name text,
  verified_department_name text,
  verified_major_category text,
  school_tier text,
  school_verified boolean,
  high_school_name text,
  profile_image_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    mp.user_id,
    mp.university_name,
    mp.department_name,
    mp.teaching_subjects,
    mp.intro_line,
    mp.verification_status,
    mp.created_at,
    sv.verified_university_name,
    sv.verified_department_name,
    sv.verified_major_category,
    sv.school_tier,
    (sv.mentor_id is not null) as school_verified,
    mp.high_school_name,
    mp.profile_image_url
  from public.mentor_profiles mp
  left join lateral (
    select
      msv.mentor_id,
      msv.verified_university_name,
      msv.verified_department_name,
      msv.verified_major_category,
      msv.school_tier
    from public.mentor_school_verifications msv
    where msv.mentor_id = mp.user_id
      and msv.status = 'approved'
    order by coalesce(msv.reviewed_at, msv.updated_at, msv.created_at) desc, msv.created_at desc
    limit 1
  ) sv on true
  where p_ids is not null
    and array_length(p_ids, 1) is not null
    and mp.user_id = any (p_ids);
$$;

revoke all on function public.mentor_profiles_for_directory_v2(uuid[]) from public;
grant execute on function public.mentor_profiles_for_directory_v2(uuid[]) to anon, authenticated;

comment on function public.mentor_profiles_for_directory_v2(uuid[]) is
  'P0 public mentor directory whitelist (+ profile photo, high school). Excludes PII, consent, payout, and document paths.';