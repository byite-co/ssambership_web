-- 20260801040844_qna_answer_notification_per_event.sql
-- F2(D-12): 구독 질문방 답변 알림을 "스레드당 1회" → "멘토 답변 이벤트당 정확히 1회"로 수정.
--
-- 결함(운영 QA D-12):
--   1) 136/139/142/144 의 question_answered 알림은 최초 답변 상태 전이(first_answered_at IS NULL)
--      분기 안에서만 발행돼, 후속 멘토 답변은 알림 생성 함수 자체가 실행되지 않았다.
--   2) event_key/dedup_key 가 'question_answered:<thread_id>' 스레드 단위라, 최초 답변 조건만
--      제거해도 후속 알림이 UNIQUE(recipient,event_key)/(recipient,dedup_key) 에 무음 흡수된다.
--
-- 수정 후 계약:
--   * 상태 전이(pending/open→answered + first_answered_at): 스레드당 exactly-once — 기존 유지.
--   * 답변 알림: 멘토 답변 이벤트(메시지 행 / 단독 첨부 행)당 exactly-once — 행 단위 멱등 키.
--       - 멘토 메시지 1건        → event_key = 'question_answer_message:<message_id>'   → 알림 +1
--       - 멘토 단독 첨부 1건     → event_key = 'question_answer_attachment:<attachment_id>' → 알림 +1
--         (message_id IS NULL 인 첨부만 독립 이벤트)
--       - 메시지 연결 첨부       → 메시지 이벤트에 합류, 추가 알림 +0 (텍스트+첨부 한 답변 = 알림 1)
--       - 학생 메시지/첨부·저장 실패·비당사자·잠금 스레드 거부·기존 과거 행·동일 행 재처리 → 알림 +0
--   * 알림 책임 단일화 (R1 보정 반영): 알림은 question_messages/question_attachments 의
--     신규 AFTER INSERT 알림 트리거(qm/qa_answer_notification_after — SECURITY DEFINER)가
--     내부 helper `qna_emit_answer_notification` 을 호출해서만 발행한다.
--     RPC 경로(qna_append_message/qna_register_attachment)와 허용된 direct-write 경로 모두
--     같은 INSERT 행이 같은 트리거를 정확히 1회 발화 → 이중 발행 경로 없음.
--   * helper 외부 호출 차단 (R1): `qna_emit_answer_notification` 은 Data API 호출 표면이 아니다.
--     PUBLIC/anon/authenticated/service_role EXECUTE 전면 회수 — owner(postgres) 내부
--     (SECURITY DEFINER 알림 트리거 함수) 실행만 가능하다. 과거 message_id/attachment_id 를
--     직접 전달하는 수동 RPC 는 permission denied 로 거부되며 소급 알림을 만들 수 없다.
--     알림 발생 출처는 canonical INSERT 트랜잭션(위 4경로)으로 한정된다.
--   * 원자성: 알림 트리거는 INSERT 와 같은 트랜잭션에서 실행되므로(132 결정 C 계약 동일)
--     record_domain_notification 실패 시 메시지/첨부 저장까지 전체 롤백된다. 부분 성공 없음.
--   * 함수 identity 불변: qna_append_message(uuid,text)·qna_register_attachment(uuid,text,text,text,uuid)·
--     qna_apply_answered_transition(uuid) 의 이름/인자/반환형/SECURITY DEFINER/search_path/EXECUTE ACL 유지.
--     144 의 qm_direct_answered_after/qa_direct_answered_after(전이 트리거)는 수정하지 않는다.
--   * 기존 'question_answered:<thread_id>' 키로 적재된 과거 알림 행은 백필·삭제하지 않는다.
--
-- 선행: 132(record_domain_notification/outbox) · 136 · 139 · 141 · 142 · 144.
-- rollback: supabase/rollback/20260801040844_qna_answer_notification_per_event_rollback.sql

begin;
set local lock_timeout = '5s';

