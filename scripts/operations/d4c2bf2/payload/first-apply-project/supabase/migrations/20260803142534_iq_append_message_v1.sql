-- 개별질문 양방향 대화 RPC. qna_append_message 와 동일한 계정·차단 게이트를 적용하고,
-- 당사자(학생·지정/선점 멘토) 모두 메시지를 보낼 수 있게 한다.
-- 멘토의 첫 메시지는 기존 answer_individual_question 과 동일하게 answered 전이를 수행한다.
create or replace function public.iq_append_message(p_question_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := (select auth.uid());
  v_q public.individual_questions%rowtype;
  v_mentor uuid;
  v_is_mentor boolean;
  v_status text; v_susp timestamptz; v_norm text;
  v_message_id uuid;
  v_transitioned boolean := false;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'BODY_REQUIRED' using errcode = '22023'; end if;

  select * into v_q from public.individual_questions where id = p_question_id for update;
  if not found then raise exception 'QUESTION_NOT_FOUND' using errcode = 'P0001'; end if;

  v_mentor := coalesce(v_q.claimed_mentor_id, v_q.designated_mentor_id);
  if v_uid = v_q.student_id then v_is_mentor := false;
  elsif v_mentor is not null and v_uid = v_mentor then v_is_mentor := true;
  else raise exception 'NOT_QUESTION_PARTY' using errcode = '42501';
  end if;

  -- 계정 상태 4종 + 삭제 진행 + 상호 차단 (qna_append_message 와 동일 게이트)
  select u.status, u.suspended_until into v_status, v_susp from public.users u where u.id = v_uid;
  if not found then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  v_norm := lower(btrim(coalesce(v_status,'')));
  if v_norm = 'banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_norm = 'suspended' and (v_susp is null or v_susp > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
  if v_norm not in ('active','suspended') then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  if public.account_deletion_write_blocked(v_uid) then raise exception 'ACCOUNT_DELETION_IN_PROGRESS'; end if;
  if v_mentor is not null and public.qna_users_blocked(v_q.student_id, v_mentor) then raise exception 'BLOCKED'; end if;

  -- 상태 게이트: 종결(released/refunded/expired/canceled)은 잠금.
  -- escrowed(공개·미선점)는 멘토 미확정이라 학생만 추가 설명 가능.
  if v_q.status in ('released','refunded','expired','canceled') then
    raise exception 'QUESTION_LOCKED' using errcode = 'P0001';
  end if;
  if v_q.status = 'escrowed' and v_is_mentor then
    raise exception 'NOT_ANSWERABLE_STATUS:%', v_q.status using errcode = 'P0001';
  end if;
  if v_is_mentor and not public.individual_question_user_is_approved_mentor(v_mentor) then
    raise exception 'MENTOR_NOT_APPROVED';
  end if;

  insert into public.individual_question_messages (question_id, author_id, body)
  values (p_question_id, v_uid, btrim(p_body))
  returning id into v_message_id;

  -- 멘토 첫 답변 = answered 전이 (answer_individual_question 의 의미 보존)
  if v_is_mentor and v_q.status in ('claimed','assigned') then
    update public.individual_questions
      set status = 'answered', answered_at = coalesce(answered_at, now())
      where id = p_question_id;
    v_transitioned := true;
  end if;

  return jsonb_build_object('ok', true, 'message_id', v_message_id, 'answered_transition', v_transitioned);
end;
$$;