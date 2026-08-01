-- qna_answer_notification_per_event_fixture.sql — rollback-only 검증 fixture (F2/D-12).
-- 대상: 20260801040844_qna_answer_notification_per_event.sql (행 단위 answer 알림 계약).
-- 실행: 132/136/139/141/142/144 + F2 forward 적용 후 postgres 권한으로 전체를 한 번에 실행한다.
--   마지막 ROLLBACK 으로 모든 fixture 가 사라진다(실데이터 무변경).
-- 계약(세션 F2-A §5·§11):
--   * 멘토 메시지 행 1건 = 학생 question_answered 알림 +1 (event_key = question_answer_message:<message_id>)
--   * 멘토 단독 첨부 행 1건 = +1 (event_key = question_answer_attachment:<attachment_id>)
--   * 메시지 연결 첨부 = +0 · 학생 이벤트 = +0 · 거부된 쓰기 = +0 · 동일 행 재처리 = +0
--   * 상태 전이·first_answered_at 은 스레드당 exactly-once (기존 계약 유지)
-- 주의: 단일 트랜잭션이라 now() 이 상수 — first_answered_at "불변"은 answered_transition=false +
--   `where first_answered_at is null` 가드로 검증한다.

begin;
set local search_path to public;

-- ── fixture 사용자 ───────────────────────────────────────────────────────────
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000f2a1', 'authenticated', 'authenticated', 'fxf2-student1@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000f2a2', 'authenticated', 'authenticated', 'fxf2-student2@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000f2b1', 'authenticated', 'authenticated', 'fxf2-mentor1@test.local', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-00000000f2b2', 'authenticated', 'authenticated', 'fxf2-mentor2@test.local', now(), now());

insert into public.users (id, role, full_name, nickname, email) values
  ('00000000-0000-4000-8000-00000000f2a1', 'student', '검증학생일', null, 'fxf2-student1@test.local'),
  ('00000000-0000-4000-8000-00000000f2a2', 'student', '검증학생이', null, 'fxf2-student2@test.local'),
  ('00000000-0000-4000-8000-00000000f2b1', 'mentor', '검증멘토일', null, 'fxf2-mentor1@test.local'),
  ('00000000-0000-4000-8000-00000000f2b2', 'mentor', '검증멘토이', null, 'fxf2-mentor2@test.local')
on conflict (id) do update set
  role = excluded.role, full_name = excluded.full_name,
  nickname = excluded.nickname, email = excluded.email;

insert into public.mentor_profiles (user_id, university_name, department_name, verification_status) values
  ('00000000-0000-4000-8000-00000000f2b1', '검증대학교', '검증학과', 'approved'),
  ('00000000-0000-4000-8000-00000000f2b2', '검증대학교', '검증학과', 'pending')
on conflict (user_id) do update set
  university_name = excluded.university_name, department_name = excluded.department_name,
  verification_status = excluded.verification_status;

insert into public.mentor_student_rooms (id, student_id, mentor_id) values
  ('00000000-0000-4000-8000-00000000f2d1', '00000000-0000-4000-8000-00000000f2a1', '00000000-0000-4000-8000-00000000f2b1'),
  ('00000000-0000-4000-8000-00000000f2d2', '00000000-0000-4000-8000-00000000f2a1', '00000000-0000-4000-8000-00000000f2b2');

create temp table fx_expect (label text, got bigint, want bigint) on commit drop;

-- assert 헬퍼: 수신자·event_key 패턴별 알림/outbox 카운트.
create or replace function pg_temp.fx_n(p_recipient uuid, p_key_like text) returns bigint language sql as
$$ select count(*) from public.notifications where recipient_user_id = p_recipient and event_key like p_key_like $$;
create or replace function pg_temp.fx_o(p_recipient uuid, p_key_like text) returns bigint language sql as
$$ select count(*) from public.notification_outbox where recipient_user_id = p_recipient and dedup_key like p_key_like $$;

