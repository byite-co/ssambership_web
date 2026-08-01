-- 20260801040844_qna_answer_notification_per_event_rollback.sql
-- F2(D-12) rollback — forward(20260801040844_qna_answer_notification_per_event.sql) 역원.
--
-- 복원 대상(수정 전 정본):
--   * qna_append_message(uuid,text)                              → 142 본문(스레드 키·최초 답변 분기 내 알림)
--   * qna_register_attachment(uuid,text,text,text,uuid)          → 142 본문(동일)
--   * qna_apply_answered_transition(uuid)                        → 144 본문(전이+알림 결합)
--   * qm_direct_answered_after() / qa_direct_answered_after()    → 144 본문(전이 helper 만 호출)
--   * qna_emit_answer_notification(uuid,uuid,uuid)               → DROP (forward 신규 객체)
--   * EXECUTE ACL                                                → forward 전과 동일하게 재선언
--
-- 데이터 정책: forward 적용 후 생성된 notifications/notification_outbox 행
--   (event_key 'question_answer_message:%'/'question_answer_attachment:%')은 **삭제하지 않는다**
--   (알림 데이터 삭제 rollback 금지 — 세션 F2-A 계약 §8).

begin;
set local lock_timeout = '5s';

-- ── 1) qna_append_message — 142 정본 복원 ──
create or replace function public.qna_append_message(p_thread_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_status text; v_thread_status text;
  v_first_answered timestamptz; v_message_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_mentor_name text; v_sub_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_body is null or btrim(p_body)='' then raise exception 'BODY_REQUIRED'; end if;
  select t.mentor_student_room_id, t.status, t.first_answered_at into v_room, v_thread_status, v_first_answered
    from public.question_threads t where t.id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if v_uid=v_mentor then v_is_mentor:=true; elsif v_uid=v_student then v_is_mentor:=false; else raise exception 'NOT_ROOM_PARTY'; end if;
  select status into v_status from public.users where id=v_uid;
  if lower(coalesce(v_status,'active'))='banned' then raise exception 'ACCOUNT_BANNED'; end if;
  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;
  if v_is_mentor and not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;
  -- 학생 후속 메시지: 활성 구독 FOR UPDATE + live pending refund 게이트.
  if not v_is_mentor then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
  end if;

  insert into public.question_messages (thread_id, author_id, body) values (p_thread_id, v_uid, btrim(p_body)) returning id into v_message_id;
  if v_is_mentor and v_first_answered is null then
    update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
    v_transitioned := true;
    select coalesce(nullif(btrim(full_name),''), nullif(btrim(nickname),''), '멘토') into v_mentor_name from public.users where id=v_mentor;
    perform public.record_domain_notification(v_student, 'question_answered:'||p_thread_id::text, 'question_answered:'||p_thread_id::text,
      'question_answered','새 답변이 도착했어요', coalesce(v_mentor_name,'멘토')||'님이 답변을 남겼습니다.',
      '/question-room/'||v_room::text||'?thread='||p_thread_id::text,
      jsonb_build_object('room_id',v_room,'thread_id',p_thread_id), jsonb_build_object('room_id',v_room,'thread_id',p_thread_id));
  end if;
  return jsonb_build_object('ok',true,'message_id',v_message_id,'answered_transition',v_transitioned);
end; $$;

-- ── 2) qna_register_attachment — 142 정본 복원 ──
create or replace function public.qna_register_attachment(
  p_thread_id uuid, p_storage_path text, p_file_name text default null, p_mime_type text default null, p_message_id uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_thread_status text;
  v_first_answered timestamptz; v_att_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_mentor_name text; v_sub_id uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_storage_path is null or btrim(p_storage_path)='' then raise exception 'STORAGE_PATH_REQUIRED'; end if;
  select t.mentor_student_room_id, t.status, t.first_answered_at into v_room, v_thread_status, v_first_answered
    from public.question_threads t where t.id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if v_uid=v_mentor then v_is_mentor:=true; elsif v_uid=v_student then v_is_mentor:=false; else raise exception 'NOT_ROOM_PARTY'; end if;
  if v_thread_status in ('confirmed','closed','archived') then raise exception 'THREAD_LOCKED'; end if;
  if p_storage_path not like (v_room::text || '/' || p_thread_id::text || '/%') then raise exception 'STORAGE_PATH_MISMATCH'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='question-room-attachments' and o.name = btrim(p_storage_path) and o.owner_id = v_uid::text) then raise exception 'STORAGE_OBJECT_NOT_OWNED'; end if;
  if p_message_id is not null and not exists (select 1 from public.question_messages m where m.id=p_message_id and m.thread_id=p_thread_id) then raise exception 'MESSAGE_THREAD_MISMATCH'; end if;
  if not v_is_mentor then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
  end if;

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

