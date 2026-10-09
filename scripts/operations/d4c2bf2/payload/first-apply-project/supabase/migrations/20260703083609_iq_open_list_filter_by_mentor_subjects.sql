CREATE OR REPLACE FUNCTION public.list_open_individual_questions_for_mentor(p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, subject text, topic text, title text, price_cents integer, expires_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_subjects text[];
begin
  if not public.individual_question_user_is_approved_mentor((select auth.uid())) then
    return;
  end if;

  -- 멘토 담당 과목(teaching_subjects)만 노출. 과목 없는(null) 질문은 일반 질문으로 모두에게 노출.
  select mp.teaching_subjects into v_subjects
  from public.mentor_profiles mp
  where mp.user_id = (select auth.uid());

  return query
    select
      q.id,
      q.subject,
      q.topic,
      q.title,
      q.price_cents,
      q.expires_at,
      q.created_at
    from public.individual_questions q
    where q.question_type = 'open'
      and q.status = 'open'
      and q.claimed_mentor_id is null
      and (q.expires_at is null or q.expires_at > now())
      and (q.subject is null or q.subject = any(coalesce(v_subjects, array[]::text[])))
    order by q.created_at desc
    limit v_limit;
end;
$function$;