do $$
declare
  c_s1 uuid := '00000000-0000-4000-8000-00000000f2a1';
  c_s2 uuid := '00000000-0000-4000-8000-00000000f2a2';
  c_m1 uuid := '00000000-0000-4000-8000-00000000f2b1';
  c_m2 uuid := '00000000-0000-4000-8000-00000000f2b2';
  c_room_a uuid := '00000000-0000-4000-8000-00000000f2d1';
  c_room_b uuid := '00000000-0000-4000-8000-00000000f2d2';
  v_res jsonb; v_err text;
  v_t1 uuid; v_t2 uuid;
  v_msg1 uuid; v_msg2 uuid; v_msg3 uuid; v_msg4 uuid; v_msg5 uuid; v_smsg uuid;
  v_att1 uuid; v_att2 uuid; v_satt uuid;
  v_dm1 uuid; v_dm2 uuid; v_da1 uuid; v_da2 uuid; v_rm uuid;
  v_status text; v_first timestamptz;
  v_sub uuid; v_path text; v_msg_cnt bigint;
begin
  -- ══ R1. 회귀: 학생 스레드 생성(무료 경로) — 학생 메시지는 알림 0 ══
  perform set_config('request.fixture_uid', c_s1::text, true);
  v_res := public.qna_create_question_thread(c_room_a, '검증 질문 1', null, null, '첫 질문 본문');
  v_t1 := (v_res->>'thread_id')::uuid;
  insert into fx_expect values
    ('R1 thread created pending', (select count(*) from question_threads where id = v_t1 and status = 'pending'), 1),
    ('R1 free usage linked', (select count(*) from free_question_usage where student_id = c_s1 and mentor_id = c_m1 and thread_id = v_t1), 1),
    ('R1 student first msg no notif', pg_temp.fx_n(c_s1, '%'), 0);

  -- ══ 11-1. 최초 멘토 메시지: 전이 1 + 알림 1(message 키) ══
  perform set_config('request.fixture_uid', c_m1::text, true);
  v_res := public.qna_append_message(v_t1, '멘토 첫 답변');
  v_msg1 := (v_res->>'message_id')::uuid;
  select status, first_answered_at into v_status, v_first from question_threads where id = v_t1;
  insert into fx_expect values
    ('11-1 answered_transition true', case when (v_res->>'answered_transition')::boolean then 1 else 0 end, 1),
    ('11-1 status answered', case when v_status = 'answered' then 1 else 0 end, 1),
    ('11-1 first_answered_at set', case when v_first is not null then 1 else 0 end, 1),
    ('11-1 notif message key', pg_temp.fx_n(c_s1, 'question_answer_message:' || v_msg1::text), 1),
    ('11-1 outbox message key', pg_temp.fx_o(c_s1, 'question_answer_message:' || v_msg1::text), 1),
    ('11-1 payload contract', (select count(*) from notifications
       where recipient_user_id = c_s1 and event_key = 'question_answer_message:' || v_msg1::text
         and type = 'question_answered'
         and body = '검증멘토일님이 답변을 남겼습니다.'
         and metadata->>'link' = '/question-room/' || c_room_a::text || '?thread=' || v_t1::text
         and (metadata->>'room_id')::uuid = c_room_a
         and (metadata->>'thread_id')::uuid = v_t1
         and (metadata->>'message_id')::uuid = v_msg1), 1),
    ('11-1 total', pg_temp.fx_n(c_s1, '%'), 1);

  -- ══ 11-2. 후속 멘토 메시지: 전이 0 + 알림 +1(다른 키) ══
  v_res := public.qna_append_message(v_t1, '멘토 후속 답변');
  v_msg2 := (v_res->>'message_id')::uuid;
  insert into fx_expect values
    ('11-2 no re-transition', case when (v_res->>'answered_transition')::boolean then 1 else 0 end, 0),
    ('11-2 status still answered', (select count(*) from question_threads where id = v_t1 and status = 'answered'), 1),
    ('11-2 notif new key', pg_temp.fx_n(c_s1, 'question_answer_message:' || v_msg2::text), 1),
    ('11-2 keys distinct', case when v_msg2 is distinct from v_msg1 then 1 else 0 end, 1),
    ('11-2 total', pg_temp.fx_n(c_s1, '%'), 2),
    ('11-2 outbox total', pg_temp.fx_o(c_s1, '%'), 2);

  -- ══ 11-3. 세 번째 멘토 메시지: 알림 +1 — 스레드 dedup 충돌 없음 ══
  v_res := public.qna_append_message(v_t1, '멘토 세 번째 답변');
  v_msg3 := (v_res->>'message_id')::uuid;
  insert into fx_expect values
    ('11-3 notif third key', pg_temp.fx_n(c_s1, 'question_answer_message:' || v_msg3::text), 1),
    ('11-3 total', pg_temp.fx_n(c_s1, '%'), 3),
    ('11-3 outbox total', pg_temp.fx_o(c_s1, '%'), 3);

  -- ══ 11-4. 같은 메시지 행 재처리: 알림/outbox +0 ══
  perform public.qna_emit_answer_notification(v_t1, v_msg3, null);
  perform public.qna_emit_answer_notification(v_t1, v_msg1, null);
  insert into fx_expect values
    ('11-4 replay notif +0', pg_temp.fx_n(c_s1, '%'), 3),
    ('11-4 replay outbox +0', pg_temp.fx_o(c_s1, '%'), 3);

  -- ══ 11-5. 멘토 단독 첨부(message_id IS NULL): 알림 +1(attachment 키) ══
  v_path := c_room_a::text || '/' || v_t1::text || '/' || gen_random_uuid()::text || '-answer.png';
  insert into storage.objects (bucket_id, name, owner_id)
  values ('question-room-attachments', v_path, c_m1::text);
  v_res := public.qna_register_attachment(v_t1, v_path, 'answer.png', 'image/png', null);
  v_att1 := (v_res->>'attachment_id')::uuid;
  insert into fx_expect values
    ('11-5 no re-transition', case when (v_res->>'answered_transition')::boolean then 1 else 0 end, 0),
    ('11-5 notif attachment key', pg_temp.fx_n(c_s1, 'question_answer_attachment:' || v_att1::text), 1),
    ('11-5 body file variant', (select count(*) from notifications
       where recipient_user_id = c_s1 and event_key = 'question_answer_attachment:' || v_att1::text
         and body = '검증멘토일님이 파일을 보냈습니다.'
         and (metadata->>'attachment_id')::uuid = v_att1), 1),
    ('11-5 total', pg_temp.fx_n(c_s1, '%'), 4),
    ('11-5 outbox total', pg_temp.fx_o(c_s1, '%'), 4);

  -- 같은 첨부 행 재처리: +0
  perform public.qna_emit_answer_notification(v_t1, null, v_att1);
  insert into fx_expect values
    ('11-5 attachment replay +0', pg_temp.fx_n(c_s1, '%'), 4);

  -- ══ 11-6. 텍스트+첨부 한 번의 답변: 메시지 알림 1 + 연결 첨부 추가 알림 0 ══
  v_res := public.qna_append_message(v_t1, '자료 첨부 답변');
  v_msg4 := (v_res->>'message_id')::uuid;
  v_path := c_room_a::text || '/' || v_t1::text || '/' || gen_random_uuid()::text || '-linked.pdf';
  insert into storage.objects (bucket_id, name, owner_id)
  values ('question-room-attachments', v_path, c_m1::text);
  v_res := public.qna_register_attachment(v_t1, v_path, 'linked.pdf', 'application/pdf', v_msg4);
  v_att2 := (v_res->>'attachment_id')::uuid;
  insert into fx_expect values
    ('11-6 message notif', pg_temp.fx_n(c_s1, 'question_answer_message:' || v_msg4::text), 1),
    ('11-6 linked attachment +0', pg_temp.fx_n(c_s1, 'question_answer_attachment:' || v_att2::text), 0),
    ('11-6 answer action total 1', pg_temp.fx_n(c_s1, '%' || v_msg4::text) + pg_temp.fx_n(c_s1, '%' || v_att2::text), 1),
    ('11-6 total', pg_temp.fx_n(c_s1, '%'), 5);

  -- ══ 11-7. 학생 이벤트: 메시지/단독 첨부/연결 첨부 전부 알림 +0 ══
  perform set_config('request.fixture_uid', c_s1::text, true);
  v_res := public.qna_append_message(v_t1, '학생 추가 질문');
  v_smsg := (v_res->>'message_id')::uuid;
  v_path := c_room_a::text || '/' || v_t1::text || '/' || gen_random_uuid()::text || '-student.png';
  insert into storage.objects (bucket_id, name, owner_id)
  values ('question-room-attachments', v_path, c_s1::text);
  v_res := public.qna_register_attachment(v_t1, v_path, 'student.png', 'image/png', null);
  v_satt := (v_res->>'attachment_id')::uuid;
  v_path := c_room_a::text || '/' || v_t1::text || '/' || gen_random_uuid()::text || '-student2.png';
  insert into storage.objects (bucket_id, name, owner_id)
  values ('question-room-attachments', v_path, c_s1::text);
  perform public.qna_register_attachment(v_t1, v_path, 'student2.png', 'image/png', v_smsg);
  insert into fx_expect values
    ('11-7 student events +0', pg_temp.fx_n(c_s1, '%'), 5),
    ('11-7 student rows saved', (select count(*) from question_messages where id = v_smsg)
       + (select count(*) from question_attachments where id = v_satt), 2),
    ('11-7 mentor gets no notif', pg_temp.fx_n(c_m1, '%'), 0);

  -- ══ 회귀: pending refund 게이트(142) — 학생 쓰기 거부, 멘토 답변 무영향 ══
  insert into public.subscriptions (id, student_id, mentor_id, plan_tier, status)
  values ('00000000-0000-4000-8000-00000000f2e1', c_s1, c_m1, 'standard', 'active');
  insert into public.refunds (user_id, amount_cents, status, subscription_id, request_type)
  values (c_s1, 100000, 'pending', '00000000-0000-4000-8000-00000000f2e1', 'subscription_prorated');
  v_err := null;
  begin
    perform public.qna_append_message(v_t1, '환불 대기 중 학생 메시지');
  exception when others then v_err := sqlerrm;
  end;
  insert into fx_expect values
    ('REG refund gate student rejected', case when v_err = 'SUBSCRIPTION_REFUND_PENDING' then 1 else 0 end, 1);
  perform set_config('request.fixture_uid', c_m1::text, true);
  v_res := public.qna_append_message(v_t1, '환불 대기 중 멘토 답변');
  v_msg5 := (v_res->>'message_id')::uuid;
  insert into fx_expect values
    ('REG refund gate mentor unaffected', pg_temp.fx_n(c_s1, 'question_answer_message:' || v_msg5::text), 1),
    ('REG total after refund test', pg_temp.fx_n(c_s1, '%'), 6);
  delete from public.refunds where subscription_id = '00000000-0000-4000-8000-00000000f2e1';
  delete from public.subscriptions where id = '00000000-0000-4000-8000-00000000f2e1';

  -- ══ 11-8. 비당사자: 메시지/첨부 저장 0 + 알림 0 ══
  perform set_config('request.fixture_uid', c_s2::text, true);
  select count(*) into v_msg_cnt from question_messages where thread_id = v_t1;
  v_err := null;
  begin
    perform public.qna_append_message(v_t1, '비당사자 침입 메시지');
  exception when others then v_err := sqlerrm;
  end;
  insert into fx_expect values
    ('11-8 non-party append rejected', case when v_err = 'NOT_ROOM_PARTY' then 1 else 0 end, 1);
  v_err := null;
  begin
    perform public.qna_register_attachment(v_t1, c_room_a::text || '/' || v_t1::text || '/x-intruder.png', 'x.png', 'image/png', null);
  exception when others then v_err := sqlerrm;
  end;
  insert into fx_expect values
    ('11-8 non-party register rejected', case when v_err = 'NOT_ROOM_PARTY' then 1 else 0 end, 1),
    ('11-8 rows unchanged', (select count(*) from question_messages where thread_id = v_t1), v_msg_cnt),
    ('11-8 notif unchanged', pg_temp.fx_n(c_s1, '%') + pg_temp.fx_n(c_s2, '%'), 6);

  -- ══ 회귀: 계정 상태 차단(banned) ══
  update public.users set status = 'banned' where id = c_s1;
  perform set_config('request.fixture_uid', c_s1::text, true);
  v_err := null;
  begin
    perform public.qna_append_message(v_t1, '정지 계정 메시지');
  exception when others then v_err := sqlerrm;
  end;
  insert into fx_expect values
    ('REG banned rejected', case when v_err = 'ACCOUNT_BANNED' then 1 else 0 end, 1);
  update public.users set status = 'active' where id = c_s1;

  -- ══ 회귀: 상호 차단 — 스레드 생성 거부 ══
  insert into public.user_blocks (blocker_id, blocked_id) values (c_s1, c_m1);
  v_err := null;
  begin
    perform public.qna_create_question_thread(c_room_a, '차단 중 질문', null, null, null);
  exception when others then v_err := sqlerrm;
  end;
  insert into fx_expect values
    ('REG blocked rejected', case when v_err = 'BLOCKED' then 1 else 0 end, 1);
  delete from public.user_blocks where blocker_id = c_s1 and blocked_id = c_m1;

  -- ══ 회귀: 멘토 승인 게이트 — 미승인 멘토 방 생성 거부 ══
  v_err := null;
  begin
    perform public.qna_create_question_thread(c_room_b, '미승인 멘토 질문', null, null, null);
  exception when others then v_err := sqlerrm;
  end;
  insert into fx_expect values
    ('REG unapproved mentor rejected', case when v_err = 'MENTOR_NOT_APPROVED' then 1 else 0 end, 1);

  -- ══ 회귀: 오답 표시(학생) ══
  perform public.qna_flag_wrong_answer(v_t1, true);
  insert into fx_expect values
    ('REG wrong-answer flag', (select count(*) from question_threads
       where id = v_t1 and is_wrong_answer and mastery_status = 'wrong'), 1);

  -- ══ 11-9. confirm(회귀) → 잠금 스레드: 멘토 쓰기 거부 + 알림 0 ══
  perform public.qna_confirm_thread(v_t1);
  insert into fx_expect values
    ('REG confirmed', (select count(*) from question_threads where id = v_t1 and status = 'confirmed'), 1);
  perform set_config('request.fixture_uid', c_m1::text, true);
  select count(*) into v_msg_cnt from question_messages where thread_id = v_t1;
  v_err := null;
  begin
    perform public.qna_append_message(v_t1, '잠금 후 메시지');
  exception when others then v_err := sqlerrm;
  end;
  insert into fx_expect values
    ('11-9 locked append rejected', case when v_err = 'THREAD_LOCKED' then 1 else 0 end, 1);
  v_err := null;
  begin
    perform public.qna_register_attachment(v_t1, c_room_a::text || '/' || v_t1::text || '/locked.png', 'locked.png', 'image/png', null);
  exception when others then v_err := sqlerrm;
  end;
  insert into fx_expect values
    ('11-9 locked register rejected', case when v_err = 'THREAD_LOCKED' then 1 else 0 end, 1),
    ('11-9 rows unchanged', (select count(*) from question_messages where thread_id = v_t1), v_msg_cnt),
    ('11-9 notif unchanged', pg_temp.fx_n(c_s1, '%'), 6);

  -- ══ 직접쓰기(direct-write) 경로: 동일 행 단위 계약 (141/144 트리거 스택) ══
  -- 준비: m2 승인 후 room B 스레드 생성(학생 RPC — 무료 2번째 소비).
  update public.mentor_profiles set verification_status = 'approved' where user_id = c_m2;
  perform set_config('request.fixture_uid', c_s1::text, true);
  v_res := public.qna_create_question_thread(c_room_b, '검증 질문 2', null, null, '두 번째 질문 본문');
  v_t2 := (v_res->>'thread_id')::uuid;
  insert into fx_expect values
    ('REG free usage second mentor', (select count(*) from free_question_usage where student_id = c_s1), 2);

  -- 직접 멘토 첫 메시지(role=authenticated): 전이 + 알림 +1(message 키).
  perform set_config('request.fixture_uid', c_m2::text, true);
  execute 'set local role authenticated';
  insert into public.question_messages (thread_id, author_id, body)
  values (v_t2, c_m2, '직접쓰기 첫 답변') returning id into v_dm1;
  -- 직접 멘토 후속 메시지: 전이 0 + 알림 +1.
  insert into public.question_messages (thread_id, author_id, body)
  values (v_t2, c_m2, '직접쓰기 후속 답변') returning id into v_dm2;
  -- 직접 학생 메시지: 알림 +0.
  perform set_config('request.fixture_uid', c_s1::text, true);
  insert into public.question_messages (thread_id, author_id, body)
  values (v_t2, c_s1, '직접쓰기 학생 메시지');
  -- 직접 멘토 단독 첨부: 알림 +1(attachment 키).
  perform set_config('request.fixture_uid', c_m2::text, true);
  v_path := c_room_b::text || '/' || v_t2::text || '/' || gen_random_uuid()::text || '-direct.png';
  insert into storage.objects (bucket_id, name, owner_id)
  values ('question-room-attachments', v_path, c_m2::text);
  insert into public.question_attachments (thread_id, message_id, author_id, storage_path)
  values (v_t2, null, c_m2, v_path) returning id into v_da1;
  -- 직접 멘토 연결 첨부: 알림 +0.
  v_path := c_room_b::text || '/' || v_t2::text || '/' || gen_random_uuid()::text || '-direct-linked.png';
  insert into storage.objects (bucket_id, name, owner_id)
  values ('question-room-attachments', v_path, c_m2::text);
  insert into public.question_attachments (thread_id, message_id, author_id, storage_path)
  values (v_t2, v_dm1, c_m2, v_path) returning id into v_da2;
  -- RPC 를 authenticated 세션에서 호출해도 알림은 정확히 1(트리거 경로와 이중 발행 없음).
  v_res := public.qna_append_message(v_t2, 'authenticated 세션 RPC 답변');
  v_rm := (v_res->>'message_id')::uuid;
  execute 'reset role';

  select status, first_answered_at into v_status, v_first from question_threads where id = v_t2;
  insert into fx_expect values
    ('DW first msg transition', case when v_status = 'answered' and v_first is not null then 1 else 0 end, 1),
    ('DW first msg notif', pg_temp.fx_n(c_s1, 'question_answer_message:' || v_dm1::text), 1),
    ('DW second msg notif', pg_temp.fx_n(c_s1, 'question_answer_message:' || v_dm2::text), 1),
    ('DW standalone att notif', pg_temp.fx_n(c_s1, 'question_answer_attachment:' || v_da1::text), 1),
    ('DW linked att +0', pg_temp.fx_n(c_s1, 'question_answer_attachment:' || v_da2::text), 0),
    ('DW rpc under authenticated exactly 1', pg_temp.fx_n(c_s1, 'question_answer_message:' || v_rm::text), 1),
    ('DW total', pg_temp.fx_n(c_s1, '%'), 10),
    ('DW outbox total', pg_temp.fx_o(c_s1, '%'), 10);

  -- ══ 정합 총괄 ══
  insert into fx_expect values
    ('SUM thread-scope keys 0', (select count(*) from notifications
       where recipient_user_id in (c_s1, c_s2) and event_key like 'question_answered:%'), 0),
    ('SUM duplicate event keys 0', (select count(*) - count(distinct event_key) from notifications
       where recipient_user_id = c_s1), 0),
    ('SUM duplicate dedup keys 0', (select count(*) - count(distinct dedup_key) from notification_outbox
       where recipient_user_id = c_s1), 0),
    ('SUM outbox pairs notification', (select count(*) from notification_outbox
       where recipient_user_id = c_s1 and notification_id is null), 0),
    ('SUM others get 0', pg_temp.fx_n(c_s2, '%') + pg_temp.fx_n(c_m1, '%') + pg_temp.fx_n(c_m2, '%'), 0);
end $$;

-- ── 판정 ─────────────────────────────────────────────────────────────────────
select label, got, want, case when got = want then 'PASS' else 'FAIL' end as verdict from fx_expect order by label;
do $$
declare v_fail int;
begin
  select count(*) into v_fail from fx_expect where got is distinct from want;
  if v_fail > 0 then
    raise exception 'FIXTURE FAIL: % assertion(s) mismatched — 위 SELECT 결과 확인', v_fail;
  end if;
  raise notice 'FIXTURE PASS: all assertions matched';
end $$;

rollback;
