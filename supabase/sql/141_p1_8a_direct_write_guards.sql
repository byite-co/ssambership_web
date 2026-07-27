-- 141_p1_8a_direct_write_guards.sql
-- P1-8A 최종 보안 마감 — 앱 호환 direct-write 우회 방어(서버 트리거) + 업로드 정책 계정/멘토 강제.
--
-- 배경: 앱 전환 전 direct-write 정책(qt_write_via_room/qt_update_via_room/qm_insert/
--       question_attachments_insert_via_room/fqu_insert_own)은 유지한다. 그러나 직접 호출로
--       워크플로 불변식을 우회할 수 없도록 DB 트리거로 강제한다.
-- 판별: 신규 qna_* RPC 는 SECURITY DEFINER(owner=postgres)라 실행 중 current_user='postgres'.
--       PostgREST 직접 write 는 current_user='authenticated'/'anon'. → 직접 write 만 가드한다.
-- 안전: 순수 추가형(트리거·정책 강화). 139 미수정. 무료 한도는 기존 check_free_question_usage_limits
--       트리거가 유지, fqu RLS 는 student_id=auth.uid() 로 타인 조작 차단.
-- 선행: 049·136·139.

begin;
set local lock_timeout='5s';

-- 직접(비신뢰) writer 판별: authenticated/anon 세션의 직접 테이블 write.
create or replace function public.qna_is_direct_untrusted_writer()
returns boolean language sql stable as $$
  select current_user in ('authenticated','anon');
$$;

-- ── Part 1: 업로드 INSERT 정책에 계정 활성 + (멘토면)승인 강제 추가 ──
create or replace function public.qra_uploader_allowed_for_path(p_name text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare v_room uuid; v_student uuid; v_mentor uuid; v_uid uuid := auth.uid(); v_status text;
begin
  if v_uid is null then return false; end if;
  v_room := public.qra_room_uuid_from_path(p_name);
  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id = v_room;
  if v_student is null then return false; end if;
  -- 계정 활성(업로더).
  select status into v_status from public.users where id = v_uid;
  if lower(coalesce(v_status,'active')) = 'banned' then return false; end if;
  if lower(coalesce(v_status,'active')) = 'suspended' then
    if exists (select 1 from public.users where id=v_uid and (suspended_until is null or suspended_until > now())) then return false; end if;
  end if;
  -- 멘토 업로더면 승인 필수.
  if v_uid = v_mentor and not public.individual_question_user_is_approved_mentor(v_mentor) then return false; end if;
  return true;
end;
$$;
revoke all on function public.qra_uploader_allowed_for_path(text) from public, anon;
grant execute on function public.qra_uploader_allowed_for_path(text) to authenticated, service_role;

drop policy if exists qra_storage_insert_party on storage.objects;
create policy qra_storage_insert_party on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'question-room-attachments'
    and public.user_is_room_party_for_qra_path(name)
    and public.qra_thread_writable_for_path(name)
    and public.qra_uploader_allowed_for_path(name)
  );

-- ── Part 2: question_threads 직접 write 워크플로 가드 ──
create or replace function public.qt_direct_write_guard()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_student uuid; v_mentor uuid;
begin
  if not public.qna_is_direct_untrusted_writer() then return NEW; end if;
  select student_id, mentor_id into v_student, v_mentor
    from public.mentor_student_rooms where id = NEW.mentor_student_room_id;
  if TG_OP = 'INSERT' then
    if coalesce(NEW.status,'pending') not in ('pending','open') then raise exception 'DIRECT_INSERT_STATUS_FORBIDDEN'; end if;
    if NEW.first_answered_at is not null or NEW.confirmed_at is not null then raise exception 'DIRECT_INSERT_WORKFLOW_FIELDS_FORBIDDEN'; end if;
    return NEW;
  end if;
  -- UPDATE: role-correct workflow transitions only.
  if NEW.status is distinct from OLD.status then
    if NEW.status = 'answered' and v_uid is distinct from v_mentor then raise exception 'DIRECT_ANSWERED_MENTOR_ONLY'; end if;
    if NEW.status = 'confirmed' and v_uid is distinct from v_student then raise exception 'DIRECT_CONFIRM_STUDENT_ONLY'; end if;
  end if;
  if NEW.first_answered_at is distinct from OLD.first_answered_at and v_uid is distinct from v_mentor then
    raise exception 'DIRECT_FIRST_ANSWERED_MENTOR_ONLY';
  end if;
  if (NEW.is_wrong_answer is distinct from OLD.is_wrong_answer or NEW.mastery_status is distinct from OLD.mastery_status)
     and v_uid is distinct from v_student then
    raise exception 'DIRECT_WRONG_FLAG_STUDENT_ONLY';
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_qt_direct_write_guard on public.question_threads;
create trigger trg_qt_direct_write_guard before insert or update on public.question_threads
  for each row execute function public.qt_direct_write_guard();

-- ── Part 2: question_messages 직접 write — 종료 스레드 거부 ──
create or replace function public.qm_direct_write_guard()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
declare v_status text;
begin
  if not public.qna_is_direct_untrusted_writer() then return NEW; end if;
  select status into v_status from public.question_threads where id = NEW.thread_id;
  if v_status in ('confirmed','closed','archived') then raise exception 'DIRECT_MSG_THREAD_LOCKED'; end if;
  return NEW;
end;
$$;
drop trigger if exists trg_qm_direct_write_guard on public.question_messages;
create trigger trg_qm_direct_write_guard before insert on public.question_messages
  for each row execute function public.qm_direct_write_guard();

-- ── Part 2: question_attachments 직접 write — 종료 스레드·경로/owner 위조 거부 ──
create or replace function public.qa_direct_write_guard()
returns trigger language plpgsql security invoker set search_path to 'public' as $$
declare v_room uuid; v_status text;
begin
  if not public.qna_is_direct_untrusted_writer() then return NEW; end if;
  select mentor_student_room_id, status into v_room, v_status from public.question_threads where id = NEW.thread_id;
  if v_status in ('confirmed','closed','archived') then raise exception 'DIRECT_ATT_THREAD_LOCKED'; end if;
  if NEW.storage_path is null or NEW.storage_path not like (v_room::text || '/' || NEW.thread_id::text || '/%') then
    raise exception 'DIRECT_ATT_PATH_FORGERY';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id='question-room-attachments' and o.name = NEW.storage_path and o.owner_id = auth.uid()::text
  ) then raise exception 'DIRECT_ATT_OBJECT_NOT_OWNED'; end if;
  return NEW;
end;
$$;
drop trigger if exists trg_qa_direct_write_guard on public.question_attachments;
create trigger trg_qa_direct_write_guard before insert on public.question_attachments
  for each row execute function public.qa_direct_write_guard();

commit;

-- §V(rollback-only): RPC(postgres) 경로 무영향 · 직접 authenticated 의 타역할 status/first_answered/
--   wrong 변경 거부 · 종료 스레드 메시지/첨부 거부 · 경로/owner 위조 거부 · 업로드 정책 정지계정/미승인멘토 거부.