-- ── 0) 기준선 사전 게이트: 정본 함수 identity + 멱등 UNIQUE 계약 확인 ──
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'qna_append_message'
                   and pg_get_function_identity_arguments(p.oid) = 'p_thread_id uuid, p_body text') then
    raise exception 'F2_BASELINE_OBJECT_MISMATCH: canonical qna_append_message missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'qna_register_attachment'
                   and pg_get_function_identity_arguments(p.oid)
                       = 'p_thread_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_message_id uuid') then
    raise exception 'F2_BASELINE_OBJECT_MISMATCH: canonical qna_register_attachment missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'qna_apply_answered_transition'
                   and pg_get_function_identity_arguments(p.oid) = 'p_thread_id uuid') then
    raise exception 'F2_BASELINE_OBJECT_MISMATCH: canonical qna_apply_answered_transition missing';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'record_domain_notification') then
    raise exception 'F2_BASELINE_OBJECT_MISMATCH: record_domain_notification missing (132 선행)';
  end if;
  if not exists (select 1 from pg_indexes
                 where schemaname = 'public' and indexname = 'uq_notifications_recipient_event') then
    raise exception 'F2_BASELINE_OBJECT_MISMATCH: uq_notifications_recipient_event missing (132 선행)';
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'notification_outbox_recipient_dedup_uq'
                   and conrelid = 'public.notification_outbox'::regclass) then
    raise exception 'F2_BASELINE_OBJECT_MISMATCH: notification_outbox_recipient_dedup_uq missing (132 선행)';
  end if;
end$$;