-- ── 3) qna_apply_answered_transition — 144 정본 복원(전이+알림 결합) ──
create or replace function public.qna_apply_answered_transition(p_thread_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_room uuid; v_status text; v_first timestamptz; v_student uuid; v_mentor uuid; v_updated int; v_name text;
begin
  select mentor_student_room_id, status, first_answered_at into v_room, v_status, v_first from public.question_threads where id=p_thread_id;
  if v_room is null then return; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if auth.uid() is distinct from v_mentor then return; end if;
  if v_first is not null or v_status not in ('pending','open') then return; end if;
  if not exists (select 1 from public.question_messages m where m.thread_id=p_thread_id and m.author_id=v_mentor)
     and not exists (select 1 from public.question_attachments a where a.thread_id=p_thread_id and a.author_id=v_mentor) then
    return; -- content-less: no-op
  end if;
  update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
  get diagnostics v_updated = row_count;
  if v_updated>0 then
    select coalesce(nullif(btrim(full_name),''),nullif(btrim(nickname),''),'멘토') into v_name from public.users where id=v_mentor;
    perform public.record_domain_notification(v_student,'question_answered:'||p_thread_id::text,'question_answered:'||p_thread_id::text,
      'question_answered','새 답변이 도착했어요',coalesce(v_name,'멘토')||'님이 답변을 남겼습니다.',
      '/question-room/'||v_room::text||'?thread='||p_thread_id::text,
      jsonb_build_object('room_id',v_room,'thread_id',p_thread_id),jsonb_build_object('room_id',v_room,'thread_id',p_thread_id));
  end if;
end; $$;

comment on function public.qna_apply_answered_transition(uuid) is null;

-- ── 4) direct-write AFTER 트리거 함수 — 144 정본 복원 ──
create or replace function public.qm_direct_answered_after()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
begin
  if public.qna_is_direct_untrusted_writer() then perform public.qna_apply_answered_transition(NEW.thread_id); end if;
  return NEW;
end; $$;

create or replace function public.qa_direct_answered_after()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
begin
  if public.qna_is_direct_untrusted_writer() then perform public.qna_apply_answered_transition(NEW.thread_id); end if;
  return NEW;
end; $$;

-- ── 5) forward 신규 helper 제거 ──
drop function if exists public.qna_emit_answer_notification(uuid, uuid, uuid);

-- ── 6) ACL 재선언(forward 전과 동일) ──
revoke all on function public.qna_append_message(uuid,text) from public, anon;
revoke all on function public.qna_register_attachment(uuid,text,text,text,uuid) from public, anon;
revoke all on function public.qna_apply_answered_transition(uuid) from public, anon;
grant execute on function public.qna_append_message(uuid,text) to authenticated, service_role;
grant execute on function public.qna_register_attachment(uuid,text,text,text,uuid) to authenticated, service_role;
grant execute on function public.qna_apply_answered_transition(uuid) to authenticated, service_role;

commit;

-- §V: rollback 후 qna_append_message/qna_register_attachment/qna_apply_answered_transition/
--   qm·qa_direct_answered_after 정의가 forward 적용 전 카탈로그와 일치하고,
--   qna_emit_answer_notification 이 부재하며, forward 기간 생성 알림 행은 그대로 남는다.
