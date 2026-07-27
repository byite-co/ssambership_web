-- 149_p1_8a_storage_insert_eligibility.sql
-- Phase 1 후속(비차단) — 질문 첨부 Storage INSERT 자체에 자격 게이트 추가.
--
-- 문제: 등록 RPC(qna_register_attachment)가 자격을 최종 강제하지만, 등록 전 객체는 inert 라도
--   공격자가 등록을 호출하지 않고 Storage 에 업로드만 반복해 quota 를 소모할 수 있다(141 정책은
--   party·thread-writable·계정/승인/차단만 검사, 구독/무료·환불 자격은 미검사).
-- 해결: Storage INSERT with_check 에 "가능한 범위의" 자격 게이트를 추가한다.
--   * 학생 업로더: (활성 구독 && 해당 구독 pending 환불 없음) 또는 (구독 없음 && 경로의 thread 가
--     이 학생의 무료질문 스레드) 일 때만 허용.
--   * 멘토 업로더: 구독/환불 게이트 미적용(자격은 141 qra_uploader_allowed_for_path 의 승인·party 로 확인).
-- RLS with_check 는 잠금 불가 → 비잠금 존재검사(best-effort). 최종 원자 잠금·환불검사는 등록 RPC 가 담당.
-- 141/142 미수정. 선행: 049·141·142·136.

begin;
set local lock_timeout='5s';

create or replace function public.qra_path_upload_eligible(p_name text)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid(); v_room uuid; v_thread uuid; v_student uuid; v_mentor uuid; v_sub_id uuid;
begin
  if v_uid is null then return false; end if;
  v_room := public.qra_room_uuid_from_path(p_name);
  begin
    v_thread := nullif(split_part(p_name, '/', 2), '')::uuid;
  exception when others then
    return false;
  end;
  if v_room is null or v_thread is null then return false; end if;

  select student_id, mentor_id into v_student, v_mentor from public.mentor_student_rooms where id = v_room;
  if v_student is null then return false; end if;

  -- 멘토 업로더: 구독/무료/환불 게이트 미적용(다른 conjunct 가 승인·party 를 강제).
  if v_uid = v_mentor then return true; end if;
  if v_uid <> v_student then return false; end if;

  -- 경로의 thread 가 이 room 소속이어야 한다(임의 thread 세그먼트 위조 차단).
  if not exists (
    select 1 from public.question_threads t where t.id = v_thread and t.mentor_student_room_id = v_room
  ) then
    return false;
  end if;

  -- 활성 구독 경로: 해당 구독에 live pending 환불이 없어야 자격(142 helper 재사용, current-event 기준).
  select id into v_sub_id from public.subscriptions
    where student_id = v_student and mentor_id = v_mentor and lower(coalesce(status,'')) = 'active' limit 1;
  if v_sub_id is not null then
    return not public.qna_subscription_has_live_refund(v_sub_id);
  end if;

  -- 구독 없음 → 경로의 thread 가 이 학생의 무료질문 스레드일 때만 자격.
  return exists (
    select 1 from public.free_question_usage f where f.thread_id = v_thread and f.student_id = v_student
  );
end; $$;
revoke all on function public.qra_path_upload_eligible(text) from public, anon;
grant execute on function public.qra_path_upload_eligible(text) to authenticated, service_role;

-- Storage INSERT 정책에 자격 conjunct 추가(141 정책 재정의 — party·writable·uploader-allowed 유지 + eligibility).
drop policy if exists qra_storage_insert_party on storage.objects;
create policy qra_storage_insert_party on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'question-room-attachments'
    and public.user_is_room_party_for_qra_path(name)
    and public.qra_thread_writable_for_path(name)
    and public.qra_uploader_allowed_for_path(name)
    and public.qra_path_upload_eligible(name)
  );

commit;

-- §V(rollback-only): 활성구독+환불없음 학생 업로드 허용 · pending 환불 시 학생 업로드 거부 ·
--   구독 없고 무료 스레드면 허용 · 구독 없고 무료 아님/타 thread 위조면 거부 · 멘토 업로드 무영향.
