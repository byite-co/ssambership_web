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
--  10. MIME 불일치 거부(MIME_MISMATCH)
--  11. 크기 초과 거부(SIZE_EXCEEDED)
--  12. 계정 banned/suspended/삭제 진행 거부(ACCOUNT_*)
--  13. 레거시(message_id=null·author=null) 행의 구버전 재시도 — 가드 영향 0
--  14. 상대방 기존 첨부 경로 재등록으로 귀속 뒤집기 불가(행 불변·mismatch 신호만)
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

-- 계정 상태 케이스용 당사자(각각 자기 질문의 학생 — 당사자 게이트는 통과시키고
-- 계정 게이트에서 걸리게 한다).
insert into public.users (id, role, status, suspended_until) values
  ('00000000-0000-4000-8000-000000000007', 'student', 'banned', null),
  ('00000000-0000-4000-8000-000000000008', 'student', 'suspended', now() + interval '1 day'),
  ('00000000-0000-4000-8000-000000000009', 'student', 'active', null) -- 삭제 진행 마커
on conflict do nothing;

insert into public.individual_questions (id, student_id, status, title, body) values
  ('10000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000007', 'escrowed', 'q7', 'b'),
  ('10000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000008', 'escrowed', 'q8', 'b'),
  ('10000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000009', 'escrowed', 'q9', 'b')
on conflict do nothing;

insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000007/a.png',
   '00000000-0000-4000-8000-000000000007', '{"mimetype":"image/png","size":"10"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000008/a.png',
   '00000000-0000-4000-8000-000000000008', '{"mimetype":"image/png","size":"10"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000009/a.png',
   '00000000-0000-4000-8000-000000000009', '{"mimetype":"image/png","size":"10"}'),
  -- MIME 불일치·크기 초과 케이스(소유는 s1 — q1 경로).
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/mime-bad.png',
   '00000000-0000-4000-8000-000000000001', '{"mimetype":"image/png","size":"10"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/too-big.png',
   '00000000-0000-4000-8000-000000000001', '{"mimetype":"image/png","size":"20971521"}'),
  -- 레거시 행 재시도용 객체(레거시 행이 이미 등록돼 있어 검증은 선조회에서 끝난다).
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/legacy.png',
   '00000000-0000-4000-8000-000000000001', '{"mimetype":"image/png","size":"10"}')
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

-- 레거시 행(message_id=null·author_id=null) — 구버전 앱 시대 등록분 시뮬레이션.
-- (q1 시드 이후에 삽입해야 한다 — FK.)
insert into public.individual_question_attachments
  (id, question_id, message_id, storage_path, file_name, mime_type, author_id)
values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', null,
   '10000000-0000-4000-8000-000000000001/legacy.png', 'legacy.png', 'image/png', null)
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

  -- 10. MIME 불일치 → MIME_MISMATCH ---------------------------------------------
  perform set_config('request.jwt.claim.sub', c_s1, true);
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/mime-bad.png', 'a.pdf', 'application/pdf', null);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'MIME_MISMATCH%' then
      raise exception 'case10: expected MIME_MISMATCH, got %', sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'case10: mime mismatch must be rejected'; end if;

  -- 11. 크기 초과(20MB) → SIZE_EXCEEDED -----------------------------------------
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/too-big.png', 'a.png', 'image/png', null);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'SIZE_EXCEEDED%' then
      raise exception 'case11: expected SIZE_EXCEEDED, got %', sqlerrm;
    end if;
  end;
  if not v_failed then raise exception 'case11: oversized object must be rejected'; end if;

  -- 12. 계정 상태 게이트: banned / suspended / 삭제 진행 -------------------------
  declare
    v_case record;
  begin
    for v_case in
      select * from (values
        ('00000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000007'::uuid, 'ACCOUNT_BANNED'),
        ('00000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000008'::uuid, 'ACCOUNT_SUSPENDED'),
        ('00000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000009'::uuid, 'ACCOUNT_DELETION_IN_PROGRESS')
      ) as t(uid, qid, code)
    loop
      perform set_config('request.jwt.claim.sub', v_case.uid, true);
      v_failed := false;
      begin
        v := public.add_individual_question_attachment(
          v_case.qid, v_case.qid::text || '/a.png', 'a.png', 'image/png', null);
      exception when others then
        v_failed := true;
        if sqlerrm not like v_case.code || '%' then
          raise exception 'case12: expected %, got %', v_case.code, sqlerrm;
        end if;
      end;
      if not v_failed then
        raise exception 'case12: % account must be rejected', v_case.code;
      end if;
    end loop;
  end;

  -- 13. 레거시 행(message_id·author 모두 null) 구버전 재시도 — 가드 영향 0 -------
  perform set_config('request.jwt.claim.sub', c_s1, true);
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/legacy.png', 'legacy.png', 'image/png', null);
  if v->>'status' <> 'existing' or (v->>'idempotent_hit')::boolean is not true then
    raise exception 'case13: legacy null-message retry envelope broken, got %', v;
  end if;
  select author_id into v_author from public.individual_question_attachments
   where id = '30000000-0000-4000-8000-000000000001';
  if v_author is not null then
    raise exception 'case13: legacy row author_id must remain null (no backfill), got %', v_author;
  end if;

  -- 14. 상대방 기존 첨부 경로를 내 메시지로 재등록 → 귀속 뒤집기 불가 -----------
  -- s1-a.png 는 case7 에서 s1 이 c_msg_s1 로 등록했다. m1 이 자기 메시지로
  -- 재호출해도 기존 행은 UPDATE 되지 않는다(mismatch 신호만).
  perform set_config('request.jwt.claim.sub', c_m1, true);
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-a.png', 'a.png', 'image/png', c_msg_m1);
  if v->>'status' <> 'existing' or (v->>'message_id_mismatch')::boolean is not true then
    raise exception 'case14: cross-party re-register must be idempotent-mismatch, got %', v;
  end if;
  select message_id into v_author from public.individual_question_attachments
   where question_id = c_q1 and storage_path = c_q1::text || '/s1-a.png';
  if v_author is distinct from c_msg_s1 then
    raise exception 'case14: stored message_id flipped (%) — attribution must be immutable', v_author;
  end if;
  select author_id into v_author from public.individual_question_attachments
   where question_id = c_q1 and storage_path = c_q1::text || '/s1-a.png';
  if v_author is distinct from c_s1::uuid then
    raise exception 'case14: stored author_id flipped (%) — attribution must be immutable', v_author;
  end if;

  raise notice 'IQ_ATTACHMENT_AUTHOR_GUARD FIXTURE PASS';
end
$fixture$;

rollback; -- fixture 데이터는 남기지 않는다(재실행 안전).
