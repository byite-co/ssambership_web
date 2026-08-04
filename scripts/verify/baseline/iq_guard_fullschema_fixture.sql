-- iq_guard_fullschema_fixture.sql — PR60 가드 계약 fixture 의 '실 스키마' 변형.
-- 대상: baseline+원장 replay 로 재현된 전체 스키마(스크래치 또는 Preview Branch).
-- 정본 fixture(스텁용)와의 차이:
--   * auth.users 선시드(public.users FK), question_type/price_cents 포함(070 NOT NULL)
--   * 계정 '삭제 진행' 케이스 제외(실 구현은 삭제 saga 행 필요 — 스텁 전용 케이스)
--   * storage.objects 직접 삽입은 'RPC 계약 검증용 보조 수단'이다 — 실제 업로드
--     경로(JWT Storage API) 검증을 대체한다고 주장하지 않는다.
-- 전체를 트랜잭션으로 감싸고 rollback — 데이터 잔재 0.

begin;

-- auth 선시드(FK 충족) — 실 auth 스키마/스텁 양쪽 호환.
insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004'),
  ('00000000-0000-4000-8000-000000000007'),
  ('00000000-0000-4000-8000-000000000008')
on conflict (id) do nothing;

insert into public.users (id, role) values
  ('00000000-0000-4000-8000-000000000001', 'student'),
  ('00000000-0000-4000-8000-000000000002', 'mentor'),
  ('00000000-0000-4000-8000-000000000003', 'student'),
  ('00000000-0000-4000-8000-000000000004', 'student')
on conflict (id) do nothing;
-- 087 트리거가 auth.users 시드 시 public.users 를 status='active' 로 선생성하므로
-- banned/suspended 는 upsert 로 확정한다(ON CONFLICT DO NOTHING 이면 active 로 남는다).
insert into public.users (id, role, status, suspended_until) values
  ('00000000-0000-4000-8000-000000000007', 'student', 'banned', null),
  ('00000000-0000-4000-8000-000000000008', 'student', 'suspended', now() + interval '1 day')
on conflict (id) do update
  set role = excluded.role, status = excluded.status, suspended_until = excluded.suspended_until;

insert into public.individual_questions (id, student_id, claimed_mentor_id, status, question_type, price_cents, title, body, create_idempotency_key) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000002', 'claimed', 'open', 500000, 'q1', 'b', 'fx-key-q1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004',
   null, 'escrowed', 'open', 500000, 'q2', 'b', 'fx-key-q2'),
  ('10000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000007',
   null, 'escrowed', 'open', 500000, 'q7', 'b', 'fx-key-q7'),
  ('10000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000008',
   null, 'escrowed', 'open', 500000, 'q8', 'b', 'fx-key-q8')
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

insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000007/a.png',
   '00000000-0000-4000-8000-000000000007', '{"mimetype":"image/png","size":"100"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000008/a.png',
   '00000000-0000-4000-8000-000000000008', '{"mimetype":"image/png","size":"100"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/m1-a.png',
   '00000000-0000-4000-8000-000000000002', '{"mimetype":"image/png","size":"100"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/s1-a.png',
   '00000000-0000-4000-8000-000000000001', '{"mimetype":"image/png","size":"100"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/s1-b.png',
   '00000000-0000-4000-8000-000000000001', '{"mimetype":"image/png","size":"100"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/owned-by-other.png',
   '00000000-0000-4000-8000-000000000003', '{"mimetype":"image/png","size":"100"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/mime-bad.png',
   '00000000-0000-4000-8000-000000000001', '{"mimetype":"image/png","size":"10"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/too-big.png',
   '00000000-0000-4000-8000-000000000001', '{"mimetype":"image/png","size":"20971521"}'),
  ('individual-question-attachments', '10000000-0000-4000-8000-000000000001/legacy.png',
   '00000000-0000-4000-8000-000000000001', '{"mimetype":"image/png","size":"10"}')
on conflict do nothing;

-- 레거시 행(message_id·author_id null) — 구버전 등록분 시뮬레이션.
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
  v jsonb; v_author uuid; v_count int; v_failed boolean;
