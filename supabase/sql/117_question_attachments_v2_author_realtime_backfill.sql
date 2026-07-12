-- =============================================================================
-- 117: 질문방 첨부 v2 — author_id 신설 + 레거시 마커 백필 + realtime + 마커 메시지 삭제
-- =============================================================================
-- 배경(XV-ATTACH): 웹은 서명 URL 을 메시지 본문 마커([[img]]/[[file]])로 저장·렌더,
-- 앱은 question_attachments 행 기준 렌더 — 크로스(웹↔앱) 첨부 미표시 + 웹 7일 URL 부패.
-- 확정 방향: 본문 마커 폐지, 첨부 테이블 단일 정본(첨부 v2 계약).
--   결정 ①(2026-07-12): 레거시 마커 메시지는 백필 후 삭제(A안).
--   결정 ③(2026-07-12): question_attachments 를 realtime publication 에 추가.
--
-- 실행 순서 고정: A(컬럼·정책) → C(기존 행 author 백필) → B(마커→행 백필)
--                → E(realtime) → D(마커 메시지 삭제). D 는 반드시 B·C 뒤.
-- 사전 조건: 049(버킷·스토리지 정책), 060(question_attachments 테이블·RLS) 적용 완료.
-- 검증 쿼리: 파일 하단 §V. 문제 시 관찰: 삭제 전 마커 메시지는 §V-0 으로 건수 확인.

-- -----------------------------------------------------------------------------
-- A. author_id 컬럼 + insert 정책 강화(위조 방지)
-- -----------------------------------------------------------------------------
alter table public.question_attachments
  add column if not exists author_id uuid references public.users(id) on delete set null;

comment on column public.question_attachments.author_id is
  '첨부 발신자(첨부 v2). null = author 미기록 레거시 — 클라이언트는 중립(중앙) 카드로 렌더.';

drop policy if exists question_attachments_insert_via_room on public.question_attachments;
create policy question_attachments_insert_via_room on public.question_attachments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.question_threads qt
      join public.mentor_student_rooms r on r.id = qt.mentor_student_room_id
      where qt.id = question_attachments.thread_id
        and (
          r.student_id = (select auth.uid())
          or r.mentor_id = (select auth.uid())
        )
    )
    and (
      message_id is null
      or exists (
        select 1
        from public.question_messages qm
        where qm.id = question_attachments.message_id
          and qm.thread_id = question_attachments.thread_id
      )
    )
    -- 첨부 v2: author_id 는 본인 것만(레거시 호환 위해 null 허용).
    and (author_id is null or author_id = (select auth.uid()))
  );

-- -----------------------------------------------------------------------------
-- C. 백필 2 — 이미 존재하는 linked 행의 author_id 를 연결 메시지 작성자로 채움
--    (D 에서 마커 메시지가 삭제되기 전에 발신자 정보를 보존한다)
-- -----------------------------------------------------------------------------
update public.question_attachments a
   set author_id = m.author_id
  from public.question_messages m
 where a.message_id = m.id
   and a.author_id is null;

-- -----------------------------------------------------------------------------
-- B. 백필 1 — 마커 메시지 중 연결 행이 없는 것에서 storage 경로를 추출해 행 생성
--    서명 URL 형식: .../storage/v1/object/sign/question-room-attachments/<path>?token=...
--    업로더 경로 문자셋([\w.\-/])상 URL 인코딩 없음 — '%' 포함 극단 케이스는 스킵(§V-3 로 검출).
-- -----------------------------------------------------------------------------
with markers as (
  select
    m.id          as message_id,
    m.thread_id   as thread_id,
    m.author_id   as author_id,
    m.created_at  as created_at,
    m.body        as body,
    (m.body like '[[img]]%') as is_img
  from public.question_messages m
  where (m.body like '[[img]]%' or m.body like '[[file]]%')
    and not exists (
      select 1 from public.question_attachments a where a.message_id = m.id
    )
),
parsed as (
  select
    message_id, thread_id, author_id, created_at, is_img,
    case when is_img then null
         else nullif(split_part(substr(body, length('[[file]]') + 1), '|||', 1), '')
    end as file_name,
    -- 마커 종류와 무관하게 URL 파트에서 버킷 뒤 경로를 추출
    substring(body from '/object/sign/question-room-attachments/([^?]+)') as storage_path
  from markers
)
insert into public.question_attachments
  (thread_id, message_id, author_id, storage_path, file_name, mime_type, created_at)
select
  p.thread_id,
  p.message_id,
  p.author_id,
  p.storage_path,
  coalesce(
    p.file_name,
    -- 이미지: 경로 말단에서 웹 업로더 접두(`{uuid}-`) 제거 시도
    regexp_replace(split_part(p.storage_path, '/', 3),
                   '^[0-9a-fA-F-]{36}-', '')
  ),
  case
    when p.is_img then
      case lower(regexp_replace(p.storage_path, '^.*\.', ''))
        when 'png'  then 'image/png'
        when 'jpg'  then 'image/jpeg'
        when 'jpeg' then 'image/jpeg'
        when 'webp' then 'image/webp'
        when 'gif'  then 'image/gif'
        else 'image/jpeg'
      end
    else
      case lower(regexp_replace(p.storage_path, '^.*\.', ''))
        when 'pdf'  then 'application/pdf'
        when 'zip'  then 'application/zip'
        when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        when 'pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        else 'application/octet-stream'
      end
  end,
  p.created_at
from parsed p
where p.storage_path is not null
  and position('%' in p.storage_path) = 0;  -- 인코딩 의심 경로는 스킵(§V-3)

-- -----------------------------------------------------------------------------
-- E. realtime — 앱이 상대방 첨부(standalone 포함)를 즉시 반영하도록 publication 추가
--    (재실행 안전: 이미 포함돼 있으면 duplicate_object 무시)
-- -----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.question_attachments;
exception
  when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- D. 마커 메시지 삭제(결정 ① A안) — FK on delete set null 로 행은 standalone 전환.
--    행이 확보된(백필 포함) 마커 메시지만 삭제한다. 경로 추출 실패분은 남겨 §V-3 에서 수동 처리.
-- -----------------------------------------------------------------------------
delete from public.question_messages m
 where (m.body like '[[img]]%' or m.body like '[[file]]%')
   and exists (
     select 1 from public.question_attachments a where a.message_id = m.id
   );

-- =============================================================================
-- §V. 적용 직후 검증 쿼리 (수동 실행)
-- -----------------------------------------------------------------------------
-- V-0) 삭제 전 마커 총량 파악(적용 '전'에 실행):
--   select count(*) from public.question_messages
--    where body like '[[img]]%' or body like '[[file]]%';
-- V-1) 잔존 마커 = 0 기대(경로 추출 실패분만 남을 수 있음 → V-3):
--   select count(*) from public.question_messages
--    where body like '[[img]]%' or body like '[[file]]%';
-- V-2) linked 였다가 standalone 으로 전환된 행(message_id null) 분포 확인:
--   select count(*) filter (where message_id is null) as standalone,
--          count(*) filter (where author_id is null)  as author_null
--     from public.question_attachments;
-- V-3) 경로 추출 실패로 남은 마커(수동 1건 처리 대상):
--   select id, thread_id, left(body, 120) from public.question_messages
--    where (body like '[[img]]%' or body like '[[file]]%');
-- =============================================================================
