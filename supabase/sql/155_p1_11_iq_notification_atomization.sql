-- 155_p1_11_iq_notification_atomization.sql
-- P1-11 알림 원자화 — 개별질문(IQ) 6 이벤트. domain write(RPC·웹 직접 write 무관)와 같은 트랜잭션에서
-- record_domain_notification 를 AFTER 트리거로 호출 → 원자·멱등. 웹 best-effort 알림은 코드에서 제거.
--
-- 원자성: 트리거는 domain UPDATE/INSERT 트랜잭션 안에서 실행 → domain write 롤백 시 알림도 롤백,
--   record_domain_notification 오류 시 domain write 도 롤백(예외 미포획 — 원자 계약).
-- 멱등: (recipient,event_key)·(recipient,dedup_key) UNIQUE(132) → 재실행·중복 0. event_key={event}:{qid|mid}.
-- 커버 이벤트: individual_question_assigned/claimed/answered/released/expired_refunded/message.
-- 선행: 132(record_domain_notification)·individual_questions/individual_question_messages.

begin;
set local lock_timeout='5s';

-- 1) 상태 전이 알림(answered/released/claimed/refunded).
create or replace function public.iq_notify_status_transition()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_recipient uuid; v_type text; v_title text; v_body text; v_mentor uuid;
begin
  v_mentor := coalesce(NEW.claimed_mentor_id, NEW.designated_mentor_id);
  if NEW.status = 'answered' then
    v_recipient := NEW.student_id; v_type := 'individual_question_answered';
    v_title := '개별 질문 답변 도착'; v_body := '요청한 개별 질문에 답변이 등록됐어요.';
  elsif NEW.status = 'released' then
    v_recipient := v_mentor; v_type := 'individual_question_released';
    v_title := '개별 질문 정산 확정'; v_body := '학생이 답변을 확정해 정산이 확정됐어요.';
  elsif NEW.status = 'claimed' then
    v_recipient := NEW.student_id; v_type := 'individual_question_claimed';
    v_title := '개별 질문 수락됨'; v_body := '멘토가 개별 질문을 수락했어요.';
  elsif NEW.status = 'refunded' then
    v_recipient := NEW.student_id; v_type := 'individual_question_expired_refunded';
    v_title := '개별 질문 환불'; v_body := '개별 질문이 만료되어 캐시가 환불됐어요.';
  else
    return NEW;
  end if;
  if v_recipient is not null then
    perform public.record_domain_notification(
      v_recipient, v_type || ':' || NEW.id::text, v_type || ':' || NEW.id::text, v_type,
      v_title, v_body, null,
      jsonb_build_object('question_id', NEW.id, 'status', NEW.status),
      jsonb_build_object('question_id', NEW.id));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_iq_notify_status on public.individual_questions;
create trigger trg_iq_notify_status
  after update on public.individual_questions
  for each row when (old.status is distinct from new.status)
  execute function public.iq_notify_status_transition();

-- 2) 지정형 생성 시 멘토에게 assigned 알림.
create or replace function public.iq_notify_assigned()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if NEW.designated_mentor_id is not null then
    perform public.record_domain_notification(
      NEW.designated_mentor_id, 'individual_question_assigned:' || NEW.id::text,
      'individual_question_assigned:' || NEW.id::text, 'individual_question_assigned',
      '새 지정 개별 질문', '학생이 나를 지정해 개별 질문을 보냈어요.', null,
      jsonb_build_object('question_id', NEW.id), jsonb_build_object('question_id', NEW.id));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_iq_notify_assigned on public.individual_questions;
create trigger trg_iq_notify_assigned
  after insert on public.individual_questions
  for each row execute function public.iq_notify_assigned();

-- 3) 개별 질문 메시지 → 상대방 알림.
create or replace function public.iqm_notify_message()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_student uuid; v_mentor uuid; v_recipient uuid;
begin
  select student_id, coalesce(claimed_mentor_id, designated_mentor_id)
    into v_student, v_mentor from public.individual_questions where id = NEW.question_id;
  if NEW.author_id = v_student then v_recipient := v_mentor;
  elsif NEW.author_id = v_mentor then v_recipient := v_student;
  else v_recipient := null; end if;
  if v_recipient is not null then
    perform public.record_domain_notification(
      v_recipient, 'individual_question_message:' || NEW.id::text,
      'individual_question_message:' || NEW.id::text, 'individual_question_message',
      '개별 질문 새 메시지', '개별 질문에 새 메시지가 도착했어요.', null,
      jsonb_build_object('question_id', NEW.question_id, 'message_id', NEW.id),
      jsonb_build_object('question_id', NEW.question_id, 'message_id', NEW.id));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_iqm_notify_message on public.individual_question_messages;
create trigger trg_iqm_notify_message
  after insert on public.individual_question_messages
  for each row execute function public.iqm_notify_message();

commit;

-- §V(rollback-only): answered/released/claimed/refunded 전이 시 수신자별 notification+outbox 1건(멱등) ·
--   지정 생성 시 멘토 assigned 1건 · 메시지 INSERT 시 상대방 1건 · domain write 롤백 시 알림 0 ·
--   재실행/중복 전이 시 (recipient,event_key) UNIQUE 로 중복 0.