begin
  -- 1. 미인증 → AUTH_REQUIRED
  perform set_config('request.jwt.claim.sub', '', true);
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/m1-a.png', 'a.png', 'image/png', null);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'AUTH_REQUIRED%' then raise exception 'case1: expected AUTH_REQUIRED, got %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'case1: unauthenticated call must fail'; end if;

  -- 2. 비당사자 → NOT_QUESTION_PARTY
  perform set_config('request.jwt.claim.sub', c_out, true);
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/owned-by-other.png', 'a.png', 'image/png', null);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'NOT_QUESTION_PARTY%' then raise exception 'case2: expected NOT_QUESTION_PARTY, got %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'case2: outsider must be rejected'; end if;

  -- 3. 경로 prefix 위조 → STORAGE_PATH_MISMATCH
  perform set_config('request.jwt.claim.sub', c_m1, true);
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, 'other-question/x.png', 'a.png', 'image/png', null);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'STORAGE_PATH_MISMATCH%' then raise exception 'case3: expected STORAGE_PATH_MISMATCH, got %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'case3: foreign path prefix must be rejected'; end if;

  -- 4. 교차 질문 message_id → MESSAGE_NOT_IN_QUESTION
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/m1-a.png', 'a.png', 'image/png', c_msg_q2);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'MESSAGE_NOT_IN_QUESTION%' then raise exception 'case4: expected MESSAGE_NOT_IN_QUESTION, got %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'case4: cross-question message_id must be rejected'; end if;

  -- 5. 상대방 메시지 연결 → MESSAGE_AUTHOR_MISMATCH (가드)
  perform set_config('request.jwt.claim.sub', c_s1, true);
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-a.png', 'a.png', 'image/png', c_msg_m1);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'MESSAGE_AUTHOR_MISMATCH%' then raise exception 'case5: expected MESSAGE_AUTHOR_MISMATCH, got %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'case5: counterpart-message link must be rejected'; end if;

  -- 5b. 반대 방향(멘토→학생 메시지) → MESSAGE_AUTHOR_MISMATCH
  perform set_config('request.jwt.claim.sub', c_m1, true);
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/m1-a.png', 'a.png', 'image/png', c_msg_s1);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'MESSAGE_AUTHOR_MISMATCH%' then raise exception 'case5b: expected MESSAGE_AUTHOR_MISMATCH, got %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'case5b: mentor→student-message link must be rejected'; end if;

  -- 6·7. 자기 메시지 연결 정상 + author_id = auth.uid() 서버 기록
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/m1-a.png', 'a.png', 'image/png', c_msg_m1);
  if v->>'status' <> 'created' then raise exception 'case6: mentor self link must create, got %', v; end if;
  select author_id into v_author from public.individual_question_attachments where id = (v->>'attachment_id')::uuid;
  if v_author is distinct from c_m1::uuid then raise exception 'case6: author_id must equal auth.uid(), got %', v_author; end if;

  perform set_config('request.jwt.claim.sub', c_s1, true);
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-a.png', 'a.png', 'image/png', c_msg_s1);
  if v->>'status' <> 'created' then raise exception 'case7: student self link must create, got %', v; end if;

  -- 7b. p_message_id null(구버전) 경로 불변
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-b.png', 'b.png', 'image/png', null);
  if v->>'status' <> 'created' then raise exception 'case7b: null message_id must stay allowed, got %', v; end if;
  select author_id into v_author from public.individual_question_attachments where id = (v->>'attachment_id')::uuid;
  if v_author is distinct from c_s1::uuid then raise exception 'case7b: author_id must be recorded, got %', v_author; end if;

  -- 8. 멱등 재등록 + mismatch 신호 + 행 불변
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-a.png', 'a.png', 'image/png', c_msg_s1);
  if v->>'status' <> 'existing' or (v->>'idempotent_hit')::boolean is not true
     or (v->>'message_id_mismatch')::boolean is not false then
    raise exception 'case8: idempotent retry envelope broken, got %', v;
  end if;
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-a.png', 'a.png', 'image/png', c_msg_s1b);
  if v->>'status' <> 'existing' or (v->>'message_id_mismatch')::boolean is not true then
    raise exception 'case8b: mismatch signal broken, got %', v;
  end if;
  select count(*) into v_count from public.individual_question_attachments
   where question_id = c_q1 and storage_path = c_q1::text || '/s1-a.png';
  if v_count <> 1 then raise exception 'case8: duplicate rows (%)', v_count; end if;

  -- 9. storage 미소유 → STORAGE_OBJECT_NOT_OWNED
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/owned-by-other.png', 'a.png', 'image/png', c_msg_s1);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'STORAGE_OBJECT_NOT_OWNED%' then raise exception 'case9: expected STORAGE_OBJECT_NOT_OWNED, got %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'case9: unowned object must be rejected'; end if;

  -- 10. MIME 불일치 → MIME_MISMATCH
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/mime-bad.png', 'a.pdf', 'application/pdf', null);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'MIME_MISMATCH%' then raise exception 'case10: expected MIME_MISMATCH, got %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'case10: mime mismatch must be rejected'; end if;

  -- 11. 크기 초과 → SIZE_EXCEEDED
  v_failed := false;
  begin
    v := public.add_individual_question_attachment(c_q1, c_q1::text || '/too-big.png', 'a.png', 'image/png', null);
  exception when others then
    v_failed := true;
    if sqlerrm not like 'SIZE_EXCEEDED%' then raise exception 'case11: expected SIZE_EXCEEDED, got %', sqlerrm; end if;
  end;
  if not v_failed then raise exception 'case11: oversized must be rejected'; end if;

  -- 12. 계정 banned / suspended (삭제 진행 케이스는 스텁 전용)
  declare v_case record;
  begin
    for v_case in
      select * from (values
        ('00000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000007'::uuid, 'ACCOUNT_BANNED'),
        ('00000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000008'::uuid, 'ACCOUNT_SUSPENDED')
      ) as t(uid, qid, code)
    loop
      perform set_config('request.jwt.claim.sub', v_case.uid, true);
      v_failed := false;
      begin
        v := public.add_individual_question_attachment(v_case.qid, v_case.qid::text || '/a.png', 'a.png', 'image/png', null);
      exception when others then
        v_failed := true;
        if sqlerrm not like v_case.code || '%' then raise exception 'case12: expected %, got %', v_case.code, sqlerrm; end if;
      end;
      if not v_failed then raise exception 'case12: % must be rejected', v_case.code; end if;
    end loop;
  end;

  -- 13. 레거시 null·null 재시도 — 가드 영향 0·백필 0
  perform set_config('request.jwt.claim.sub', c_s1, true);
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/legacy.png', 'legacy.png', 'image/png', null);
  if v->>'status' <> 'existing' or (v->>'idempotent_hit')::boolean is not true then
    raise exception 'case13: legacy retry envelope broken, got %', v;
  end if;
  select author_id into v_author from public.individual_question_attachments
   where id = '30000000-0000-4000-8000-000000000001';
  if v_author is not null then raise exception 'case13: legacy author_id backfilled (%)', v_author; end if;

  -- 14. 귀속 뒤집기 불가(행 불변)
  perform set_config('request.jwt.claim.sub', c_m1, true);
  v := public.add_individual_question_attachment(c_q1, c_q1::text || '/s1-a.png', 'a.png', 'image/png', c_msg_m1);
  if v->>'status' <> 'existing' or (v->>'message_id_mismatch')::boolean is not true then
    raise exception 'case14: cross-party re-register must be idempotent-mismatch, got %', v;
  end if;
  select message_id into v_author from public.individual_question_attachments
   where question_id = c_q1 and storage_path = c_q1::text || '/s1-a.png';
  if v_author is distinct from c_msg_s1 then raise exception 'case14: message_id flipped (%)', v_author; end if;
  select author_id into v_author from public.individual_question_attachments
   where question_id = c_q1 and storage_path = c_q1::text || '/s1-a.png';
  if v_author is distinct from c_s1::uuid then raise exception 'case14: author_id flipped (%)', v_author; end if;

  raise notice 'IQ_ATTACHMENT_AUTHOR_GUARD FULLSCHEMA FIXTURE PASS (15 cases)';
end
$fixture$;

rollback;
