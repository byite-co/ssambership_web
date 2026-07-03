-- 112_mentor_directory_rpc_photo_highschool.sql
-- 공개 멘토 프로필 RPC(mentor_profiles_for_directory_v2)에 프로필 사진·고교 표시 필드 추가.
-- 선행: 078_p0_public_mentor_read_rpc_v2.sql, 097_mentor_profile_avatar.sql
--   - mentor_profiles.high_school_name  (001, not null text)
--   - mentor_profiles.profile_image_url (097, text)
-- ⚠️ 본 SQL은 이미 운영 DB에 적용됨. 저장소 기록용이며 재실행해도 안전(idempotent).
--   RETURNS TABLE 시그니처가 바뀌므로 CREATE OR REPLACE만으로는 불가 → DROP 후 재생성.
-- Run manually in Supabase SQL Editor.

begin;

-- 반환 컬럼(시그니처) 변경을 위해 기존 함수 제거 후 재생성.
drop function if exists public.mentor_profiles_for_directory_v2(uuid[]);

-- Public mentor profiles: safe profile fields plus approved school verification display fields,
-- 그리고 공개 표시용 프로필 사진(profile_image_url)·고교(high_school_name).
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

comment on function public.mentor_profiles_for_directory_v2(uuid[]) is 'P0 public mentor profile whitelist plus approved school verification display fields, public profile photo, and high school name only.';

commit;
