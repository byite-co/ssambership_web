-- 139_p1_8a_attachment_storage_contract.sql
-- P1-8A 첨부 Storage 계약 완결 — 136 을 수정하지 않는 수렴 보정.
--
-- 배경: 049 는 question-room-attachments INSERT(party via path)·SELECT(party/admin) 정책만 두고
--       DELETE 정책이 없어 보상 삭제가 조용히 실패했다. 등록 RPC 도 storage 객체 존재·owner 를 대조하지 않았다.
-- 안전: 추가형(DELETE 정책 신설) + INSERT 정책 조건 강화(당사자 + 경로 thread 소속 + 쓰기가능 상태).
--       기존 direct-write 테이블 정책·049 SELECT/INSERT 존재 자체는 유지(앱 전환 전 최종 제거 금지).
-- 선행: 136(RPC), 049(qra storage), 132(record_domain_notification).

begin;
set local lock_timeout='5s';

-- 경로의 thread 세그먼트가 room 에 속하고 쓰기 가능한 상태인지 검사(경로 = {room}/{thread}/{uuid}-name).
create or replace function public.qra_thread_writable_for_path(p_name text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1
    from public.question_threads t
    where t.id = nullif(split_part(p_name, '/', 2), '')::uuid
      and t.mentor_student_room_id = public.qra_room_uuid_from_path(p_name)
      and coalesce(t.status, '') in ('pending','open','answered')
  );
$$;
revoke all on function public.qra_thread_writable_for_path(text) from public, anon;
grant execute on function public.qra_thread_writable_for_path(text) to authenticated, service_role;

-- 업로드 INSERT 정책 강화: 당사자 + 경로 thread 소속 + 쓰기가능 상태.
--  (자격(무료/구독)은 등록 RPC 가 authoritative 하게 재검사하고, 실패 시 미등록 객체를 보상 삭제한다.)
drop policy if exists qra_storage_insert_party on storage.objects;
create policy qra_storage_insert_party on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'question-room-attachments'
    and public.user_is_room_party_for_qra_path(name)
    and public.qra_thread_writable_for_path(name)
  );

-- 보상 DELETE 정책: 본인 소유(owner_id=auth.uid()) + 미등록 객체만. 활성 스레드 조건 없음.
--  등록된 question_attachments.storage_path 객체는 삭제 불가. 타인 객체 삭제 거부.
drop policy if exists qra_storage_delete_unregistered_owner on storage.objects;
create policy qra_storage_delete_unregistered_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'question-room-attachments'
    and owner_id = (select auth.uid())::text
    and not exists (
      select 1 from public.question_attachments a where a.storage_path = storage.objects.name
    )
  );

-- 등록 RPC 강화: storage 객체 존재 + 정확 bucket + owner_id=auth.uid() 대조 추가.
create or replace function public.qna_register_attachment(
  p_thread_id uuid, p_storage_path text, p_file_name text default null, p_mime_type text default null, p_message_id uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_thread_status text;
  v_first_answered timestamptz; v_att_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_mentor_name text;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_storage_path is null or btrim(p_storage_path)='' then raise exception 'STORAGE_PATH_REQUIRED'; end if;
  select t.mentor_student_room_id, t.status, t.first_answered_at into v_room, v_thread_status, v_first_answered
    from public.question_threads t where t.id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if v_uid=v_mentor then v_is_mentor:=true; elsif v_uid=v_student then v_is_mentor:=false; else raise exception 'NOT_ROOM_PARTY'; end if;
  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;
  -- 경로 thread-id 일치({room}/{thread}/...).
  if p_storage_path not like (v_room::text || '/' || p_thread_id::text || '/%') then raise exception 'STORAGE_PATH_MISMATCH'; end if;
  -- storage 객체 존재 + 정확 bucket + owner_id=auth.uid().
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id='question-room-attachments' and o.name = btrim(p_storage_path)
      and o.owner_id = v_uid::text
  ) then raise exception 'STORAGE_OBJECT_NOT_OWNED'; end if;
  if p_message_id is not null and not exists (select 1 from public.question_messages m where m.id=p_message_id and m.thread_id=p_thread_id) then raise exception 'MESSAGE_THREAD_MISMATCH'; end if;

  insert into public.question_attachments (thread_id, message_id, author_id, storage_path, file_name, mime_type)
  values (p_thread_id, p_message_id, v_uid, btrim(p_storage_path), p_file_name, p_mime_type) returning id into v_att_id;

  if v_is_mentor and v_first_answered is null then
    update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
    v_transitioned := true;
    select coalesce(nullif(btrim(full_name),''), nullif(btrim(nickname),''), '멘토') into v_mentor_name from public.users where id=v_mentor;
    perform public.record_domain_notification(v_student, 'question_answered:'||p_thread_id::text, 'question_answered:'||p_thread_id::text,
      'question_answered','새 답변이 도착했어요', coalesce(v_mentor_name,'멘토')||'님이 파일을 보냈습니다.',
      '/question-room/'||v_room::text||'?thread='||p_thread_id::text,
      jsonb_build_object('room_id',v_room,'thread_id',p_thread_id), jsonb_build_object('room_id',v_room,'thread_id',p_thread_id));
  end if;
  return jsonb_build_object('ok',true,'attachment_id',v_att_id,'answered_transition',v_transitioned);
end; $$;

revoke all on function public.qna_register_attachment(uuid,text,text,text,uuid) from public, anon;
grant execute on function public.qna_register_attachment(uuid,text,text,text,uuid) to authenticated, service_role;

commit;

-- §V: (a) INSERT 정책 = party+thread+writable, (b) DELETE 정책 owner+미등록만,
--     (c) 등록 RPC 가 미소유/미존재 객체 STORAGE_OBJECT_NOT_OWNED 거부, (d) 등록된 객체 DELETE 거부.
