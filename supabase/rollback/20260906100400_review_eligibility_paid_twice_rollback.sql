-- =============================================================================
-- 20260906100400_review_eligibility_paid_twice_rollback.sql  (DB-5 묶음 E 롤백)
-- =============================================================================
-- forward: supabase/sql/208_review_eligibility_paid_twice.sql
-- 되돌리는 것: api_app_v1.review_eligibility_self(uuid) DROP → public.check_review_eligibility(uuid,uuid) 를 170 라이브 원문(md5 7f458145…)으로 복원
--   → core_private.review_eligibility_impl(uuid,uuid) DROP. 정책 reviews_insert_student(126) 은 forward 가 만지지 않았다(같은 함수를 계속 참조).
-- 데이터: forward 기간에 작성된 리뷰는 그대로 남는다(자격 규칙이 느슨한 쪽으로 돌아가므로 위반 행이 생기지 않는다).
-- =============================================================================

begin;

drop function if exists api_app_v1.review_eligibility_self(uuid);

-- 170 원문 복원 (라이브 pg_get_functiondef 원문 · md5 7f458145b70b0eb239a0c67f265a4c93)
CREATE OR REPLACE FUNCTION public.check_review_eligibility(p_mentor_id uuid, p_student_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_mentor_id is null or p_student_id is null then
    return false;
  end if;

  -- (B) 구독 관계
  if exists (
    select 1
    from public.subscriptions s
    where s.student_id = p_student_id
      and s.mentor_id = p_mentor_id
      and s.status in ('active', 'expired', 'cancel_scheduled')
  ) then
    return true;
  end if;

  -- (C) 완료된 개별질문
  if exists (
    select 1
    from public.individual_questions q
    where q.student_id = p_student_id
      and coalesce(q.claimed_mentor_id, q.designated_mentor_id) = p_mentor_id
      and q.status in ('answered', 'released')
  ) then
    return true;
  end if;

  return false;
end;
$function$;

drop function if exists core_private.review_eligibility_impl(uuid, uuid);

do $$
begin
  if md5(pg_get_functiondef('public.check_review_eligibility(uuid,uuid)'::regprocedure)) <> '7f458145b70b0eb239a0c67f265a4c93' then
    raise exception '208_ROLLBACK_SELFCHECK: check_review_eligibility 원문 불일치';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where (n.nspname, p.proname) in (('core_private', 'review_eligibility_impl'), ('api_app_v1', 'review_eligibility_self'))) then
    raise exception '208_ROLLBACK_SELFCHECK: 함수 잔존';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reviews' and policyname = 'reviews_insert_student'
                   and with_check like '%check_review_eligibility(mentor_id%') then
    raise exception '208_ROLLBACK_SELFCHECK: reviews_insert_student 정책 소실';
  end if;
end $$;

commit;
