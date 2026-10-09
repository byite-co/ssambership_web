-- S17: 개별질문 첨부 등록 RPC (PR #19 초안 — 사람 승인 후 적용)
create or replace function public.add_individual_question_attachment(
  p_question_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_message_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if coalesce(btrim(p_storage_path), '') = '' then
    raise exception 'INVALID_INPUT: storage_path is required' using errcode = '22023';
  end if;

  -- 당사자(질문 학생 또는 배정 멘토)만 등록 가능.
  if not public.user_is_individual_question_party(p_question_id) then
    raise exception 'NOT_QUESTION_PARTY' using errcode = '42501';
  end if;

  -- 경로 위조 차단: 첫 세그먼트가 이 질문의 uuid 가 아니면 거부.
  if split_part(p_storage_path, '/', 1) <> p_question_id::text then
    raise exception 'STORAGE_PATH_MISMATCH' using errcode = '22023';
  end if;

  insert into public.individual_question_attachments
    (question_id, message_id, storage_path, file_name, mime_type)
  values
    (p_question_id, p_message_id, p_storage_path, p_file_name, p_mime_type)
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.add_individual_question_attachment(uuid, text, text, text, uuid) from public;
revoke all on function public.add_individual_question_attachment(uuid, text, text, text, uuid) from anon;
grant execute on function public.add_individual_question_attachment(uuid, text, text, text, uuid) to authenticated;