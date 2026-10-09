CREATE OR REPLACE FUNCTION public.claim_individual_question_v2(p_question_id uuid, p_mentor_id uuid)
 RETURNS individual_question_escrow_result
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_question public.individual_questions%rowtype;
  v_required_school_tier text;
  v_required_major_category text;
  v_verified_school_tier text;
  v_verified_major_category text;
  v_question_subject text;
  v_mentor_subjects text[];
begin
  if p_question_id is null or p_mentor_id is null then
    return (false, 'invalid_input', 'question_id and mentor_id are required', p_question_id, null, null, null)::public.individual_question_escrow_result;
  end if;

  if not public.individual_question_user_is_approved_mentor(p_mentor_id) then
    return (false, 'mentor_not_approved', 'mentor is not approved for individual questions', p_question_id, null, null, null)::public.individual_question_escrow_result;
  end if;

  select
    q.required_school_tier,
    q.required_major_category,
    q.subject
    into v_required_school_tier, v_required_major_category, v_question_subject
  from public.individual_questions q
  where q.id = p_question_id
    and q.question_type = 'open'
    and q.status = 'open'
    and q.claimed_mentor_id is null
    and (q.expires_at is null or q.expires_at > now())
    and q.student_id <> p_mentor_id;

  if not found then
    return (false, 'not_available', 'question is already claimed, expired, or unavailable', p_question_id, null, null, null)::public.individual_question_escrow_result;
  end if;

  -- [과목 게이트] 멘토 담당 과목(teaching_subjects)이 아닌 질문은 맡을 수 없다. 과목 없는(null) 질문은 허용.
  if v_question_subject is not null then
    select mp.teaching_subjects into v_mentor_subjects
    from public.mentor_profiles mp
    where mp.user_id = p_mentor_id;

    if not (v_question_subject = any(coalesce(v_mentor_subjects, array[]::text[]))) then
      return (false, 'mentor_subject_not_met', 'mentor does not teach this subject', p_question_id, null, null, null)::public.individual_question_escrow_result;
    end if;
  end if;

  if v_required_school_tier is not null or v_required_major_category is not null then
    select
      msv.school_tier,
      msv.verified_major_category
      into v_verified_school_tier, v_verified_major_category
    from public.mentor_school_verifications msv
    where msv.mentor_id = p_mentor_id
      and msv.status = 'approved'
    order by coalesce(msv.reviewed_at, msv.updated_at, msv.created_at) desc, msv.created_at desc
    limit 1;

    if not found then
      return (false, 'mentor_school_verification_required', 'mentor school verification is required for this question', p_question_id, null, null, null)::public.individual_question_escrow_result;
    end if;

    if v_required_school_tier is not null
       and coalesce(v_verified_school_tier, '') <> v_required_school_tier then
      return (false, 'mentor_qualification_not_met', 'mentor school tier does not match this question requirement', p_question_id, null, null, null)::public.individual_question_escrow_result;
    end if;

    if v_required_major_category is not null
       and coalesce(v_verified_major_category, '') <> v_required_major_category then
      return (false, 'mentor_qualification_not_met', 'mentor major category does not match this question requirement', p_question_id, null, null, null)::public.individual_question_escrow_result;
    end if;
  end if;

  update public.individual_questions
  set
    claimed_mentor_id = p_mentor_id,
    claimed_at = now(),
    status = 'claimed'
  where id = p_question_id
    and question_type = 'open'
    and status = 'open'
    and claimed_mentor_id is null
    and (expires_at is null or expires_at > now())
    and student_id <> p_mentor_id
  returning * into v_question;

  if not found then
    return (false, 'not_available', 'question is already claimed, expired, or unavailable', p_question_id, null, null, null)::public.individual_question_escrow_result;
  end if;

  return (true, 'claimed', 'individual question claimed', v_question.id, v_question.status, null, null)::public.individual_question_escrow_result;
end;
$function$;