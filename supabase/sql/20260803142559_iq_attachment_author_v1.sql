-- 첨부 귀속(누가 올렸는가) 기록. 기존 행은 author 미상(null) 유지 — 화면은 null 을
-- 종전처럼 질문 말풍선 그룹으로 렌더한다.
alter table public.individual_question_attachments
  add column if not exists author_id uuid references public.users(id) on delete set null;

-- add_individual_question_attachment: INSERT 시 auth.uid() 를 author_id 로 기록.
-- 반환 계약(jsonb 키·의미)·멱등 계약(on conflict do nothing)·가드 순서는 전부 불변.
create or replace function public.add_individual_question_attachment(p_question_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_message_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_path text;
  v_id   uuid;
  v_existing_message_id uuid;
  v_created boolean := false;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  v_path := btrim(coalesce(p_storage_path, ''));
  if v_path = '' then
    raise exception 'INVALID_INPUT: storage_path is required' using errcode = '22023';
  end if;

  if not public.user_is_individual_question_party(p_question_id) then
    raise exception 'NOT_QUESTION_PARTY' using errcode = '42501';
  end if;

  if split_part(v_path, '/', 1) <> p_question_id::text then
    raise exception 'STORAGE_PATH_MISMATCH' using errcode = '22023';
  end if;

  if p_message_id is not null and not exists (
    select 1
    from public.individual_question_messages m
    where m.id = p_message_id
      and m.question_id = p_question_id
  ) then
    raise exception 'MESSAGE_NOT_IN_QUESTION' using errcode = '22023';
  end if;

  insert into public.individual_question_attachments
    (question_id, message_id, storage_path, file_name, mime_type, author_id)
  values
    (p_question_id, p_message_id, v_path, p_file_name, p_mime_type, v_uid)
  on conflict (question_id, storage_path) do nothing
  returning id into v_id;

  if v_id is not null then
    v_created := true;
  else
    select a.id, a.message_id
      into v_id, v_existing_message_id
    from public.individual_question_attachments a
    where a.question_id = p_question_id
      and a.storage_path = v_path;

    if v_id is null then
      raise exception 'REGISTER_CONFLICT_UNRESOLVED' using errcode = '40001';
    end if;
  end if;

  return jsonb_build_object(
    'ok',            true,
    'status',        case when v_created then 'created' else 'existing' end,
    'idempotent_hit', not v_created,
    'attachment_id', v_id,
    'question_id',   p_question_id,
    'storage_path',  v_path,
    'message_id_mismatch',
      case when v_created then false
           else coalesce(v_existing_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
                is distinct from coalesce(p_message_id, '00000000-0000-0000-0000-000000000000'::uuid)
      end
  );
end;
$$;
