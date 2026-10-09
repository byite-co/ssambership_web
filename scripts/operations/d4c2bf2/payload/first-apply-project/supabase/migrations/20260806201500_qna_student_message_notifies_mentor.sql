-- [S1-4 2026-08-06] QA-B1 — 학생이 메시지를 보내도 멘토에게 알림이 가지 않는다.
--
-- 증상: 질문방에서 학생이 메시지를 보내도 멘토는 아무 알림을 받지 못한다.
--       멘토가 받는 건 '새 질문 등록'(스레드 생성) 하나뿐이라, 이후 대화는
--       멘토가 목록을 직접 열어봐야 안다.
--       DB 실측: question_received 2건(스레드 생성분) · question_answered 13건
--       (멘토→학생) — 학생 발신에서 생성된 멘토 수신 알림 0건.
--
-- 원인: 트리거 trg_qm_answer_notification_after 는 학생 INSERT 에도 매번
--       발화하지만, 함수 public.qna_emit_answer_notification 이
--         if auth.uid() is distinct from v_mentor then return;   -- 멘토 세션만
--       로 즉시 빠져나간다. 수신자도 v_student 로 고정돼 있고 작성자=멘토 검증도
--       걸려 있어 학생 발신은 무음 처리된다.
--       (개별질문 경로는 양방향 알림이 정상 작동한다 — 질문방만의 결함)
--
-- 수정: 발신자에 따라 방향을 나눈다.
--   · 멘토 발신 → 학생에게 question_answered  (기존 동작 그대로, 회귀 없음)
--   · 학생 발신 → 멘토에게 question_received  (신규)
--
-- 알림 타입 결정(오너 판단 2026-08-06): **기존 question_received 재사용**.
--   현재 출시 후보 앱(1.0.0+18)은 알림 타입을 정확 일치 18종으로만 인식하고
--   목록 밖 타입은 unknown → '일반 알림' + 이동 없음으로 처리한다. 새 타입을
--   지금 넣으면 앱이 업데이트되기 전까지 탭해도 이동하지 않는다. question_received
--   를 쓰면 질문방 종류로 분류되고 딥링크도 정상 동작하며, **앱 수정이 필요 없다**.
--   문구는 행의 title/body 를 그대로 렌더하므로 '새 메시지'로 정확히 구분된다.
--   유형 라벨까지 분리하려면 다음 앱 버전에서 전용 타입을 추가하면 된다.
--
-- 멱등: event_key 를 message_id 기준으로 잡아 스레드 생성 알림
--   (question_received:<thread_id>)과 절대 충돌하지 않는다.
--
-- 중복 방지: 스레드의 **첫 메시지**는 이 경로에서 알리지 않는다. 질문 생성 RPC
--   (qna_create_question_thread)가 이미 '새 질문' 알림을 보내기 때문이다 —
--   검증에서 무료질문 1건에 멘토 알림이 2건 생기는 것을 확인하고 막았다.
--   판정은 "이 스레드에 더 앞선 메시지가 있는가"로 하며, 첫 메시지를 스레드와
--   같은 트랜잭션에서 만들든(p_first_message_body 제공) 나중에 따로 보내든
--   (nullable — 무료질문 진입점이 그렇다) 동일하게 성립한다.
--   두 번째 메시지부터 이 경로가 동작한다.

create or replace function public.qna_emit_answer_notification(
  p_thread_id uuid,
  p_message_id uuid default null::uuid,
  p_attachment_id uuid default null::uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_room uuid; v_student uuid; v_mentor uuid; v_name text;
  v_key text; v_body_suffix text; v_meta jsonb;
  v_actor uuid;
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

  v_actor := (select auth.uid());

  -- ── 멘토 발신 → 학생 (기존 동작 · 불변) ────────────────────────────────
  if v_actor is not distinct from v_mentor then
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
    return;
  end if;

  -- ── 학생 발신 → 멘토 (S1-4 신규) ──────────────────────────────────────
  if v_actor is not distinct from v_student then
    if p_message_id is not null then
      if not exists (
        select 1 from public.question_messages m
        where m.id = p_message_id and m.thread_id = p_thread_id and m.author_id = v_student
      ) then return; end if;
      -- ★ 스레드의 **첫 메시지**는 이 경로에서 알리지 않는다.
      --   질문 생성 RPC(qna_create_question_thread)가 이미 '새 질문이 도착했어요'
      --   (question_received:<thread_id>)를 보내므로, 여기서 또 보내면 질문
      --   1건에 멘토 알림이 2건 생긴다(무료·구독 공통 — 검증에서 실제 확인).
      --
      --   판정 기준은 **이 스레드에 이보다 앞선 메시지가 있는가**다.
      --   앞선 것이 없으면 곧 첫 메시지 → 침묵, 있으면 → 알림.
      --   (초안이던 '스레드와 같은 트랜잭션인가'(m2.created_at = t2.created_at)는
      --    p_first_message_body 를 주지 않고 스레드만 만드는 경로에서 무너진다 —
      --    free_question_entry.createFreeThread 의 firstMessageBody 는 nullable 이라
      --    학생의 진짜 첫 메시지가 별도 트랜잭션으로 들어오고, 그러면 생성 알림과
      --    이 알림이 겹쳐 다시 2건이 된다. 그 경로까지 덮으려면 순서 비교가 맞다.)
      --   동률 created_at 도 (created_at, id) 튜플 비교로 전순서가 되어
      --   2번째 메시지를 잘못 삼키지 않는다.
      if not exists (
        select 1
          from public.question_messages m_prev
          join public.question_messages m_self on m_self.id = p_message_id
         where m_prev.thread_id = p_thread_id
           and (m_prev.created_at, m_prev.id) < (m_self.created_at, m_self.id)
      ) then return; end if;
      v_key := 'question_student_message:' || p_message_id::text;
      v_body_suffix := '님이 메시지를 보냈어요.';
      v_meta := jsonb_build_object('room_id', v_room, 'thread_id', p_thread_id, 'message_id', p_message_id);
    else
      if not exists (
        select 1 from public.question_attachments a
        where a.id = p_attachment_id and a.thread_id = p_thread_id
          and a.author_id = v_student and a.message_id is null
      ) then return; end if;
      v_key := 'question_student_attachment:' || p_attachment_id::text;
      v_body_suffix := '님이 파일을 보냈어요.';
      v_meta := jsonb_build_object('room_id', v_room, 'thread_id', p_thread_id, 'attachment_id', p_attachment_id);
    end if;

    select coalesce(nullif(btrim(full_name),''), nullif(btrim(nickname),''), '학생')
      into v_name from public.users where id = v_student;

    perform public.record_domain_notification(
      v_mentor,
      v_key,
      v_key,
      'question_received',
      '새 메시지가 도착했어요',
      coalesce(v_name,'학생') || v_body_suffix,
      '/mentor/question-room/' || v_room::text || '?thread=' || p_thread_id::text,
      v_meta,
      v_meta
    );
    return;
  end if;

  -- 방 당사자가 아닌 세션(관리자·워커 등)은 알림을 만들지 않는다.
  return;
end;
$function$;
