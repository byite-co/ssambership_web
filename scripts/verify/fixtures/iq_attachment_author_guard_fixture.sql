-- iq_attachment_author_guard_fixture.sql — add_individual_question_attachment
-- 소유권·귀속 계약 실구동 fixture (스크래치 PG 전용 — 운영 적용 금지).
--
-- 검증 항목(§7 SQL 계약):
--   1. 미인증 거부(AUTH_REQUIRED)
--   2. 당사자 외 거부(NOT_QUESTION_PARTY)
--   3. storage 경로 질문 prefix 강제(STORAGE_PATH_MISMATCH)
--   4. 다른 질문 message_id 주입 거부(MESSAGE_NOT_IN_QUESTION)
--   5. 메시지 작성자 ≠ 호출자 거부(MESSAGE_AUTHOR_MISMATCH — 20260804113000)
--   6. 업로더 위조 불가 — author_id 는 서버가 auth.uid() 로만 기록
--   7. 자기 메시지 연결 정상(멘토·학생) + p_message_id null 경로 불변
--   8. 멱등 재등록 유지(existing 봉투·중복 행 0·message_id_mismatch 신호)
--   9. storage 객체 미소유 거부(STORAGE_OBJECT_NOT_OWNED)
-- (당사자 SELECT RLS 공존 검증은 staging fixture 로 대체 — local_stub 규약과 동일)
--
-- 기대 종료: 마지막 NOTICE 'IQ_ATTACHMENT_AUTHOR_GUARD FIXTURE PASS'

begin;

-- 결정적 시드 ---------------------------------------------------------------
insert into public.users (id, role) values
  ('00000000-0000-4000-8000-000000000001', 'student'),  -- s1 (q1 학생)
  ('00000000-0000-4000-8000-000000000002', 'mentor'),   -- m1 (q1 담당 멘토)
  ('00000000-0000-4000-8000-000000000003', 'student'),  -- outsider (당사자 아님)
  ('00000000-0000-4000-8000-000000000004', 'student')   -- s2 (q2 학생)
on conflict do nothing;

insert into public.individual_questions (id, student_id, claimed_mentor_id, status, title, body) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000002', 'claimed', 'q1', 'b'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004',
   null, 'escrowed', 'q2', 'b')
on conflict do nothing;

insert into public.individual_question_messages (id, question_id, author_id, body) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000001', '학생 메시지'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000002', '멘토 메시지'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000001', '학생 메시지 2'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000004', '다른 질문 메시지')
on conflict do nothing;

-- storage 객체(소유자별) — 첫 세그먼트 = 질문 uuid 규약.
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/m1-a.png',
   '00000000-0000-4000-8000-000000000002', '{"mimetype":"image/png","size":"100"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/s1-a.png',
   '00000000-0000-4000-8000-000000000001', '{"mimetype":"image/png","size":"100"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/s1-b.png',
   '00000000-0000-4000-8000-000000000001', '{"mimetype":"image/png","size":"100"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/owned-by-other.png',
   '00000000-0000-4000-8000-000000000003', '{"mimetype":"image/png","size":"100"}')
on conflict do nothing;

do $fixture$
declare
  c_q1 constant uuid := '10000000-0000-4000-8000-000000000001';
  c_s1 constant text := '00000000-0000-4000-8000-000000000001';
  c_m1 constant text := '00000000-0000-4000-8000-000000000002';
  c_out constant text := '00000000-0000-4000-8000-000000000003';
  c_msg_s1  constant uuid := '20000000-0000-4000-8000-000000000001';
  c_msg_m1  constant uuid := '20000000-0000-4000-8000-000000000002';
  c_msg_s1b constant uuid := '20000000-0000-4000-8000-000000000003';
  c_msg_q2  constant uuid := '20000000-0000-4000-8000-000000000004';
  v jsonb;
  v_author uuid;
  v_count int;
  v_failed boolean;
