begin;
set local lock_timeout='5s';

create or replace function public.qra_path_upload_eligible(p_name text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_thread uuid; v_student uuid; v_mentor uuid; v_sub_id uuid;
begin
  if v_uid is null then return false; end if;
  v_room := public.qra_room_uuid_from_path(p_name);
  begin
    v_thread := nullif(split_part(p_name, '/', 2), '')::uuid;
  exception when others then
    return false;
  end;
  if v_room is null or v_thread is null then return false; end if;

  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id = v_room;
  if v_student is null then return false; end if;

  if v_uid = v_mentor then return true; end if;
  if v_uid <> v_student then return false; end if;

  if not exists (
    select 1 from public.question_threads t where t.id = v_thread and t.mentor_student_room_id = v_room
  ) then
    return false;
  end if;

  select id into v_sub_id from public.subscriptions
    where student_id = v_student and mentor_id = v_mentor and lower(coalesce(status,'')) = 'active' limit 1;
  if v_sub_id is not null then
    return not public.qna_subscription_has_live_refund(v_sub_id);
  end if;

  return exists (
    select 1 from public.free_question_usage f where f.thread_id = v_thread and f.student_id = v_student
  );
end; $$;
revoke all on function public.qra_path_upload_eligible(text) from public, anon;
grant execute on function public.qra_path_upload_eligible(text) to authenticated, service_role;

drop policy if exists qra_storage_insert_party on storage.objects;
create policy qra_storage_insert_party on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'question-room-attachments'
    and public.user_is_room_party_for_qra_path(name)
    and public.qra_thread_writable_for_path(name)
    and public.qra_uploader_allowed_for_path(name)
    and public.qra_path_upload_eligible(name)
  );

commit;