-- 144_p1_8a_direct_write_eligibility.sql
-- P1-8A 반려 보정 (1-1/1-2/1-3) — 141/142 미수정, 가드 함수 재정의(신규 파일).
--
-- 1-1 직접 thread 생성 한도 우회: 직접 question_threads INSERT 에서 전 자격을 BEFORE 가드가 강제하고,
--     무료 경로는 AFTER 트리거가 free_question_usage(thread_id 링크)를 원자 소비한다. 구버전의 별도
--     usage INSERT(thread_id NULL, 직접)는 안전한 멱등 no-op(시간 근접 휴리스틱 없음).
-- 1-2 직접 멘토 answered: 콘텐츠 없이 status만 answered 로 바꾸는 직접 UPDATE 거부(DIRECT_ANSWERED_VIA_CONTENT_ONLY).
--     멘토 첫 실제 메시지/첨부는 AFTER 트리거가 self-gating 헬퍼(멘토 본인 + 실제 멘토 콘텐츠 존재 확인)를
--     호출해 pending/open→answered + canonical question_answered exactly-once 처리(0회 발송 아님).
-- 1-3 업로드 자격: qra_uploader_allowed_for_path 에 양방향 차단 추가(계정·멘토는 141). 활성구독/무료 자격·
--     pending refund 는 등록 RPC(qna_register_attachment)가 정본 기록으로 강제(업로드 객체는 등록 전 inert,
--     실패 시 보상 삭제) — 층위 방어.
-- 판별: qna_* RPC(owner=postgres)=current_user 'postgres', 직접='authenticated'. 가드/AFTER 트리거는 INVOKER,
--     answered 전이 헬퍼는 self-gating DEFINER(내부 UPDATE 는 postgres 컨텍스트라 qt 가드 skip).
-- 선행: 136/139/141/142.

begin;
set local lock_timeout='5s';

-- 멘토 첫 콘텐츠 → answered 전이 + exactly-once 알림. self-gating: 호출자=room 멘토 AND 실제 멘토 콘텐츠 존재.
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
revoke all on function public.qna_apply_answered_transition(uuid) from public, anon;
grant execute on function public.qna_apply_answered_transition(uuid) to authenticated, service_role;

-- 양방향 차단 검사(DEFINER: INVOKER 트리거가 RLS 로 상대의 차단 행을 못 보는 문제 방지).
create or replace function public.qna_users_blocked(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.user_blocks where (blocker_id=p_a and blocked_id=p_b) or (blocker_id=p_b and blocked_id=p_a));
$$;
revoke all on function public.qna_users_blocked(uuid,uuid) from public, anon;
grant execute on function public.qna_users_blocked(uuid,uuid) to authenticated, service_role;

-- 1-1: 직접 thread INSERT 전 자격 강제. UPDATE 는 직접 answered/first_answered 거부.
create or replace function public.qt_direct_write_guard()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_student uuid; v_mentor uuid; v_status text; v_suspended_until timestamptz;
  v_created_at timestamptz; v_total int; v_per int; v_has_sub boolean; v_usage json; v_sub_id uuid;