begin
  -- 1. 미인증 → AUTH_REQUIRED --------------------------------------------------
  perform set_config('request.jwt.claim.sub', '', true);
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/m1-a.png', 'a.png', 'image/png', null);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'AUTH_REQUIRED%' then
      raise exception 'case1: expected AUTH_REQUIRED, got %', sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'case1: unauthenticated call must fail'; end if;

  -- 2. 당사자 외 → NOT_QUESTION_PARTY ------------------------------------------
  perform set_config('request.jwt.claim.sub', c_out, true);
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/owned-by-other.png', 'a.png', 'image/png', null);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'NOT_QUESTION_PARTY%' then
      raise exception 'case2: expected NOT_QUESTION_PARTY, got %', sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'case2: outsider must be rejected'; end if;

  -- 3. 경로 prefix ≠ 질문 uuid → STORAGE_PATH_MISMATCH -------------------------
  perform set_config('request.jwt.claim.sub', c_m1, true);
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, 'other-question/x.png', 'a.png', 'image/png', null);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'STORAGE_PATH_MISMATCH%' then
      raise exception 'case3: expected STORAGE_PATH_MISMATCH, got %', sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'case3: foreign path prefix must be rejected'; end if;

  -- 4. 다른 질문의 message_id → MESSAGE_NOT_IN_QUESTION ------------------------
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/m1-a.png', 'a.png', 'image/png', c_msg_q2);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'MESSAGE_NOT_IN_QUESTION%' then
      raise exception 'case4: expected MESSAGE_NOT_IN_QUESTION, got %', sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'case4: cross-question message_id must be rejected'; end if;

  -- 5. 상대방 메시지 연결 → MESSAGE_AUTHOR_MISMATCH (가드) ---------------------
  perform set_config('request.jwt.claim.sub', c_s1, true);
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-a.png', 'a.png', 'image/png', c_msg_m1);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'MESSAGE_AUTHOR_MISMATCH%' then
      raise exception 'case5: expected MESSAGE_AUTHOR_MISMATCH, got %', sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'case5: linking to counterpart message must be rejected'; end if;

  -- 6·7. 자기 메시지 연결 정상 + author_id 는 auth.uid() 로만 기록 -------------
  perform set_config('request.jwt.claim.sub', c_m1, true);
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/m1-a.png', 'a.png', 'image/png', c_msg_m1);
  if v->>'status' <> 'created' or (v->>'ok')::boolean is not true then
    raise exception 'case6: mentor self-message link must create, got %', v;
  end if;
  select author_id into v_author from public.individual_question_attachments
   where id = (v->>'attachment_id')::uuid;
  if v_author is distinct from c_m1::uuid then
    raise exception 'case6: author_id must equal auth.uid() (server-recorded), got %', v_author;
  end if;

  perform set_config('request.jwt.claim.sub', c_s1, true);
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-a.png', 'a.png', 'image/png', c_msg_s1);
  if v->>'status' <> 'created' then
    raise exception 'case7: student self-message link must create, got %', v;
  end if;

  -- 7b. p_message_id null(구버전 앱 경로) 불변 + author 기록 -------------------
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-b.png', 'b.png', 'image/png', null);
  if v->>'status' <> 'created' then
    raise exception 'case7b: null message_id registration must stay allowed, got %', v;
  end if;
  select author_id into v_author from public.individual_question_attachments
   where id = (v->>'attachment_id')::uuid;
  if v_author is distinct from c_s1::uuid then
    raise exception 'case7b: author_id must be recorded from auth.uid(), got %', v_author;
  end if;

  -- 8. 멱등 재등록: 같은 경로 재호출 → existing 봉투·행 1개 유지 --------------
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-a.png', 'a.png', 'image/png', c_msg_s1);
  if v->>'status' <> 'existing' or (v->>'idempotent_hit')::boolean is not true
     or (v->>'message_id_mismatch')::boolean is not false then
    raise exception 'case8: idempotent same-message retry envelope broken, got %', v;
  end if;
  -- 다른 '내' 메시지로 재호출 → 기존 행 보존 + mismatch 신호(UPDATE 없음).
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-a.png', 'a.png', 'image/png', c_msg_s1b);
  if v->>'status' <> 'existing' or (v->>'message_id_mismatch')::boolean is not true then
    raise exception 'case8b: idempotent mismatch signal broken, got %', v;
  end if;
  select count(*) into v_count from public.individual_question_attachments
   where question_id = c_q1 and storage_path = c_q1::text || '/s1-a.png';
  if v_count <> 1 then
    raise exception 'case8: duplicate rows created (%)', v_count;
  end if;
  select message_id into v_author from public.individual_question_attachments
   where question_id = c_q1 and storage_path = c_q1::text || '/s1-a.png';
  if v_author is distinct from c_msg_s1 then
    raise exception 'case8: existing row message_id must be preserved, got %', v_author;
  end if;

  -- 9. storage 객체 미소유 → STORAGE_OBJECT_NOT_OWNED --------------------------
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/owned-by-other.png', 'a.png', 'image/png', c_msg_s1);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'STORAGE_OBJECT_NOT_OWNED%' then
      raise exception 'case9: expected STORAGE_OBJECT_NOT_OWNED, got %', sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'case9: unowned object must be rejected'; end if;

  raise notice 'IQ_ATTACHMENT_AUTHOR_GUARD FIXTURE PASS';
end
$fixture$;

rollback; -- fixture 데이터는 남기지 않는다(재실행 안전).
