-- 159_p1_11_custom_request_notification_atomization.sql
-- [적용됨 — ssambership-staging 에 2026-07-20 단일 execute_sql(전문 그대로) 적용. staging fixture C 절
--   전부 PASS(rollback-only)·baseline 복원 확인. 원장 미기재 — 적용 이력: docs/audit/sql_apply_manifest.md]
-- P1-11 알림 원자화 — 맞춤의뢰 2 이벤트. domain write 와 같은 트랜잭션에서
-- record_domain_notification 를 AFTER 트리거로 호출 → 원자·멱등. 웹 best-effort 알림은 코드에서 제거.
--
-- 원자성: 트리거는 domain INSERT 트랜잭션 안에서 실행 → domain write 롤백 시 알림도 롤백,
--   record_domain_notification 오류 시 domain write 도 롤백(예외 미포획 — 원자 계약).
-- 멱등: (recipient,event_key) UNIQUE(132) → 재실행·중복 0. event_key = {event}:{row id}.
-- 커버 이벤트:
--   new_application    custom_request_applications INSERT → 의뢰 글 작성자에게
--   new_order_message  custom_order_messages INSERT → 주문 상대방(학생↔멘토)에게.
--                      작성자가 당사자가 아니면(관리자 등) 무발화.
-- 선행: 157(notification_display_name 헬퍼)·132(record_domain_notification)·
--   003(custom_request_posts/applications/orders·custom_order_messages).

begin;
set local lock_timeout='5s';

-- 1) 맞춤의뢰 지원서 INSERT → 의뢰 글 작성자 알림.
create or replace function public.cra_notify_new_application()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_author uuid;
begin
  select p.author_id into v_author from public.custom_request_posts p where p.id = NEW.post_id;
  if v_author is not null and v_author is distinct from NEW.mentor_id then
    perform public.record_domain_notification(
      v_author,
      'new_application:' || NEW.id::text,
      'new_application:' || NEW.id::text,
      'new_application',
      '새 지원서가 도착했어요',
      public.notification_display_name(NEW.mentor_id) || '님이 의뢰에 지원했습니다.',
      '/custom-request/' || NEW.post_id::text || '/applications/waiting',
      jsonb_build_object('post_id', NEW.post_id, 'mentor_id', NEW.mentor_id, 'application_id', NEW.id),
      jsonb_build_object('post_id', NEW.post_id, 'application_id', NEW.id));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_cra_notify_new_application on public.custom_request_applications;
create trigger trg_cra_notify_new_application
  after insert on public.custom_request_applications
  for each row execute function public.cra_notify_new_application();

-- 2) 주문방 메시지 INSERT → 상대방 알림.
create or replace function public.com_notify_new_order_message()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_student uuid;
  v_mentor uuid;
  v_recipient uuid;
  v_sender_role text;
begin
  select o.student_id, o.mentor_id into v_student, v_mentor
  from public.custom_request_orders o where o.id = NEW.custom_request_order_id;
  if NEW.author_id = v_student then
    v_recipient := v_mentor; v_sender_role := 'student';
  elsif NEW.author_id = v_mentor then
    v_recipient := v_student; v_sender_role := 'mentor';
  else
    v_recipient := null;
  end if;
  if v_recipient is not null and v_recipient is distinct from NEW.author_id then
    perform public.record_domain_notification(
      v_recipient,
      'new_order_message:' || NEW.id::text,
      'new_order_message:' || NEW.id::text,
      'new_order_message',
      '주문방에 새 메시지가 왔어요',
      public.notification_display_name(NEW.author_id) || '님이 메시지를 보냈습니다.',
      '/custom-request/orders/' || NEW.custom_request_order_id::text,
      jsonb_build_object('order_id', NEW.custom_request_order_id, 'sender_id', NEW.author_id,
        'sender_role', v_sender_role, 'message_id', NEW.id),
      jsonb_build_object('order_id', NEW.custom_request_order_id, 'message_id', NEW.id));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_com_notify_new_order_message on public.custom_order_messages;
create trigger trg_com_notify_new_order_message
  after insert on public.custom_order_messages
  for each row execute function public.com_notify_new_order_message();

commit;

-- §V(rollback-only): 지원서 INSERT 시 글 작성자 1건(자기 글 지원 무발화) · 메시지 INSERT 시 상대방 1건
--   (학생→멘토·멘토→학생, 제3자 작성 무발화) · 재실행 중복 0 · domain write 롤백 시 알림 0.