begin
  if not public.qna_is_direct_untrusted_writer() then return NEW; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id = NEW.mentor_student_room_id;
  if TG_OP = 'INSERT' then
    if v_student is null then raise exception 'ROOM_NOT_FOUND'; end if;
    if v_uid is distinct from v_student then raise exception 'DIRECT_CREATE_STUDENT_ONLY'; end if;
    if coalesce(NEW.status,'pending') not in ('pending','open') then raise exception 'DIRECT_INSERT_STATUS_FORBIDDEN'; end if;
    if NEW.first_answered_at is not null or NEW.confirmed_at is not null then raise exception 'DIRECT_INSERT_WORKFLOW_FIELDS_FORBIDDEN'; end if;
    select status, suspended_until, created_at into v_status, v_suspended_until, v_created_at from public.users where id=v_student;
    if lower(coalesce(v_status,'active'))='banned' then raise exception 'ACCOUNT_BANNED'; end if;
    if lower(coalesce(v_status,'active'))='suspended' and (v_suspended_until is null or v_suspended_until > now()) then raise exception 'ACCOUNT_SUSPENDED'; end if;
    if public.qna_users_blocked(v_student, v_mentor) then raise exception 'BLOCKED'; end if;
    if not public.individual_question_user_is_approved_mentor(v_mentor) then raise exception 'MENTOR_NOT_APPROVED'; end if;
    v_has_sub := exists (select 1 from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active');
    if v_has_sub then
      select id into v_sub_id from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active';
      if v_sub_id is not null and public.qna_subscription_has_live_refund(v_sub_id) then raise exception 'SUBSCRIPTION_REFUND_PENDING'; end if;
      v_usage := public.get_weekly_question_usage(v_student, v_mentor);
      if not coalesce((v_usage->>'can_ask')::boolean, false) then raise exception 'WEEKLY_LIMIT_EXHAUSTED'; end if;
    else
      if v_created_at is not null and now() >= v_created_at + interval '7 days' then raise exception 'FREE_QUOTA_EXPIRED'; end if;
      select count(*) into v_total from public.free_question_usage where student_id=v_student;
      if v_total >= 7 then raise exception 'FREE_QUOTA_TOTAL_EXHAUSTED'; end if;
      select count(*) into v_per from public.free_question_usage where student_id=v_student and mentor_id=v_mentor;
      if v_per >= 3 then raise exception 'FREE_QUOTA_MENTOR_EXHAUSTED'; end if;
    end if;
    return NEW;
  end if;
  if NEW.status is distinct from OLD.status then
    if NEW.status = 'answered' then raise exception 'DIRECT_ANSWERED_VIA_CONTENT_ONLY'; end if;
    if NEW.status = 'confirmed' and v_uid is distinct from v_student then raise exception 'DIRECT_CONFIRM_STUDENT_ONLY'; end if;
  end if;
  if NEW.first_answered_at is distinct from OLD.first_answered_at then raise exception 'DIRECT_FIRST_ANSWERED_VIA_CONTENT_ONLY'; end if;
  if (NEW.is_wrong_answer is distinct from OLD.is_wrong_answer or NEW.mastery_status is distinct from OLD.mastery_status) and v_uid is distinct from v_student then raise exception 'DIRECT_WRONG_FLAG_STUDENT_ONLY'; end if;
  return NEW;
end; $$;

-- 1-1: 직접 무료 thread 생성 후(AFTER, thread FK 존재) 무료 usage 원자 소비.
create or replace function public.qt_direct_consume_free_usage()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
declare v_student uuid; v_mentor uuid;
begin
  if not public.qna_is_direct_untrusted_writer() then return NEW; end if;
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id = NEW.mentor_student_room_id;
  if not exists (select 1 from public.subscriptions where student_id=v_student and mentor_id=v_mentor and lower(coalesce(status,''))='active') then
    insert into public.free_question_usage (student_id, mentor_id, thread_id) values (v_student, v_mentor, NEW.id);
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_qt_direct_consume_free_usage on public.question_threads;
create trigger trg_qt_direct_consume_free_usage after insert on public.question_threads for each row execute function public.qt_direct_consume_free_usage();

-- 1-1: 구버전 별도 usage INSERT(thread_id NULL, 직접) 안전 멱등 no-op(AFTER 트리거가 정본 소비).
create or replace function public.fqu_legacy_standalone_noop()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
begin
  if public.qna_is_direct_untrusted_writer() and NEW.thread_id is null then return null; end if;
  return NEW;
end; $$;
drop trigger if exists trg_fqu_legacy_standalone_noop on public.free_question_usage;
create trigger trg_fqu_legacy_standalone_noop before insert on public.free_question_usage for each row execute function public.fqu_legacy_standalone_noop();

-- 1-2/1-3 BEFORE 가드: 종료 스레드·경로·owner 위조 거부(answered 전이는 AFTER 에서).
create or replace function public.qm_direct_write_guard()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
declare v_status text;
begin
  if not public.qna_is_direct_untrusted_writer() then return NEW; end if;
  select status into v_status from public.question_threads where id = NEW.thread_id;
  if v_status in ('confirmed','closed','archived') then raise exception 'DIRECT_MSG_THREAD_LOCKED'; end if;
  return NEW;
end; $$;

create or replace function public.qa_direct_write_guard()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
declare v_room uuid; v_status text;
begin
  if not public.qna_is_direct_untrusted_writer() then return NEW; end if;
  select mentor_student_room_id, status into v_room, v_status from public.question_threads where id = NEW.thread_id;
  if v_status in ('confirmed','closed','archived') then raise exception 'DIRECT_ATT_THREAD_LOCKED'; end if;
  if NEW.storage_path is null or NEW.storage_path not like (v_room::text||'/'||NEW.thread_id::text||'/%') then raise exception 'DIRECT_ATT_PATH_FORGERY'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='question-room-attachments' and o.name=NEW.storage_path and o.owner_id=auth.uid()::text) then raise exception 'DIRECT_ATT_OBJECT_NOT_OWNED'; end if;
  return NEW;
end; $$;

-- 1-2 AFTER: 직접 멘토 첫 메시지/첨부 → self-gating answered 전이.
create or replace function public.qm_direct_answered_after()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
begin
  if public.qna_is_direct_untrusted_writer() then perform public.qna_apply_answered_transition(NEW.thread_id); end if;
  return NEW;
end; $$;
drop trigger if exists trg_qm_direct_answered_after on public.question_messages;
create trigger trg_qm_direct_answered_after after insert on public.question_messages for each row execute function public.qm_direct_answered_after();

create or replace function public.qa_direct_answered_after()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
begin
  if public.qna_is_direct_untrusted_writer() then perform public.qna_apply_answered_transition(NEW.thread_id); end if;
  return NEW;
end; $$;
drop trigger if exists trg_qa_direct_answered_after on public.question_attachments;
create trigger trg_qa_direct_answered_after after insert on public.question_attachments for each row execute function public.qa_direct_answered_after();

-- 1-3: 업로드 자격 helper 에 양방향 차단 추가(계정·멘토는 141).
create or replace function public.qra_uploader_allowed_for_path(p_name text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v_room uuid; v_student uuid; v_mentor uuid; v_uid uuid := auth.uid(); v_status text;
begin
  if v_uid is null then return false; end if;
  v_room := public.qra_room_uuid_from_path(p_name);
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id = v_room;
  if v_student is null then return false; end if;
  select status into v_status from public.users where id = v_uid;
  if lower(coalesce(v_status,'active')) = 'banned' then return false; end if;
  if lower(coalesce(v_status,'active')) = 'suspended' then
    if exists (select 1 from public.users where id=v_uid and (suspended_until is null or suspended_until > now())) then return false; end if;
  end if;
  if v_uid = v_mentor and not public.individual_question_user_is_approved_mentor(v_mentor) then return false; end if;
  if public.qna_users_blocked(v_student, v_mentor) then return false; end if;
  return true;
end; $$;

commit;

-- §V(rollback-only, PASS): 직접 thread-only 생성이 무료 usage 원자 소비(4번째 멘토별 거부)·구버전 standalone
--   usage no-op·직접 status-only answered 거부·멘토 첫 메시지 answered+exactly-once·RPC(postgres) 무영향.
