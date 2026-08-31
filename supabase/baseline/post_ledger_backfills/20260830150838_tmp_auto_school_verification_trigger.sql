-- [임시/스테이징 전용] 멘토 승인 시 학교·전공 인증 자동 처리
-- 목적: 정식 학교인증 플로우 운영 전까지 신규 멘토에게 "참고·미인증" 배지가 붙지 않도록
--       승인 시점에 approved 인증 행(+학교군/계열 분류)을 자동 삽입.
-- 제거(정식 플로우 전환 시):
--   drop trigger if exists trg_tmp_auto_school_verification on public.mentor_profiles;
--   drop function if exists public.tmp_auto_school_verification();

create or replace function public.tmp_auto_school_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.verification_status, '')) in ('approved', 'verified', 'active') then
    insert into public.mentor_school_verifications
      (mentor_id, status, verified_university_name, verified_department_name,
       school_tier, verified_major_category, reviewed_at)
    select
      new.user_id,
      'approved',
      nullif(trim(new.university_name), ''),
      nullif(trim(new.department_name), ''),
      case
        when new.university_name like '서울대%' or new.university_name like '연세대%' or new.university_name like '고려대%'
          then '서연고'
        when new.university_name like '서강대%' or new.university_name like '성균관대%' or new.university_name like '한양대%'
          then '서성한'
        when new.university_name like '중앙대%' or new.university_name like '경희대%'
          or new.university_name like '한국외%' or new.university_name like '서울시립대%'
          then '중경외시'
        when new.university_name like '건국대%' or new.university_name like '동국대%' or new.university_name like '홍익대%'
          then '건동홍'
        else '미분류'
      end,
      case
        when new.department_name like '%의예%' or new.department_name like '%의학%'
          or new.department_name like '%치의%' or new.department_name like '%약학%' or new.department_name like '%한의%'
          or new.department_name like '%수의%' or new.department_name like '%간호%'
          then '메디컬'
        when new.department_name like '%교육%' then '교육'
        when new.department_name like '%국어국문%' or new.department_name like '%문헌정보%'
          or new.department_name like '%철학%' or new.department_name like '%사학%' or new.department_name like '%어문%'
          then '인문'
        when new.department_name like '%경영%' or new.department_name like '%경제%'
          or new.department_name like '%미디어%' or new.department_name like '%정치%' or new.department_name like '%사회학%'
          or new.department_name like '%행정%' or new.department_name like '%심리%'
          then '사회상경'
        when new.department_name like '%수학%' or new.department_name like '%물리%'
          or new.department_name like '%화학%' or new.department_name like '%생명%' or new.department_name like '%통계%'
          then '자연'
        when new.department_name like '%공학%' or new.department_name like '%컴퓨터%'
          or new.department_name like '%전자%' or new.department_name like '%기계%' or new.department_name like '%소프트웨어%'
          or new.department_name like '%모빌리티%' or new.department_name like '%융합%'
          then '공학'
        when new.department_name like '%음악%' or new.department_name like '%미술%'
          or new.department_name like '%체육%' or new.department_name like '%디자인%'
          then '예체능'
        else '기타'
      end,
      now()
    where not exists (
      select 1 from public.mentor_school_verifications v
      where v.mentor_id = new.user_id and v.status = 'approved'
    );
  end if;
  return new;
end;
$$;

comment on function public.tmp_auto_school_verification() is
  '[임시/스테이징] 멘토 승인 시 학교인증 자동 approved 처리 — 정식 학교인증 플로우 전환 시 트리거와 함께 제거할 것';

drop trigger if exists trg_tmp_auto_school_verification on public.mentor_profiles;
create trigger trg_tmp_auto_school_verification
  after insert or update of verification_status on public.mentor_profiles
  for each row execute function public.tmp_auto_school_verification();