-- ── 1) 신규 내부 helper: 멘토 답변 이벤트(행 단위) → 학생 question_answered 알림 exactly-once ──
--   ⚠️ owner-only 내부 함수(R1): 외부 EXECUTE 0 — 아래 AFTER INSERT 알림 트리거 함수
--   (SECURITY DEFINER, owner=postgres)에서만 호출된다. Data API 직접 RPC 는 permission denied.
--   self-gating(144 계약 동형): 호출 세션 auth.uid() = room 멘토 AND 대상 행의 author = room 멘토.
--   메시지 스코프: 해당 스레드의 멘토 메시지 행. 첨부 스코프: message_id IS NULL 인 멘토 단독 첨부 행만
--   (메시지 연결 첨부는 메시지 이벤트에 합류 — 추가 알림 없음). 조건 불충족 시 무발화 no-op.
--   멱등: record_domain_notification 의 UNIQUE(recipient,event_key)/(recipient,dedup_key)
--   ON CONFLICT DO NOTHING — 같은 행 재처리 시 알림/outbox +0.
create or replace function public.qna_emit_answer_notification(
  p_thread_id uuid,
  p_message_id uuid default null,
  p_attachment_id uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_room uuid; v_student uuid; v_mentor uuid; v_name text;
  v_key text; v_body_suffix text; v_meta jsonb;
begin
  if p_thread_id is null then return; end if;
  -- 정확히 하나의 행 스코프(메시지 XOR 단독첨부)만 허용 — 호출 계약 위반은 즉시 실패(무음 금지).
  if (p_message_id is null) = (p_attachment_id is null) then
    raise exception 'ANSWER_EVENT_SCOPE_REQUIRED';
  end if;

  select t.mentor_student_room_id into v_room
  from public.question_threads t where t.id = p_thread_id;
  if v_room is null then return; end if;

  select student_id, mentor_id into v_student, v_mentor
  from public.mentor_student_rooms where id = v_room;
  if v_student is null then return; end if;

  if auth.uid() is distinct from v_mentor then return; end if;  -- 멘토 세션만

  if p_message_id is not null then
    if not exists (
      select 1 from public.question_messages m
      where m.id = p_message_id and m.thread_id = p_thread_id and m.author_id = v_mentor
    ) then return; end if;
    v_key := 'question_answer_message:' || p_message_id::text;
    v_body_suffix := '님이 답변을 남겼습니다.';
    v_meta := jsonb_build_object('room_id', v_room, 'thread_id', p_thread_id, 'message_id', p_message_id);
  else
    if not exists (
      select 1 from public.question_attachments a
      where a.id = p_attachment_id and a.thread_id = p_thread_id
        and a.author_id = v_mentor and a.message_id is null
    ) then return; end if;
    v_key := 'question_answer_attachment:' || p_attachment_id::text;
    v_body_suffix := '님이 파일을 보냈습니다.';
    v_meta := jsonb_build_object('room_id', v_room, 'thread_id', p_thread_id, 'attachment_id', p_attachment_id);
  end if;

  select coalesce(nullif(btrim(full_name),''), nullif(btrim(nickname),''), '멘토')
    into v_name from public.users where id = v_mentor;

  perform public.record_domain_notification(
    v_student,
    v_key,
    v_key,
    'question_answered',
    '새 답변이 도착했어요',
    coalesce(v_name,'멘토') || v_body_suffix,
    '/question-room/' || v_room::text || '?thread=' || p_thread_id::text,
    v_meta,
    v_meta
  );
end;
$$;

comment on function public.qna_emit_answer_notification(uuid, uuid, uuid) is
  'F2(D-12)+R1: 멘토 답변 이벤트(메시지 행/단독 첨부 행)당 학생 question_answered 알림 exactly-once. event_key = question_answer_message:<message_id> | question_answer_attachment:<attachment_id>. 메시지 연결 첨부는 메시지 이벤트에 합류(추가 알림 0). self-gating: auth.uid()=room 멘토 AND 행 author=멘토. owner-only 내부 함수 — 외부(PUBLIC/anon/authenticated/service_role) EXECUTE 0, AFTER INSERT 알림 트리거(qm/qa_answer_notification_after)에서만 실행. Data API 호출 표면 아님 — 과거 행 ID 수동 전달로 소급 알림 생성 불가.';

-- R1: 외부 EXECUTE 전면 회수 — owner(postgres) 내부 실행만 허용. GRANT 없음.
revoke all on function public.qna_emit_answer_notification(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- ── 2) qna_apply_answered_transition: 상태 전이 전용으로 축소(알림 책임 제거) ──
--   144 계약 유지: 멘토 첫 실제 콘텐츠에서만 pending/open→answered + first_answered_at exactly-once.
--   알림은 본 함수에서 더 이상 발행하지 않는다(호출측이 qna_emit_answer_notification 사용).
create or replace function public.qna_apply_answered_transition(p_thread_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_room uuid; v_status text; v_first timestamptz; v_student uuid; v_mentor uuid;
begin
  select mentor_student_room_id, status, first_answered_at into v_room, v_status, v_first from public.question_threads where id=p_thread_id;
  if v_room is null then return; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id=v_room;
  if auth.uid() is distinct from v_mentor then return; end if;          -- 멘토만
  if v_first is not null or v_status not in ('pending','open') then return; end if;
  if not exists (select 1 from public.question_messages m where m.thread_id=p_thread_id and m.author_id=v_mentor)
     and not exists (select 1 from public.question_attachments a where a.thread_id=p_thread_id and a.author_id=v_mentor) then
    return; -- content-less: no-op
  end if;
  update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
end; $$;

comment on function public.qna_apply_answered_transition(uuid) is
  'P1-8A(144)→F2(D-12): 멘토 첫 실제 콘텐츠 → pending/open→answered + first_answered_at 스레드당 exactly-once. 알림 발행 책임은 F2 에서 qna_emit_answer_notification 로 분리됐다(본 함수는 전이 전용).';

revoke all on function public.qna_apply_answered_transition(uuid) from public, anon;
grant execute on function public.qna_apply_answered_transition(uuid) to authenticated, service_role;

-- ── 3) qna_append_message: 142 본문 유지 — 전이 분기에서 알림 발행 제거(전이만 수행) ──
--   알림은 본 RPC 가 직접 발행하지 않는다(R1) — INSERT 가 AFTER INSERT 알림 트리거(§5)를
--   정확히 1회 발화해 행 단위 알림이 발생한다(최초/후속 무관).
create or replace function public.qna_append_message(p_thread_id uuid, p_body text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_status text; v_thread_status text;
  v_first_answered timestamptz; v_message_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_sub_id uuid;
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
  -- 학생 후속 메시지: 활성 구독 FOR UPDATE + live pending refund 게이트(142 유지).
  if not v_is_mentor then
    select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active' for update;
    if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
  end if;

  -- F2(D-12)+R1: 아래 INSERT 가 AFTER INSERT 알림 트리거를 발화 — 멘토 메시지 행 1건 = 알림 정확히 1건.
  insert into public.question_messages (thread_id, author_id, body) values (p_thread_id, v_uid, btrim(p_body)) returning id into v_message_id;
  if v_is_mentor and v_first_answered is null then
    update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
    v_transitioned := true;
  end if;
  return jsonb_build_object('ok',true,'message_id',v_message_id,'answered_transition',v_transitioned);
end; $$;

revoke all on function public.qna_append_message(uuid,text) from public, anon;
grant execute on function public.qna_append_message(uuid,text) to authenticated, service_role;

-- ── 4) qna_register_attachment: 142 본문 유지 — 전이 분기에서 알림 발행 제거(전이만 수행) ──
--   알림은 본 RPC 가 직접 발행하지 않는다(R1) — INSERT 가 AFTER INSERT 알림 트리거(§5)를
--   정확히 1회 발화한다. 멘토 단독 첨부(message_id IS NULL)만 알림 +1,
--   메시지 연결 첨부는 해당 메시지 이벤트에 합류 — 추가 알림 없음(helper self-gate).
create or replace function public.qna_register_attachment(
  p_thread_id uuid, p_storage_path text, p_file_name text default null, p_mime_type text default null, p_message_id uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_student uuid; v_mentor uuid; v_thread_status text;
  v_first_answered timestamptz; v_att_id uuid; v_is_mentor boolean; v_transitioned boolean := false; v_sub_id uuid;
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

  -- F2(D-12)+R1: 아래 INSERT 가 AFTER INSERT 알림 트리거를 발화 — 멘토 단독 첨부 행 1건 = 알림 정확히 1건.
  insert into public.question_attachments (thread_id, message_id, author_id, storage_path, file_name, mime_type)
  values (p_thread_id, p_message_id, v_uid, btrim(p_storage_path), p_file_name, p_mime_type) returning id into v_att_id;
  if v_is_mentor and v_first_answered is null then
    update public.question_threads set status='answered', first_answered_at=now(), updated_at=now() where id=p_thread_id and first_answered_at is null;
    v_transitioned := true;
  end if;
  return jsonb_build_object('ok',true,'attachment_id',v_att_id,'answered_transition',v_transitioned);
end; $$;

revoke all on function public.qna_register_attachment(uuid,text,text,text,uuid) from public, anon;
grant execute on function public.qna_register_attachment(uuid,text,text,text,uuid) to authenticated, service_role;

-- ── 5) AFTER INSERT 알림 트리거 (R1 — 단일 알림 발행 경로) ──
--   RPC INSERT(정의자 postgres)와 허용된 direct-write INSERT(authenticated) 모두
--   같은 AFTER INSERT 알림 트리거를 정확히 1회 통과한다. 트리거 함수는 SECURITY DEFINER
--   (owner=postgres)라 owner-only helper 를 호출할 수 있고, helper 의 self-gate 가
--   학생 행·연결 첨부·비멘토 세션(service_role 단독 INSERT 포함)을 무발화 no-op 처리한다.
--   INSERT 없는 알림 생성 경로는 존재하지 않는다(helper 외부 EXECUTE 0).
--   144 의 전이 트리거(trg_qm/qa_direct_answered_after — 상태 전이 전용)는 수정하지 않는다.
create or replace function public.qm_answer_notification_after()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.qna_emit_answer_notification(NEW.thread_id, NEW.id, null);
  return NEW;
end; $$;
revoke all on function public.qm_answer_notification_after()
  from public, anon, authenticated, service_role;

create or replace function public.qa_answer_notification_after()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.qna_emit_answer_notification(NEW.thread_id, null, NEW.id);
  return NEW;
end; $$;
revoke all on function public.qa_answer_notification_after()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_qm_answer_notification_after on public.question_messages;
create trigger trg_qm_answer_notification_after
  after insert on public.question_messages
  for each row execute function public.qm_answer_notification_after();

drop trigger if exists trg_qa_answer_notification_after on public.question_attachments;
create trigger trg_qa_answer_notification_after
  after insert on public.question_attachments
  for each row execute function public.qa_answer_notification_after();

commit;

-- §V (rollback-only fixture: scripts/verify/fixtures/qna_answer_notification_per_event_fixture.sql):
--   최초 멘토 메시지(전이 1·알림 1·message 키) · 후속 메시지 2건(전이 0·알림 각 +1·키 상이) ·
--   동일 행 재처리(+0) · 단독 첨부(+1·attachment 키) · 연결 첨부(+0, 텍스트+첨부 합계 1) ·
--   학생 메시지/첨부(+0) · 비당사자/잠금 스레드 거부(행 0·알림 0) · 직접쓰기 경로 동일 계약 ·
--   기존 회귀(생성/무료소비/confirm/wrong/차단/미승인) 무변 ·
--   R1: helper/알림 트리거 함수 외부 EXECUTE 0(anon/authenticated/service_role/PUBLIC) ·
--   과거 멘토 메시지/단독 첨부 ID 수동 RPC = permission denied·알림 delta 0 ·
--   RPC INSERT 1회당 알림 정확히 1(이중 발행 0).
